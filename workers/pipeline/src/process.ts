import type { PlatformContribution, RawHotItem, Region, SourceCategory, TopicCategory, TrendPoint } from '@hot-topics/core';
import { RECENT_TOPIC_LOOKBACK_HOURS, SCORING_MODEL_VERSION } from '@hot-topics/config';
import { assignToExistingTopics, normalizeTitle } from '@hot-topics/clustering';
import {
  createTopic, insertPlatformSnapshot, insertSnapshot, linkItem, previousSnapshot, rawItemsForRun, recentSnapshotPoints,
  recentTopics, saveClusterDecision, setRunStatus, topicItemsForRun, touchTopic, updateTopicHeat, type D1Database
} from '@hot-topics/db';
import { computeHeat, deltaHeat, freshnessScore, inferLifecycle, momentumLabel, normalizePlatformItems, persistenceScore } from '@hot-topics/scoring';
import { clamp, slugify, stableHash } from '@hot-topics/shared';
import type { ProcessRunMessage } from './runtime-types.ts';

const PROCESSING_ITEMS_PER_SOURCE=15;

function classify(title:string,hint?:string):TopicCategory{
  if(hint && ['社会','国际','财经','科技','AI','汽车','娱乐','体育','游戏','文化教育','健康','其他'].includes(hint)) return hint as TopicCategory;
  const s=title.toLowerCase();
  const rules:Array<[TopicCategory,RegExp]>=[
    ['AI',/\b(ai|llm|gpt|openai|anthropic|deepseek|人工智能|大模型|模型)\b/i],['财经',/stock|market|bank|econom|finance|inflation|bitcoin|crypto|股|银行|经济|金融|基金|债/i],
    ['体育',/football|soccer|nba|nfl|tennis|olympic|match|cup|足球|篮球|奥运|比赛|联赛|冠军/i],['娱乐',/film|movie|music|actor|actress|celebrity|电影|演员|明星|音乐|综艺|奖/i],
    ['汽车',/tesla|vehicle|automotive|car|汽车|新能源车|比亚迪/i],['游戏',/game|gaming|steam|xbox|playstation|游戏|电竞/i],['健康',/health|medical|disease|virus|hospital|健康|医疗|疾病|医院/i],
    ['文化教育',/school|university|education|book|culture|教育|大学|学校|文化|图书/i],['国际',/war|election|president|government|country|外交|总统|战争|国际|政府|地震|台风/i],['科技',/github|software|chip|nvidia|apple|google|microsoft|technology|科技|芯片|软件|互联网/i]
  ];
  return rules.find(([,re])=>re.test(s))?.[0] ?? '社会';
}

function rowToRaw(row:Record<string,any>):RawHotItem{
  const metrics=JSON.parse(row.raw_metrics_json || '{}') as Record<string,any>;
  return {id:row.id,sourceId:row.source_id,sourceType:row.source_type,region:row.region,title:row.title,
    ...(row.url?{url:row.url}:{}),...(row.rank!=null?{rank:Number(row.rank)}:{}),...(row.raw_heat!=null?{rawHeat:Number(row.raw_heat)}:{}),
    ...(metrics.views!=null?{views:Number(metrics.views)}:{}),...(metrics.likes!=null?{likes:Number(metrics.likes)}:{}),...(metrics.comments!=null?{comments:Number(metrics.comments)}:{}),
    ...(metrics.shares!=null?{shares:Number(metrics.shares)}:{}),...(metrics.searchInterest!=null?{searchInterest:Number(metrics.searchInterest)}:{}),
    ...(row.published_at?{publishedAt:row.published_at}:{}),retrievedAt:row.retrieved_at,...(row.language?{language:row.language}:{}),...(row.category_hint?{categoryHint:row.category_hint}:{}),
    sourceMetadata:{...(metrics.sourceMetadata??{}),reliabilityWeight:Number(row.reliability_weight??1)} };
}

function evidenceCoverage(items:Array<Record<string,any>>):number{
  const sources=new Set(items.map((i)=>i.source_id)).size; const news=new Set(items.filter((i)=>i.source_type==='news').map((i)=>i.source_id)).size;
  return clamp(20*sources+12*news+(sources>=3?16:0));
}
function anomalyRisk(items:Array<Record<string,any>>,heat:number):number{
  const sources=new Set(items.map((i)=>i.source_id)).size;
  const titles=items.map((i)=>normalizeTitle(i.title)); const unique=new Set(titles).size; const repetition=1-unique/Math.max(1,titles.length);
  return clamp((sources===1&&heat>75?45:0)+repetition*45);
}

export async function processRun(db:D1Database,message:ProcessRunMessage):Promise<{topics:number;snapshots:number;region:Region}>{
  await setRunStatus(db,message.runId,'PROCESSING',new Date().toISOString(),{region:message.region});
  // Preserve every accepted raw item in D1, but score only each source's leading items.
  // This makes source breadth independent from per-invocation D1 query growth.
  const rawRows=await rawItemsForRun(db,message.runId,message.region,PROCESSING_ITEMS_PER_SOURCE); const raw=rawRows.map(rowToRaw);
  const since=new Date(Date.parse(message.capturedAt)-RECENT_TOPIC_LOOKBACK_HOURS*3_600_000).toISOString();
  const existing=await recentTopics(db,since);
  const seeds=existing.map((t)=>({topicId:t.id,title:t.canonical_title_en||t.canonical_title_zh,firstSeenAt:t.first_seen_at,lastSeenAt:t.last_seen_at}));
  const assignments=await assignToExistingTopics(raw,seeds);
  let newTopics=0;
  for(const assignment of assignments){
    let topicId=assignment.topicId;
    if(!topicId){
      const canonical=assignment.item.title.trim(); const normalized=normalizeTitle(canonical);
      topicId=`topic_${stableHash(`${normalized}|${assignment.item.retrievedAt.slice(0,10)}`)}`;
      const slug=`${slugify(canonical)}-${stableHash(topicId).slice(0,6)}`;
      await createTopic(db,{id:topicId,slug,titleZh:canonical,titleEn:canonical,category:classify(canonical,assignment.item.categoryHint),seenAt:assignment.item.retrievedAt});
      seeds.push({topicId,title:canonical,firstSeenAt:assignment.item.retrievedAt,lastSeenAt:assignment.item.retrievedAt}); newTopics+=1;
    } else { await touchTopic(db,topicId,assignment.item.retrievedAt); }
    await linkItem(db,topicId,assignment.item.id,message.runId,assignment.decision?.confidence??1,assignment.decision?.reasonCode??'new_topic_seed');
    if(assignment.decision) await saveClusterDecision(db,message.runId,assignment.item.id,topicId,assignment.decision);
  }
  await setRunStatus(db,message.runId,'SCORING',new Date().toISOString(),{region:message.region});
  const linked=await topicItemsForRun(db,message.runId,message.region);
  const sourceGroups=new Map<string,Array<Record<string,any>>>();
  for(const row of linked){ const a=sourceGroups.get(row.source_id)??[];a.push(row);sourceGroups.set(row.source_id,a); }
  const platformScores=new Map<string,number>();
  for(const [sourceId,rows] of sourceGroups){ const scores=normalizePlatformItems(rows.map(rowToRaw)); rows.forEach((row,i)=>platformScores.set(`${sourceId}:${row.id}`,scores[i]??0)); }
  const topicGroups=new Map<string,Array<Record<string,any>>>();
  for(const row of linked){ const a=topicGroups.get(row.topic_id)??[];a.push(row);topicGroups.set(row.topic_id,a); }
  let snapshots=0;
  for(const [topicId,items] of topicGroups){
    const region=message.region;
    const bySource=new Map<string,Array<Record<string,any>>>(); for(const item of items){const a=bySource.get(item.source_id)??[];a.push(item);bySource.set(item.source_id,a);}
    const contributions:PlatformContribution[]=[];
    for(const [sourceId,rows] of bySource){
      const platformHeat=Math.max(...rows.map((r)=>platformScores.get(`${sourceId}:${r.id}`)??0));
      const metrics=rows.map((r)=>JSON.parse(r.raw_metrics_json||'{}') as Record<string,any>);
      const rawVolume=Math.max(...metrics.map((m)=>Number(m.views??0)+3*Number(m.comments??0)+1.5*Number(m.likes??0)+4*Number(m.shares??0)+Number(rows[0]?.raw_heat??0)));
      const volumeSignal=rawVolume>0?Math.min(100,20*Math.log10(1+rawVolume)):platformHeat;
      const category=rows[0]?.source_type as SourceCategory; const searchSignal=category==='search'?platformHeat:Math.max(...metrics.map((m)=>Number(m.searchInterest??0)),0);
      contributions.push({sourceId,sourceCategory:category,region,platformHeat,reliabilityWeight:Number(rows[0]?.reliability_weight??1),rawVolumeSignal:clamp(volumeSignal),searchSignal:clamp(searchSignal)});
      await insertPlatformSnapshot(db,{id:`${message.runId}:${topicId}:${sourceId}`,runId:message.runId,topicId,sourceId,region,platformHeat,rawVolumeSignal:clamp(volumeSignal),searchSignal:clamp(searchSignal),capturedAt:message.capturedAt});
    }
    const topic=existing.find((t)=>t.id===topicId);
    const points=await recentSnapshotPoints(db,topicId,region,12); const trend:TrendPoint[]=points.map((p)=>({capturedAt:p.captured_at,heat:Number(p.heat)}));
    const persistence=persistenceScore(topic?.first_seen_at??message.capturedAt,points.length,new Date(message.capturedAt));
    const freshness=freshnessScore(topic?.last_seen_at??message.capturedAt,new Date(message.capturedAt));
    const heat=computeHeat(contributions,{persistence,freshness,expectedEnabledWeight:message.expectedWeightByRegion[region],availableEnabledWeight:message.availableWeightByRegion[region]});
    const previous=await previousSnapshot(db,topicId,region,message.capturedAt); const delta=deltaHeat(heat.heat,previous?.heat==null?null:Number(previous.heat));
    const momentum=momentumLabel(delta.delta,previous?.momentum??null); const lifecycle=inferLifecycle([...trend,{capturedAt:message.capturedAt,heat:heat.heat}],new Date(message.capturedAt));
    const ev=evidenceCoverage(items); const anomaly=anomalyRisk(items,heat.heat);
    await insertSnapshot(db,{id:`${message.runId}:${topicId}:${region}`,runId:message.runId,topicId,region,heat:heat.heat,delta:delta.delta,isNew:delta.isNew,momentum,lifecycle,
      coverageConfidence:heat.coverageConfidence,crossPlatformIndex:heat.crossPlatformIndex,components:heat.components,capturedAt:message.capturedAt,scoringModelVersion:SCORING_MODEL_VERSION,evidenceCoverage:ev,anomalyRisk:anomaly});
    await updateTopicHeat(db,topicId,region,heat.heat,lifecycle); snapshots+=1;
  }
  return {topics:newTopics,snapshots,region:message.region};
}
