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

export function tokenize(input: string): string[] {
  const normalized = normalizeTitle(input);
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

export function jaccard(a: string[], b: string[]): number {
  const aa = new Set(a); const bb = new Set(b);
  const intersection = [...aa].filter((x) => bb.has(x)).length;
  const union = new Set([...aa, ...bb]).size;
  return union ? intersection / union : 0;
}

export function charNgrams(input: string, n = 3): string[] {
  const value = normalizeTitle(input).replace(/\s+/g, '');
  if (value.length <= n) return value ? [value] : [];
  return Array.from({ length: value.length - n + 1 }, (_, i) => value.slice(i, i + n));
}

export function extractNumbers(input: string): string[] {
  return [...new Set((input.match(/\b\d+(?:\.\d+)?(?:%|亿|万|级|b|m|k)?\b/gi) ?? []).map((x) => x.toLowerCase()))];
}

export function extractDateTokens(input: string): string[] {
  return [...new Set(input.match(/(?:20\d{2}[-/.年])?\d{1,2}[-/.月]\d{1,2}(?:日)?|20\d{2}年?/g) ?? [])];
}

export function eventFingerprint(title: string): string {
  const normalized = normalizeTitle(title);
  const significant = tokenize(normalized).filter((t) => t.length > 1).sort().slice(0, 12).join('|');
  const numbers = extractNumbers(normalized).sort().join('|');
  const dates = extractDateTokens(normalized).sort().join('|');
  return stableHash(`${significant}::${numbers}::${dates}`);
}

export function lexicalSimilarity(a: string, b: string): number {
  const tokenScore = jaccard(tokenize(a), tokenize(b));
  const charScore = jaccard(charNgrams(a), charNgrams(b));
  const aNorm = normalizeTitle(a); const bNorm = normalizeTitle(b);
  const containment = aNorm.includes(bNorm) || bNorm.includes(aNorm) ? 1 : 0;
  let score = 0.52 * tokenScore + 0.38 * charScore + 0.10 * containment;
  if (tokenScore >= 0.95) score = Math.max(score, 0.94);
  const numsA = extractNumbers(a); const numsB = extractNumbers(b);
  if (numsA.length && numsB.length && jaccard(numsA, numsB) === 0) score -= CLUSTERING_THRESHOLDS.numericConflictPenalty;
  const datesA = extractDateTokens(a); const datesB = extractDateTokens(b);
  if (datesA.length && datesB.length && jaccard(datesA, datesB) === 0) score -= CLUSTERING_THRESHOLDS.timeConflictPenalty;
  return Math.max(0, Math.min(1, score));
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

export async function decideCluster(
  a: string,
  b: string,
  arbitration: ArbitrationProvider = new DisabledArbitrationProvider()
): Promise<ClusterDecision> {
  const similarity = lexicalSimilarity(a, b);
  if (similarity >= CLUSTERING_THRESHOLDS.autoMerge) {
    return { sameEvent: true, confidence: similarity, reasonCode: 'high_lexical_event_match', similarity };
  }
  if (similarity < CLUSTERING_THRESHOLDS.arbitrationLow) {
    return { sameEvent: false, confidence: 1 - similarity, reasonCode: 'below_boundary_threshold', similarity };
  }
  if (arbitration.available()) return arbitration.decide(a, b, similarity);
  return { sameEvent: false, confidence: 0.55, reasonCode: 'ambiguous_no_llm_conservative_split', similarity };
}

export interface ClusterSeed { topicId: string; title: string; firstSeenAt: string; lastSeenAt: string; }
export interface ClusterAssignment { item: RawHotItem; topicId: string | null; decision: ClusterDecision | null; }

export async function assignToExistingTopics(
  items: RawHotItem[],
  seeds: ClusterSeed[],
  arbitration: ArbitrationProvider = new DisabledArbitrationProvider()
): Promise<ClusterAssignment[]> {
  const assignments: ClusterAssignment[] = [];
  for (const item of items) {
    let best: ClusterSeed | undefined;
    let bestSimilarity = -1;
    for (const seed of seeds) {
      const similarity = lexicalSimilarity(item.title, seed.title);
      if (similarity > bestSimilarity) { best = seed; bestSimilarity = similarity; }
    }
    if (!best || bestSimilarity < CLUSTERING_THRESHOLDS.candidateMin) {
      assignments.push({ item, topicId: null, decision: null });
      continue;
    }
    const decision = await decideCluster(item.title, best.title, arbitration);
    assignments.push({ item, topicId: decision.sameEvent ? best.topicId : null, decision });
  }
  return assignments;
}
