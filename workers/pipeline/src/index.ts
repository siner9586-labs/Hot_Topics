import { collectAll, createAdapters } from '@hot-topics/adapters';
import type { PipelineRunReport, Region, SourceRunResult } from '@hot-topics/core';
import { healthSummary, insertRawItems, listRankings, recordSourceRun, runSnapshotCounts, searchTopics, setRunStatus, sourceHealth, startSystemRun, topicBySlug, topicHistory, topicSources, upsertSource } from '@hot-topics/db';
import { createLogger } from '@hot-topics/shared';
import { processRun } from './process.ts';
import { applyQualityGate } from './quality.ts';
import type { ExecutionContext, MessageBatch, ProcessRunMessage, ScheduledController, ServiceEnv } from './runtime-types.ts';

const log=createLogger();
const REGIONS:Region[]=['CN','GLOBAL'];
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
  // A cold production database has strict foreign keys from raw_items/source_runs/source_health to sources.
  // Register the complete source catalog before any collected item can be persisted.
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
  if(path==='/api/v1/source-health') return json({data:await sourceHealth(env.DB)});
  if(path==='/api/v1/rankings'){
    const region=url.searchParams.get('region')==='GLOBAL'?'GLOBAL':'CN'; const mode=url.searchParams.get('mode')??'all'; const limit=Number(url.searchParams.get('limit')??50);
    return json({data:await listRankings(env.DB,region,limit,mode),region,mode,generated_at:new Date().toISOString()});
  }
  if(path==='/api/v1/topics'){
    const q=(url.searchParams.get('q')??'').trim(); if(q) return json({data:await searchTopics(env.DB,q,Number(url.searchParams.get('limit')??30))});
    const region=url.searchParams.get('region')==='GLOBAL'?'GLOBAL':'CN'; return json({data:await listRankings(env.DB,region,Number(url.searchParams.get('limit')??50),'all')});
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
  async scheduled(controller:ScheduledController,env:ServiceEnv,ctx:ExecutionContext):Promise<void>{ const capturedAt=new Date(controller.scheduledTime).toISOString(); const runId=runIdFor(controller.scheduledTime); ctx.waitUntil(collectAndQueue(env,runId,capturedAt)); },
  async queue(batch:MessageBatch<ProcessRunMessage>,env:ServiceEnv):Promise<void>{
    for(const message of batch.messages){
      try{
        const result=await processRun(env.DB,message.body);
        const finalized=await finalizeIfBothRegions(env.DB,message.body,result);
        message.ack();
        log({run_id:message.body.runId,region:message.body.region,stage:'publish',status:finalized?publishStatus(message.body.sourceStatuses):'REGION_COMPLETE',...result});
      } catch(error){
        log({run_id:message.body.runId,region:message.body.region,stage:'process',status:'retry',detail:error instanceof Error?error.message:'unknown_error'});
        message.retry({delaySeconds:60});
      }
    }
  }
};

export { collectAndQueue };
