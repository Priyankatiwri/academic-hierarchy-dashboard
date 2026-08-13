# Academic Hierarchy Dashboard

Covers the batch → semester → subject → task → group hierarchy, Drive-based submission
collection, deadline cross-tracking (before/on time/after), manual screenshot evidence, and a
cascading-dropdown dashboard for audit.

**Status: built.** The design package (below) is finalized; the implementation is in
**[app/](app/README.md)** — built, installed, and smoke-tested end to end (see
[app/README.md "What's been verified"](app/README.md#whats-been-verified-this-session-without-real-drive-credentials)).

## Design package

1. **[architecture.md](architecture.md)** — component breakdown, the Task creation form spec,
   and the architecture diagram.
2. **[sequence-flows.md](sequence-flows.md)** — 4 sequence diagrams: task creation &
   distribution, submission capture, dashboard browsing, audit report export.
3. **[design-options.md](design-options.md)** — every point where the requirement admitted more
   than one build, with a recommended default and which options were ultimately chosen.
4. **[schema.md](schema.md)** — proposed DB schema (the `app/` implementation departs slightly —
   e.g. `groups` → `student_groups`, `components` → `tasks` — see `app/src/db.js` for the
   as-built version).

## Decisions made

- **Before/On-time/After boundary**: configurable per-task `on_time_window_hours` (default
  24h) — [design-options.md §2](design-options.md#2-️-deadline-label-semantics--before--on-time--after).
- **Screenshot evidence**: stays in the Prof's own local folders; the dashboard stores a
  free-text note, not an uploaded file — [design-options.md §5](design-options.md#5-️-screenshot-evidence-handling).
- **Google auth**: OAuth "Sign in with Google," not a service account — the Prof already owns
  the folders their students submit into, so signing in grants exactly the access needed with
  no per-folder sharing step. This is a departure from [architecture.md](architecture.md)'s
  original service-account assumption (and from the earlier [../web-app](../web-app/README.md)
  build) — see [app/credentials/README.md](app/credentials/README.md) for the reasoning and setup.
- **Database**: `@libsql/client` instead of `better-sqlite3` — SQLite-compatible locally (a
  plain file, zero setup), swappable to a free [Turso](https://turso.tech) database for hosting
  with no code changes. Chosen specifically so this deploys on genuinely free hosting — see
  [app/README.md "Deploying for free"](app/README.md#deploying-for-free).

## What this pass settled (vs. the previous discussion round)

- **"Task" is the concrete unit the Prof creates**: Subject name, Task name, Drive submission
  link, and an exact date+time deadline via a native date/time picker.
- **Group identity comes from Drive itself** — each Task's submission folder contains one
  subfolder per group (`group_a/`, `group_b/`, ...); the sync engine auto-registers a group the
  first time it sees a new subfolder name.
- **"Placing submissions in the appropriate nested place"** is an explicit pipeline step —
  every submission is automatically nested into Batch/Semester/Subject/Task/Group and labeled.
