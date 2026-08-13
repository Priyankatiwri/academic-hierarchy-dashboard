const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');

// Local dev (default): a plain SQLite file, zero external account needed.
// Production: point TURSO_DATABASE_URL/TURSO_AUTH_TOKEN at a free Turso database — same
// client API, same SQL, the app code doesn't change. See ../README.md "Deploying for free".
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'dashboard.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const url = process.env.TURSO_DATABASE_URL || `file:${dbPath}`;
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

const db = createClient(authToken ? { url, authToken } : { url });

// submission_events is append-only by convention: sync.js only ever INSERT OR IGNOREs into
// it, never UPDATEs or DELETEs a row — a status recorded here is what was true the first time
// it was observed, and stays that way for audit purposes even if the Drive file is later
// renamed, moved, or deleted. "student_groups" (not "groups" — GROUPS is a SQL keyword since
// window-function support landed) are auto-registered by the sync engine on first sighting a
// new Drive subfolder name, not pre-populated by hand.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    start_year INTEGER NOT NULL,
    end_year INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS semesters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL REFERENCES batches(id),
    number INTEGER NOT NULL CHECK (number BETWEEN 1 AND 4),
    UNIQUE (batch_id, number)
  )`,
  `CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    semester_id INTEGER NOT NULL REFERENCES semesters(id),
    name TEXT NOT NULL,
    UNIQUE (semester_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL REFERENCES subjects(id),
    name TEXT NOT NULL,
    drive_submission_link TEXT NOT NULL,
    drive_folder_id TEXT NOT NULL,
    deadline_at TEXT NOT NULL,
    on_time_window_hours INTEGER NOT NULL DEFAULT 24,
    grace_period_hours INTEGER NOT NULL DEFAULT 24
  )`,
  `CREATE TABLE IF NOT EXISTS student_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL REFERENCES subjects(id),
    name TEXT NOT NULL,
    UNIQUE (subject_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS submission_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_key TEXT NOT NULL UNIQUE,
    task_id INTEGER NOT NULL REFERENCES tasks(id),
    group_id INTEGER NOT NULL REFERENCES student_groups(id),
    drive_file_id TEXT,
    file_name TEXT,
    submitted_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('Before', 'On time', 'After', 'Missing')),
    web_view_link TEXT,
    first_observed_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_events_task_group ON submission_events(task_id, group_id)`,
  `CREATE INDEX IF NOT EXISTS idx_events_status ON submission_events(status)`,
  `CREATE INDEX IF NOT EXISTS idx_events_first_observed ON submission_events(first_observed_at)`,
  // Screenshot evidence stays in the Prof's own local folders (per requirement) — this is a
  // free-text note/pointer, not a file upload, so nothing needs to live on server disk.
  `CREATE TABLE IF NOT EXISTS evidence_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id),
    group_id INTEGER REFERENCES student_groups(id),
    note TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_email TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    connected_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    tasks_scanned INTEGER,
    groups_discovered INTEGER,
    events_created INTEGER,
    error TEXT
  )`
];

async function initSchema() {
  for (const statement of SCHEMA) {
    await db.execute(statement);
  }
}

module.exports = { db, initSchema };
