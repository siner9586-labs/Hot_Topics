export type Region = 'CN' | 'GLOBAL';
export type SourceCategory = 'search' | 'social' | 'video' | 'news' | 'knowledge' | 'forum';
export type SourceStatus =
  | 'healthy'
  | 'degraded'
  | 'unavailable'
  | 'disabled'
  | 'rate_limited'
  | 'auth_required'
  | 'schema_changed'
  | 'requires_access';

export type TopicCategory =
  | '社会' | '国际' | '财经' | '科技' | 'AI' | '汽车' | '娱乐' | '体育' | '游戏' | '文化教育' | '健康' | '其他';

export type Lifecycle = 'emerging' | 'rising' | 'spreading' | 'peak' | 'cooling' | 'long_tail' | 'revived';
export type MomentumLabel = 'surging' | 'rising' | 'stable' | 'cooling' | 'falling_fast';

export interface RawHotItem {
  id: string;
  sourceId: string;
  sourceType: string;
  region: Region;
  title: string;
  url?: string;
  rank?: number;
  rawHeat?: number;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  searchInterest?: number;
  publishedAt?: string;
  retrievedAt: string;
  language?: string;
  categoryHint?: string;
  sourceMetadata?: Record<string, unknown>;
}

export interface HealthResult {
  status: SourceStatus;
  latencyMs?: number;
  detail?: string;
}

export interface CollectContext {
  runId: string;
  retrievedAt: string;
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
}

export interface SourceAdapter {
  id: string;
  name: string;
  region: Region;
  category: SourceCategory;
  reliabilityWeight: number;
  adapterVersion: string;
  enabled: boolean;
  healthCheck(context: CollectContext): Promise<HealthResult>;
  collect(context: CollectContext): Promise<RawHotItem[]>;
}

export interface Topic {
  id: string;
  slug: string;
  canonicalTitleZh: string;
  canonicalTitleEn: string;
  category: TopicCategory;
  firstSeenAt: string;
  lastSeenAt: string;
  chinaHeat: number;
  globalHeat: number;
  lifecycle: Lifecycle;
}

export interface PlatformContribution {
  sourceId: string;
  sourceCategory: SourceCategory;
  region: Region;
  platformHeat: number;
  reliabilityWeight: number;
  rawVolumeSignal: number;
  searchSignal: number;
}

export interface HeatComponents {
  platformStrength: number;
  breadth: number;
  volume: number;
  search: number;
  persistence: number;
  freshness: number;
}

export interface HeatResult {
  heat: number;
  coverageConfidence: number;
  crossPlatformIndex: number;
  components: HeatComponents;
  scoringModelVersion: string;
}

export interface TrendPoint {
  capturedAt: string;
  heat: number;
}

export interface SnapshotRecord {
  topicId: string;
  region: Region;
  heat: number;
  delta: number | null;
  isNew: boolean;
  momentum: MomentumLabel;
  lifecycle: Lifecycle;
  coverageConfidence: number;
  crossPlatformIndex: number;
  components: HeatComponents;
  capturedAt: string;
}

export interface ClusterDecision {
  sameEvent: boolean;
  confidence: number;
  reasonCode: string;
  similarity: number;
}

export interface SourceRunResult {
  sourceId: string;
  status: SourceStatus;
  itemCount: number;
  durationMs: number;
  errorCode?: string;
  detail?: string;
}

export interface PipelineRunReport {
  runId: string;
  status: 'PUBLISHED' | 'PARTIAL' | 'FAILED';
  startedAt: string;
  finishedAt: string;
  sources: SourceRunResult[];
  rawItemCount: number;
  topicCount: number;
  snapshotCount: number;
}
