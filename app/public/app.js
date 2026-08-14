const STATUS_COLORS = {
  'On time': 'var(--status-good)',
  'After': 'var(--status-warning)',
  'Missing': 'var(--status-critical)'
};
// Only these two get an itemized section + legend entry — Missing is folded into the
// "Submitted X/Y" aggregate tile instead of a per-group callout list (see renderAggregateTile).
const STATUS_ORDER = ['On time', 'After'];

const ICONS = {
  'On time': '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.25"/><path d="M5.3 8.3l1.9 1.9 3.6-3.9"/></svg>',
  'After': '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.6 14 13H2L8 2.6Z"/><path d="M8 6.4V9.4"/><circle cx="8" cy="11.3" r="0.6" fill="currentColor" stroke="none"/></svg>',
  'Missing': '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.25"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"/></svg>'
};

const ACCOUNT_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="5.5" r="2.3"/><path d="M3 13c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5"/></svg>';
const INBOX_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13V6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v7"/><path d="M4 13h4.5l1 2h5l1-2H20"/><path d="M4 13v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/></svg>';
const GROUPS_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="6" r="2"/><circle cx="11" cy="6.5" r="1.6"/><path d="M2 13c0-2.2 1.6-3.5 3.5-3.5S9 10.8 9 13"/><path d="M9.5 9.8c1.6.1 2.8 1.3 2.8 3.2"/></svg>';
const TOAST_ICONS = {
  success: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.25"/><path d="M5.3 8.3l1.9 1.9 3.6-3.9"/></svg>',
  error: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.25"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"/></svg>',
  close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>'
};

function statusSlug(status) {
  return 'status-' + status.toLowerCase().replace(/\s+/g, '-');
}

function iconChip(status) {
  return `<span class="icon-chip ${statusSlug(status)}">${ICONS[status]}</span>`;
}

let state = { batchId: null, semesterId: null, subjectId: null, taskId: null };

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---- Toasts ----

function showToast(message, type = 'success') {
  const stack = document.getElementById('toast-stack');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="icon">${TOAST_ICONS[type]}</span>
    <span>${escapeHtml(message)}</span>
    <button class="toast-close" type="button" aria-label="Dismiss"><span class="icon">${TOAST_ICONS.close}</span></button>
  `;
  const remove = () => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 200);
  };
  toast.querySelector('.toast-close').addEventListener('click', remove);
  stack.appendChild(toast);
  setTimeout(remove, 5000);
}

// ---- Date/time picker with an explicit OK confirm step ----

function wireDateTimeConfirm(inputId, okBtnId) {
  const input = document.getElementById(inputId);
  const okBtn = document.getElementById(okBtnId);
  okBtn.addEventListener('click', () => {
    if (!input.value) return;
    input.classList.add('confirmed');
    okBtn.classList.add('confirmed');
  });
  input.addEventListener('input', () => {
    input.classList.remove('confirmed');
    okBtn.classList.remove('confirmed');
  });
}

function resetDateTimeConfirm(inputId, okBtnId) {
  document.getElementById(inputId).classList.remove('confirmed');
  document.getElementById(okBtnId).classList.remove('confirmed');
}

wireDateTimeConfirm('nt-deadline', 'nt-deadline-ok');
wireDateTimeConfirm('ed-deadline', 'ed-deadline-ok');

// ---- Google connection status ----

async function loadGoogleStatus() {
  const el = document.getElementById('google-status');
  try {
    const { connected, account } = await api('/api/auth/status');
    if (connected) {
      el.className = 'google-status connected';
      el.innerHTML = `<span class="icon">${ACCOUNT_ICON}</span>Connected as ${escapeHtml(account.google_email)} — <a href="/auth/google">Reconnect</a>`;
    } else {
      el.className = 'google-status disconnected';
      el.innerHTML = `<span class="icon">${ACCOUNT_ICON}</span>Not connected — <a href="/auth/google">Connect Google Drive</a>`;
    }
  } catch (err) {
    el.textContent = 'Could not check Google connection status.';
  }
}

async function loadMeta() {
  const el = document.getElementById('last-sync');
  const { lastSync } = await api('/api/meta');
  if (lastSync && lastSync.finished_at) {
    el.textContent = `Last synced: ${new Date(lastSync.finished_at).toLocaleString()} (${lastSync.events_created ?? 0} new events)`;
  } else if (lastSync && lastSync.error) {
    el.textContent = `Last sync failed: ${lastSync.error}`;
  } else {
    el.textContent = 'Last synced: never';
  }
}

document.getElementById('sync-btn').addEventListener('click', async () => {
  const btn = document.getElementById('sync-btn');
  const label = document.getElementById('sync-label');
  btn.disabled = true;
  btn.classList.add('syncing');
  label.textContent = 'Syncing…';
  try {
    const result = await api('/api/sync', { method: 'POST' });
    await loadMeta();
    if (state.taskId) await loadSubmissions(state.taskId);
    showToast(`Sync complete — ${result.eventsCreated ?? 0} new event(s).`, 'success');
  } catch (err) {
    showToast('Sync failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.classList.remove('syncing');
    label.textContent = 'Sync now';
  }
});

// ---- Batches ----

async function loadBatches(selectId) {
  const { batches } = await api('/api/batches');
  const select = document.getElementById('batch-select');
  const reportSelect = document.getElementById('report-batch');
  select.innerHTML = '<option value="">Select batch…</option>' +
    batches.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
  reportSelect.innerHTML = '<option value="">All</option>' +
    batches.map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
  if (selectId) select.value = String(selectId);
}

document.getElementById('new-batch-toggle').addEventListener('click', () => {
  document.getElementById('new-batch-form').classList.toggle('open');
});

document.getElementById('nb-submit').addEventListener('click', async () => {
  const name = document.getElementById('nb-name').value.trim();
  const start_year = Number(document.getElementById('nb-start').value);
  const end_year = Number(document.getElementById('nb-end').value);
  const errorEl = document.getElementById('nb-error');
  errorEl.textContent = '';
  if (!name || !start_year || !end_year) {
    errorEl.textContent = 'Fill in name, start year, and end year.';
    return;
  }
  try {
    const batch = await api('/api/batches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, start_year, end_year })
    });
    document.getElementById('new-batch-form').classList.remove('open');
    document.getElementById('nb-name').value = '';
    document.getElementById('nb-start').value = '';
    document.getElementById('nb-end').value = '';
    await loadBatches(batch.id);
    onBatchChange();
    showToast(`Batch "${name}" created.`, 'success');
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

document.getElementById('batch-select').addEventListener('change', onBatchChange);

async function onBatchChange() {
  const batchId = document.getElementById('batch-select').value;
  state.batchId = batchId || null;
  state.semesterId = null; state.subjectId = null; state.taskId = null;
  hideDownstream('sem');
  if (!batchId) return;

  const { semesters } = await api(`/api/batches/${batchId}/semesters`);
  const tabs = document.getElementById('sem-tabs');
  tabs.innerHTML = semesters.map(s => `<button type="button" data-sem="${s.id}">Sem ${s.number}</button>`).join('');
  document.getElementById('sem-row').classList.remove('hidden');
  tabs.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => onSemesterChange(btn.dataset.sem, btn));
  });
}

async function onSemesterChange(semesterId, btnEl) {
  state.semesterId = semesterId;
  state.subjectId = null; state.taskId = null;
  document.querySelectorAll('#sem-tabs button').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  hideDownstream('subject');

  const { subjects } = await api(`/api/semesters/${semesterId}/subjects`);
  const select = document.getElementById('subject-select');
  select.innerHTML = '<option value="">Select subject…</option>' +
    subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  document.getElementById('existing-subjects').innerHTML =
    subjects.map(s => `<option value="${escapeHtml(s.name)}">`).join('');
  document.getElementById('subject-row').classList.remove('hidden');
}

document.getElementById('subject-select').addEventListener('change', onSubjectChange);

async function onSubjectChange() {
  const subjectId = document.getElementById('subject-select').value;
  state.subjectId = subjectId || null;
  state.taskId = null;
  const taskSelect = document.getElementById('task-select');
  taskSelect.innerHTML = '<option value="">Select task…</option>';
  document.getElementById('submissions-panel').classList.add('hidden');
  document.getElementById('evidence-panel').classList.add('hidden');
  if (!subjectId) return;

  const { tasks } = await api(`/api/subjects/${subjectId}/tasks`);
  taskSelect.innerHTML = '<option value="">Select task…</option>' +
    tasks.map(t => `<option value="${t.id}">${escapeHtml(t.name)} (due ${new Date(t.deadline_at).toLocaleString()})</option>`).join('');
}

document.getElementById('task-select').addEventListener('change', () => {
  const taskId = document.getElementById('task-select').value;
  state.taskId = taskId || null;
  document.getElementById('extend-deadline-form').classList.remove('open');
  if (taskId) {
    loadSubmissions(taskId);
    document.getElementById('submissions-panel').classList.remove('hidden');
    document.getElementById('evidence-panel').classList.remove('hidden');
  } else {
    document.getElementById('submissions-panel').classList.add('hidden');
    document.getElementById('evidence-panel').classList.add('hidden');
  }
});

function hideDownstream(from) {
  if (from === 'sem') {
    document.getElementById('sem-row').classList.add('hidden');
    document.getElementById('sem-tabs').innerHTML = '';
  }
  document.getElementById('subject-row').classList.add('hidden');
  document.getElementById('submissions-panel').classList.add('hidden');
  document.getElementById('evidence-panel').classList.add('hidden');
}

// ---- New task form ----

document.getElementById('new-task-toggle').addEventListener('click', () => {
  document.getElementById('new-task-form').classList.toggle('open');
});

document.getElementById('nt-submit').addEventListener('click', async () => {
  const errorEl = document.getElementById('nt-error');
  errorEl.textContent = '';
  const subject_name = document.getElementById('nt-subject').value.trim();
  const name = document.getElementById('nt-name').value.trim();
  const drive_submission_link = document.getElementById('nt-link').value.trim();
  const deadlineLocal = document.getElementById('nt-deadline').value;
  if (!state.semesterId) { errorEl.textContent = 'Select a semester first.'; return; }
  if (!subject_name || !name || !drive_submission_link || !deadlineLocal) {
    errorEl.textContent = 'Fill in all fields.';
    return;
  }
  try {
    const deadline_at = new Date(deadlineLocal).toISOString();
    await api('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ semester_id: state.semesterId, subject_name, name, drive_submission_link, deadline_at })
    });
    document.getElementById('new-task-form').classList.remove('open');
    document.getElementById('nt-subject').value = '';
    document.getElementById('nt-name').value = '';
    document.getElementById('nt-link').value = '';
    document.getElementById('nt-deadline').value = '';
    resetDateTimeConfirm('nt-deadline', 'nt-deadline-ok');
    await onSemesterChange(state.semesterId, document.querySelector('#sem-tabs button.active'));
    showToast(`Task "${name}" created.`, 'success');
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// ---- Extend deadline ----

document.getElementById('extend-deadline-toggle').addEventListener('click', () => {
  const form = document.getElementById('extend-deadline-form');
  form.classList.toggle('open');
});

document.getElementById('ed-cancel').addEventListener('click', () => {
  document.getElementById('extend-deadline-form').classList.remove('open');
  document.getElementById('ed-error').textContent = '';
});

document.getElementById('ed-submit').addEventListener('click', async () => {
  const errorEl = document.getElementById('ed-error');
  errorEl.textContent = '';
  const deadlineLocal = document.getElementById('ed-deadline').value;
  if (!deadlineLocal) { errorEl.textContent = 'Pick a new deadline.'; return; }
  if (!state.taskId) return;

  try {
    const deadline_at = new Date(deadlineLocal).toISOString();
    const result = await api(`/api/tasks/${state.taskId}/deadline`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deadline_at })
    });
    document.getElementById('extend-deadline-form').classList.remove('open');
    document.getElementById('ed-deadline').value = '';
    resetDateTimeConfirm('ed-deadline', 'ed-deadline-ok');
    await loadSubmissions(state.taskId);
    await onSubjectChange(); // refresh the task dropdown's "due ..." label too
    const remapNote = result.remapped ? ` (${result.remapped} submission${result.remapped === 1 ? '' : 's'} relabeled)` : '';
    showToast(`Deadline updated.${remapNote}`, 'success');
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

function renderLegend() {
  document.getElementById('legend').innerHTML = STATUS_ORDER.map(s => `
    <li><span class="icon" style="color:${STATUS_COLORS[s]}">${ICONS[s]}</span>${s}</li>
  `).join('');
}

// ---- Submissions (sectioned by label) ----

function renderAggregateTile(onTime, after) {
  const total = onTime + after;
  const onTimePct = total > 0 ? (onTime / total) * 100 : 0;
  const afterPct = total > 0 ? (after / total) * 100 : 0;
  return `
    <div class="stat-tile stat-tile-aggregate">
      <span class="stat-label"><span class="icon">${GROUPS_ICON}</span>Total Submissions</span>
      <span class="stat-value">${total}</span>
      <div class="stat-progress stat-progress-split">
        ${onTimePct > 0 ? `<div class="stat-progress-fill" style="width:${onTimePct}%; background:var(--status-good)"></div>` : ''}
        ${afterPct > 0 ? `<div class="stat-progress-fill" style="width:${afterPct}%; background:var(--status-warning)"></div>` : ''}
      </div>
    </div>
  `;
}

async function loadSubmissions(taskId) {
  const { task, cells, evidence } = await api(`/api/tasks/${taskId}/submissions`);
  renderEvidence(evidence);

  let metaText = `${task.name} — deadline ${new Date(task.deadline_at).toLocaleString()}`;
  if (task.access_revoked_at) {
    metaText += ` — Drive access revoked ${new Date(task.access_revoked_at).toLocaleString()}`;
  } else if (task.access_revoke_error) {
    metaText += ` — Drive access revocation failed: ${task.access_revoke_error}`;
  }
  document.getElementById('task-meta').textContent = metaText;

  const counts = { 'On time': 0, 'After': 0 };
  cells.forEach(c => { if (c.status in counts) counts[c.status] += 1; });

  document.getElementById('stat-row').innerHTML =
    STATUS_ORDER.map(s => `
      <div class="stat-tile" style="border-top-color:${STATUS_COLORS[s]}">
        <span class="stat-label"><span class="icon">${ICONS[s]}</span>${s}</span>
        <span class="stat-value">${counts[s]}</span>
      </div>
    `).join('') + renderAggregateTile(counts['On time'], counts['After']);

  // On time/After get itemized sections; Missing is represented only in the aggregate tile above.
  const bySection = {};
  STATUS_ORDER.forEach(s => { bySection[s] = []; });
  cells.forEach(c => { if (c.status in bySection) bySection[c.status].push(c); });

  const sectionsEl = document.getElementById('sections');
  if (cells.length === 0) {
    sectionsEl.innerHTML = `<div class="empty-state"><span class="icon">${INBOX_ICON}</span>Nothing to report yet for this task — run Sync, or check the Drive submission link.</div>`;
    return;
  }

  sectionsEl.innerHTML = STATUS_ORDER.map(status => {
    const groups = bySection[status];
    if (groups.length === 0) return '';
    const rows = groups.map(g => `
      <li class="group-row">
        <span class="name">${escapeHtml(g.group_name)}</span>
        ${g.web_view_link
          ? `<a class="file-link" href="${escapeHtml(g.web_view_link)}" target="_blank" rel="noopener">${escapeHtml(g.file_name)}</a>`
          : `<span class="meta">no file</span>`}
        <span class="meta">${g.submitted_at ? new Date(g.submitted_at).toLocaleString() : '—'}</span>
      </li>
    `).join('');
    return `
      <div class="section-group">
        <h3>${iconChip(status)}${status}<span class="count-pill">${groups.length}</span></h3>
        <ul class="group-list">${rows}</ul>
      </div>
    `;
  }).join('');
}

// ---- Evidence notes ----

function renderEvidence(evidence) {
  const list = document.getElementById('evidence-list');
  if (!evidence || evidence.length === 0) {
    list.innerHTML = `<li class="empty-state"><span class="icon">${INBOX_ICON}</span>No evidence notes yet.</li>`;
    return;
  }
  list.innerHTML = evidence.map(e => `
    <li class="evidence-item">
      ${escapeHtml(e.note)}
      <div class="meta">${e.group_name ? escapeHtml(e.group_name) + ' — ' : ''}${new Date(e.created_at).toLocaleString()}</div>
      ${e.has_screenshot ? `<img class="screenshot-thumb" src="/api/evidence/${e.id}/screenshot" alt="Evidence screenshot" loading="lazy" />` : ''}
    </li>
  `).join('');
}

document.getElementById('evidence-submit').addEventListener('click', async () => {
  const textarea = document.getElementById('evidence-note');
  const fileInput = document.getElementById('evidence-screenshot');
  const errorEl = document.getElementById('evidence-error');
  errorEl.textContent = '';
  const note = textarea.value.trim();
  const file = fileInput.files[0];
  if (!note && !file) {
    errorEl.textContent = 'Add a note, a screenshot, or both.';
    return;
  }
  if (!state.taskId) return;

  const formData = new FormData();
  if (note) formData.append('note', note);
  if (file) formData.append('screenshot', file);

  try {
    await api(`/api/tasks/${state.taskId}/evidence`, { method: 'POST', body: formData });
    textarea.value = '';
    fileInput.value = '';
    await loadSubmissions(state.taskId);
    showToast('Evidence added.', 'success');
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// ---- Audit report ----

document.getElementById('report-download').addEventListener('click', () => {
  const batch_id = document.getElementById('report-batch').value;
  const from = document.getElementById('report-from').value;
  const to = document.getElementById('report-to').value;
  const params = new URLSearchParams();
  if (batch_id) params.set('batch_id', batch_id);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  window.location.href = '/api/reports/audit.csv?' + params.toString();
});

// ---- Init ----

(async function init() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('connected')) {
    history.replaceState({}, '', window.location.pathname);
  }
  renderLegend();
  await loadGoogleStatus();
  await loadMeta();
  await loadBatches();
})();
