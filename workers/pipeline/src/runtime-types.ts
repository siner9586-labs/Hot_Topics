import type { D1Database } from '@hot-topics/db';

export interface QueueBinding<T> { send(message:T):Promise<void>; }
export interface ServiceEnv {
  DB:D1Database;
  PIPELINE_QUEUE:QueueBinding<ProcessRunMessage>;
  ADMIN_HEALTH_TOKEN?:string;
  OPENAI_API_KEY?:string;
  YOUTUBE_API_KEY?:string;
  ZHIHU_API_TOKEN?:string;
  ZHIHU_ACCESS_SECRET?:string;
  GDELT_CLOUD_API_KEY?:string;
  LLM_BUDGET_PER_RUN?:string;
  SOURCE_BAIDU_ENABLED?:string;
  SOURCE_36KR_ENABLED?:string;
  SOURCE_PEOPLE_ENABLED?:string;
  SOURCE_HN_ENABLED?:string;
  SOURCE_WIKIMEDIA_ENABLED?:string;
  SOURCE_BBC_ENABLED?:string;
  SOURCE_GDELT_ENABLED?:string;
  SOURCE_YOUTUBE_ENABLED?:string;
  SOURCE_ZHIHU_ENABLED?:string;
  SOURCE_WEIBO_ENABLED?:string;
  SOURCE_GOOGLE_TRENDS_ENABLED?:string;
}
export interface ProcessRunMessage {
  type:'PROCESS_RUN'; runId:string; capturedAt:string;
  expectedWeightByRegion:{CN:number;GLOBAL:number}; availableWeightByRegion:{CN:number;GLOBAL:number};
  sourceStatuses:Record<string,string>;
}
export interface ScheduledController { scheduledTime:number; cron:string; }
export interface ExecutionContext { waitUntil(promise:Promise<unknown>):void; }
export interface QueueMessage<T> { body:T; ack():void; retry(options?:{delaySeconds?:number}):void; }
export interface MessageBatch<T> { messages:Array<QueueMessage<T>>; queue:string; }
