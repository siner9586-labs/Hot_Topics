import type { RawHotItem, SourceAdapter, SourceStatus } from '@hot-topics/core';

export interface QualityResult { accepted:RawHotItem[]; status:SourceStatus; warnings:string[]; duplicateRate:number; nullTitleRate:number; }

export function applyQualityGate(_adapter:SourceAdapter,items:RawHotItem[]):QualityResult{
  const warnings:string[]=[];
  if(!items.length) return {accepted:[],status:'degraded',warnings:['zero_items'],duplicateRate:0,nullTitleRate:1};
  const titleMissing=items.filter((i)=>!i.title.trim()).length;
  const nullTitleRate=titleMissing/items.length;
  const seen=new Set<string>(); let duplicates=0;
  const accepted=items.filter((item)=>{
    const title=item.title.normalize('NFKC').trim();
    if(!title || title.length>500) return false;
    const key=`${item.sourceId}|${item.url??title}`;
    if(seen.has(key)){duplicates+=1;return false;} seen.add(key); return true;
  });
  const duplicateRate=duplicates/items.length;
  if(nullTitleRate>0.02) warnings.push(`null_title_rate=${nullTitleRate.toFixed(3)}`);
  if(duplicateRate>0.2) warnings.push(`duplicate_rate=${duplicateRate.toFixed(3)}`);
  if(accepted.length<Math.min(3,items.length)) warnings.push(`accepted_items=${accepted.length}`);
  const status:SourceStatus=warnings.length && accepted.length<5?'degraded':'healthy';
  return {accepted,status,warnings,duplicateRate,nullTitleRate};
}
