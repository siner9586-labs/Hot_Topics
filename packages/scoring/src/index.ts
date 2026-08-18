import type {
  HeatResult, Lifecycle, MomentumLabel, PlatformContribution, TrendPoint
} from '@hot-topics/core';
import { MOMENTUM_THRESHOLDS, SCORING_MODEL_VERSION, SCORING_WEIGHTS } from '@hot-topics/config';
import { clamp, hoursBetween, round1 } from '@hot-topics/shared';

export function rankDecay(rank: number, listSize = 50): number {
  const safeRank = Math.max(1, rank);
  const scale = Math.max(8, listSize / 3);
  return clamp(100 * Math.exp(-(safeRank - 1) / scale));
}

export function percentileRanks(values: number[]): number[] {
  if (values.length === 0) return [];
  const indexed = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = Array<number>(values.length).fill(0);
  indexed.forEach((entry, rank) => {
    result[entry.index] = values.length === 1 ? 100 : (rank / (values.length - 1)) * 100;
  });
  return result;
}

export function robustLongTailScores(values: number[]): number[] {
  if (values.length === 0) return [];
  const transformed = values.map((v) => Math.log1p(Math.max(0, v)));
  const sorted = [...transformed].sort((a, b) => a - b);
  const low = sorted[Math.floor((sorted.length - 1) * 0.02)] ?? sorted[0] ?? 0;
  const high = sorted[Math.ceil((sorted.length - 1) * 0.98)] ?? sorted.at(-1) ?? 1;
  const clipped = transformed.map((v) => Math.min(high, Math.max(low, v)));
  return percentileRanks(clipped);
}

export function normalizePlatformItems<T extends { rank?: number; rawHeat?: number; views?: number; comments?: number; likes?: number; shares?: number; searchInterest?: number }>(items: T[]): number[] {
  const volume = items.map((item) =>
    (item.views ?? 0) + 3 * (item.comments ?? 0) + 1.5 * (item.likes ?? 0) + 4 * (item.shares ?? 0) + (item.rawHeat ?? 0)
  );
  const volumeScores = robustLongTailScores(volume);
  return items.map((item, index) => {
    const rankScore = item.rank ? rankDecay(item.rank, items.length) : null;
    const volumeScore = volumeScores[index] ?? 0;
    const search = item.searchInterest == null ? null : clamp(item.searchInterest);
    const available = [rankScore, volumeScore, search].filter((v): v is number => v != null);
    return round1(available.length ? available.reduce((a, b) => a + b, 0) / available.length : 0);
  });
}

function diversityBreadth(contributions: PlatformContribution[]): number {
  const sources = new Set(contributions.map((c) => c.sourceId));
  const categories = new Set(contributions.map((c) => c.sourceCategory));
  const reliability = contributions.reduce((sum, c) => sum + c.reliabilityWeight, 0) / Math.max(1, contributions.length);
  const sourcePart = 60 * (1 - Math.exp(-sources.size / 2.2));
  const categoryPart = 30 * (1 - Math.exp(-categories.size / 1.7));
  return clamp((sourcePart + categoryPart + 10 * reliability) * Math.min(1, sources.size / 2));
}

export function computeHeat(
  contributions: PlatformContribution[],
  options: {
    persistence?: number;
    freshness?: number;
    expectedEnabledWeight?: number;
    availableEnabledWeight?: number;
  } = {}
): HeatResult {
  if (contributions.length === 0) {
    return {
      heat: 0,
      coverageConfidence: 0,
      crossPlatformIndex: 0,
      components: { platformStrength: 0, breadth: 0, volume: 0, search: 0, persistence: 0, freshness: 0 },
      scoringModelVersion: SCORING_MODEL_VERSION
    };
  }
  const reliabilitySum = contributions.reduce((sum, c) => sum + Math.max(0.05, c.reliabilityWeight), 0);
  const weighted = (selector: (c: PlatformContribution) => number) =>
    contributions.reduce((sum, c) => sum + selector(c) * Math.max(0.05, c.reliabilityWeight), 0) / reliabilitySum;
  const components = {
    platformStrength: weighted((c) => c.platformHeat),
    breadth: diversityBreadth(contributions),
    volume: weighted((c) => c.rawVolumeSignal),
    search: weighted((c) => c.searchSignal),
    persistence: clamp(options.persistence ?? 50),
    freshness: clamp(options.freshness ?? 80)
  };
  const heat = Object.entries(SCORING_WEIGHTS).reduce((sum, [key, weight]) => sum + components[key as keyof typeof components] * weight, 0);
  const expected = Math.max(0.01, options.expectedEnabledWeight ?? options.availableEnabledWeight ?? reliabilitySum);
  const available = Math.max(0, options.availableEnabledWeight ?? reliabilitySum);
  const coverageConfidence = clamp((available / expected) * 100);
  return {
    heat: round1(clamp(heat)),
    coverageConfidence: round1(coverageConfidence),
    crossPlatformIndex: round1(diversityBreadth(contributions)),
    components: Object.fromEntries(Object.entries(components).map(([k, v]) => [k, round1(v)])) as typeof components,
    scoringModelVersion: SCORING_MODEL_VERSION
  };
}

export function deltaHeat(current: number, previous: number | null | undefined): { delta: number | null; isNew: boolean } {
  if (previous == null) return { delta: null, isNew: true };
  return { delta: round1(current - previous), isNew: false };
}

export function momentumLabel(delta: number | null, previousLabel: MomentumLabel | null = null): MomentumLabel {
  if (delta == null) return 'surging';
  const h = previousLabel ? MOMENTUM_THRESHOLDS.hysteresis : 0;
  if (delta >= MOMENTUM_THRESHOLDS.surging + (previousLabel === 'surging' ? -h : h)) return 'surging';
  if (delta >= MOMENTUM_THRESHOLDS.rising + (previousLabel === 'rising' ? -h : h)) return 'rising';
  if (delta <= MOMENTUM_THRESHOLDS.fallingFast + (previousLabel === 'falling_fast' ? h : -h)) return 'falling_fast';
  if (delta <= MOMENTUM_THRESHOLDS.cooling + (previousLabel === 'cooling' ? h : -h)) return 'cooling';
  return 'stable';
}

export function inferLifecycle(points: TrendPoint[], now = new Date()): Lifecycle {
  if (points.length === 0) return 'emerging';
  const sorted = [...points].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  const first = sorted[0]!;
  const last = sorted.at(-1)!;
  const previous = sorted.at(-2);
  const age = hoursBetween(now.toISOString(), first.capturedAt);
  const delta = previous ? last.heat - previous.heat : last.heat;
  const historicPeak = Math.max(...sorted.map((p) => p.heat));
  const wasCool = sorted.slice(0, -1).some((p) => p.heat < historicPeak * 0.5);
  if (age <= 6 && last.heat < 45) return 'emerging';
  if (delta >= 12 && age > 12 && wasCool) return 'revived';
  if (delta >= 8) return 'rising';
  if (last.heat >= 80 && Math.abs(delta) < 8) return 'peak';
  if (delta <= -12) return 'cooling';
  if (age > 72 && last.heat < 35) return 'long_tail';
  return 'spreading';
}

export function freshnessScore(lastSeenAt: string, now = new Date()): number {
  const hours = hoursBetween(now.toISOString(), lastSeenAt);
  return clamp(100 * Math.exp(-hours / 18));
}

export function persistenceScore(firstSeenAt: string, recentSnapshotCount: number, now = new Date()): number {
  const age = hoursBetween(now.toISOString(), firstSeenAt);
  const continuity = clamp((recentSnapshotCount / 8) * 100);
  const maturity = clamp(100 * (1 - Math.exp(-age / 12)));
  return round1(0.65 * continuity + 0.35 * maturity);
}
