/** Frontend: pick a file, post it to /api/analyze, render the comparison. */

const el = (id) => document.getElementById(id);
const dropzone = el('dropzone');
const fileInput = el('file-input');
const analyzeButton = el('analyze-button');
const errorBox = el('error');
const results = el('results');
const toolsBody = el('tools-body');

let selectedFile = null;
let previewUrl = null;
let config = { detectors: [], demoMode: false };

/* ---------- config ---------- */

async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) return;
    config = await response.json();
    if (config.accept) fileInput.setAttribute('accept', config.accept);
    el('demo-banner').hidden = !config.demoMode;
  } catch {
    /* The app still works without it; the server will validate the upload. */
  }
}

/* ---------- file selection ---------- */

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

function selectFile(file) {
  if (!file) return;
  showError('');
  selectedFile = file;
  analyzeButton.disabled = false;

  el('file-name').textContent = file.name;
  const kind = file.type.startsWith('audio') ? 'Audio' : file.type.startsWith('image') ? 'Image' : 'File';
  el('file-detail').textContent = `${kind} · ${formatBytes(file.size)}`;

  const preview = el('file-preview');
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  if (file.type.startsWith('image/')) {
    previewUrl = URL.createObjectURL(file);
    preview.innerHTML = '';
    const img = document.createElement('img');
    img.src = previewUrl;
    img.alt = '';
    preview.append(img);
  } else {
    preview.textContent = '🎵';
  }
  el('file-card').hidden = false;
}

function clearFile() {
  selectedFile = null;
  analyzeButton.disabled = true;
  fileInput.value = '';
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  el('file-card').hidden = true;
  results.hidden = true;
  showError('');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => selectFile(fileInput.files[0]));
el('clear-button').addEventListener('click', clearFile);

for (const type of ['dragenter', 'dragover']) {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add('is-dragging');
  });
}
for (const type of ['dragleave', 'drop']) {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.remove('is-dragging');
  });
}
dropzone.addEventListener('drop', (event) => selectFile(event.dataTransfer.files[0]));
// Dropping outside the zone should not navigate away from the page.
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

/* ---------- analysis ---------- */

analyzeButton.addEventListener('click', analyze);

async function analyze() {
  if (!selectedFile) return;
  showError('');
  analyzeButton.disabled = true;
  analyzeButton.textContent = 'Analyzing…';
  renderPending();

  const body = new FormData();
  body.append('file', selectedFile);

  try {
    const response = await fetch('/api/analyze', { method: 'POST', body });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Analysis failed (HTTP ${response.status}).`);
    render(payload);
  } catch (error) {
    results.hidden = true;
    showError(error.message || 'Could not reach the server.');
  } finally {
    analyzeButton.disabled = false;
    analyzeButton.textContent = 'Analyze';
  }
}

/** Show a spinner row per tool while the fan-out is in flight. */
function renderPending() {
  results.hidden = false;
  el('credentials').hidden = true;
  el('reverse').hidden = true;
  el('average-number').textContent = '—';
  el('verdict-label').textContent = 'Analyzing…';
  el('verdict-note').textContent = '';
  el('verdict-card').removeAttribute('data-level');
  el('meter-marker').hidden = true;

  const tools = config.detectors.length
    ? config.detectors
    : [{ id: 'pending', name: 'Detectors', supports: [] }];
  toolsBody.replaceChildren(...tools.map((tool) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><span class="tool__name"></span></td>
      <td><span class="spinner" role="status" aria-label="Checking"></span></td>
      <td><span class="tool__score tool__score--muted">…</span></td>`;
    row.querySelector('.tool__name').textContent = tool.name;
    return row;
  }));
  results.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

const SUPPORT_PILL = {
  ok: { text: 'Yes', className: 'pill--yes' },
  demo: { text: 'Demo', className: 'pill--warn' },
  unsupported: { text: 'No', className: 'pill--no' },
  not_configured: { text: 'No key', className: 'pill--no' },
  error: { text: 'Failed', className: 'pill--error' },
};

function render(payload) {
  results.hidden = false;

  const average = payload.average;
  const card = el('verdict-card');
  card.setAttribute('data-level', payload.level);
  el('average-number').textContent = average === null ? '—' : average;
  el('verdict-label').textContent = average === null
    ? 'No tool could score this file'
    : payload.verdict;

  const marker = el('meter-marker');
  if (average === null) {
    marker.hidden = true;
  } else {
    marker.hidden = false;
    marker.style.left = `${average}%`;
    el('meter').setAttribute('aria-label', `Averaged AI likelihood: ${average} percent — ${payload.verdict}`);
  }

  el('verdict-note').textContent = buildNote(payload);

  toolsBody.replaceChildren(...payload.perTool.map(toolRow));

  const credentials = payload.contentCredentials;
  const credentialsPanel = el('credentials');
  if (credentials) {
    credentialsPanel.hidden = false;
    credentialsPanel.dataset.flag = credentials.aiGeneratorDetected ? 'ai' : credentials.present ? 'present' : 'absent';
    el('credentials-note').textContent = credentials.note;
  } else {
    credentialsPanel.hidden = true;
  }

  const reversePanel = el('reverse');
  if (payload.reverseSearch?.length) {
    reversePanel.hidden = false;
    el('reverse-links').replaceChildren(...payload.reverseSearch.map((engine) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = engine.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = engine.name;
      const note = document.createElement('span');
      note.textContent = engine.note;
      item.append(link, note);
      return item;
    }));
  } else {
    reversePanel.hidden = true;
  }

  el('disclaimer').textContent = payload.disclaimer;
}

/** The sentence under the meter — what the number is actually built from. */
function buildNote(payload) {
  const { contributingTools, singleSource, perTool, file } = payload;
  if (contributingTools === 0) {
    const reason = perTool.every((t) => t.status === 'not_configured')
      ? 'No detector API keys are configured — add keys to .env, or set DEMO_MODE=true to try the interface.'
      : 'Every tool either failed or does not support this file type.';
    return reason;
  }
  const demo = perTool.some((t) => t.status === 'demo');
  const parts = [`Averaged across ${contributingTools} tool${contributingTools === 1 ? '' : 's'}.`];
  if (singleSource) {
    parts.push(file.kind === 'audio'
      ? 'Free audio coverage is thin — this is one tool\'s opinion, not a consensus.'
      : 'Only one tool returned a score, so this is not a consensus.');
  }
  if (demo) parts.push('Includes simulated demo scores.');
  return parts.join(' ');
}

function toolRow(tool) {
  const row = document.createElement('tr');
  const pill = SUPPORT_PILL[tool.status] ?? SUPPORT_PILL.error;

  row.innerHTML = `
    <td><span class="tool__name"></span><span class="tool__message"></span></td>
    <td><span class="pill"></span></td>
    <td><span class="tool__score"></span></td>`;

  row.querySelector('.tool__name').textContent = tool.name;

  const message = row.querySelector('.tool__message');
  if (tool.message) message.textContent = tool.message;
  else message.remove();

  const pillEl = row.querySelector('.pill');
  pillEl.classList.add(pill.className);
  pillEl.textContent = pill.text;

  const score = row.querySelector('.tool__score');
  if (typeof tool.score === 'number') {
    score.textContent = `${tool.score}%`;
    if (tool.status === 'demo') score.classList.add('tool__score--muted');
  } else {
    score.textContent = '—';
    score.classList.add('tool__score--muted');
  }
  return row;
}

loadConfig();
