# Proposed Schema

SQLite, same append-only pattern as `../web-app` (see its
[README rationale](../web-app/README.md#why-sqlite-here-and-why-the-schema-looks-the-way-it-does)) —
`submission_events` and `evidence` are insert-only; the hierarchy tables (`batches` … `groups`)
are normal admin-managed config tables, though `groups` rows are written automatically by the
sync engine on first discovery rather than pre-populated by hand (see
[design-options.md §3](design-options.md#3-️-where-does-group-identity-come-from)).

Reflects the recommended options from [design-options.md](design-options.md) throughout.

```sql
CREATE TABLE batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,        -- e.g. "2025-27"
  start_year INTEGER NOT NULL,
  end_year INTEGER NOT NULL
);

CREATE TABLE semesters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  number INTEGER NOT NULL CHECK (number BETWEEN 1 AND 4),
  UNIQUE (batch_id, number)
);

-- Created inline from the Task creation form's "Subject name" field (autocomplete-or-create).
CREATE TABLE subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semester_id INTEGER NOT NULL REFERENCES semesters(id),
  name TEXT NOT NULL,
  UNIQUE (semester_id, name)
);

-- The unit the Prof creates directly: "Task" in product language, one Drive link, one deadline.
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  name TEXT NOT NULL,                   -- e.g. "Assignment 1"
  drive_submission_link TEXT NOT NULL,  -- as pasted by the Prof
  drive_folder_id TEXT NOT NULL,        -- extracted server-side from drive_submission_link
  deadline_at TEXT NOT NULL,            -- ISO 8601 UTC, exact date + time (design-options.md §7)
  on_time_window_hours INTEGER NOT NULL DEFAULT 24,  -- design-options.md §2 Option A
  grace_period_hours INTEGER NOT NULL DEFAULT 24      -- how long past deadline_at before "Missing" finalizes
);

-- Auto-registered by the sync engine on first sighting a new Drive subfolder name
-- (INSERT OR IGNORE, keyed on subject_id + name). Member enrichment is optional and additive.
CREATE TABLE groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  name TEXT NOT NULL,               -- the Drive subfolder name, e.g. "group_a"
  note TEXT,
  UNIQUE (subject_id, name)
);

CREATE TABLE group_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id),
  student_name TEXT NOT NULL,
  email TEXT
);

-- Append-only: sync.js only INSERT OR IGNOREs here, keyed on event_key. Never UPDATE/DELETE.
CREATE TABLE submission_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,   -- drive_file_id, or "missing-<task_id>-<group_id>"
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  group_id INTEGER NOT NULL REFERENCES groups(id),  -- always resolvable: it's the subfolder the file came from
  drive_file_id TEXT,
  file_name TEXT,
  submitted_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('Before', 'On time', 'After', 'Missing')),
  web_view_link TEXT,
  first_observed_at TEXT NOT NULL
);

CREATE INDEX idx_events_task_group ON submission_events(task_id, group_id);
CREATE INDEX idx_events_status ON submission_events(status);
CREATE INDEX idx_events_first_observed ON submission_events(first_observed_at);

-- design-options.md §5 Option A: uploaded through the dashboard, centralized.
CREATE TABLE evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  group_id INTEGER REFERENCES groups(id),   -- NULL if the screenshot covers the whole task (e.g. folder listing)
  file_path TEXT NOT NULL,
  uploaded_by TEXT,
  uploaded_at TEXT NOT NULL,
  note TEXT
);

CREATE TABLE sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  tasks_scanned INTEGER,
  groups_discovered INTEGER,
  events_created INTEGER,
  error TEXT
);
```

## Note on `submission_events.group_id`

Unlike the previous pass (where a submission could arrive from an unregistered student), a
submission here can't arrive without a resolvable group — the group *is* the Drive subfolder it
was found in, and that subfolder always gets auto-registered into `groups` before its files are
read (see flow 2 in [sequence-flows.md](sequence-flows.md)). So `group_id` is `NOT NULL` here,
unlike the nullable `student_id` in the earlier schema.

## Dashboard query shape

The cascading dropdowns are direct FK-chain queries — `semesters WHERE batch_id = ?`,
`subjects WHERE semester_id = ?`, `tasks WHERE subject_id = ?`. The submissions view for a
selected task is "latest event per group, or Missing marker, or Pending," same pattern as
`../web-app/src/routes/api.js`, joined through `groups` and sectioned by `status` in the
application layer (one query, grouped client-side into the four label sections):

```sql
SELECT
  g.id AS group_id, g.name AS group_name,
  latest.status, latest.file_name, latest.web_view_link, latest.submitted_at,
  ev.file_path AS evidence_path
FROM groups g
JOIN tasks t ON t.subject_id = g.subject_id
LEFT JOIN (
  SELECT * FROM submission_events
  WHERE task_id = @taskId
    AND id IN (SELECT MAX(id) FROM submission_events WHERE task_id = @taskId GROUP BY group_id)
) latest ON latest.group_id = g.id
LEFT JOIN evidence ev ON ev.task_id = @taskId AND (ev.group_id = g.id OR ev.group_id IS NULL)
WHERE t.id = @taskId
ORDER BY g.name;
```

Rows with no `latest` match and the task's `deadline_at + grace_period_hours` already passed are
`Missing` (finalized as a real event by the sync job); rows with no match and the deadline still
ahead are `Pending` (computed at query time only, same as the previous pass).
