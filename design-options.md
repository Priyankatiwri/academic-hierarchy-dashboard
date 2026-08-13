# Design Options

Every point in the requirement that admits more than one reasonable build, with a recommended
default. Items 2 and 5 change table shapes and are worth confirming explicitly; §3 (group
identity) is now effectively settled by the latest requirement pass; the rest are safe to build
with the recommended default and revisit later.

## 1. Drive ingestion approach

Confirmed structure (per the latest pass): a Task's Drive folder contains one subfolder per
group (`group_a/`, `group_b/`, ...), each holding that group's files. Scanning is two levels:
list subfolders (= groups), then list files inside each.

**A. Direct Drive API connector (recommended)** — service account scans each Task's folder
automatically, same mechanism as the earlier `web-app`, extended to the two-level walk above.

**B. Local-folder import** — the Prof keeps downloading into local nested folders (same
task-folder → group-subfolder shape), and a script/watcher scans those instead of calling the
Drive API. Useful if Drive API access can't be granted.

**C. Hybrid** — A is primary; B exists as a manual "import/backfill" tool for gaps.

*Recommendation:* **A**, with **C**'s backfill tool kept cheap to add later — it's the same
two-level walk, just fed from `fs.readdir` instead of the Drive API.

## 2. ⚠️ Deadline label semantics — Before / On time / After

Still open — this requirement pass fixed *when* the deadline is captured (exact date+time, see
§7) but not what separates "before" from "on time."

**A. Configurable on-time window (recommended)** — each Task has `deadline_at` and an
`on_time_window_hours` (default 24). `Before` = submitted earlier than
`deadline_at − window`; `On time` = submitted within the window, up to `deadline_at`; `After` =
submitted past `deadline_at` (+ optional grace before finalizing as Missing).

**B. Two-state, cosmetic split** — really just On-time vs Late; "Before" is a UI-only label for
anything more than, say, 48h early, computed client-side from the same timestamp.

**C. Calendar-day based** — Before = any day strictly before the due date; On time = same
calendar day; After = any day following. Stops making sense once deadlines carry exact times
(which they now do, per §7) — a submission at 11pm on the due date and one at 12:01am the next
day would land in different calendar days despite being minutes apart.

*Recommendation:* **A** — the exact-time deadline this pass adds makes A more natural than
before (it can use minutes/hours precision, not just calendar days), and C is now actively a
worse fit than when deadlines were date-only. **Still the one most worth confirming.**

## 3. ⚠️ Where does group identity come from?

**Settled by this pass:** groups are Drive subfolders inside a Task's submission folder
(`group_a/`, `group_b/`, ...) — that *is* the group identity, discovered automatically. The
remaining question is only about optional enrichment on top of that:

**A. Auto-registered, optionally enriched (recommended)** — the sync engine `INSERT OR IGNORE`s
a `groups` row (scoped to the subject, so "group_a" means the same thing across every Task in
that subject) the first time it sees a new subfolder name. No pre-registration blocks
ingestion. The Prof can later attach real member names to a group for nicer display in the
dashboard/report, but the pipeline works with just the raw subfolder name from day one.

**B. Pre-registered roster required** — Prof must define groups and members before submissions
can be matched. Rejected by this pass's requirement — it explicitly describes reading groups
*from* the Drive structure, not validating against a pre-existing list.

*Recommendation:* **A** — already reflected in [schema.md](schema.md). Worth a light
confirmation only on whether member-name enrichment is wanted at all, since it's pure addition
and doesn't block anything if skipped entirely.

## 4. Email & Drive link distribution

**A. Fully manual (recommended for v1)** — Prof composes the email and pastes the problem
statement outside the system; the Task creation form's "Drive submission link" field is the
same link they then paste into that email. One link, two places it's used — no duplication of
effort.

**B. System-generated** — the dashboard creates the Drive folder via the API (needs *write*
access) and sends the email via the Gmail API. Bigger scope (write access to Drive,
email-sending credentials, template management).

*Recommendation:* **A** now; **B** is a reasonable phase-2, structurally independent of
everything else here.

## 5. ⚠️ Screenshot evidence handling

**A. Uploaded through the dashboard (recommended)** — Prof uploads the screenshot via the admin
UI; stored on disk with a DB row linking it to a Task (and optionally a specific group).
Centralized, shows up directly in the audit report.

**B. Stays in Prof's local folders** — system only stores a free-text path/note. Zero upload UI
to build, but not centralized.

**C. System auto-captures evidence** — the sync engine snapshots the Task folder's listing
(e.g. renders it to PDF/image at scan time) instead of relying on a manual screenshot. Removes
the manual step, more engineering.

*Recommendation:* **A** — matches "needs the records for auditing" better than B, far less work
than C. Still worth confirming since B is the path of least change to the Prof's current habit.

## 6. Nested placement — logical or physical?

The requirement's "placing the submissions with the discussed categories/label in the
appropriate nested place" is satisfied primarily by the **automatic logical nesting** this pass
adds to the pipeline: every submission event is placed into
Batch → Semester → Subject → Task → Group as it's ingested, and the dashboard renders it further
sectioned by label (Before/On time/After/Missing) — see the "Placer" step in
[architecture.md](architecture.md)'s diagram and flow 2 in
[sequence-flows.md](sequence-flows.md). This replaces the Prof's manual folder-nesting effort
without requiring any physical file copying.

**A. Logical only (recommended)** — DB is the nested structure; Drive links are the file
reference. Nothing physically copied.

**C. On-demand physical export** — an "export to local folders" action regenerates the nested
batch/subject/task/group/label folder structure on disk from the DB, for archival, using the
file IDs already in the log. Cheap to add later since it's just a batch download.

*Recommendation:* **A**, with **C** available as a later add-on if offline/local archives turn
out to be needed independent of Drive itself.

## 7. Deadline/time picker UI

**A. Native `<input type="datetime-local">` (recommended for MVP)** — zero dependency, browser-
native calendar + time widget, works on every modern browser and mobile. Satisfies "prefer a
time/date picker tool" without adding a library.

**B. JS date-time picker library** (e.g. flatpickr) — nicer visual consistency across browsers,
easier timezone-aware display, more work to wire up.

*Recommendation:* **A** for MVP; revisit only if the native widget's inconsistent styling
across browsers becomes an actual complaint. Store `deadline_at` as ISO 8601 UTC regardless of
which picker renders it, so label computation isn't sensitive to the Prof's browser timezone.

## Summary table

| # | Decision | Status |
|---|---|---|
| 1 | Drive ingestion (two-level: task folder → group subfolder) | Confirmed this pass |
| 2 | Before/On time/After semantics | **Still open — confirm** |
| 3 | Group identity source | Settled: Drive subfolder, auto-registered |
| 4 | Email/Drive distribution | Manual (safe default) |
| 5 | Screenshot evidence | **Still open — confirm** |
| 6 | Nested placement | Logical (DB), physical export deferred |
| 7 | Deadline picker | Native datetime-local (safe default) |
