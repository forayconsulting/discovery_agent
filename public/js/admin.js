// Admin dashboard client logic

const API_BASE = '/api/admin';
let authToken = localStorage.getItem('admin_token');
let currentEngagementId = null;
let engagementData = null;
let summaryPollTimer = null;
let summaryPollCount = 0;
let overviewPollTimer = null;
let sessionPollTimer = null;
let selectedFiles = [];

// Helpers
function apiHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${authToken}`,
  };
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...apiHeaders(), ...options.headers },
  });

  if (res.status === 401) {
    localStorage.removeItem('admin_token');
    authToken = null;
    showView('login');
    throw new Error('Unauthorized');
  }

  return res;
}

// Views
function showView(view) {
  stopSummaryPolling();
  stopOverviewPolling();
  stopSessionPolling();
  const allScreens = ['login-screen', 'list-screen', 'create-screen', 'detail-screen', 'settings-screen'];
  allScreens.forEach((id) => document.getElementById(id).classList.add('hidden'));
  document.getElementById('nav').classList.toggle('hidden', view === 'login');

  if (view === 'login') {
    document.getElementById('login-screen').classList.remove('hidden');
  } else if (view === 'list') {
    document.getElementById('list-screen').classList.remove('hidden');
    loadEngagements();
  } else if (view === 'create') {
    document.getElementById('create-screen').classList.remove('hidden');
    // Reset form
    document.getElementById('eng-name').value = '';
    document.getElementById('eng-description').value = '';
    document.getElementById('eng-context').value = '';
    document.getElementById('doc-eng-name').value = '';
    selectedFiles = [];
    renderFileList();
    document.getElementById('extraction-status').classList.add('hidden');
  } else if (view === 'detail') {
    document.getElementById('detail-screen').classList.remove('hidden');
    loadEngagementDetail(currentEngagementId);
  } else if (view === 'settings') {
    document.getElementById('settings-screen').classList.remove('hidden');
    loadMondayKeyStatus();
  }
}

// Init
if (authToken) {
  showView('list');
} else {
  showView('login');
}

// Auth
async function login() {
  const password = document.getElementById('password').value;
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');

  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (!res.ok) {
      errEl.textContent = 'Invalid password';
      errEl.classList.remove('hidden');
      return;
    }

    const data = await res.json();
    authToken = data.token;
    localStorage.setItem('admin_token', authToken);
    showView('list');
  } catch (err) {
    errEl.textContent = 'Login failed. Please try again.';
    errEl.classList.remove('hidden');
  }
}

function logout() {
  localStorage.removeItem('admin_token');
  authToken = null;
  showView('login');
}

// Engagements list
async function loadEngagements() {
  const listEl = document.getElementById('engagements-list');
  const loadingEl = document.getElementById('engagements-loading');
  const emptyEl = document.getElementById('engagements-empty');

  listEl.innerHTML = '';
  loadingEl.classList.remove('hidden');
  emptyEl.classList.add('hidden');

  try {
    const res = await apiFetch('/engagements');
    const data = await res.json();
    loadingEl.classList.add('hidden');

    if (data.engagements.length === 0) {
      emptyEl.classList.remove('hidden');
      return;
    }

    data.engagements.forEach((eng) => {
      const card = document.createElement('div');
      card.className = 'engagement-card';
      card.onclick = () => {
        currentEngagementId = eng.id;
        showView('detail');
      };

      card.innerHTML = `
        <div>
          <h3>${escapeHtml(eng.name)}</h3>
          <div class="engagement-meta">
            ${eng.session_count} session${eng.session_count !== '1' ? 's' : ''} &middot;
            ${eng.completed_count} completed &middot;
            Created ${formatDate(eng.created_at)}
          </div>
        </div>
        <span style="color: var(--gray-400); font-size: 1.2rem;">&rsaquo;</span>
      `;
      listEl.appendChild(card);
    });
  } catch (err) {
    loadingEl.classList.add('hidden');
  }
}

// Create engagement
function switchCreateTab(tab) {
  document.querySelectorAll('#create-screen .tab').forEach((t) => t.classList.remove('active'));
  document.getElementById('create-manual').classList.add('hidden');
  document.getElementById('create-monday').classList.add('hidden');
  document.getElementById('create-document').classList.add('hidden');

  if (tab === 'manual') {
    document.querySelectorAll('#create-screen .tab')[0].classList.add('active');
    document.getElementById('create-manual').classList.remove('hidden');
  } else if (tab === 'monday') {
    document.querySelectorAll('#create-screen .tab')[1].classList.add('active');
    document.getElementById('create-monday').classList.remove('hidden');
  } else {
    document.querySelectorAll('#create-screen .tab')[2].classList.add('active');
    document.getElementById('create-document').classList.remove('hidden');
  }
}

async function createEngagement() {
  const name = document.getElementById('eng-name').value.trim();
  const description = document.getElementById('eng-description').value.trim();
  const context = document.getElementById('eng-context').value.trim();

  if (!name) {
    alert('Engagement name is required.');
    return;
  }

  const btn = document.getElementById('create-btn');
  btn.disabled = true;
  btn.textContent = 'Creating...';

  try {
    const res = await apiFetch('/engagements', {
      method: 'POST',
      body: JSON.stringify({ name, description, context }),
    });

    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Failed to create engagement.');
      return;
    }

    const data = await res.json();
    currentEngagementId = data.engagement.id;
    showView('detail');
  } catch (err) {
    alert('Failed to create engagement.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Engagement';
  }
}

// Monday.com
async function searchMonday() {
  const term = document.getElementById('monday-search').value.trim();
  const boardsEl = document.getElementById('monday-boards');
  const itemsEl = document.getElementById('monday-items');
  const previewEl = document.getElementById('monday-preview');

  itemsEl.classList.add('hidden');
  previewEl.classList.add('hidden');

  try {
    const res = await apiFetch(`/monday/search?term=${encodeURIComponent(term)}`);
    const data = await res.json();

    if (data.boards.length === 0) {
      boardsEl.innerHTML = '<p class="text-muted">No boards found.</p>';
      return;
    }

    boardsEl.innerHTML = '<h3>Boards</h3>' + data.boards.map((b) => `
      <div class="engagement-card" style="margin-top:8px;" onclick="loadBoardItems('${b.id}')">
        <span>${escapeHtml(b.name)}</span>
        <span style="color:var(--gray-400);">&rsaquo;</span>
      </div>
    `).join('');
  } catch (err) {
    boardsEl.innerHTML = '<p class="text-muted">Failed to search Monday.com. Check API key.</p>';
  }
}

async function loadBoardItems(boardId) {
  const itemsEl = document.getElementById('monday-items');
  itemsEl.classList.remove('hidden');
  itemsEl.innerHTML = '<div class="loading-container"><div class="spinner"></div></div>';

  try {
    const res = await apiFetch(`/monday/boards/${boardId}/items`);
    const data = await res.json();

    if (data.items.length === 0) {
      itemsEl.innerHTML = '<p class="text-muted">No items in this board.</p>';
      return;
    }

    itemsEl.innerHTML = '<h3>Items</h3>' + data.items.map((item) => `
      <div class="engagement-card" style="margin-top:8px;" onclick="importMondayItem('${item.id}', '${boardId}')">
        <span>${escapeHtml(item.name)}</span>
        <span style="color:var(--gray-400);">&rsaquo;</span>
      </div>
    `).join('');
  } catch (err) {
    itemsEl.innerHTML = '<p class="text-muted">Failed to load items.</p>';
  }
}

let mondayImportData = null;

async function importMondayItem(itemId, boardId) {
  const previewEl = document.getElementById('monday-preview');
  previewEl.classList.remove('hidden');

  try {
    const res = await apiFetch(`/monday/item/${itemId}`);
    const data = await res.json();

    mondayImportData = {
      name: data.item.name,
      context: data.context,
      mondayItemId: itemId,
      mondayBoardId: boardId,
    };

    document.getElementById('monday-eng-name').value = data.item.name;
    document.getElementById('monday-context').textContent = data.context;
  } catch (err) {
    previewEl.innerHTML = '<p class="text-muted">Failed to load item details.</p>';
  }
}

async function createFromMonday() {
  if (!mondayImportData) return;

  const name = document.getElementById('monday-eng-name').value.trim() || mondayImportData.name;

  try {
    const res = await apiFetch('/engagements', {
      method: 'POST',
      body: JSON.stringify({
        name,
        context: mondayImportData.context,
        mondayItemId: mondayImportData.mondayItemId,
        mondayBoardId: mondayImportData.mondayBoardId,
      }),
    });

    if (!res.ok) {
      alert('Failed to create engagement.');
      return;
    }

    const data = await res.json();
    currentEngagementId = data.engagement.id;
    showView('detail');
  } catch (err) {
    alert('Failed to create engagement.');
  }
}

// Document upload
function handleFileSelect(files) {
  const maxSize = 10 * 1024 * 1024; // 10MB
  const textExtensions = ['.md', '.txt', '.text', '.vtt', '.csv', '.json', '.xml', '.yaml', '.yml', '.log', '.html', '.htm', '.rtf'];

  for (const file of files) {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    const isAllowed = file.type === 'application/pdf' || file.type.startsWith('text/') || textExtensions.includes(ext);
    if (!isAllowed) {
      alert(`"${file.name}" is not a supported file type. Please upload PDF or text-based files.`);
      continue;
    }
    if (file.size > maxSize) {
      alert(`"${file.name}" exceeds the 10MB size limit.`);
      continue;
    }
    // Avoid duplicates
    if (!selectedFiles.find((f) => f.name === file.name && f.size === file.size)) {
      selectedFiles.push(file);
    }
  }
  renderFileList();
}

function removeFile(index) {
  selectedFiles.splice(index, 1);
  renderFileList();
}

function renderFileList() {
  const el = document.getElementById('file-list');
  if (selectedFiles.length === 0) {
    el.innerHTML = '';
    return;
  }

  el.innerHTML = selectedFiles.map((f, i) => `
    <div class="file-item">
      <div class="file-info">
        <span>${escapeHtml(f.name)}</span>
        <span class="file-size">${formatFileSize(f.size)}</span>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="removeFile(${i})">&times;</button>
    </div>
  `).join('');
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Drag and drop
document.addEventListener('DOMContentLoaded', () => {
  const dropzone = document.getElementById('dropzone');
  if (!dropzone) return;

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('drag-over');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    handleFileSelect(e.dataTransfer.files);
  });
});

async function createFromDocuments() {
  const name = document.getElementById('doc-eng-name').value.trim();
  if (!name) {
    alert('Engagement name is required.');
    return;
  }
  if (selectedFiles.length === 0) {
    alert('Please upload at least one document.');
    return;
  }

  const btn = document.getElementById('doc-upload-btn');
  const statusEl = document.getElementById('extraction-status');
  const statusText = document.getElementById('extraction-status-text');
  btn.disabled = true;
  statusEl.classList.remove('hidden');
  statusText.textContent = 'Creating engagement...';

  try {
    // Step 1: Create engagement (no description/context yet)
    const createRes = await apiFetch('/engagements', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    if (!createRes.ok) {
      const err = await createRes.json();
      alert(err.error || 'Failed to create engagement.');
      return;
    }
    const createData = await createRes.json();
    const engagementId = createData.engagement.id;

    // Step 2: Upload files via multipart FormData
    statusText.textContent = 'Uploading documents...';
    const formData = new FormData();
    selectedFiles.forEach((f) => formData.append('files', f));

    const uploadRes = await fetch(`${API_BASE}/engagements/${engagementId}/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: formData,
    });
    if (!uploadRes.ok) {
      const err = await uploadRes.json();
      alert(err.error || 'Failed to upload documents.');
      return;
    }

    // Step 3: Trigger extraction (fire-and-forget on server)
    statusText.textContent = 'Extracting context from documents...';
    const extractRes = await apiFetch(`/engagements/${engagementId}/documents/extract`, {
      method: 'POST',
    });
    if (!extractRes.ok) {
      const err = await extractRes.json();
      alert(err.error || 'Failed to start extraction.');
      return;
    }

    // Step 4: Poll for completion
    pollDocumentExtraction(engagementId);
  } catch (err) {
    alert('An error occurred. Please try again.');
    statusEl.classList.add('hidden');
  } finally {
    btn.disabled = false;
  }
}

async function pollDocumentExtraction(engagementId) {
  const statusText = document.getElementById('extraction-status-text');
  const statusEl = document.getElementById('extraction-status');

  const poll = setInterval(async () => {
    try {
      const res = await apiFetch(`/engagements/${engagementId}/documents`);
      const data = await res.json();
      const docs = data.documents || [];

      const allDone = docs.length > 0 && docs.every((d) => d.processing_status === 'completed' || d.processing_status === 'failed');
      const anyFailed = docs.some((d) => d.processing_status === 'failed');

      if (allDone) {
        clearInterval(poll);
        if (anyFailed) {
          const failedDocs = docs.filter((d) => d.processing_status === 'failed');
          alert(`Extraction completed with errors: ${failedDocs.map((d) => d.error_message || d.filename).join(', ')}`);
        }
        statusEl.classList.add('hidden');
        currentEngagementId = engagementId;
        showView('detail');
      }
    } catch (err) {
      // Silently retry
    }
  }, 3000);
}

// Engagement detail
async function loadEngagementDetail(id) {
  const headerEl = document.getElementById('detail-header');
  const sessionsEl = document.getElementById('sessions-list');

  headerEl.innerHTML = '<div class="loading-container"><div class="spinner"></div></div>';

  try {
    const res = await apiFetch(`/engagements/${id}`);
    const data = await res.json();
    engagementData = data.engagement;

    headerEl.innerHTML = `
      <h1>${escapeHtml(engagementData.name)}</h1>
      ${engagementData.description ? `<p class="subtitle">${escapeHtml(engagementData.description)}</p>` : ''}
      ${engagementData.context ? `<details class="mt-4"><summary class="text-sm text-muted" style="cursor:pointer;">View project context</summary><pre class="summary-block" style="font-size:0.85rem;">${escapeHtml(engagementData.context)}</pre></details>` : ''}
    `;

    initStakeholderForm();
    renderSessions();
    renderAggregate();
    startSessionPolling();
  } catch (err) {
    headerEl.innerHTML = '<p class="text-muted">Failed to load engagement.</p>';
  }
}

function switchDetailTab(tab) {
  document.querySelectorAll('#detail-screen .tab').forEach((t) => t.classList.remove('active'));
  document.getElementById('detail-sessions').classList.add('hidden');
  document.getElementById('detail-aggregate').classList.add('hidden');
  document.getElementById('result-detail').classList.add('hidden');

  if (tab === 'sessions') {
    document.querySelectorAll('#detail-screen .tab')[0].classList.add('active');
    document.getElementById('detail-sessions').classList.remove('hidden');
  } else {
    document.querySelectorAll('#detail-screen .tab')[1].classList.add('active');
    document.getElementById('detail-aggregate').classList.remove('hidden');
  }
}

function renderSessions() {
  const sessionsEl = document.getElementById('sessions-list');
  const sessions = engagementData.sessions || [];

  if (sessions.length === 0) {
    sessionsEl.innerHTML = '<p class="text-muted text-center mt-4">No sessions yet. Add a stakeholder above.</p>';
    return;
  }

  const statusLabels = { pending: 'Not Started', in_progress: 'In Progress', completed: 'Completed' };
  const statusClasses = { pending: 'pending', in_progress: 'in-progress', completed: 'completed' };

  sessionsEl.innerHTML = '<div class="card">' + sessions.map((s) => {
    const label = statusLabels[s.status] || s.status;
    const cls = statusClasses[s.status] || s.status;
    const badge = `<span class="badge badge-${cls}">${label}</span>`;
    const result = engagementData.results?.find((r) => r.session_id === s.id);
    const summaryPending = s.status === 'completed' && (!result || !result.ai_summary);
    const summaryHint = summaryPending
      ? ' <span class="spinner spinner-inline"></span> <span class="text-sm text-muted">Generating summary...</span>'
      : '';
    const viewBtn = s.status === 'completed'
      ? `<button class="btn btn-secondary btn-sm" onclick="viewResult('${s.id}')">View Results</button>`
      : `<button class="btn btn-secondary btn-sm" onclick="copySessionLink('${s.token}')">Copy Link</button>`;

    return `
      <div class="session-row">
        <div>
          <strong>${escapeHtml(s.stakeholder_name)}</strong>
          ${s.stakeholder_role ? `<span class="text-sm text-muted"> &middot; ${escapeHtml(s.stakeholder_role)}</span>` : ''}
          <br>${badge}${summaryHint}
        </div>
        <div>${viewBtn}</div>
      </div>
    `;
  }).join('') + '</div>';
}

// Batch stakeholder creation
let stakeholderRowId = 0;

function addStakeholderRow() {
  const container = document.getElementById('stakeholder-rows');
  const id = stakeholderRowId++;
  const row = document.createElement('div');
  row.className = 'flex gap-2 mb-4';
  row.style.flexWrap = 'wrap';
  row.setAttribute('data-row-id', id);
  row.innerHTML = `
    <div class="form-group" style="flex:1;min-width:140px;">
      ${id === 0 ? '<label>Name *</label>' : ''}
      <input type="text" class="sh-name" placeholder="Full name">
    </div>
    <div class="form-group" style="flex:1;min-width:140px;">
      ${id === 0 ? '<label>Email</label>' : ''}
      <input type="email" class="sh-email" placeholder="email@example.com">
    </div>
    <div class="form-group" style="flex:1;min-width:140px;">
      ${id === 0 ? '<label>Role</label>' : ''}
      <input type="text" class="sh-role" placeholder="e.g., VP of Ops">
    </div>
    <button class="btn btn-secondary btn-sm steering-btn" style="align-self:center;white-space:nowrap;" onclick="suggestSteering(${id})">Suggest Focus Areas</button>
    ${id > 0 ? `<button class="btn btn-secondary btn-sm" style="align-self:center;" onclick="removeStakeholderRow(${id})">&times;</button>` : '<div style="width:38px;"></div>'}
  `;
  container.appendChild(row);
}

function removeStakeholderRow(id) {
  const row = document.querySelector(`[data-row-id="${id}"]`);
  if (row) row.remove();
}

function initStakeholderForm() {
  const container = document.getElementById('stakeholder-rows');
  container.innerHTML = '';
  stakeholderRowId = 0;
  document.getElementById('new-links').classList.add('hidden');
  document.getElementById('new-links').innerHTML = '';
  addStakeholderRow();
}

async function createBatchSessions() {
  const rows = document.querySelectorAll('#stakeholder-rows [data-row-id]');
  const stakeholders = [];

  rows.forEach((row) => {
    const name = row.querySelector('.sh-name').value.trim();
    const email = row.querySelector('.sh-email').value.trim();
    const role = row.querySelector('.sh-role').value.trim();
    const steeringPrompt = getSteeringValue(row);
    if (name) {
      stakeholders.push({ name, email: email || undefined, role: role || undefined, steeringPrompt });
    }
  });

  if (stakeholders.length === 0) {
    alert('At least one stakeholder name is required.');
    return;
  }

  const btn = document.getElementById('create-sessions-btn');
  btn.disabled = true;
  btn.textContent = 'Creating...';

  try {
    const res = await apiFetch(`/engagements/${currentEngagementId}/sessions/batch`, {
      method: 'POST',
      body: JSON.stringify({ stakeholders }),
    });

    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Failed to create sessions.');
      return;
    }

    const data = await res.json();

    // Show all links
    const linksEl = document.getElementById('new-links');
    linksEl.classList.remove('hidden');
    linksEl.innerHTML = '<h4 style="margin-bottom:8px;">Session Links Created</h4>' +
      data.sessions.map((s) => `
        <div class="link-display" style="margin-bottom:4px;">
          <span style="min-width:120px;font-weight:500;">${escapeHtml(s.session.stakeholder_name)}</span>
          <code style="flex:1;">${s.shareableLink}</code>
          <button class="btn btn-secondary btn-sm" onclick="navigator.clipboard.writeText('${s.shareableLink}')">Copy</button>
        </div>
      `).join('');

    // Reset form and reload sessions
    initStakeholderForm();
    loadEngagementDetail(currentEngagementId);
  } catch (err) {
    alert('Failed to create sessions.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Sessions';
  }
}

async function suggestSteering(rowId) {
  const row = document.querySelector(`[data-row-id="${rowId}"]`);
  if (!row) return;

  const name = row.querySelector('.sh-name').value.trim();
  const role = row.querySelector('.sh-role').value.trim();

  if (!name) {
    alert('Please enter a stakeholder name first.');
    return;
  }

  const btn = row.querySelector('.steering-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }

  try {
    const res = await apiFetch(`/engagements/${currentEngagementId}/suggest-steering`, {
      method: 'POST',
      body: JSON.stringify({ stakeholderName: name, stakeholderRole: role }),
    });

    const data = await res.json();
    const suggestions = data.suggestions || [];

    // Build steering panel
    let steeringEl = row.querySelector('.steering-panel');
    if (!steeringEl) {
      steeringEl = document.createElement('div');
      steeringEl.className = 'steering-panel';
      row.appendChild(steeringEl);
    }

    if (suggestions.length === 0) {
      steeringEl.innerHTML = `
        <div class="form-group" style="width:100%;">
          <label>Custom Focus Areas</label>
          <input type="text" class="sh-steering" placeholder="e.g., Process efficiency, team dynamics">
        </div>
      `;
    } else {
      steeringEl.innerHTML = `
        <div style="width:100%;">
          <label class="text-sm" style="font-weight:500;display:block;margin-bottom:6px;">Focus Areas</label>
          ${suggestions.map((s, i) => `
            <label class="steering-option">
              <input type="checkbox" class="steering-check" value="${escapeHtml(s.prompt)}" data-label="${escapeHtml(s.label)}">
              <span><strong>${escapeHtml(s.label)}</strong> — ${escapeHtml(s.prompt)}</span>
            </label>
          `).join('')}
          <div class="form-group mt-4" style="margin-bottom:0;">
            <input type="text" class="sh-steering-other" placeholder="Other focus area (optional)">
          </div>
        </div>
      `;
    }
  } catch (err) {
    // Allow manual entry on failure
    let steeringEl = row.querySelector('.steering-panel');
    if (!steeringEl) {
      steeringEl = document.createElement('div');
      steeringEl.className = 'steering-panel';
      row.appendChild(steeringEl);
    }
    steeringEl.innerHTML = `
      <div class="form-group" style="width:100%;">
        <label>Custom Focus Areas</label>
        <input type="text" class="sh-steering" placeholder="e.g., Process efficiency, team dynamics">
      </div>
    `;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Suggest Focus Areas'; }
  }
}

function getSteeringValue(row) {
  // Check for checkboxes
  const checks = row.querySelectorAll('.steering-check:checked');
  const parts = [];
  checks.forEach((c) => parts.push(c.value));

  // Check for "other" free text
  const otherInput = row.querySelector('.sh-steering-other');
  if (otherInput && otherInput.value.trim()) {
    parts.push(otherInput.value.trim());
  }

  // Check for direct text input (fallback)
  const directInput = row.querySelector('.sh-steering');
  if (directInput && directInput.value.trim()) {
    parts.push(directInput.value.trim());
  }

  return parts.join('; ') || undefined;
}

function copySessionLink(token) {
  const url = `${window.location.origin}/session.html?token=${token}`;
  navigator.clipboard.writeText(url);
  alert('Link copied to clipboard!');
}

// View result
async function viewResult(sessionId) {
  stopSummaryPolling();
  document.getElementById('detail-sessions').classList.add('hidden');
  const resultEl = document.getElementById('result-detail');
  const contentEl = document.getElementById('result-content');
  resultEl.classList.remove('hidden');

  // Find result from engagement data
  const result = engagementData.results?.find((r) => r.session_id === sessionId);
  const session = engagementData.sessions?.find((s) => s.id === sessionId);

  if (!result) {
    contentEl.innerHTML = '<p class="text-muted">No results found.</p>';
    return;
  }

  const answers = result.answers_structured || [];

  const summaryBlock = result.ai_summary
    ? `<div class="card">
        <h3>AI Summary</h3>
        <div class="summary-block">${escapeHtml(result.ai_summary)}</div>
      </div>`
    : `<div class="card">
        <h3>AI Summary</h3>
        <div class="summary-generating">
          <div class="spinner"></div>
          <p class="text-muted">Summary is being generated...</p>
          <button class="btn btn-secondary btn-sm mt-4" onclick="refreshSummary('${sessionId}')">Check Again</button>
        </div>
      </div>`;

  contentEl.innerHTML = `
    <div class="card">
      <h2>${escapeHtml(session?.stakeholder_name || 'Stakeholder')}</h2>
      ${session?.stakeholder_role ? `<p class="subtitle">${escapeHtml(session.stakeholder_role)}</p>` : ''}
      <p class="text-sm text-muted">Completed ${formatDate(result.created_at)}</p>
    </div>

    ${summaryBlock}

    <div class="card">
      <h3>Full Q&A History</h3>
      ${answers.map((a, i) => `
        <div style="padding:12px 0;${i < answers.length - 1 ? 'border-bottom:1px solid var(--gray-100);' : ''}">
          <p class="text-sm" style="font-weight:500;">${escapeHtml(a.questionText)}</p>
          <p class="text-sm text-muted" style="margin-top:4px;">
            ${a.noneOfTheAbove ? 'None of the above' : a.selectedLabels.join(', ')}${a.customText ? `<br><em>Other: "${escapeHtml(a.customText)}"</em>` : ''}
          </p>
        </div>
      `).join('')}
    </div>
  `;

  // Start polling if summary not yet available
  if (!result.ai_summary) {
    startSummaryPolling(sessionId);
  }
}

function hideResult() {
  stopSummaryPolling();
  document.getElementById('result-detail').classList.add('hidden');
  document.getElementById('detail-sessions').classList.remove('hidden');
}

function stopSummaryPolling() {
  if (summaryPollTimer) {
    clearInterval(summaryPollTimer);
    summaryPollTimer = null;
  }
}

function startSummaryPolling(sessionId) {
  stopSummaryPolling();
  summaryPollCount = 0;
  summaryPollTimer = setInterval(async () => {
    summaryPollCount++;
    try {
      // After 3 poll attempts (15s), the background generation likely failed — trigger retry
      if (summaryPollCount === 3) {
        await triggerSummaryRetry(sessionId);
        return;
      }
      const res = await apiFetch(`/engagements/${currentEngagementId}`);
      const data = await res.json();
      engagementData = data.engagement;
      const result = engagementData.results?.find((r) => r.session_id === sessionId);
      if (result && result.ai_summary) {
        stopSummaryPolling();
        viewResult(sessionId);
        renderSessions();
      }
    } catch (err) {
      // Silently retry on next interval
    }
  }, 5000);
}

function stopSessionPolling() {
  if (sessionPollTimer) {
    clearInterval(sessionPollTimer);
    sessionPollTimer = null;
  }
}

function startSessionPolling() {
  stopSessionPolling();
  sessionPollTimer = setInterval(async () => {
    if (!currentEngagementId) return;
    try {
      const res = await apiFetch(`/engagements/${currentEngagementId}`);
      const data = await res.json();
      engagementData = data.engagement;
      renderSessions();
    } catch (err) {
      // Silently retry on next interval
    }
  }, 15000);
}

async function triggerSummaryRetry(sessionId) {
  try {
    const res = await apiFetch(`/sessions/${sessionId}/retry-summary`, { method: 'POST' });
    const data = await res.json();
    if (data.summary) {
      stopSummaryPolling();
      // Refresh engagement data so the summary is in the local cache
      const engRes = await apiFetch(`/engagements/${currentEngagementId}`);
      engagementData = (await engRes.json()).engagement;
      viewResult(sessionId);
      renderSessions();
    }
  } catch (err) {
    // Will retry on next poll or manual click
  }
}

async function refreshSummary(sessionId) {
  try {
    // First check if it arrived from the background task
    const res = await apiFetch(`/engagements/${currentEngagementId}`);
    const data = await res.json();
    engagementData = data.engagement;
    const result = engagementData.results?.find((r) => r.session_id === sessionId);
    if (result && result.ai_summary) {
      stopSummaryPolling();
      viewResult(sessionId);
      renderSessions();
      return;
    }
    // Not there yet — actively trigger generation
    await triggerSummaryRetry(sessionId);
  } catch (err) {
    // Ignore
  }
}

// Aggregate view
function renderAggregate() {
  const el = document.getElementById('detail-aggregate');
  const results = engagementData.results || [];

  if (results.length === 0) {
    el.innerHTML = '<p class="text-muted text-center mt-4">No completed sessions yet.</p>';
    return;
  }

  // Separate completed summaries from pending ones
  const completedSummaries = results.filter((r) => r.ai_summary);
  const pendingSummaries = results.filter((r) => !r.ai_summary);
  const autoCollapse = completedSummaries.length > 2;

  // Engagement overview section
  const overviewGenerating = overviewPollTimer && !engagementData.engagement_overview;
  const overviewHtml = engagementData.engagement_overview
    ? `<div class="card">
        <div class="flex-between">
          <h3>Engagement Overview</h3>
          <button class="btn btn-secondary btn-sm" onclick="refreshOverview()">Refresh</button>
        </div>
        <div class="summary-block">${escapeHtml(engagementData.engagement_overview)}</div>
      </div>`
    : overviewGenerating
      ? `<div class="card">
          <div class="flex-between">
            <h3>Engagement Overview</h3>
          </div>
          <div class="summary-generating">
            <div class="spinner"></div>
            <p class="text-muted">Generating overview...</p>
          </div>
        </div>`
      : completedSummaries.length >= 2
        ? `<div class="card">
            <div class="flex-between">
              <h3>Engagement Overview</h3>
              <button class="btn btn-primary btn-sm" onclick="refreshOverview()">Generate Overview</button>
            </div>
            <p class="text-sm text-muted mt-4">An AI-generated overview synthesizing all stakeholder summaries will appear here.</p>
          </div>`
        : '';

  // Pending summary cards
  const pendingHtml = pendingSummaries.map((r) => {
    const session = engagementData.sessions?.find((s) => s.id === r.session_id);
    return `
      <div class="card">
        <h3>${escapeHtml(session?.stakeholder_name || 'Stakeholder')}</h3>
        ${session?.stakeholder_role ? `<p class="subtitle">${escapeHtml(session.stakeholder_role)}</p>` : ''}
        <div class="summary-generating">
          <div class="spinner"></div>
          <p class="text-muted">Summary is being generated...</p>
        </div>
      </div>
    `;
  }).join('');

  // Completed summary cards (collapsible)
  const summaryCards = completedSummaries.map((r, i) => {
    const session = engagementData.sessions?.find((s) => s.id === r.session_id);
    const collapsed = autoCollapse ? ' collapsed' : '';
    return `
      <div class="card collapsible-card${collapsed}">
        <div class="collapsible-header" onclick="toggleSummary(this)">
          <div>
            <h3>${escapeHtml(session?.stakeholder_name || 'Stakeholder')}</h3>
            ${session?.stakeholder_role ? `<p class="subtitle">${escapeHtml(session.stakeholder_role)}</p>` : ''}
          </div>
          <span class="collapse-icon">&rsaquo;</span>
        </div>
        <div class="collapsible-body">
          <div class="summary-block">${escapeHtml(r.ai_summary)}</div>
        </div>
      </div>
    `;
  }).join('');

  el.innerHTML = `
    ${overviewHtml}
    <div class="card">
      <h3>Individual Discovery Summaries</h3>
      <p class="text-sm text-muted">${completedSummaries.length} completed${pendingSummaries.length > 0 ? `, ${pendingSummaries.length} generating` : ''}</p>
    </div>
    ${pendingHtml}
    ${summaryCards}
  `;
}

function toggleSummary(header) {
  const card = header.closest('.collapsible-card');
  card.classList.toggle('collapsed');
}

function stopOverviewPolling() {
  if (overviewPollTimer) {
    clearInterval(overviewPollTimer);
    overviewPollTimer = null;
  }
}

function startOverviewPolling() {
  stopOverviewPolling();
  overviewPollTimer = setInterval(async () => {
    try {
      const res = await apiFetch(`/engagements/${currentEngagementId}`);
      const data = await res.json();
      engagementData = data.engagement;
      if (engagementData.engagement_overview) {
        stopOverviewPolling();
        renderAggregate();
      }
    } catch (err) {
      // Silently retry on next interval
    }
  }, 5000);
}

async function refreshOverview() {
  try {
    const res = await apiFetch(`/engagements/${currentEngagementId}/refresh-overview`, {
      method: 'POST',
    });

    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Failed to generate overview.');
      return;
    }

    // Show spinner immediately and start polling
    startOverviewPolling();
    renderAggregate();
  } catch (err) {
    alert('Failed to generate overview.');
  }
}

// Delete engagement
async function deleteEngagement() {
  if (!currentEngagementId) return;

  const confirmed = confirm(
    'Are you sure you want to delete this engagement? All sessions, results, and uploaded documents will be permanently deleted.'
  );
  if (!confirmed) return;

  try {
    const res = await apiFetch(`/engagements/${currentEngagementId}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Failed to delete engagement.');
      return;
    }

    currentEngagementId = null;
    engagementData = null;
    showView('list');
  } catch (err) {
    alert('Failed to delete engagement.');
  }
}

// Utilities
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Settings - Monday.com API Key
async function loadMondayKeyStatus() {
  const statusEl = document.getElementById('monday-key-status');
  try {
    const res = await apiFetch('/settings/monday');
    const data = await res.json();
    if (data.configured) {
      const sourceLabel = data.source === 'admin' ? 'Set via admin panel' : 'Set via environment variable';
      statusEl.innerHTML = `<span class="badge badge-completed">Configured</span> <span class="text-sm text-muted">${sourceLabel}</span>`;
    } else {
      statusEl.innerHTML = '<span class="badge badge-pending">Not configured</span>';
    }
  } catch (err) {
    statusEl.innerHTML = '<span class="text-muted">Unable to check status</span>';
  }
}

async function saveMondayKey() {
  const apiKey = document.getElementById('monday-api-key').value.trim();
  const statusEl = document.getElementById('monday-save-status');

  if (!apiKey) {
    statusEl.textContent = 'Please enter an API key.';
    statusEl.style.color = 'var(--error)';
    return;
  }

  statusEl.textContent = 'Saving...';
  statusEl.style.color = 'var(--gray-400)';

  try {
    const res = await apiFetch('/settings/monday', {
      method: 'POST',
      body: JSON.stringify({ apiKey }),
    });

    if (!res.ok) {
      const err = await res.json();
      statusEl.textContent = err.error || 'Failed to save.';
      statusEl.style.color = 'var(--error)';
      return;
    }

    statusEl.textContent = 'Saved!';
    statusEl.style.color = 'var(--success, #22c55e)';
    document.getElementById('monday-api-key').value = '';
    loadMondayKeyStatus();
  } catch (err) {
    statusEl.textContent = 'Failed to save.';
    statusEl.style.color = 'var(--error)';
  }
}
