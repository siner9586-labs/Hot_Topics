import { collectAll, createAdapters } from '@hot-topics/adapters';
import type { PipelineRunReport, Region, SourceRunResult } from '@hot-topics/core';
import { healthSummary, insertRawItems, listRankings, recordSourceRun, runSnapshotCounts, searchTopics, setRunStatus, sourceHealth, startSystemRun, topicBySlug, topicHistory, topicSources, upsertSource } from '@hot-topics/db';
import { createLogger } from '@hot-topics/shared';
import { processRun } from './process.ts';
import { applyQualityGate } from './quality.ts';
import type { ExecutionContext, MessageBatch, ProcessRunMessage, ScheduledController, ServiceEnv } from './runtime-types.ts';

const log=createLogger();
const REGIONS:Region[]=['CN','GLOBAL'];
const PRIMARY_CRON='0 1,4,7,10,13,16,19,22 * * *';
const WATCHDOG_CRON='30 * * * *';
const STALE_AFTER_MS=3.25*60*60*1000;
const ACTIVE_GRACE_MS=45*60*1000;
function envRecord(env:ServiceEnv):Record<string,string|undefined>{ return env as unknown as Record<string,string|undefined>; }
function json(data:unknown,status=200,cache='public, max-age=60, s-maxage=180'){
  return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':cache,'access-control-allow-origin':'*','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin'}});
}
function runIdFor(timestamp:number,prefix='run'):string{ return `${prefix}_${new Date(timestamp).toISOString().replace(/[-:.TZ]/g,'').slice(0,14)}`; }
function bearer(request:Request):string{ return request.headers.get('authorization')?.replace(/^Bearer\s+/i,'')??''; }
function adminAuthorized(request:Request,env:ServiceEnv):boolean{ return Boolean(env.ADMIN_RUN_TOKEN)&&bearer(request)===env.ADMIN_RUN_TOKEN; }
function publishStatus(sourceStatuses:Record<string,string>):'PUBLISHED'|'PARTIAL'{
  return Object.values(sourceStatuses).some((s)=>!['healthy','degraded','disabled','auth_required','requires_access'].includes(s))?'PARTIAL':'PUBLISHED';
}
function maxCapturedAt(rows:Array<Record<string,any>>):string|null{
  let latest='';
  for(const row of rows){ const value=String(row.captured_at??''); if(value>latest) latest=value; }
  return latest||null;
}

async function schedulerState(db:ServiceEnv['DB'],nowMs=Date.now()):Promise<Record<string,unknown>>{
  const terminal=await db.prepare(`SELECT id,status,started_at,updated_at FROM system_runs WHERE status IN ('PUBLISHED','PARTIAL') ORDER BY started_at DESC LIMIT 1`).first<Record<string,unknown>>();
  const active=await db.prepare(`SELECT id,status,started_at,updated_at FROM system_runs WHERE status IN ('STARTED','COLLECTING','PROCESSING','SCORING') ORDER BY updated_at DESC LIMIT 1`).first<Record<string,unknown>>();
  const snapshots=await db.prepare(`SELECT region,MAX(captured_at) captured_at FROM topic_snapshots GROUP BY region`).all<Record<string,unknown>>();
  const regionSnapshots:{CN:string|null;GLOBAL:string|null}={CN:null,GLOBAL:null};
  for(const row of snapshots.results??[]){ if(row.region==='CN'||row.region==='GLOBAL') regionSnapshots[row.region]=String(row.captured_at??'')||null; }
  const terminalAt=terminal?.started_at?Date.parse(String(terminal.started_at)):Number.NaN;
  const activeAt=active?.updated_at?Date.parse(String(active.updated_at)):Number.NaN;
  const terminalAgeMs=Number.isFinite(terminalAt)?Math.max(0,nowMs-terminalAt):null;
  const activeAgeMs=Number.isFinite(activeAt)?Math.max(0,nowMs-activeAt):null;
  const stale=terminalAgeMs===null||terminalAgeMs>STALE_AFTER_MS;
  const activeFresh=activeAgeMs!==null&&activeAgeMs<ACTIVE_GRACE_MS;
  return {now:new Date(nowMs).toISOString(),primary_cron:PRIMARY_CRON,watchdog_cron:WATCHDOG_CRON,latest_terminal_run:terminal,latest_active_run:active,region_snapshots:regionSnapshots,terminal_age_ms:terminalAgeMs,active_age_ms:activeAgeMs,stale,active_fresh:activeFresh,repair_needed:stale&&!activeFresh};
}

async function finalizeIfBothRegions(db:ServiceEnv['DB'],message:ProcessRunMessage,result:Record<string,unknown>):Promise<boolean>{
  const counts=await runSnapshotCounts(db,message.runId);
  if(counts.CN>0&&counts.GLOBAL>0){
    const status=publishStatus(message.sourceStatuses);
    await setRunStatus(db,message.runId,status,new Date().toISOString(),{...result,region_counts:counts,sourceStatuses:message.sourceStatuses});
    return true;
  }
  await setRunStatus(db,message.runId,'PROCESSING',new Date().toISOString(),{...result,region_counts:counts,awaiting_region:counts.CN>0?'GLOBAL':'CN'});
  return false;
}

async function collectAndQueue(env:ServiceEnv,runId:string,capturedAt:string):Promise<PipelineRunReport>{
  await startSystemRun(env.DB,runId,capturedAt); await setRunStatus(env.DB,runId,'COLLECTING',new Date().toISOString());
  const adapters=createAdapters(envRecord(env)); const expected={CN:0,GLOBAL:0}; const available={CN:0,GLOBAL:0};
  await Promise.all(adapters.map((adapter)=>upsertSource(env.DB,adapter)));
  for(const a of adapters.filter((x)=>x.enabled)) expected[a.region]+=a.reliabilityWeight;
  const results=await collectAll(adapters,{runId,retrievedAt:capturedAt,env:envRecord(env)});
  const sourceResults:SourceRunResult[]=[]; let rawItemCount=0;
  for(const result of results){
    const gated=result.status==='healthy'||result.status==='degraded'?applyQualityGate(result.adapter,result.items):{accepted:[],status:result.status,warnings:[],duplicateRate:0,nullTitleRate:0};
    const status=(result.status==='healthy'&&gated.status==='degraded'?'degraded':result.status);
    const accepted=gated.accepted; rawItemCount+=await insertRawItems(env.DB,runId,accepted);
    if(status==='healthy'||status==='degraded') available[result.adapter.region]+=result.adapter.reliabilityWeight;
    const sr:SourceRunResult={sourceId:result.adapter.id,status,itemCount:accepted.length,durationMs:result.durationMs,...(result.error?{detail:result.error}:{}),...(gated.warnings.length?{errorCode:gated.warnings.join(',')}: {}) };
    sourceResults.push(sr); await recordSourceRun(env.DB,runId,sr,result.adapter,new Date().toISOString());
    log({run_id:runId,source:result.adapter.id,stage:'collect',status,duration_ms:result.durationMs,item_count:accepted.length});
  }
  const active=sourceResults.filter((r)=>r.status!=='disabled'&&r.status!=='auth_required'&&r.status!=='requires_access');
  const failed=active.filter((r)=>!['healthy','degraded'].includes(r.status)); const collectionStatus=active.length===0?'FAILED':failed.length?'PARTIAL':'PUBLISHED';
  const sourceStatuses=Object.fromEntries(sourceResults.map((r)=>[r.sourceId,r.status]));
  await setRunStatus(env.DB,runId,'PROCESSING',new Date().toISOString(),{queued_regions:REGIONS});
  for(const region of REGIONS){
    const message:ProcessRunMessage={type:'PROCESS_RUN',runId,capturedAt,region,expectedWeightByRegion:expected,availableWeightByRegion:available,sourceStatuses};
    try { await env.PIPELINE_QUEUE.send(message); }
    catch(error){
      log({run_id:runId,region,stage:'queue',status:'fallback_direct',detail:error instanceof Error?error.message:'queue_error'});
      const processed=await processRun(env.DB,message);
      await finalizeIfBothRegions(env.DB,message,processed);
    }
  }
  return {runId,status:collectionStatus,startedAt:capturedAt,finishedAt:new Date().toISOString(),sources:sourceResults,rawItemCount,topicCount:0,snapshotCount:0};
}

async function handleApi(request:Request,env:ServiceEnv):Promise<Response>{
  const url=new URL(request.url); const path=url.pathname;
  if(path==='/health'){
    const token=bearer(request);
    if(env.ADMIN_HEALTH_TOKEN && token!==env.ADMIN_HEALTH_TOKEN) return json({status:'ok',detail:'protected'},200,'no-store');
    return json(await healthSummary(env.DB),200,'no-store');
  }
  if(path==='/api/v1/freshness') return json(await schedulerState(env.DB),200,'no-store');
  if(path==='/api/v1/source-health') return json({data:await sourceHealth(env.DB)},200,'no-store');
  if(path==='/api/v1/rankings'){
    const region=url.searchParams.get('region')==='GLOBAL'?'GLOBAL':'CN'; const mode=url.searchParams.get('mode')??'all'; const limit=Number(url.searchParams.get('limit')??50);
    const data=await listRankings(env.DB,region,limit,mode); const dataAsOf=maxCapturedAt(data); const stale=!dataAsOf||Date.now()-Date.parse(dataAsOf)>4*60*60*1000;
    return json({data,region,mode,generated_at:new Date().toISOString(),data_as_of:dataAsOf,stale},200,'no-store');
  }
  if(path==='/api/v1/topics'){
    const q=(url.searchParams.get('q')??'').trim(); if(q) return json({data:await searchTopics(env.DB,q,Number(url.searchParams.get('limit')??30))},200,'no-store');
    const region=url.searchParams.get('region')==='GLOBAL'?'GLOBAL':'CN'; const data=await listRankings(env.DB,region,Number(url.searchParams.get('limit')??50),'all');
    return json({data,region,generated_at:new Date().toISOString(),data_as_of:maxCapturedAt(data)},200,'no-store');
  }
  const match=path.match(/^\/api\/v1\/topics\/([^/]+)$/);
  if(match){ const slug=decodeURIComponent(match[1]??''); const topic=await topicBySlug(env.DB,slug); if(!topic)return json({error:'topic_not_found'},404);
    const days=Math.min(30,Math.max(1,Number(url.searchParams.get('days')??7))); return json({data:{...topic,history:await topicHistory(env.DB,String(topic.id),days),sources:await topicSources(env.DB,String(topic.id),100)}}); }
  return json({error:'not_found'},404);
}

async function handleRunNow(request:Request,env:ServiceEnv):Promise<Response>{
  if(!adminAuthorized(request,env)) return json({error:'not_found'},404,'no-store');
  const capturedAt=new Date().toISOString(); const runId=runIdFor(Date.now(),'manual');
  const report=await collectAndQueue(env,runId,capturedAt);
  return json({accepted:true,run_id:runId,collected:report.rawItemCount,source_results:report.sources.map((s)=>({source:s.sourceId,status:s.status,item_count:s.itemCount}))},202,'no-store');
}

async function handleRunStatus(request:Request,env:ServiceEnv):Promise<Response>{
  if(!adminAuthorized(request,env)) return json({error:'not_found'},404,'no-store');
  const runId=new URL(request.url).searchParams.get('run_id')?.trim();
  if(!runId) return json({error:'run_id_required'},400,'no-store');
  const run=await env.DB.prepare(`SELECT id,status,started_at,updated_at,detail_json FROM system_runs WHERE id=? LIMIT 1`).bind(runId).first<Record<string,unknown>>();
  if(!run) return json({error:'run_not_found'},404,'no-store');
  const counts=await runSnapshotCounts(env.DB,runId);
  const sourceResult=await env.DB.prepare(`SELECT source_id,status,item_count,duration_ms,error_code,detail FROM source_runs WHERE run_id=? ORDER BY source_id`).bind(runId).all<Record<string,unknown>>();
  return json({run,region_counts:counts,sources:sourceResult.results??[]},200,'no-store');
}

export default {
  async fetch(request:Request,env:ServiceEnv):Promise<Response>{
    const path=new URL(request.url).pathname;
    if(path==='/admin/run-now'){
      if(request.method!=='POST') return json({error:'method_not_allowed'},405,'no-store');
      return handleRunNow(request,env);
    }
    if(path==='/admin/run-status'){
      if(request.method!=='GET') return json({error:'method_not_allowed'},405,'no-store');
      return handleRunStatus(request,env);
    }
    if(request.method!=='GET'&&request.method!=='HEAD')return json({error:'method_not_allowed'},405,'no-store');
    return handleApi(request,env);
  },
  async scheduled(controller:ScheduledController,env:ServiceEnv,_ctx:ExecutionContext):Promise<void>{
    const capturedAt=new Date(controller.scheduledTime).toISOString();
    if(controller.cron===WATCHDOG_CRON){
      const state=await schedulerState(env.DB,controller.scheduledTime);
      if(!state.repair_needed){ log({stage:'watchdog',status:'fresh',...state}); return; }
      const runId=runIdFor(controller.scheduledTime,'repair');
      log({run_id:runId,stage:'watchdog',status:'repair_start',...state});
      await collectAndQueue(env,runId,capturedAt);
      return;
    }
    const runId=runIdFor(controller.scheduledTime);
    log({run_id:runId,stage:'cron',status:'start',cron:controller.cron});
    await collectAndQueue(env,runId,capturedAt);
  },
  async queue(batch:MessageBatch<ProcessRunMessage>,env:ServiceEnv):Promise<void>{
    for(const message of batch.messages){
      try{
        const result=await processRun(env.DB,message.body);
        const finalized=await finalizeIfBothRegions(env.DB,message.body,result);
        message.ack();
        log({run_id:message.body.runId,stage:'publish',status:finalized?publishStatus(message.body.sourceStatuses):'REGION_COMPLETE',...result});
      } catch(error){
        log({run_id:message.body.runId,region:message.body.region,stage:'process',status:'retry',detail:error instanceof Error?error.message:'unknown_error'});
        message.retry({delaySeconds:60});
      }
    }
  }
};

export { collectAndQueue };
