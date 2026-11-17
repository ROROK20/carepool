-- Carepool schema (SQLite, WAL). Every statement is idempotent; db.ts runs this file on open.
-- Times are ISO-8601 UTC text; calendar days are YYYY-MM-DD; clock times are HH:MM (24 h).

CREATE TABLE IF NOT EXISTS recipient (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  name      TEXT NOT NULL,
  age       INTEGER,
  fictional INTEGER NOT NULL DEFAULT 0,
  notice    TEXT
);

-- What the family typed. dose is stored exactly as entered and never rewritten.
CREATE TABLE IF NOT EXISTS meds (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  dose       TEXT NOT NULL DEFAULT '',
  times_json TEXT NOT NULL DEFAULT '[]',
  notes      TEXT NOT NULL DEFAULT '',
  position   INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- The FDA label resolved for a medicine (parsed sections included), so pages and the matcher never refetch.
CREATE TABLE IF NOT EXISTS labels (
  med_id        TEXT PRIMARY KEY REFERENCES meds(id) ON DELETE CASCADE,
  query         TEXT NOT NULL,
  resolved_json TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  med_id     TEXT PRIMARY KEY REFERENCES meds(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed')),
  step       TEXT,
  card_json  TEXT,
  error      TEXT,
  updated_at TEXT NOT NULL
);

-- Model explanations of deterministic flags, keyed by the flag id the matcher produced.
CREATE TABLE IF NOT EXISTS explanations (
  flag_id        TEXT PRIMARY KEY,
  sentences_json TEXT NOT NULL,
  model      TEXT,
  provider   TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- One row per generation run, for the progress display.
CREATE TABLE IF NOT EXISTS runs (
  id          TEXT PRIMARY KEY,
  status      TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')),
  provider    TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  note        TEXT
);

CREATE TABLE IF NOT EXISTS members (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT '',
  color    TEXT NOT NULL DEFAULT 'teal',
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('dose_check', 'refill', 'organizer', 'custom')),
  slot            TEXT,
  time            TEXT,
  assignee_id     TEXT REFERENCES members(id) ON DELETE SET NULL,
  recurrence_json TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

-- The state of one task on one day. No row = open.
CREATE TABLE IF NOT EXISTS task_events (
  task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  date            TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('done', 'needs_cover', 'covered')),
  by_member_id    TEXT REFERENCES members(id) ON DELETE SET NULL,
  cover_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (task_id, date)
);
