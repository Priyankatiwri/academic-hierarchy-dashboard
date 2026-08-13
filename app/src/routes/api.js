const express = require('express');
const { db } = require('../db');
const { runSync } = require('../sync');

const router = express.Router();

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

  const cells = result.rows.map(r => ({
    group_id: r.group_id,
    group_name: r.group_name,
    status: r.status || (r.missing_status ? 'Missing' : 'Pending'),
    file_name: r.file_name,
    web_view_link: r.web_view_link,
    submitted_at: r.submitted_at
  }));

  const evidence = await db.execute({
    sql: 'SELECT e.*, g.name AS group_name FROM evidence_notes e LEFT JOIN student_groups g ON g.id = e.group_id WHERE e.task_id = ? ORDER BY e.created_at DESC',
    args: [taskId]
  });

  res.json({ task: task.rows[0], cells, evidence: evidence.rows });
}));

// ---- Evidence notes (Prof's screenshots stay in their own local folders — this is just a pointer/note) ----

router.post('/tasks/:id/evidence', asyncHandler(async (req, res) => {
  const { group_id, note } = req.body;
  if (!note || !note.trim()) return res.status(400).json({ error: 'note is required' });
  await db.execute({
    sql: 'INSERT INTO evidence_notes (task_id, group_id, note, created_at) VALUES (?, ?, ?, ?)',
    args: [req.params.id, group_id || null, note.trim(), new Date().toISOString()]
  });
  res.status(201).json({ ok: true });
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
