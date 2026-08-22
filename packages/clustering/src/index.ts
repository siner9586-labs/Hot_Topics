import type { ClusterDecision, RawHotItem } from '@hot-topics/core';
import { CLUSTERING_THRESHOLDS } from '@hot-topics/config';
import { stableHash } from '@hot-topics/shared';

const STOP_PATTERNS = [
  /^(最新|快讯|热搜|breaking|update|live)[:：\s-]*/i,
  /[🔥🚀📢⚡]/gu,
  /\b(read more|watch now)\b/gi
];

const ALIASES: Record<string, string> = {
  'donald trump': 'trump', 'president trump': 'trump', '特朗普': 'trump',
  'open ai': 'openai', 'open-ai': 'openai',
  '人工智能': 'ai', 'artificial intelligence': 'ai',
  '北京冬奥会': 'beijing olympics',
  '英伟达': 'nvidia', '辉达': 'nvidia'
};

export function normalizeTitle(input: string): string {
  let text = input.normalize('NFKC').toLowerCase();
  for (const pattern of STOP_PATTERNS) text = text.replace(pattern, ' ');
  text = text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[“”‘’"'`]/g, '')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    if (/\p{Script=Han}/u.test(alias)) text = text.replaceAll(alias, ` ${canonical} `);
    else text = text.replace(new RegExp(`(^|\\s)${escapeRegExp(alias)}(?=\\s|$)`, 'gi'), `$1${canonical}`);
  }
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenizeNormalized(normalized: string): string[] {
  const latin = normalized.match(/[a-z0-9][a-z0-9._+-]*/g) ?? [];
  const hanRuns = normalized.match(/[\p{Script=Han}]+/gu) ?? [];
  const han = hanRuns.flatMap((run) => {
    if (run.length <= 2) return [run];
    const grams: string[] = [];
    for (let i = 0; i < run.length - 1; i += 1) grams.push(run.slice(i, i + 2));
    return grams;
  });
  return [...new Set([...latin, ...han])];
}

export function tokenize(input: string): string[] {
  return tokenizeNormalized(normalizeTitle(input));
}

export function jaccard(a: string[], b: string[]): number {
  const aa = new Set(a); const bb = new Set(b);
  return setJaccard(aa, bb);
}

function setJaccard<T>(a:Set<T>,b:Set<T>):number {
  if (!a.size && !b.size) return 0;
  const smaller=a.size<=b.size?a:b; const larger=a.size<=b.size?b:a;
  let intersection=0;
  for(const value of smaller) if(larger.has(value)) intersection+=1;
  const union=a.size+b.size-intersection;
  return union ? intersection/union : 0;
}

function charNgramsNormalized(normalized:string,n=3):string[] {
  const value=normalized.replace(/\s+/g,'');
  if(value.length<=n) return value?[value]:[];
  return Array.from({length:value.length-n+1},(_,i)=>value.slice(i,i+n));
}

export function charNgrams(input: string, n = 3): string[] {
  return charNgramsNormalized(normalizeTitle(input),n);
}

export function extractNumbers(input: string): string[] {
  return [...new Set((input.match(/\b\d+(?:\.\d+)?(?:%|亿|万|级|b|m|k)?\b/gi) ?? []).map((x) => x.toLowerCase()))];
}

export function extractDateTokens(input: string): string[] {
  return [...new Set(input.match(/(?:20\d{2}[-/.年])?\d{1,2}[-/.月]\d{1,2}(?:日)?|20\d{2}年?/g) ?? [])];
}

export function eventFingerprint(title: string): string {
  const normalized = normalizeTitle(title);
  const significant = tokenizeNormalized(normalized).filter((t) => t.length > 1).sort().slice(0, 12).join('|');
  const numbers = extractNumbers(normalized).sort().join('|');
  const dates = extractDateTokens(normalized).sort().join('|');
  return stableHash(`${significant}::${numbers}::${dates}`);
}

interface LexicalFeatures {
  normalized:string;
  tokens:Set<string>;
  chars:Set<string>;
  numbers:Set<string>;
  dates:Set<string>;
}

function lexicalFeatures(input:string):LexicalFeatures {
  const normalized=normalizeTitle(input);
  return {
    normalized,
    tokens:new Set(tokenizeNormalized(normalized)),
    chars:new Set(charNgramsNormalized(normalized)),
    numbers:new Set(extractNumbers(normalized)),
    dates:new Set(extractDateTokens(normalized))
  };
}

function lexicalSimilarityFromFeatures(a:LexicalFeatures,b:LexicalFeatures):number {
  const tokenScore=setJaccard(a.tokens,b.tokens);
  const charScore=setJaccard(a.chars,b.chars);
  const containment=a.normalized.includes(b.normalized)||b.normalized.includes(a.normalized)?1:0;
  let score=0.52*tokenScore+0.38*charScore+0.10*containment;
  if(tokenScore>=0.95) score=Math.max(score,0.94);
  if(a.numbers.size&&b.numbers.size&&setJaccard(a.numbers,b.numbers)===0) score-=CLUSTERING_THRESHOLDS.numericConflictPenalty;
  if(a.dates.size&&b.dates.size&&setJaccard(a.dates,b.dates)===0) score-=CLUSTERING_THRESHOLDS.timeConflictPenalty;
  return Math.max(0,Math.min(1,score));
}

export function lexicalSimilarity(a: string, b: string): number {
  return lexicalSimilarityFromFeatures(lexicalFeatures(a),lexicalFeatures(b));
}

export interface EmbeddingProvider {
  id: string;
  available(): boolean;
  embed(texts: string[]): Promise<number[][]>;
}

export class DisabledEmbeddingProvider implements EmbeddingProvider {
  id = 'disabled';
  available(): boolean { return false; }
  async embed(_texts: string[]): Promise<number[][]> { return []; }
}

export interface ArbitrationProvider {
  id: string;
  available(): boolean;
  decide(a: string, b: string, similarity: number): Promise<ClusterDecision>;
}

export class DisabledArbitrationProvider implements ArbitrationProvider {
  id = 'disabled';
  available(): boolean { return false; }
  async decide(_a: string, _b: string, similarity: number): Promise<ClusterDecision> {
    return { sameEvent: false, confidence: 0, reasonCode: 'provider_disabled', similarity };
  }
}

async function decideClusterWithSimilarity(
  a:string,
  b:string,
  similarity:number,
  arbitration:ArbitrationProvider
):Promise<ClusterDecision>{
  if (similarity >= CLUSTERING_THRESHOLDS.autoMerge) {
    return { sameEvent: true, confidence: similarity, reasonCode: 'high_lexical_event_match', similarity };
  }
  if (similarity < CLUSTERING_THRESHOLDS.arbitrationLow) {
    return { sameEvent: false, confidence: 1 - similarity, reasonCode: 'below_boundary_threshold', similarity };
  }
  if (arbitration.available()) return arbitration.decide(a, b, similarity);
  return { sameEvent: false, confidence: 0.55, reasonCode: 'ambiguous_no_llm_conservative_split', similarity };
}

export async function decideCluster(
  a: string,
  b: string,
  arbitration: ArbitrationProvider = new DisabledArbitrationProvider()
): Promise<ClusterDecision> {
  return decideClusterWithSimilarity(a,b,lexicalSimilarity(a,b),arbitration);
}

export interface ClusterSeed { topicId: string; title: string; firstSeenAt: string; lastSeenAt: string; }
export interface ClusterAssignment { item: RawHotItem; topicId: string | null; decision: ClusterDecision | null; }

export async function assignToExistingTopics(
  items: RawHotItem[],
  seeds: ClusterSeed[],
  arbitration: ArbitrationProvider = new DisabledArbitrationProvider()
): Promise<ClusterAssignment[]> {
  const assignments: ClusterAssignment[] = [];
  // The production queue may compare dozens of items with up to 1,000 recent topics.
  // Precompute seed features once; recomputing tokenization/ngrams for every pair can
  // consume the entire Queue CPU budget before GLOBAL reaches snapshot generation.
  const preparedSeeds=seeds.map((seed)=>({seed,features:lexicalFeatures(seed.title)}));
  for (const item of items) {
    const itemFeatures=lexicalFeatures(item.title);
    let best: ClusterSeed | undefined;
    let bestSimilarity = -1;
    for (const prepared of preparedSeeds) {
      const similarity = lexicalSimilarityFromFeatures(itemFeatures,prepared.features);
      if (similarity > bestSimilarity) { best = prepared.seed; bestSimilarity = similarity; }
    }
    if (!best || bestSimilarity < CLUSTERING_THRESHOLDS.candidateMin) {
      assignments.push({ item, topicId: null, decision: null });
      continue;
    }
    const decision = await decideClusterWithSimilarity(item.title, best.title, bestSimilarity, arbitration);
    assignments.push({ item, topicId: decision.sameEvent ? best.topicId : null, decision });
  }
  return assignments;
}
