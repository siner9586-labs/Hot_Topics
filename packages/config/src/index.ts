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
  chinanews: true,
  toutiao: true,
  bilibili: true,
  hackernews: true,
  wikimedia: true,
  bbc: true,
  googleNews: true,
  guardian: true,
  nytimes: true,
  aljazeera: true,
  gdelt: false,
  youtube: false,
  zhihu: false,
  weibo: false,
  douyin: false,
  googleTrends: false,
  reddit: false,
  x: false,
  tiktok: false
});

export interface FeatureFlags {
  baidu: boolean;
  kr36: boolean;
  people: boolean;
  chinanews: boolean;
  toutiao: boolean;
  bilibili: boolean;
  hackernews: boolean;
  wikimedia: boolean;
  bbc: boolean;
  googleNews: boolean;
  guardian: boolean;
  nytimes: boolean;
  aljazeera: boolean;
  gdelt: boolean;
  youtube: boolean;
  zhihu: boolean;
  weibo: boolean;
  douyin: boolean;
  googleTrends: boolean;
  reddit: boolean;
  x: boolean;
  tiktok: boolean;
}

export function featureFlags(env: Record<string, string | undefined> = {}): FeatureFlags {
  return {
    baidu: parseBoolean(env.SOURCE_BAIDU_ENABLED, SOURCE_DEFAULTS.baidu),
    kr36: parseBoolean(env.SOURCE_36KR_ENABLED, SOURCE_DEFAULTS.kr36),
    people: parseBoolean(env.SOURCE_PEOPLE_ENABLED, SOURCE_DEFAULTS.people),
    chinanews: parseBoolean(env.SOURCE_CHINANEWS_ENABLED, SOURCE_DEFAULTS.chinanews),
    toutiao: parseBoolean(env.SOURCE_TOUTIAO_ENABLED, SOURCE_DEFAULTS.toutiao),
    bilibili: parseBoolean(env.SOURCE_BILIBILI_ENABLED, SOURCE_DEFAULTS.bilibili),
    hackernews: parseBoolean(env.SOURCE_HN_ENABLED, SOURCE_DEFAULTS.hackernews),
    wikimedia: parseBoolean(env.SOURCE_WIKIMEDIA_ENABLED, SOURCE_DEFAULTS.wikimedia),
    bbc: parseBoolean(env.SOURCE_BBC_ENABLED, SOURCE_DEFAULTS.bbc),
    googleNews: parseBoolean(env.SOURCE_GOOGLE_NEWS_ENABLED, SOURCE_DEFAULTS.googleNews),
    guardian: parseBoolean(env.SOURCE_GUARDIAN_ENABLED, SOURCE_DEFAULTS.guardian),
    nytimes: parseBoolean(env.SOURCE_NYTIMES_ENABLED, SOURCE_DEFAULTS.nytimes),
    aljazeera: parseBoolean(env.SOURCE_ALJAZEERA_ENABLED, SOURCE_DEFAULTS.aljazeera),
    gdelt: parseBoolean(env.SOURCE_GDELT_ENABLED, SOURCE_DEFAULTS.gdelt),
    youtube: parseBoolean(env.SOURCE_YOUTUBE_ENABLED, SOURCE_DEFAULTS.youtube),
    zhihu: parseBoolean(env.SOURCE_ZHIHU_ENABLED, SOURCE_DEFAULTS.zhihu),
    weibo: parseBoolean(env.SOURCE_WEIBO_ENABLED, SOURCE_DEFAULTS.weibo),
    douyin: parseBoolean(env.SOURCE_DOUYIN_ENABLED, SOURCE_DEFAULTS.douyin),
    googleTrends: parseBoolean(env.SOURCE_GOOGLE_TRENDS_ENABLED, SOURCE_DEFAULTS.googleTrends),
    reddit: parseBoolean(env.SOURCE_REDDIT_ENABLED, SOURCE_DEFAULTS.reddit),
    x: parseBoolean(env.SOURCE_X_ENABLED, SOURCE_DEFAULTS.x),
    tiktok: parseBoolean(env.SOURCE_TIKTOK_ENABLED, SOURCE_DEFAULTS.tiktok)
  };
}

export const LLM_BUDGET_DEFAULT = 8;
export const RAW_RETENTION_DAYS = 30;
export const RECENT_TOPIC_LOOKBACK_HOURS = 72;
