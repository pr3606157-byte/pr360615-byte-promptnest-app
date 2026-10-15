CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  day TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'topic',
  status TEXT NOT NULL DEFAULT 'running',
  topic TEXT,
  meta TEXT,
  source_urls TEXT,
  research TEXT,
  outline TEXT,
  draft TEXT,
  check1 TEXT,
  check2 TEXT,
  failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER,
  channel TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  tags TEXT,
  body_md TEXT NOT NULL,
  image_url TEXT,
  image_alt TEXT,
  image_credit TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  quality_notes TEXT,
  created_at TEXT,
  published_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, published_at);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, day);

CREATE TABLE IF NOT EXISTS usage (
  day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT,
  level TEXT,
  message TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
