const lifecycleZh:Record<string,string>={emerging:'萌芽',rising:'升温',spreading:'扩散',peak:'峰值',cooling:'降温',long_tail:'长尾',revived:'再爆发'};
const momentumZh:Record<string,string>={surging:'🚀 急升',rising:'↑ 上升',stable:'→ 平稳',cooling:'↓ 降温',falling_fast:'↓↓ 快速降温'};
export function lifecycleLabel(v:string){return lifecycleZh[v]??v;}
export function momentumLabel(v:string){return momentumZh[v]??v;}
export function deltaLabel(delta:number|null,isNew=false){if(isNew||delta==null)return 'NEW';return `${delta>0?'↑ ':delta<0?'↓ ':''}${delta>0?'+':''}${Number(delta).toFixed(0)}`;}
export function relativeTime(iso:string){const ms=Date.now()-Date.parse(iso);const h=Math.max(0,Math.round(ms/3600000));return h<1?'刚刚':h<24?`${h}小时前`:`${Math.round(h/24)}天前`;}
export function heat(value:number){return Math.round(Number(value)||0);}
