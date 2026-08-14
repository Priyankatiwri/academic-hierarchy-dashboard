const { db } = require('./db');
const { getAuthorizedClient } = require('./googleAuth');
const { buildDriveClient, listFilesInFolder, revokeNonOwnerPermissions } = require('./driveConnector');

function computeStatus(submittedAt, deadlineAt) {
  const deadline = new Date(deadlineAt);
  const submitted = new Date(submittedAt);
  return submitted > deadline ? 'After' : 'On time';
}

/**
 * Groups aren't subfolders — a submission is a file dropped directly into the task's Drive
 * folder, named after its group (e.g. "group_1.pdf", "Group 1 - final.docx"). Normalize the
 * common "group <number>" pattern so filename inconsistencies collapse to the same group
 * instead of quietly minting a new one per typo; anything that doesn't match falls back to
 * the plain filename (without extension) so non-numbered group names still work.
 */
function parseGroupName(fileName) {
  const withoutExt = fileName.replace(/\.[^/.]+$/, '');
  const match = withoutExt.match(/group[\s_-]*(\d+)/i);
  if (match) return `group_${match[1]}`;
  return withoutExt.trim();
}

async function getDrive() {
  const tokenResult = await db.execute('SELECT * FROM oauth_tokens ORDER BY id DESC LIMIT 1');
  if (tokenResult.rows.length === 0) {
    throw new Error('No Google account connected yet — click "Connect Google Drive" on the dashboard first.');
  }
  const authClient = await getAuthorizedClient(tokenResult.rows[0].refresh_token);
  return { drive: buildDriveClient(authClient), connectedEmail: tokenResult.rows[0].google_email };
}

async function getOrCreateGroup(subjectId, name) {
  const existing = await db.execute({
    sql: 'SELECT id FROM student_groups WHERE subject_id = ? AND name = ?',
    args: [subjectId, name]
  });
  if (existing.rows.length > 0) return { id: existing.rows[0].id, isNew: false };
  const inserted = await db.execute({
    sql: 'INSERT INTO student_groups (subject_id, name) VALUES (?, ?)',
    args: [subjectId, name]
  });
  return { id: Number(inserted.lastInsertRowid), isNew: true };
}

async function syncTask(drive, task, connectedEmail) {
  let filesScanned = 0;
  let eventsCreated = 0;
  let eventsRenamed = 0;
  let groupsDiscovered = 0;
  const nowIso = new Date().toISOString();

  const files = await listFilesInFolder(drive, task.drive_folder_id);
  filesScanned += files.length;

  for (const file of files) {
    const groupName = parseGroupName(file.name);
    const { id: groupId, isNew } = await getOrCreateGroup(task.subject_id, groupName);
    if (isNew) groupsDiscovered += 1;

    const status = computeStatus(file.createdTime, task.deadline_at);
    const existing = await db.execute({
      sql: 'SELECT file_name FROM submission_events WHERE event_key = ?',
      args: [file.id]
    });

    if (existing.rows.length === 0) {
      await db.execute({
        sql: `INSERT INTO submission_events
                (event_key, task_id, group_id, drive_file_id, file_name, submitted_at, status, web_view_link, first_observed_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [file.id, task.id, groupId, file.id, file.name, file.createdTime, status, file.webViewLink || null, nowIso]
      });
      eventsCreated += 1;
    } else if (existing.rows[0].file_name !== file.name) {
      // Same Drive file, renamed since we first saw it (e.g. corrected to match group naming).
      // Refresh the identifying metadata, but first_observed_at/submitted_at/status stay as the
      // original audit facts — a rename doesn't change when or how on-time the submission was.
      await db.execute({
        sql: 'UPDATE submission_events SET group_id = ?, file_name = ?, web_view_link = ? WHERE event_key = ?',
        args: [groupId, file.name, file.webViewLink || null, file.id]
      });
      eventsRenamed += 1;
    }
  }

  // Finalize "Missing" once deadline + grace period has fully passed, for every known
  // group in the subject (not just ones seen this scan) that never submitted to this task.
  const deadline = new Date(task.deadline_at);
  const graceDeadline = new Date(deadline.getTime() + task.grace_period_hours * 3600 * 1000);
  if (new Date() > graceDeadline) {
    const allGroups = await db.execute({
      sql: 'SELECT id FROM student_groups WHERE subject_id = ?',
      args: [task.subject_id]
    });
    for (const group of allGroups.rows) {
      const has = await db.execute({
        sql: 'SELECT 1 FROM submission_events WHERE task_id = ? AND group_id = ? AND drive_file_id IS NOT NULL LIMIT 1',
        args: [task.id, group.id]
      });
      if (has.rows.length > 0) continue;
      const result = await db.execute({
        sql: `INSERT OR IGNORE INTO submission_events
                (event_key, task_id, group_id, drive_file_id, file_name, submitted_at, status, web_view_link, first_observed_at)
              VALUES (?, ?, ?, NULL, NULL, NULL, 'Missing', NULL, ?)`,
        args: [`missing-${task.id}-${group.id}`, task.id, group.id, nowIso]
      });
      if (result.rowsAffected > 0) eventsCreated += 1;
    }

    // Revoke Drive access once, the same run that finalizes Missing — never retried once it
    // succeeds (access_revoked_at is set), retried automatically on the next sync if it failed
    // (e.g. scope not yet upgraded), and never allowed to abort the rest of this task's sync.
    if (!task.access_revoked_at) {
      try {
        const revoked = await revokeNonOwnerPermissions(drive, task.drive_folder_id, connectedEmail);
        const revokedAt = new Date().toISOString();
        for (const r of revoked) {
          if (!r.ok) continue;
          await db.execute({
            sql: 'INSERT INTO access_revocations (task_id, permission_id, permission_type, email_address, revoked_at) VALUES (?, ?, ?, ?, ?)',
            args: [task.id, r.id, r.type, r.emailAddress, revokedAt]
          });
        }
        await db.execute({
          sql: 'UPDATE tasks SET access_revoked_at = ?, access_revoke_error = NULL WHERE id = ?',
          args: [revokedAt, task.id]
        });
      } catch (err) {
        await db.execute({
          sql: 'UPDATE tasks SET access_revoke_error = ? WHERE id = ?',
          args: [String(err.message || err), task.id]
        });
      }
    }
  }

  return { filesScanned, eventsCreated, eventsRenamed, groupsDiscovered };
}

async function runSync() {
  const startedAt = new Date().toISOString();
  const logInsert = await db.execute({
    sql: 'INSERT INTO sync_log (started_at, tasks_scanned, groups_discovered, events_created) VALUES (?, 0, 0, 0)',
    args: [startedAt]
  });
  const logId = logInsert.lastInsertRowid;

  try {
    const tasksResult = await db.execute('SELECT * FROM tasks');
    const tasks = tasksResult.rows;

    if (tasks.length === 0) {
      await db.execute({
        sql: 'UPDATE sync_log SET finished_at = ?, tasks_scanned = 0 WHERE id = ?',
        args: [new Date().toISOString(), logId]
      });
      return { tasksScanned: 0, filesScanned: 0, eventsCreated: 0, eventsRenamed: 0, groupsDiscovered: 0 };
    }

    const { drive, connectedEmail } = await getDrive();
    const totals = { filesScanned: 0, eventsCreated: 0, eventsRenamed: 0, groupsDiscovered: 0 };
    for (const task of tasks) {
      const r = await syncTask(drive, task, connectedEmail);
      totals.filesScanned += r.filesScanned;
      totals.eventsCreated += r.eventsCreated;
      totals.eventsRenamed += r.eventsRenamed;
      totals.groupsDiscovered += r.groupsDiscovered;
    }

    await db.execute({
      sql: 'UPDATE sync_log SET finished_at = ?, tasks_scanned = ?, groups_discovered = ?, events_created = ? WHERE id = ?',
      args: [new Date().toISOString(), tasks.length, totals.groupsDiscovered, totals.eventsCreated, logId]
    });

    return { tasksScanned: tasks.length, ...totals };
  } catch (err) {
    const message = friendlyError(err);
    await db.execute({
      sql: 'UPDATE sync_log SET finished_at = ?, error = ? WHERE id = ?',
      args: [new Date().toISOString(), message, logId]
    });
    throw new Error(message);
  }
}

/** Google's raw "Insufficient Permission" gives no hint where to look — point at the actual fix. */
function friendlyError(err) {
  const status = err.code || err.response?.status;
  const message = String(err.message || err);
  if (status === 403 && /insufficient/i.test(message)) {
    return (
      "Insufficient permission — the connected Google account's token doesn't include Drive access " +
      "(usually means it was granted before drive.readonly was saved under Data Access). Revoke access at " +
      'https://myaccount.google.com/permissions, confirm the scope is saved in Google Cloud Console, then ' +
      'click "Connect Google Drive" again.'
    );
  }
  return message;
}

module.exports = { runSync, computeStatus };
