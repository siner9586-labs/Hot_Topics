import type { CollectContext, HealthResult, RawHotItem, SourceAdapter, SourceCategory, SourceStatus, Region } from '@hot-topics/core';
import { featureFlags } from '@hot-topics/config';
import { decodeXmlEntities, fetchWithTimeout, isLikelyChallengePage, safeUrl, stableHash, stripTags } from '@hot-topics/shared';

function makeId(sourceId: string, key: string): string { return `${sourceId}:${stableHash(key)}`; }

async function checkedText(url: string, context: CollectContext, accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.7'): Promise<{ response: Response; text: string }> {
  const response = await fetchWithTimeout(url, {
    ...(context.signal ? { signal: context.signal } : {}),
    headers: {
      accept,
      'user-agent': 'HotTopicsObservatory/1.0 (+https://github.com/siner9586-labs/Hot_Topics)'
    }
  }, 12_000);
  const text = await response.text();
  if (!response.ok) throw new SourceError(response.status === 429 ? 'rate_limited' : 'unavailable', `HTTP ${response.status}`);
  if (isLikelyChallengePage(text)) throw new SourceError('unavailable', 'challenge_or_login_page');
  return { response, text };
}

async function checkedJson<T>(url: string, context: CollectContext, extraHeaders: Record<string,string> = {}): Promise<T> {
  const response = await fetchWithTimeout(url, {
    ...(context.signal ? { signal: context.signal } : {}),
    headers: {
      accept: 'application/json,text/plain,*/*',
      'user-agent': 'Mozilla/5.0 (compatible; HotTopicsObservatory/1.0; +https://github.com/siner9586-labs/Hot_Topics)',
      ...extraHeaders
    }
  }, 12_000);
  const text = await response.text();
  if (!response.ok) throw new SourceError(response.status === 429 ? 'rate_limited' : 'unavailable', `HTTP ${response.status}`);
  if (isLikelyChallengePage(text)) throw new SourceError('unavailable', 'challenge_or_login_page');
  try { return JSON.parse(text) as T; }
  catch { throw new SourceError('schema_changed', 'invalid_json'); }
}

export class SourceError extends Error {
  constructor(public readonly status: SourceStatus, message: string) { super(message); }
}

abstract class BaseAdapter implements SourceAdapter {
  abstract id: string; abstract name: string; abstract region: Region; abstract category: SourceCategory;
  abstract reliabilityWeight: number; abstract adapterVersion: string; enabled = true;
  abstract collect(context: CollectContext): Promise<RawHotItem[]>;
  async healthCheck(context: CollectContext): Promise<HealthResult> {
    const started = Date.now();
    try {
      const items = await this.collect({ ...context, runId: `${context.runId}:health` });
      return { status: items.length ? 'healthy' : 'degraded', latencyMs: Date.now() - started, detail: `${items.length} items` };
    } catch (error) {
      const status = error instanceof SourceError ? error.status : 'unavailable';
      return { status, latencyMs: Date.now() - started, detail: error instanceof Error ? error.message : 'unknown_error' };
    }
  }
}

export class BaiduHotAdapter extends BaseAdapter {
  id = 'baidu'; name = '百度热搜'; region = 'CN' as const; category = 'search' as const;
  reliabilityWeight = 1; adapterVersion = '1.0.0';
  async collect(context: CollectContext): Promise<RawHotItem[]> {
    const { text } = await checkedText('https://top.baidu.com/board?tab=realtime', context);
    const rows: Array<{ title: string; heat: number; url?: string }> = [];
    const seen = new Set<string>();
    const jsonPattern = /"word"\s*:\s*"((?:\\.|[^"\\])*)"[\s\S]{0,1500}?"hotScore"\s*:\s*"?(\d{3,})"?/g;
    for (const match of text.matchAll(jsonPattern)) {
      let title = match[1] ?? '';
      try { title = JSON.parse(`"${title}"`) as string; } catch { /* keep raw */ }
      const heat = Number(match[2]);
      if (title && Number.isFinite(heat) && !seen.has(title)) { seen.add(title); rows.push({ title, heat }); }
    }
    if (rows.length < 5) {
      const fallback = /(?:hot-index|c-index-single)[^>]*>[\s\S]{0,300}?(\d{5,})[\s\S]{0,1000}?<a[^>]+href="([^"]+)"[^>]*>([\s\S]{2,180}?)<\/a>/gi;
      for (const match of text.matchAll(fallback)) {
        const title = stripTags(match[3] ?? ''); const heat = Number(match[1]);
        if (title && !seen.has(title)) { seen.add(title); const parsedUrl=safeUrl(decodeXmlEntities(match[2] ?? '')); rows.push({ title, heat, ...(parsedUrl ? { url: parsedUrl } : {}) }); }
      }
    }
    if (rows.length < 5) throw new SourceError('schema_changed', `baidu_parser_items=${rows.length}`);
    return rows.slice(0, 50).map((row, index) => ({
      id: makeId(this.id, `${row.title}:${context.retrievedAt.slice(0, 13)}`), sourceId: this.id, sourceType: this.category, region: this.region,
      title: row.title, url: row.url ?? `https://www.baidu.com/s?wd=${encodeURIComponent(row.title)}`, rank: index + 1, rawHeat: row.heat,
      retrievedAt: context.retrievedAt, language: 'zh-CN', sourceMetadata: { metric: 'hot_search_index' }
    }));
  }
}

export class ToutiaoHotAdapter extends BaseAdapter {
  id='toutiao'; name='今日头条热榜'; region='CN' as const; category='news' as const; reliabilityWeight=0.95; adapterVersion='1.0.0';
  async collect(context:CollectContext):Promise<RawHotItem[]> {
    type Row={Title?:string;title?:string;HotValue?:number|string;hot_value?:number|string;ClusterIdStr?:string;ClusterId?:string|number;Url?:string;url?:string};
    const data=await checkedJson<{data?:Row[]}>('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc',context,{
      referer:'https://www.toutiao.com/'
    });
    const rows=Array.isArray(data.data)?data.data:[];
    const items=rows.flatMap((row,index):RawHotItem[]=>{
      const title=String(row.Title??row.title??'').trim(); if(!title)return [];
      const rawHeat=Number(row.HotValue??row.hot_value??0); const key=String(row.ClusterIdStr??row.ClusterId??title);
      const url=safeUrl(String(row.Url??row.url??'')) ?? `https://www.toutiao.com/search/?keyword=${encodeURIComponent(title)}`;
      return [{id:makeId(this.id,key),sourceId:this.id,sourceType:this.category,region:this.region,title,url,rank:index+1,
        rawHeat:Number.isFinite(rawHeat)?rawHeat:0,retrievedAt:context.retrievedAt,language:'zh-CN',sourceMetadata:{metric:'hot_board',cluster_id:key}}];
    });
    if(items.length<5) throw new SourceError('schema_changed',`toutiao_items=${items.length}`);
    return items.slice(0,50);
  }
}

export class BilibiliRankingAdapter extends BaseAdapter {
  id='bilibili'; name='哔哩哔哩全站排行'; region='CN' as const; category='video' as const; reliabilityWeight=0.9; adapterVersion='1.0.0';
  async collect(context:CollectContext):Promise<RawHotItem[]> {
    type BiliRow={aid?:number;bvid?:string;title?:string;stat?:{view?:number;danmaku?:number;reply?:number;favorite?:number;coin?:number;share?:number;like?:number}};
    const data=await checkedJson<{code?:number;data?:{list?:BiliRow[]}}>('https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all',context,{
      referer:'https://www.bilibili.com/v/popular/rank/all'
    });
    if(data.code!==0) throw new SourceError('unavailable',`bilibili_code=${data.code??'unknown'}`);
    const rows=data.data?.list??[];
    const items=rows.flatMap((row,index):RawHotItem[]=>{
      const title=String(row.title??'').trim(); if(!title)return [];
      const key=row.bvid??String(row.aid??title); const stat=row.stat??{};
      return [{id:makeId(this.id,key),sourceId:this.id,sourceType:this.category,region:this.region,title,
        url:row.bvid?`https://www.bilibili.com/video/${encodeURIComponent(row.bvid)}`:undefined,rank:index+1,views:Number(stat.view??0),
        likes:Number(stat.like??0),comments:Number(stat.reply??0)+Number(stat.danmaku??0),shares:Number(stat.share??0),
        rawHeat:Number(stat.view??0)+3*Number(stat.reply??0)+2*Number(stat.danmaku??0)+1.5*Number(stat.like??0),
        retrievedAt:context.retrievedAt,language:'zh-CN',sourceMetadata:{metric:'all_site_ranking',bvid:row.bvid,aid:row.aid,coins:stat.coin,favorites:stat.favorite}}];
    });
    if(items.length<5) throw new SourceError('schema_changed',`bilibili_items=${items.length}`);
    return items.slice(0,50);
  }
}

export interface RssConfig { id: string; name: string; url: string; region: Region; reliabilityWeight: number; categoryHint?: string; }
export class RssAdapter extends BaseAdapter {
  category = 'news' as const; adapterVersion = '1.0.0';
  id: string; name: string; region: Region; reliabilityWeight: number;
  constructor(private readonly config: RssConfig) { super(); this.id=config.id; this.name=config.name; this.region=config.region; this.reliabilityWeight=config.reliabilityWeight; }
  async collect(context: CollectContext): Promise<RawHotItem[]> {
    const { text } = await checkedText(this.config.url, context, 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5');
    const blocks = [...text.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
    if (!blocks.length) throw new SourceError('schema_changed', 'rss_no_items');
    return blocks.slice(0, 60).flatMap((block, index): RawHotItem[] => {
      const read = (tag: string) => {
        const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
        return m ? stripTags(m[1] ?? '') : '';
      };
      const title = read('title');
      const guid = read('guid') || read('id');
      const linkTag = block.match(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i)?.[1] ?? block.match(/<link[^>]+href=["']([^"']+)/i)?.[1] ?? '';
      const url = safeUrl(stripTags(linkTag));
      const published = read('pubDate') || read('published') || read('updated');
      if (!title) return [];
      const publishedAt = published && !Number.isNaN(Date.parse(published)) ? new Date(published).toISOString() : undefined;
      return [{
        id: makeId(this.id, guid || url || title), sourceId: this.id, sourceType: this.category, region: this.region,
        title, ...(url ? { url } : {}), rank: index + 1, ...(publishedAt ? { publishedAt } : {}), retrievedAt: context.retrievedAt,
        language: this.region === 'CN' ? 'zh-CN' : 'en', ...(this.config.categoryHint ? { categoryHint: this.config.categoryHint } : {}),
        sourceMetadata: { metric: 'feed_position', feed: this.config.url }
      }];
    });
  }
}

interface HnItem { id: number; title?: string; url?: string; score?: number; descendants?: number; time?: number; type?: string; deleted?: boolean; dead?: boolean; }
export class HackerNewsAdapter extends BaseAdapter {
  id='hackernews'; name='Hacker News'; region='GLOBAL' as const; category='forum' as const; reliabilityWeight=0.85; adapterVersion='1.0.0';
  async collect(context: CollectContext): Promise<RawHotItem[]> {
    const response = await fetchWithTimeout('https://hacker-news.firebaseio.com/v0/topstories.json', { ...(context.signal ? { signal: context.signal } : {}) }, 10_000);
    if (!response.ok) throw new SourceError(response.status === 429 ? 'rate_limited' : 'unavailable', `HN topstories ${response.status}`);
    const ids = (await response.json()) as number[];
    const top = ids.slice(0, 40);
    const details = await Promise.all(top.map(async (id) => {
      try {
        const r = await fetchWithTimeout(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { ...(context.signal ? { signal: context.signal } : {}) }, 8_000);
        return r.ok ? await r.json() as HnItem : null;
      } catch { return null; }
    }));
    const items = details.filter((x): x is HnItem => !!x?.title && !x.deleted && !x.dead);
    if (items.length < 5) throw new SourceError('degraded', `hn_items=${items.length}`);
    return items.map((item, index) => ({
      id: makeId(this.id, String(item.id)), sourceId:this.id, sourceType:this.category, region:this.region, title:item.title!,
      url: safeUrl(item.url) ?? `https://news.ycombinator.com/item?id=${item.id}`, rank:index+1, rawHeat:item.score ?? 0,
      comments:item.descendants ?? 0, ...(item.time ? { publishedAt: new Date(item.time*1000).toISOString() } : {}), retrievedAt:context.retrievedAt,
      language:'en', sourceMetadata:{ metric:'score_comments_rank', hn_id:item.id }
    }));
  }
}

interface WikimediaTopResponse { items?: Array<{ articles?: Array<{ article?: string; views?: number; rank?: number }> }> }
export class WikimediaTopAdapter extends BaseAdapter {
  id='wikimedia'; name='Wikimedia Pageviews'; region='GLOBAL' as const; category='knowledge' as const; reliabilityWeight=0.9; adapterVersion='1.0.0';
  async collect(context: CollectContext): Promise<RawHotItem[]> {
    const date = new Date(Date.parse(context.retrievedAt) - 86_400_000);
    const y=String(date.getUTCFullYear()), m=String(date.getUTCMonth()+1).padStart(2,'0'), d=String(date.getUTCDate()).padStart(2,'0');
    const url=`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia.org/all-access/${y}/${m}/${d}`;
    const response=await fetchWithTimeout(url,{...(context.signal?{signal:context.signal}:{}),headers:{'user-agent':'HotTopicsObservatory/1.0 (siner9586-labs/Hot_Topics)','accept':'application/json'}},12_000);
    if(!response.ok) throw new SourceError(response.status===429?'rate_limited':'unavailable',`wikimedia ${response.status}`);
    const data=await response.json() as WikimediaTopResponse;
    const articles=(data.items?.[0]?.articles ?? []).filter((a)=>a.article && !/^(Main_Page|Special:|Wikipedia:)/i.test(a.article));
    if(articles.length<5) throw new SourceError('schema_changed',`wikimedia_items=${articles.length}`);
    return articles.slice(0,50).map((article,index)=>({
      id:makeId(this.id,`${y}${m}${d}:${article.article}`),sourceId:this.id,sourceType:this.category,region:this.region,
      title:decodeURIComponent((article.article ?? '').replace(/_/g,' ')),url:`https://en.wikipedia.org/wiki/${encodeURIComponent(article.article ?? '')}`,
      rank:article.rank ?? index+1,views:article.views ?? 0,rawHeat:article.views ?? 0,retrievedAt:context.retrievedAt,language:'en',
      sourceMetadata:{metric:'daily_pageviews',metric_date:`${y}-${m}-${d}`}
    }));
  }
}

export class GitHubTrendingAdapter extends BaseAdapter {
  id='github-trending'; name='GitHub Trending'; region='GLOBAL' as const; category='knowledge' as const; reliabilityWeight=0.72; adapterVersion='1.0.0';
  async collect(context: CollectContext): Promise<RawHotItem[]> {
    const { text }=await checkedText('https://github.com/trending?since=daily',context);
    const articles=[...text.matchAll(/<article[^>]*class="[^"]*Box-row[^"]*"[^>]*>([\s\S]*?)<\/article>/gi)].map((m)=>m[1] ?? '');
    if(articles.length<3) throw new SourceError('schema_changed',`github_trending_items=${articles.length}`);
    return articles.slice(0,30).flatMap((html,index):RawHotItem[]=>{
      const repo=html.match(/<h2[\s\S]*?<a[^>]+href="\/([^"?#]+)"/i)?.[1]?.trim();
      if(!repo) return [];
      const description=stripTags(html.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '');
      const starsToday=Number((stripTags(html.match(/([\d,]+)\s+stars today/i)?.[1] ?? '0')).replace(/,/g,''));
      return [{id:makeId(this.id,`${context.retrievedAt.slice(0,10)}:${repo}`),sourceId:this.id,sourceType:this.category,region:this.region,
        title:description ? `${repo}: ${description}` : repo,url:`https://github.com/${repo}`,rank:index+1,rawHeat:Number.isFinite(starsToday)?starsToday:0,
        retrievedAt:context.retrievedAt,language:'en',categoryHint:'科技',sourceMetadata:{metric:'daily_trending_rank_stars',repository:repo,starsToday}}];
    });
  }
}

interface YouTubeList { items?: Array<{ id?: string; snippet?: { title?: string; publishedAt?: string }; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }> }
export class YouTubePopularAdapter extends BaseAdapter {
  id='youtube'; name='YouTube mostPopular'; region='GLOBAL' as const; category='video' as const; reliabilityWeight=0.82; adapterVersion='1.0.0';
  async collect(context: CollectContext): Promise<RawHotItem[]> {
    const key=context.env?.YOUTUBE_API_KEY;
    if(!key) throw new SourceError('auth_required','YOUTUBE_API_KEY missing');
    const url=new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part','snippet,statistics');url.searchParams.set('chart','mostPopular');url.searchParams.set('regionCode','US');url.searchParams.set('maxResults','50');url.searchParams.set('key',key);
    const response=await fetchWithTimeout(url,{...(context.signal?{signal:context.signal}: {})},12_000);
    if(!response.ok) throw new SourceError(response.status===403?'auth_required':response.status===429?'rate_limited':'unavailable',`youtube ${response.status}`);
    const data=await response.json() as YouTubeList; const list=data.items ?? [];
    return list.flatMap((video,index):RawHotItem[]=>video.id&&video.snippet?.title?[{id:makeId(this.id,video.id),sourceId:this.id,sourceType:this.category,region:this.region,
      title:video.snippet.title,url:`https://www.youtube.com/watch?v=${video.id}`,rank:index+1,views:Number(video.statistics?.viewCount ?? 0),likes:Number(video.statistics?.likeCount ?? 0),comments:Number(video.statistics?.commentCount ?? 0),
      ...(video.snippet.publishedAt?{publishedAt:video.snippet.publishedAt}:{}),retrievedAt:context.retrievedAt,language:'en',sourceMetadata:{metric:'mostPopular_US'}}]:[]);
  }
}

export class RequiresAccessAdapter extends BaseAdapter {
  constructor(
    public id:string, public name:string, public region:Region, public category:SourceCategory,
    public reliabilityWeight:number, public adapterVersion:string, private readonly status:SourceStatus, private readonly reason:string
  ){ super(); }
  async collect(_context:CollectContext):Promise<RawHotItem[]>{ throw new SourceError(this.status,this.reason); }
}

export function createAdapters(env: Record<string,string|undefined> = {}): SourceAdapter[] {
  const flags=featureFlags(env);
  const adapters:SourceAdapter[]=[
    Object.assign(new BaiduHotAdapter(),{enabled:flags.baidu}),
    Object.assign(new RssAdapter({id:'36kr',name:'36Kr RSS',url:'https://36kr.com/feed',region:'CN',reliabilityWeight:0.78,categoryHint:'科技'}),{enabled:flags.kr36}),
    Object.assign(new RssAdapter({id:'people',name:'人民网 RSS',url:'http://www.people.com.cn/rss/ywkx.xml',region:'CN',reliabilityWeight:0.88}),{enabled:flags.people}),
    Object.assign(new RssAdapter({id:'chinanews',name:'中国新闻网即时新闻 RSS',url:'https://www.chinanews.com.cn/rss/scroll-news.xml',region:'CN',reliabilityWeight:0.9}),{enabled:flags.chinanews}),
    Object.assign(new ToutiaoHotAdapter(),{enabled:flags.toutiao}),
    Object.assign(new BilibiliRankingAdapter(),{enabled:flags.bilibili}),

    Object.assign(new HackerNewsAdapter(),{enabled:flags.hackernews}),
    Object.assign(new WikimediaTopAdapter(),{enabled:flags.wikimedia}),
    Object.assign(new RssAdapter({id:'bbc',name:'BBC News RSS',url:'https://feeds.bbci.co.uk/news/rss.xml',region:'GLOBAL',reliabilityWeight:0.9}),{enabled:flags.bbc}),
    Object.assign(new RssAdapter({id:'google-news',name:'Google News Top Stories RSS',url:'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en',region:'GLOBAL',reliabilityWeight:0.92}),{enabled:flags.googleNews}),
    Object.assign(new RssAdapter({id:'guardian-world',name:'The Guardian World RSS',url:'https://www.theguardian.com/world/rss',region:'GLOBAL',reliabilityWeight:0.88}),{enabled:flags.guardian}),
    Object.assign(new RssAdapter({id:'nyt-world',name:'New York Times World RSS',url:'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',region:'GLOBAL',reliabilityWeight:0.9}),{enabled:flags.nytimes}),
    Object.assign(new RssAdapter({id:'aljazeera',name:'Al Jazeera RSS',url:'https://www.aljazeera.com/xml/rss/all.xml',region:'GLOBAL',reliabilityWeight:0.86}),{enabled:flags.aljazeera}),
    Object.assign(new GitHubTrendingAdapter(),{enabled:true}),
    Object.assign(new YouTubePopularAdapter(),{enabled:flags.youtube||Boolean(env.YOUTUBE_API_KEY)}),

    Object.assign(new RequiresAccessAdapter('zhihu','知乎官方热榜 API','CN','social',0.9,'1.0.0','auth_required','official API token/access secret required'),{enabled:flags.zhihu}),
    Object.assign(new RequiresAccessAdapter('weibo','微博开放平台热搜趋势','CN','social',0.95,'2.0.0','auth_required','Weibo Open Platform/CLI authorization required; do not scrape login-protected pages'),{enabled:flags.weibo}),
    Object.assign(new RequiresAccessAdapter('douyin','抖音开放平台热点能力','CN','video',0.95,'1.0.0','requires_access','Douyin Open Platform approved hot/trend capability and token required'),{enabled:flags.douyin}),
    Object.assign(new RequiresAccessAdapter('google-trends','Google Trends API Alpha','GLOBAL','search',1,'1.0.0','requires_access','Google Trends API Alpha access required'),{enabled:flags.googleTrends}),
    Object.assign(new RequiresAccessAdapter('gdelt-cloud','GDELT Cloud','GLOBAL','news',0.9,'1.0.0','auth_required','GDELT Cloud API key required for production story ranking'),{enabled:flags.gdelt}),
    Object.assign(new RequiresAccessAdapter('reddit','Reddit Data API','GLOBAL','forum',0.9,'1.0.0','auth_required','approved Reddit Data API OAuth access required; unapproved scraping is not used'),{enabled:flags.reddit}),
    Object.assign(new RequiresAccessAdapter('x','X API trends/search','GLOBAL','social',0.9,'1.0.0','auth_required','X API bearer/OAuth access with required endpoint tier is required'),{enabled:flags.x}),
    Object.assign(new RequiresAccessAdapter('tiktok','TikTok approved API','GLOBAL','video',0.9,'1.0.0','requires_access','TikTok approved API or Research API eligibility is required'),{enabled:flags.tiktok})
  ];
  return adapters;
}

export async function collectAll(adapters: SourceAdapter[], context: CollectContext): Promise<Array<{ adapter: SourceAdapter; items: RawHotItem[]; status: SourceStatus; durationMs:number; error?:string }>> {
  return Promise.all(adapters.map(async(adapter)=>{
    if(!adapter.enabled) return {adapter,items:[],status:'disabled' as const,durationMs:0};
    const started=Date.now();
    try { const items=await adapter.collect(context); return {adapter,items,status:items.length?'healthy' as const:'degraded' as const,durationMs:Date.now()-started}; }
    catch(error){ return {adapter,items:[],status:error instanceof SourceError?error.status:'unavailable',durationMs:Date.now()-started,error:error instanceof Error?error.message:'unknown_error'}; }
  }));
}
