import { collectAll, createAdapters } from '@hot-topics/adapters';
import type { PipelineRunReport, SourceRunResult } from '@hot-topics/core';
import { healthSummary, insertRawItems, listRankings, recordSourceRun, searchTopics, setRunStatus, sourceHealth, startSystemRun, topicBySlug, topicHistory, topicSources } from '@hot-topics/db';
import { createLogger } from '@hot-topics/shared';
import { processRun } from './process.ts';
import { applyQualityGate } from './quality.ts';
import type { ExecutionContext, MessageBatch, ProcessRunMessage, ScheduledController, ServiceEnv } from './runtime-types.ts';

const log=createLogger();
function envRecord(env:ServiceEnv):Record<string,string|undefined>{ return env as unknown as Record<string,string|undefined>; }
function json(data:unknown,status=200,cache='public, max-age=60, s-maxage=180'){
  return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':cache,'access-control-allow-origin':'*','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin'}});
}
function runIdFor(timestamp:number):string{ return `run_${new Date(timestamp).toISOString().replace(/[-:.TZ]/g,'').slice(0,12)}`; }

async function collectAndQueue(env:ServiceEnv,runId:string,capturedAt:string):Promise<PipelineRunReport>{
  await startSystemRun(env.DB,runId,capturedAt); await setRunStatus(env.DB,runId,'COLLECTING',new Date().toISOString());
  const adapters=createAdapters(envRecord(env)); const expected={CN:0,GLOBAL:0}; const available={CN:0,GLOBAL:0};
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
  const message:ProcessRunMessage={type:'PROCESS_RUN',runId,capturedAt,expectedWeightByRegion:expected,availableWeightByRegion:available,sourceStatuses:Object.fromEntries(sourceResults.map((r)=>[r.sourceId,r.status]))};
  try { await env.PIPELINE_QUEUE.send(message); }
  catch(error){ log({run_id:runId,stage:'queue',status:'fallback_direct',detail:error instanceof Error?error.message:'queue_error'}); const processed=await processRun(env.DB,message); await setRunStatus(env.DB,runId,collectionStatus,new Date().toISOString(),{...processed,sourceStatuses:message.sourceStatuses}); }
  return {runId,status:collectionStatus,startedAt:capturedAt,finishedAt:new Date().toISOString(),sources:sourceResults,rawItemCount,topicCount:0,snapshotCount:0};
}

async function handleApi(request:Request,env:ServiceEnv):Promise<Response>{
  const url=new URL(request.url); const path=url.pathname;
  if(path==='/health'){
    const token=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
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

export default {
  async fetch(request:Request,env:ServiceEnv):Promise<Response>{ if(request.method!=='GET'&&request.method!=='HEAD')return json({error:'method_not_allowed'},405,'no-store'); return handleApi(request,env); },
  async scheduled(controller:ScheduledController,env:ServiceEnv,ctx:ExecutionContext):Promise<void>{ const capturedAt=new Date(controller.scheduledTime).toISOString(); const runId=runIdFor(controller.scheduledTime); ctx.waitUntil(collectAndQueue(env,runId,capturedAt)); },
  async queue(batch:MessageBatch<ProcessRunMessage>,env:ServiceEnv):Promise<void>{
    for(const message of batch.messages){ try{ const result=await processRun(env.DB,message.body); const statuses=Object.values(message.body.sourceStatuses); const publishStatus=statuses.some((s)=>!['healthy','degraded','disabled','auth_required','requires_access'].includes(s))?'PARTIAL':'PUBLISHED';
        await setRunStatus(env.DB,message.body.runId,publishStatus,new Date().toISOString(),result); message.ack(); log({run_id:message.body.runId,stage:'publish',status:publishStatus,...result}); }
      catch(error){ log({run_id:message.body.runId,stage:'process',status:'retry',detail:error instanceof Error?error.message:'unknown_error'}); message.retry({delaySeconds:60}); } }
  }
};

export { collectAndQueue };
