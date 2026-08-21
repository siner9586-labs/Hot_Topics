import type { RawHotItem, SourceAdapter, SourceRunResult } from '@hot-topics/core';
import { normalizeTitle } from '@hot-topics/clustering';
import { stableHash } from '@hot-topics/shared';

export interface D1Result<T=unknown> { success: boolean; meta?: Record<string,unknown>; results?: T[]; error?: string; }
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T=Record<string,unknown>>(column?: string): Promise<T|null>;
  all<T=Record<string,unknown>>(): Promise<D1Result<T>>;
  run<T=Record<string,unknown>>(): Promise<D1Result<T>>;
}
export interface D1Database {
  prepare(sql:string):D1PreparedStatement;
  batch<T=unknown>(statements:D1PreparedStatement[]):Promise<D1Result<T>[]>;
}

export interface DbTopicRow {
  id:string; slug:string; canonical_title_zh:string; canonical_title_en:string; category:string;
  first_seen_at:string; last_seen_at:string; china_heat:number; global_heat:number; status:string; lifecycle:string;
}

export async function startSystemRun(db:D1Database, runId:string, startedAt:string):Promise<boolean>{
  const r=await db.prepare(`INSERT OR IGNORE INTO system_runs(id,status,started_at,updated_at) VALUES(?,'STARTED',?,?)`).bind(runId,startedAt,startedAt).run();
  return r.success;
}

export async function setRunStatus(db:D1Database,runId:string,status:string,updatedAt:string,detail?:Record<string,unknown>):Promise<void>{
  await db.prepare(`UPDATE system_runs SET status=?, updated_at=?, detail_json=? WHERE id=?`).bind(status,updatedAt,JSON.stringify(detail??{}),runId).run();
}

export async function upsertSource(db:D1Database,adapter:SourceAdapter):Promise<void>{
  await db.prepare(`INSERT INTO sources(id,name,region,source_type,enabled,weight,reliability_weight,adapter_version,status)
    VALUES(?,?,?,?,?,1,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,region=excluded.region,source_type=excluded.source_type,
    enabled=excluded.enabled,reliability_weight=excluded.reliability_weight,adapter_version=excluded.adapter_version`)
    .bind(adapter.id,adapter.name,adapter.region,adapter.category,adapter.enabled?1:0,adapter.reliabilityWeight,adapter.adapterVersion,adapter.enabled?'healthy':'disabled').run();
}

export async function recordSourceRun(db:D1Database,runId:string,result:SourceRunResult,adapter:SourceAdapter,finishedAt:string):Promise<void>{
  await upsertSource(db,adapter);
  const startedAt=new Date(Date.parse(finishedAt)-result.durationMs).toISOString();
  await db.prepare(`INSERT OR REPLACE INTO source_runs(id,run_id,source_id,status,started_at,finished_at,duration_ms,item_count,error_code,detail)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(`${runId}:${adapter.id}`,runId,adapter.id,result.status,startedAt,finishedAt,result.durationMs,result.itemCount,result.errorCode??null,result.detail??null).run();
  await db.prepare(`INSERT INTO source_health(source_id,last_success_at,last_failure_at,status,latency_ms,item_count,schema_error,http_error,rate_limited,adapter_version,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET
      last_success_at=CASE WHEN excluded.status='healthy' THEN excluded.updated_at ELSE source_health.last_success_at END,
      last_failure_at=CASE WHEN excluded.status NOT IN ('healthy','disabled') THEN excluded.updated_at ELSE source_health.last_failure_at END,
      status=excluded.status,latency_ms=excluded.latency_ms,item_count=excluded.item_count,schema_error=excluded.schema_error,
      http_error=excluded.http_error,rate_limited=excluded.rate_limited,adapter_version=excluded.adapter_version,updated_at=excluded.updated_at`)
    .bind(adapter.id,result.status==='healthy'?finishedAt:null,result.status!=='healthy'&&result.status!=='disabled'?finishedAt:null,result.status,result.durationMs,result.itemCount,result.status==='schema_changed'?1:0,result.errorCode?.startsWith('HTTP')?result.errorCode:null,result.status==='rate_limited'?1:0,adapter.adapterVersion,finishedAt).run();
  await db.prepare(`UPDATE sources SET status=?,last_success_at=CASE WHEN ?='healthy' THEN ? ELSE last_success_at END,last_failure_at=CASE WHEN ? NOT IN ('healthy','disabled') THEN ? ELSE last_failure_at END WHERE id=?`)
    .bind(result.status,result.status,finishedAt,result.status,finishedAt,adapter.id).run();
}

export async function insertRawItems(db:D1Database,runId:string,items:RawHotItem[]):Promise<number>{
  if(!items.length) return 0;
  const statements=items.map((item)=>{
    const key=String(item.sourceMetadata?.sourceItemKey ?? item.url ?? item.title);
    const contentHash=stableHash(`${item.sourceId}|${item.title}|${item.url??''}|${item.publishedAt??''}`);
    return db.prepare(`INSERT OR IGNORE INTO raw_items(id,run_id,source_id,source_item_key,title,normalized_title,url,rank,raw_heat,raw_metrics_json,published_at,retrieved_at,language,content_hash,category_hint)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(item.id,runId,item.sourceId,key,item.title,normalizeTitle(item.title),item.url??null,item.rank??null,item.rawHeat??null,
      JSON.stringify({views:item.views,likes:item.likes,comments:item.comments,shares:item.shares,searchInterest:item.searchInterest,sourceMetadata:item.sourceMetadata}),
      item.publishedAt??null,item.retrievedAt,item.language??null,contentHash,item.categoryHint??null);
  });
  const chunks=[] as D1PreparedStatement[][];
  for(let i=0;i<statements.length;i+=50) chunks.push(statements.slice(i,i+50));
  let inserted=0;
  for(const chunk of chunks){ const results=await db.batch(chunk); inserted+=results.filter((r)=>r.success).length; }
  return inserted;
}

export async function rawItemsForRun(db:D1Database,runId:string,region?:string,limitPerSource=15):Promise<Array<Record<string,any>>>{
  const safeLimit=Math.min(50,Math.max(1,Math.floor(limitPerSource)));
  if(region){
    const r=await db.prepare(`WITH ranked AS (
      SELECT r.*,s.region,s.source_type,s.reliability_weight,
        ROW_NUMBER() OVER (PARTITION BY r.source_id ORDER BY COALESCE(r.rank,999999),r.retrieved_at DESC) AS source_row
      FROM raw_items r JOIN sources s ON s.id=r.source_id WHERE r.run_id=? AND s.region=?
    ) SELECT * FROM ranked WHERE source_row<=? ORDER BY source_id,COALESCE(rank,999999),retrieved_at DESC`)
      .bind(runId,region,safeLimit).all<Record<string,any>>();
    return r.results??[];
  }
  const r=await db.prepare(`WITH ranked AS (
    SELECT r.*,s.region,s.source_type,s.reliability_weight,
      ROW_NUMBER() OVER (PARTITION BY r.source_id ORDER BY COALESCE(r.rank,999999),r.retrieved_at DESC) AS source_row
    FROM raw_items r JOIN sources s ON s.id=r.source_id WHERE r.run_id=?
  ) SELECT * FROM ranked WHERE source_row<=? ORDER BY source_id,COALESCE(rank,999999),retrieved_at DESC`)
    .bind(runId,safeLimit).all<Record<string,any>>();
  return r.results??[];
}

export async function recentTopics(db:D1Database,sinceIso:string):Promise<DbTopicRow[]>{
  const r=await db.prepare(`SELECT * FROM topics WHERE last_seen_at>=? ORDER BY last_seen_at DESC LIMIT 1000`).bind(sinceIso).all<DbTopicRow>();
  return r.results??[];
}

export async function createTopic(db:D1Database,topic:{id:string;slug:string;titleZh:string;titleEn:string;category:string;seenAt:string}):Promise<void>{
  await db.prepare(`INSERT OR IGNORE INTO topics(id,canonical_title_zh,canonical_title_en,slug,category,first_seen_at,last_seen_at,china_heat,global_heat,status,lifecycle)
    VALUES(?,?,?,?,?,?,?,0,0,'active','emerging')`).bind(topic.id,topic.titleZh,topic.titleEn,topic.slug,topic.category,topic.seenAt,topic.seenAt).run();
}

export async function touchTopic(db:D1Database,topicId:string,seenAt:string):Promise<void>{
  await db.prepare(`UPDATE topics SET last_seen_at=CASE WHEN last_seen_at<? THEN ? ELSE last_seen_at END WHERE id=?`).bind(seenAt,seenAt,topicId).run();
}

export async function linkItem(db:D1Database,topicId:string,rawItemId:string,runId:string,confidence:number,reasonCode:string):Promise<void>{
  await db.prepare(`INSERT OR IGNORE INTO topic_items(topic_id,raw_item_id,run_id,match_confidence,match_reason,created_at) VALUES(?,?,?,?,?,datetime('now'))`)
    .bind(topicId,rawItemId,runId,confidence,reasonCode).run();
}

export async function saveClusterDecision(db:D1Database,runId:string,rawItemId:string,topicId:string|null,decision:{sameEvent:boolean;confidence:number;reasonCode:string;similarity:number}):Promise<void>{
  await db.prepare(`INSERT OR REPLACE INTO cluster_decisions(id,run_id,raw_item_id,candidate_topic_id,same_event,confidence,reason_code,similarity,created_at)
    VALUES(?,?,?,?,?,?,?,?,datetime('now'))`).bind(`${runId}:${rawItemId}`,runId,rawItemId,topicId,decision.sameEvent?1:0,decision.confidence,decision.reasonCode,decision.similarity).run();
}

export async function topicItemsForRun(db:D1Database,runId:string,region?:string):Promise<Array<Record<string,any>>>{
  if(region){
    const r=await db.prepare(`SELECT ti.topic_id,r.*,s.region,s.source_type,s.reliability_weight FROM topic_items ti JOIN raw_items r ON r.id=ti.raw_item_id JOIN sources s ON s.id=r.source_id WHERE ti.run_id=? AND s.region=?`).bind(runId,region).all<Record<string,any>>();
    return r.results??[];
  }
  const r=await db.prepare(`SELECT ti.topic_id,r.*,s.region,s.source_type,s.reliability_weight FROM topic_items ti JOIN raw_items r ON r.id=ti.raw_item_id JOIN sources s ON s.id=r.source_id WHERE ti.run_id=?`).bind(runId).all<Record<string,any>>();
  return r.results??[];
}

export async function previousSnapshot(db:D1Database,topicId:string,region:string,beforeIso:string):Promise<Record<string,any>|null>{
  return db.prepare(`SELECT * FROM topic_snapshots WHERE topic_id=? AND region=? AND captured_at<? ORDER BY captured_at DESC LIMIT 1`).bind(topicId,region,beforeIso).first<Record<string,any>>();
}

export async function recentSnapshotPoints(db:D1Database,topicId:string,region:string,limit=12):Promise<Array<{captured_at:string;heat:number}>>{
  const r=await db.prepare(`SELECT captured_at,heat FROM topic_snapshots WHERE topic_id=? AND region=? ORDER BY captured_at DESC LIMIT ?`).bind(topicId,region,limit).all<{captured_at:string;heat:number}>();
  return (r.results??[]).reverse();
}

export async function insertSnapshot(db:D1Database,snapshot:Record<string,any>):Promise<void>{
  await db.prepare(`INSERT OR REPLACE INTO topic_snapshots(id,run_id,topic_id,region,heat,delta,is_new,momentum,lifecycle,coverage_confidence,cross_platform_index,components_json,captured_at,scoring_model_version,evidence_coverage,anomaly_risk)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(snapshot.id,snapshot.runId,snapshot.topicId,snapshot.region,snapshot.heat,snapshot.delta,snapshot.isNew?1:0,snapshot.momentum,snapshot.lifecycle,
    snapshot.coverageConfidence,snapshot.crossPlatformIndex,JSON.stringify(snapshot.components),snapshot.capturedAt,snapshot.scoringModelVersion,snapshot.evidenceCoverage,snapshot.anomalyRisk).run();
}

export async function insertPlatformSnapshot(db:D1Database,row:Record<string,any>):Promise<void>{
  await db.prepare(`INSERT OR REPLACE INTO topic_platform_snapshots(id,run_id,topic_id,source_id,region,platform_heat,raw_volume_signal,search_signal,captured_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind(row.id,row.runId,row.topicId,row.sourceId,row.region,row.platformHeat,row.rawVolumeSignal,row.searchSignal,row.capturedAt).run();
}

export async function updateTopicHeat(db:D1Database,topicId:string,region:string,heat:number,lifecycle:string):Promise<void>{
  const column=region==='CN'?'china_heat':'global_heat';
  await db.prepare(`UPDATE topics SET ${column}=?, lifecycle=?, status='active' WHERE id=?`).bind(heat,lifecycle,topicId).run();
}

export async function runSnapshotCounts(db:D1Database,runId:string):Promise<{CN:number;GLOBAL:number}>{
  const r=await db.prepare(`SELECT region,COUNT(*) snapshot_count FROM topic_snapshots WHERE run_id=? GROUP BY region`).bind(runId).all<{region:string;snapshot_count:number}>();
  const counts={CN:0,GLOBAL:0};
  for(const row of r.results??[]){ if(row.region==='CN'||row.region==='GLOBAL') counts[row.region]=Number(row.snapshot_count??0); }
  return counts;
}

export async function listRankings(db:D1Database,region:string,limit:number,mode:string):Promise<Array<Record<string,any>>>{
  const safeLimit=Math.min(100,Math.max(1,limit));
  const order=mode==='rising'?'COALESCE(s.delta,-999) DESC, s.heat DESC':mode==='cooling'?'COALESCE(s.delta,999) ASC, s.heat DESC':mode==='new'?'s.is_new DESC,s.heat DESC':'s.heat DESC';
  const r=await db.prepare(`WITH latest AS (SELECT topic_id,MAX(captured_at) captured_at FROM topic_snapshots WHERE region=? GROUP BY topic_id)
    SELECT t.*,s.heat,s.delta,s.is_new,s.momentum,s.lifecycle,s.coverage_confidence,s.cross_platform_index,s.components_json,s.evidence_coverage,s.anomaly_risk,s.captured_at
    FROM latest l JOIN topic_snapshots s ON s.topic_id=l.topic_id AND s.captured_at=l.captured_at AND s.region=? JOIN topics t ON t.id=s.topic_id
    ORDER BY ${order} LIMIT ?`).bind(region,region,safeLimit).all<Record<string,any>>();
  return r.results??[];
}

export async function sourceHealth(db:D1Database):Promise<Array<Record<string,any>>>{
  const r=await db.prepare(`SELECT s.id,s.name,s.region,s.source_type,s.enabled,s.reliability_weight,h.* FROM sources s LEFT JOIN source_health h ON h.source_id=s.id ORDER BY s.region,s.id`).all<Record<string,any>>();
  return r.results??[];
}

export async function topicBySlug(db:D1Database,slug:string):Promise<Record<string,any>|null>{
  return db.prepare(`SELECT * FROM topics WHERE slug=? LIMIT 1`).bind(slug).first<Record<string,any>>();
}

export async function topicHistory(db:D1Database,topicId:string,days:number):Promise<Array<Record<string,any>>>{
  const r=await db.prepare(`SELECT region,heat,delta,momentum,lifecycle,coverage_confidence,cross_platform_index,components_json,captured_at FROM topic_snapshots WHERE topic_id=? AND captured_at>=datetime('now',?) ORDER BY captured_at`).bind(topicId,`-${Math.max(1,days)} days`).all<Record<string,any>>();
  return r.results??[];
}

export async function topicSources(db:D1Database,topicId:string,limit=100):Promise<Array<Record<string,any>>>{
  const r=await db.prepare(`SELECT r.source_id,r.title,r.url,r.rank,r.raw_heat,r.raw_metrics_json,r.published_at,r.retrieved_at,s.name source_name FROM topic_items ti JOIN raw_items r ON r.id=ti.raw_item_id JOIN sources s ON s.id=r.source_id WHERE ti.topic_id=? ORDER BY r.retrieved_at DESC,r.rank ASC LIMIT ?`).bind(topicId,Math.min(200,limit)).all<Record<string,any>>();
  return r.results??[];
}

export async function searchTopics(db:D1Database,q:string,limit=30):Promise<Array<Record<string,any>>>{
  const term=`%${q.replace(/[%_]/g,'')}%`;
  const r=await db.prepare(`SELECT DISTINCT t.* FROM topics t LEFT JOIN topic_aliases a ON a.topic_id=t.id WHERE t.canonical_title_zh LIKE ? OR t.canonical_title_en LIKE ? OR a.alias LIKE ? ORDER BY MAX(t.china_heat,t.global_heat) DESC LIMIT ?`).bind(term,term,term,Math.min(50,limit)).all<Record<string,any>>();
  return r.results??[];
}

export async function healthSummary(db:D1Database):Promise<Record<string,unknown>>{
  const counts=await db.prepare(`SELECT (SELECT COUNT(*) FROM topics) topic_count,(SELECT COUNT(*) FROM raw_items) raw_item_count,(SELECT COUNT(*) FROM topic_snapshots) snapshot_count`).first<Record<string,number>>();
  const run=await db.prepare(`SELECT * FROM system_runs ORDER BY started_at DESC LIMIT 1`).first<Record<string,unknown>>();
  const partial=await db.prepare(`SELECT * FROM system_runs WHERE status='PARTIAL' ORDER BY started_at DESC LIMIT 1`).first<Record<string,unknown>>();
  return { ...counts, last_run:run, last_partial_run:partial, source_health:await sourceHealth(db) };
}
