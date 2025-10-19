// DOM Elements
const uploadBox = document.getElementById('uploadBox');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const processBtn = document.getElementById('processBtn');
const loading = document.getElementById('loading');
const loadingText = document.getElementById('loadingText');
const results = document.getElementById('results');
const extractedContent = document.getElementById('extractedContent');
const downloadBtn = document.getElementById('downloadBtn');
const errorDiv = document.getElementById('error');

let currentFile = null;
let extractedData = [];

// Upload UX
uploadBox.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => handleFile(e.target.files[0]));
uploadBox.addEventListener('dragover', e => { e.preventDefault(); uploadBox.classList.add('dragover'); });
uploadBox.addEventListener('dragleave', () => uploadBox.classList.remove('dragover'));
uploadBox.addEventListener('drop', e => {
  e.preventDefault();
  uploadBox.classList.remove('dragover');
  handleFile(e.dataTransfer.files[0]);
});

function handleFile(file) {
  if (!file) return;
  if (file.type !== 'application/pdf') return showError('Please upload a PDF file');

  currentFile = file;
  fileName.textContent = file.name;
  uploadBox.style.display = 'none';
  fileInfo.style.display = 'block';
  hideError();
}

processBtn.addEventListener('click', async () => {
  if (!currentFile) return;
  try {
    showLoading('Processing your PDF... This may take a minute.');
    results.style.display = 'none';
    hideError();

    const formData = new FormData();
    formData.append('pdf', currentFile);

    const port = window.location.port || '3000';
    const response = await fetch(`http://localhost:${port}/api/extract`, { method: 'POST', body: formData });

    const ct = response.headers.get('content-type') || '';
    if (!ct.includes('application/json')) throw new Error('Server did not return JSON. Is it running?');

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to process PDF');

    if (!data.content || !data.content.length) {
      throw new Error('No mathematical content found in the PDF.');
    }

    // 🔒 Strong client-side de-dup (same logic as server)
    extractedData = dedupeByNumberedTitle(data.content);

    await displayResults(extractedData);
    hideLoading();
    results.style.display = 'block';
  } catch (err) {
    hideLoading();
    showError(err.message);
  }
});

/* ---------- De-dup helpers (mirror server) ---------- */

function normalizeNumberedTitle(title = '', fallbackType = '') {
  const raw = String(title || '').toLowerCase().trim()
    .replace(/\s+/g, ' ')
    .replace(/[·–—-]/g, '-')        // normalize dashes
    .replace(/\s*[\.:;,-]+\s*$/,''); // trim trailing punctuation

  const norm = raw
    .replace(/^prop\.\s+/i, 'proposition ')
    .replace(/^cor\.\s+/i, 'corollary ');

  const re = /^(definition|theorem|lemma|proposition|corollary|axiom|prop\.?|cor\.?)\s+(\d+(?:\.\d+)*)/i;
  const m = norm.match(re);
  if (m) {
    const head = m[1].replace(/^prop\.?$/i, 'proposition').replace(/^cor\.?$/i, 'corollary').toLowerCase();
    return `${head} ${m[2]}`;
  }
  const m2 = norm.match(/\b(\d+(?:\.\d+)*)\b/);
  if (m2 && fallbackType) {
    return `${String(fallbackType).toLowerCase().trim()} ${m2[1]}`;
  }
  return norm || (fallbackType ? String(fallbackType).toLowerCase().trim() : '');
}

function dedupeByNumberedTitle(items) {
  const best = new Map();
  for (const it of items) {
    const key = normalizeNumberedTitle(it.title, it.type);
    const existing = best.get(key);
    if (!existing) {
      best.set(key, it);
    } else {
      const currLen = (it.content || '').length;
      const prevLen = (existing.content || '').length;
      if (currLen > prevLen) best.set(key, it);
    }
  }
  return Array.from(best.values());
}

/* ---------- Rendering ---------- */

async function displayResults(content) {
  extractedContent.innerHTML = '';

  const summaryDiv = document.createElement('div');
  summaryDiv.style.cssText = 'background:#f0f4ff;padding:15px;border-radius:8px;margin-bottom:20px;';
  summaryDiv.innerHTML = `<strong>Found ${content.length} mathematical items</strong>`;
  extractedContent.appendChild(summaryDiv);

  content.forEach((item, idx) => {
    const itemDiv = document.createElement('div');
    itemDiv.className = `content-item ${String(item.type || '').toLowerCase()}`;

    const typeSpan = document.createElement('span');
    typeSpan.className = `content-type ${String(item.type || '').toLowerCase()}`;
    typeSpan.textContent = item.type || 'Item';

    const titleDiv = document.createElement('div');
    titleDiv.className = 'content-title';
    titleDiv.textContent = item.title || `${item.type || 'Item'} ${idx + 1}`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'content-text';
    contentDiv.style.whiteSpace = 'pre-wrap'; // preserve original line breaks/spaces
    // DO NOT touch LaTeX—insert raw text, let MathJax typeset it
    contentDiv.textContent = item.content || '';

    itemDiv.appendChild(typeSpan);
    itemDiv.appendChild(titleDiv);
    itemDiv.appendChild(contentDiv);
    extractedContent.appendChild(itemDiv);
  });

  await renderMathJax();
}

async function renderMathJax() {
  if (!window.MathJax) return;
  try {
    if (window.MathJax.typesetPromise) {
      await window.MathJax.typesetPromise([extractedContent]);
    } else if (window.MathJax.Hub) {
      await new Promise(res => {
        window.MathJax.Hub.Queue(['Typeset', window.MathJax.Hub, extractedContent]);
        window.MathJax.Hub.Queue(res);
      });
    }
  } catch (e) {
    console.error('MathJax render error', e);
  }
}

// PDF
downloadBtn.addEventListener('click', async () => {
  try {
    showLoading('Rendering LaTeX and building the PDF...');
    const gen = new LatexPDFGenerator();
    await gen.generatePDF(extractedData);
    hideLoading();
  } catch (e) {
    hideLoading();
    showError('Failed to generate PDF.');
  }
});

// UX helpers
function showLoading(msg = 'Loading...') {
  loadingText.textContent = msg;
  loading.style.display = 'block';
  fileInfo.style.display = 'none';
}
function hideLoading() { loading.style.display = 'none'; }
function showError(msg) { errorDiv.querySelector('p').textContent = msg; errorDiv.style.display = 'block'; }
function hideError() { errorDiv.style.display = 'none'; }
