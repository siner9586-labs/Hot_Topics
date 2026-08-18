PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT NOT NULL CHECK(region IN ('CN','GLOBAL')),
  source_type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  weight REAL NOT NULL DEFAULT 1,
  reliability_weight REAL NOT NULL DEFAULT 1,
  adapter_version TEXT NOT NULL,
  last_success_at TEXT,
  last_failure_at TEXT,
  status TEXT NOT NULL DEFAULT 'disabled'
);

CREATE TABLE IF NOT EXISTS system_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('STARTED','COLLECTING','PROCESSING','SCORING','PUBLISHED','PARTIAL','FAILED')),
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_system_runs_started ON system_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS source_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES system_runs(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id),
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  detail TEXT,
  UNIQUE(run_id,source_id)
);

CREATE TABLE IF NOT EXISTS source_health (
  source_id TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
  last_success_at TEXT,
  last_failure_at TEXT,
  status TEXT NOT NULL,
  latency_ms INTEGER,
  item_count INTEGER NOT NULL DEFAULT 0,
  schema_error INTEGER NOT NULL DEFAULT 0,
  http_error TEXT,
  rate_limited INTEGER NOT NULL DEFAULT 0,
  adapter_version TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES system_runs(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id),
  source_item_key TEXT NOT NULL,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  url TEXT,
  rank INTEGER,
  raw_heat REAL,
  raw_metrics_json TEXT NOT NULL DEFAULT '{}',
  published_at TEXT,
  retrieved_at TEXT NOT NULL,
  language TEXT,
  content_hash TEXT NOT NULL,
  category_hint TEXT,
  UNIQUE(source_id,source_item_key,run_id)
);
CREATE INDEX IF NOT EXISTS idx_raw_run ON raw_items(run_id);
CREATE INDEX IF NOT EXISTS idx_raw_source_retrieved ON raw_items(source_id,retrieved_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_hash ON raw_items(content_hash);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  label_zh TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL
);
INSERT OR IGNORE INTO categories(id,label_zh,sort_order) VALUES
 ('social','社会',10),('international','国际',20),('finance','财经',30),('technology','科技',40),('ai','AI',50),('auto','汽车',60),
 ('entertainment','娱乐',70),('sports','体育',80),('games','游戏',90),('culture-education','文化教育',100),('health','健康',110),('other','其他',999);

CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  canonical_title_zh TEXT NOT NULL,
  canonical_title_en TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT '其他',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  china_heat REAL NOT NULL DEFAULT 0,
  global_heat REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  lifecycle TEXT NOT NULL DEFAULT 'emerging'
);
CREATE INDEX IF NOT EXISTS idx_topics_last_seen ON topics(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_topics_china_heat ON topics(china_heat DESC);
CREATE INDEX IF NOT EXISTS idx_topics_global_heat ON topics(global_heat DESC);

CREATE TABLE IF NOT EXISTS topic_aliases (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  language TEXT,
  normalized_alias TEXT NOT NULL,
  UNIQUE(topic_id,normalized_alias)
);

CREATE TABLE IF NOT EXISTS topic_items (
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  raw_item_id TEXT NOT NULL REFERENCES raw_items(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES system_runs(id) ON DELETE CASCADE,
  match_confidence REAL NOT NULL,
  match_reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(topic_id,raw_item_id)
);
CREATE INDEX IF NOT EXISTS idx_topic_items_run ON topic_items(run_id);

CREATE TABLE IF NOT EXISTS cluster_decisions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES system_runs(id) ON DELETE CASCADE,
  raw_item_id TEXT NOT NULL REFERENCES raw_items(id) ON DELETE CASCADE,
  candidate_topic_id TEXT REFERENCES topics(id),
  same_event INTEGER NOT NULL,
  confidence REAL NOT NULL,
  reason_code TEXT NOT NULL,
  similarity REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS topic_snapshots (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES system_runs(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  region TEXT NOT NULL CHECK(region IN ('CN','GLOBAL')),
  heat REAL NOT NULL,
  delta REAL,
  is_new INTEGER NOT NULL DEFAULT 0,
  momentum TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  coverage_confidence REAL NOT NULL,
  cross_platform_index REAL NOT NULL,
  components_json TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  scoring_model_version TEXT NOT NULL,
  evidence_coverage REAL NOT NULL DEFAULT 0,
  anomaly_risk REAL NOT NULL DEFAULT 0,
  UNIQUE(topic_id,region,captured_at)
);
CREATE INDEX IF NOT EXISTS idx_snapshots_region_time_heat ON topic_snapshots(region,captured_at DESC,heat DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_topic_time ON topic_snapshots(topic_id,captured_at DESC);

CREATE TABLE IF NOT EXISTS topic_platform_snapshots (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES system_runs(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id),
  region TEXT NOT NULL CHECK(region IN ('CN','GLOBAL')),
  platform_heat REAL NOT NULL,
  raw_volume_signal REAL NOT NULL,
  search_signal REAL NOT NULL,
  captured_at TEXT NOT NULL,
  UNIQUE(topic_id,source_id,captured_at)
);

CREATE TABLE IF NOT EXISTS system_state (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
