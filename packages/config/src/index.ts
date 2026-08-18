import { parseBoolean } from '@hot-topics/shared';

export const SCORING_MODEL_VERSION = 'v1.0.0';

export const SCORING_WEIGHTS = Object.freeze({
  platformStrength: 0.34,
  breadth: 0.22,
  volume: 0.12,
  search: 0.12,
  persistence: 0.10,
  freshness: 0.10
});

export const CLUSTERING_THRESHOLDS = Object.freeze({
  autoMerge: 0.90,
  arbitrationLow: 0.76,
  candidateMin: 0.42,
  numericConflictPenalty: 0.24,
  timeConflictPenalty: 0.18
});

export const MOMENTUM_THRESHOLDS = Object.freeze({
  surging: 12,
  rising: 4,
  stableBand: 3,
  cooling: -4,
  fallingFast: -12,
  hysteresis: 2
});

export const SOURCE_DEFAULTS = Object.freeze({
  baidu: true,
  kr36: true,
  people: true,
  hackernews: true,
  wikimedia: true,
  bbc: true,
  gdelt: false,
  youtube: false,
  zhihu: false,
  weibo: false,
  googleTrends: false
});

export interface FeatureFlags {
  baidu: boolean;
  kr36: boolean;
  people: boolean;
  hackernews: boolean;
  wikimedia: boolean;
  bbc: boolean;
  gdelt: boolean;
  youtube: boolean;
  zhihu: boolean;
  weibo: boolean;
  googleTrends: boolean;
}

export function featureFlags(env: Record<string, string | undefined> = {}): FeatureFlags {
  return {
    baidu: parseBoolean(env.SOURCE_BAIDU_ENABLED, SOURCE_DEFAULTS.baidu),
    kr36: parseBoolean(env.SOURCE_36KR_ENABLED, SOURCE_DEFAULTS.kr36),
    people: parseBoolean(env.SOURCE_PEOPLE_ENABLED, SOURCE_DEFAULTS.people),
    hackernews: parseBoolean(env.SOURCE_HN_ENABLED, SOURCE_DEFAULTS.hackernews),
    wikimedia: parseBoolean(env.SOURCE_WIKIMEDIA_ENABLED, SOURCE_DEFAULTS.wikimedia),
    bbc: parseBoolean(env.SOURCE_BBC_ENABLED, SOURCE_DEFAULTS.bbc),
    gdelt: parseBoolean(env.SOURCE_GDELT_ENABLED, SOURCE_DEFAULTS.gdelt),
    youtube: parseBoolean(env.SOURCE_YOUTUBE_ENABLED, SOURCE_DEFAULTS.youtube),
    zhihu: parseBoolean(env.SOURCE_ZHIHU_ENABLED, SOURCE_DEFAULTS.zhihu),
    weibo: parseBoolean(env.SOURCE_WEIBO_ENABLED, SOURCE_DEFAULTS.weibo),
    googleTrends: parseBoolean(env.SOURCE_GOOGLE_TRENDS_ENABLED, SOURCE_DEFAULTS.googleTrends)
  };
}

export const LLM_BUDGET_DEFAULT = 8;
export const RAW_RETENTION_DAYS = 30;
export const RECENT_TOPIC_LOOKBACK_HOURS = 72;
