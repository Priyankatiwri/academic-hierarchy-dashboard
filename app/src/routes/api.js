const express = require('express');
const multer = require('multer');
const { db } = require('../db');
const { runSync, computeStatus } = require('../sync');

const router = express.Router();

const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB — generous for a screenshot, guards against runaway storage growth
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are accepted for evidence screenshots.'));
  }
}).single('screenshot');

/** multer errors land in Express's error-handling path by default — route them through our own JSON error shape instead. */
function handleEvidenceUpload(req, res, next) {
  evidenceUpload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

function asyncHandler(fn) {
  return (req, res) => fn(req, res).catch(err => {
    console.error(err);
    res.status(500).json({ error: err.message });
  });
}

function extractFolderId(link) {
  const folderMatch = String(link).match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];
  const looseMatch = String(link).match(/[-\w]{20,}/);
  if (looseMatch) return looseMatch[0];
  throw new Error('Could not find a Drive folder ID in that link — expected something like https://drive.google.com/drive/folders/<id>');
}

// ---- Google connection status ----

router.get('/auth/status', asyncHandler(async (req, res) => {
  const result = await db.execute('SELECT google_email, connected_at FROM oauth_tokens ORDER BY id DESC LIMIT 1');
  res.json({ connected: result.rows.length > 0, account: result.rows[0] || null });
}));

// ---- Hierarchy: batches -> semesters -> subjects -> tasks ----

router.get('/batches', asyncHandler(async (req, res) => {
  const result = await db.execute('SELECT * FROM batches ORDER BY name');
  res.json({ batches: result.rows });
}));

router.post('/batches', asyncHandler(async (req, res) => {
  const { name, start_year, end_year } = req.body;
  if (!name || !start_year || !end_year) {
    return res.status(400).json({ error: 'name, start_year, end_year are required' });
  }
  const inserted = await db.execute({
    sql: 'INSERT INTO batches (name, start_year, end_year) VALUES (?, ?, ?)',
    args: [name, start_year, end_year]
  });
  const batchId = Number(inserted.lastInsertRowid);
  for (let n = 1; n <= 4; n++) {
    await db.execute({ sql: 'INSERT INTO semesters (batch_id, number) VALUES (?, ?)', args: [batchId, n] });
  }
  res.status(201).json({ id: batchId, name, start_year, end_year });
}));

router.get('/batches/:id/semesters', asyncHandler(async (req, res) => {
  const result = await db.execute({ sql: 'SELECT * FROM semesters WHERE batch_id = ? ORDER BY number', args: [req.params.id] });
  res.json({ semesters: result.rows });
}));

router.get('/semesters/:id/subjects', asyncHandler(async (req, res) => {
  const result = await db.execute({ sql: 'SELECT * FROM subjects WHERE semester_id = ? ORDER BY name', args: [req.params.id] });
  res.json({ subjects: result.rows });
}));

router.get('/subjects/:id/tasks', asyncHandler(async (req, res) => {
  const result = await db.execute({ sql: 'SELECT * FROM tasks WHERE subject_id = ? ORDER BY deadline_at', args: [req.params.id] });
  res.json({ tasks: result.rows });
}));

router.get('/tasks/:id', asyncHandler(async (req, res) => {
  const result = await db.execute({
    sql: `SELECT t.*, s.name AS subject_name, sem.number AS semester_number, b.name AS batch_name
          FROM tasks t
          JOIN subjects s ON s.id = t.subject_id
          JOIN semesters sem ON sem.id = s.semester_id
          JOIN batches b ON b.id = sem.batch_id
          WHERE t.id = ?`,
    args: [req.params.id]
  });
  if (result.rows.length === 0) return res.status(404).json({ error: 'Task not found' });
  res.json(result.rows[0]);
}));

router.post('/tasks', asyncHandler(async (req, res) => {
  const { semester_id, subject_name, name, drive_submission_link, deadline_at, on_time_window_hours, grace_period_hours } = req.body;
  if (!semester_id || !subject_name || !name || !drive_submission_link || !deadline_at) {
    return res.status(400).json({ error: 'semester_id, subject_name, name, drive_submission_link, deadline_at are required' });
  }

  let subjectId;
  const existingSubject = await db.execute({
    sql: 'SELECT id FROM subjects WHERE semester_id = ? AND name = ?',
    args: [semester_id, subject_name]
  });
  if (existingSubject.rows.length > 0) {
    subjectId = existingSubject.rows[0].id;
  } else {
    const inserted = await db.execute({
      sql: 'INSERT INTO subjects (semester_id, name) VALUES (?, ?)',
      args: [semester_id, subject_name]
    });
    subjectId = Number(inserted.lastInsertRowid);
  }

  const driveFolderId = extractFolderId(drive_submission_link);

  const inserted = await db.execute({
    sql: `INSERT INTO tasks (subject_id, name, drive_submission_link, drive_folder_id, deadline_at, on_time_window_hours, grace_period_hours)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [subjectId, name, drive_submission_link, driveFolderId, deadline_at, on_time_window_hours || 24, grace_period_hours || 24]
  });

  res.status(201).json({ id: Number(inserted.lastInsertRowid), subject_id: subjectId });
}));

router.patch('/tasks/:id/deadline', asyncHandler(async (req, res) => {
  const { deadline_at } = req.body;
  if (!deadline_at) return res.status(400).json({ error: 'deadline_at is required' });

  const existing = await db.execute({ sql: 'SELECT id FROM tasks WHERE id = ?', args: [req.params.id] });
  if (existing.rows.length === 0) return res.status(404).json({ error: 'Task not found' });

  // Resetting access_revoked_at re-arms the Missing/revocation logic against the new deadline —
  // it does NOT retroactively undo an already-finalized Missing marker (the audit log is
  // append-only), and does NOT automatically restore any Drive access already revoked; Google
  // doesn't let you recreate a deleted permission's old ID, so re-sharing the folder with
  // affected students is a manual step if that already happened.
  await db.execute({
    sql: 'UPDATE tasks SET deadline_at = ?, access_revoked_at = NULL, access_revoke_error = NULL WHERE id = ?',
    args: [deadline_at, req.params.id]
  });

  // Re-evaluate every real submission's On time/After label against the new deadline.
  // submitted_at and first_observed_at are untouched — the fact of when something was
  // submitted never changes — but status is a *derived* field (a function of submitted_at and
  // deadline_at), so when the deadline itself moves, the label needs to move with it. This is
  // exactly the point of extending a deadline: a submission that was late against the old date
  // should read as on time against the new one. Existing Missing markers aren't touched here —
  // if that group later submits, the "current status" view already prefers the real submission
  // over the marker, so no separate handling is needed for that case.
  const events = await db.execute({
    sql: 'SELECT id, submitted_at, status FROM submission_events WHERE task_id = ? AND drive_file_id IS NOT NULL',
    args: [req.params.id]
  });
  let remapped = 0;
  for (const ev of events.rows) {
    const newStatus = computeStatus(ev.submitted_at, deadline_at);
    if (newStatus !== ev.status) {
      await db.execute({ sql: 'UPDATE submission_events SET status = ? WHERE id = ?', args: [newStatus, ev.id] });
      remapped += 1;
    }
  }

  res.json({ ok: true, remapped });
}));

// ---- Submissions for a task, sectioned by label ----

router.get('/tasks/:id/submissions', asyncHandler(async (req, res) => {
  const taskId = req.params.id;
  const task = await db.execute({ sql: 'SELECT * FROM tasks WHERE id = ?', args: [taskId] });
  if (task.rows.length === 0) return res.status(404).json({ error: 'Task not found' });

  const result = await db.execute({
    sql: `
      SELECT g.id AS group_id, g.name AS group_name,
             latest.status, latest.file_name, latest.web_view_link, latest.submitted_at,
             missing.status AS missing_status
      FROM student_groups g
      LEFT JOIN (
        SELECT * FROM submission_events
        WHERE task_id = ? AND drive_file_id IS NOT NULL
          AND id IN (SELECT MAX(id) FROM submission_events WHERE task_id = ? AND drive_file_id IS NOT NULL GROUP BY group_id)
      ) latest ON latest.group_id = g.id
      LEFT JOIN (
        SELECT * FROM submission_events WHERE task_id = ? AND drive_file_id IS NULL
      ) missing ON missing.group_id = g.id
      WHERE g.subject_id = ?
      ORDER BY g.name
    `,
    args: [taskId, taskId, taskId, task.rows[0].subject_id]
  });

  // 'Before' only exists in older historical rows (pre-simplification) — fold it into 'On time'
  // for display. A group with neither a submission nor a finalized Missing marker yet (still
  // waiting, deadline not passed) has nothing to report — leave it out entirely rather than
  // labeling it, since there's no "Pending" status anymore.
  const cells = result.rows
    .map(r => ({
      group_id: r.group_id,
      group_name: r.group_name,
      status: r.status === 'Before' ? 'On time' : r.status || (r.missing_status ? 'Missing' : null),
      file_name: r.file_name,
      web_view_link: r.web_view_link,
      submitted_at: r.submitted_at
    }))
    .filter(c => c.status !== null);

  const evidence = await db.execute({
    sql: `SELECT e.id, e.task_id, e.group_id, e.note, e.created_at, e.screenshot_content_type,
                 CASE WHEN e.screenshot IS NOT NULL THEN 1 ELSE 0 END AS has_screenshot,
                 g.name AS group_name
          FROM evidence_notes e
          LEFT JOIN student_groups g ON g.id = e.group_id
          WHERE e.task_id = ?
          ORDER BY e.created_at DESC`,
    args: [taskId]
  });

  res.json({ task: task.rows[0], cells, evidence: evidence.rows });
}));

// ---- Evidence: a note and/or a screenshot (e.g. of the assignment email), stored as a BLOB ----

router.post('/tasks/:id/evidence', handleEvidenceUpload, asyncHandler(async (req, res) => {
  const { group_id, note } = req.body;
  const file = req.file;
  const noteText = (note || '').trim() || (file ? '(screenshot evidence)' : '');
  if (!noteText) return res.status(400).json({ error: 'Provide a note, a screenshot, or both.' });

  await db.execute({
    sql: `INSERT INTO evidence_notes (task_id, group_id, note, created_at, screenshot, screenshot_content_type, screenshot_size_bytes)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      req.params.id,
      group_id || null,
      noteText,
      new Date().toISOString(),
      file ? file.buffer : null,
      file ? file.mimetype : null,
      file ? file.size : null
    ]
  });
  res.status(201).json({ ok: true });
}));

router.get('/evidence/:id/screenshot', asyncHandler(async (req, res) => {
  const result = await db.execute({
    sql: 'SELECT screenshot, screenshot_content_type FROM evidence_notes WHERE id = ?',
    args: [req.params.id]
  });
  const row = result.rows[0];
  if (!row || !row.screenshot) return res.status(404).json({ error: 'No screenshot for this evidence note.' });
  res.setHeader('Content-Type', row.screenshot_content_type || 'application/octet-stream');
  res.send(Buffer.from(row.screenshot));
}));

// ---- Sync ----

router.get('/meta', asyncHandler(async (req, res) => {
  const result = await db.execute('SELECT * FROM sync_log ORDER BY id DESC LIMIT 1');
  res.json({ lastSync: result.rows[0] || null });
}));

router.post('/sync', asyncHandler(async (req, res) => {
  const result = await runSync();
  res.json({ ok: true, ...result });
}));

// ---- Audit report: every submission that crossed its deadline (After/Missing) ----

router.get('/reports/audit.csv', asyncHandler(async (req, res) => {
  const { batch_id, semester_id, from, to } = req.query;
  const clauses = [`e.status IN ('After', 'Missing')`];
  const args = [];
  if (batch_id) { clauses.push('b.id = ?'); args.push(batch_id); }
  if (semester_id) { clauses.push('sem.id = ?'); args.push(semester_id); }
  if (from) { clauses.push('e.first_observed_at >= ?'); args.push(from); }
  if (to) { clauses.push('e.first_observed_at <= ?'); args.push(to); }

  const result = await db.execute({
    sql: `
      SELECT e.first_observed_at, e.status, b.name AS batch_name, sem.number AS semester_number,
             s.name AS subject_name, t.name AS task_name, g.name AS group_name,
             t.deadline_at, e.submitted_at, e.file_name, e.web_view_link
      FROM submission_events e
      JOIN tasks t ON t.id = e.task_id
      JOIN student_groups g ON g.id = e.group_id
      JOIN subjects s ON s.id = t.subject_id
      JOIN semesters sem ON sem.id = s.semester_id
      JOIN batches b ON b.id = sem.batch_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY e.first_observed_at DESC
    `,
    args
  });

  const header = ['First Observed', 'Status', 'Batch', 'Semester', 'Subject', 'Task', 'Group', 'Deadline', 'Submitted At', 'File Name', 'File Link'];
  const csvEscape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(',')];
  result.rows.forEach(r => {
    lines.push([
      r.first_observed_at, r.status, r.batch_name, r.semester_number, r.subject_name, r.task_name,
      r.group_name, r.deadline_at, r.submitted_at, r.file_name, r.web_view_link
    ].map(csvEscape).join(','));
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="audit-report.csv"');
  res.send(lines.join('\n'));
}));

module.exports = router;
