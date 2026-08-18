export interface ApiResult<T> { data:T; generated_at?:string; region?:string; mode?:string; }
export interface RankingRow {
  id:string; slug:string; canonical_title_zh:string; canonical_title_en:string; category:string; first_seen_at:string; last_seen_at:string;
  china_heat:number; global_heat:number; heat:number; delta:number|null; is_new:number; momentum:string; lifecycle:string; coverage_confidence:number;
  cross_platform_index:number; components_json:string; evidence_coverage:number; anomaly_risk:number; captured_at:string;
}
export interface TopicDetail extends RankingRow { history:Array<Record<string,any>>; sources:Array<Record<string,any>>; }

export async function apiFetch<T>(locals:any,path:string):Promise<T|null>{
  const service=locals?.runtime?.env?.API;
  if(service?.fetch){
    try{
      const response=await service.fetch(new Request(`https://pipeline.internal${path}`));
      if(response.ok) return await response.json() as T;
    }catch{/* fall through only when an explicit public/test API origin exists */}
  }
  const origin=import.meta.env.PUBLIC_API_ORIGIN;
  if(!origin) return null;
  try{
    const response=await fetch(`${origin}${path}`);
    if(!response.ok) return null;
    return await response.json() as T;
  }catch{return null;}
}

export function parseComponents(value:string|undefined):Record<string,number>{
  try{return value?JSON.parse(value) as Record<string,number>:{};}catch{return {};}
}
