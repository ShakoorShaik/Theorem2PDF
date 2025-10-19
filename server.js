const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const OpenAI = require('openai');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(express.json());

const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  }
});

function chunkText(text, chunkSize = 15000) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) chunks.push(text.substring(i, i + chunkSize));
  return chunks;
}

function normalizeNumberedTitle(title = '', fallbackType = '') {
  const raw = String(title || '').toLowerCase().trim()
    .replace(/\s+/g, ' ')
    .replace(/[·–—-]/g, '-') 
    .replace(/\s*[\.:;,-]+\s*$/,''); 

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

async function extractMathContent(pdfText) {
  const chunks = chunkText(pdfText, 15000);
  let all = [];

  for (let i = 0; i < chunks.length; i++) {
    const prompt = `You are an expert at extracting mathematical content from academic notes.

Extract ALL unique Definitions, Theorems, Lemmas, Propositions, Corollaries, and Axioms.

RULES:
- Preserve LaTeX EXACTLY (backslashes, $, $$, \\begin{env} ... \\end{env}, etc.).
- Keep the author’s numbering and titles exactly.
- Do NOT add, remove, or rewrite any math.
- No proofs/examples, only the statements.
- Return JSON with an "items" array of objects: {type,title,content,page}.

Text (chunk ${i + 1}/${chunks.length}):
"""${chunks[i]}"""`;

    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Extract unique math statements and preserve LaTeX exactly.' },
        { role: 'user', content: prompt }
      ]
    });

    let chunkItems = [];
    try {
      const parsed = JSON.parse(resp.choices?.[0]?.message?.content || '{}');
      if (Array.isArray(parsed.items)) chunkItems = parsed.items;
      else if (Array.isArray(parsed)) chunkItems = parsed;
    } catch (_) { /* ignore bad chunk */ }

    all = all.concat(chunkItems);
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 400));
  }
  return dedupeByNumberedTitle(all);
}


app.post('/api/extract', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const data = fs.readFileSync(req.file.path);
    const parsed = await pdfParse(data);
    fs.unlinkSync(req.file.path);

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not set on server.' });
    }

    const items = await extractMathContent(parsed.text);
    return res.json({
      success: true,
      content: items,
      stats: { totalPages: parsed.numpages, totalItems: items.length }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to process PDF', details: err.message });
  }
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Serving static files from: ${PUBLIC_DIR}`);
});
