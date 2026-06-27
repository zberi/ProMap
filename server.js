require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || null;
const ARCO_MODE = ANTHROPIC_API_KEY ? 'live' : 'mock';

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = process.env.NODE_ENV === 'production' ? '/tmp/data' : path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'processes.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ processes: [] }, null, 2));

function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch(e) { return { processes: [] }; }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ── HEALTH ───────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status:'ok', system:'MERIDIAN', version:'1.6.13', arcoMode: ARCO_MODE }));

// ── AUDIT LOG HELPERS ────────────────────────────
function makeAuditEntry(action, module, detail, changes) {
  return {
    ts: new Date().toISOString(),
    action,   
    module,   
    detail,   
    changes: changes || null,  
  };
}

function appendAudit(process, entry) {
  if (!process.auditLog) process.auditLog = [];
  process.auditLog.push(entry);
  if (process.auditLog.length > 500) process.auditLog = process.auditLog.slice(-500);
}

// ── PROCESSES ────────────────────────────────────
app.get('/api/processes', (req, res) => res.json(readData().processes));

app.get('/api/processes/:id', (req, res) => {
  const p = readData().processes.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

app.post('/api/processes', (req, res) => {
  const data = readData();
  const p = {
    id:'P-'+Date.now(), createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
    version:1, status:'draft', ...req.body,
    nodes:req.body.nodes||[], connections:req.body.connections||[], auditLog:[]
  };
  appendAudit(p, makeAuditEntry('created', 'PROMAP', `Process "${p.name}" created`));
  data.processes.push(p);
  writeData(data);
  res.status(201).json(p);
});

app.put('/api/processes/:id', (req, res) => {
  const data = readData();
  const idx = data.processes.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const prev = data.processes[idx];
  const next = { ...prev, ...req.body, id:req.params.id, updatedAt:new Date().toISOString(), version:(prev.version||1)+1 };

  if (!next.auditLog) next.auditLog = prev.auditLog || [];

  const module = req.body._auditModule || 'PROMAP';
  const auditEntries = req.body._auditEntries || [];
  delete next._auditModule;
  delete next._auditEntries;

  if (prev.status !== next.status) {
    appendAudit(next, makeAuditEntry(next.status, module, `Status changed: ${prev.status} → ${next.status}`, { field:'status', from:prev.status, to:next.status }));
  }

  const prevNodeCount = (prev.nodes||[]).length;
  const nextNodeCount = (next.nodes||[]).length;
  if (prevNodeCount !== nextNodeCount) {
    const delta = nextNodeCount - prevNodeCount;
    appendAudit(next, makeAuditEntry('modified', module, `${delta>0?'Added':'Removed'} ${Math.abs(delta)} step(s) — total: ${nextNodeCount}`, { field:'nodes', from:prevNodeCount, to:nextNodeCount }));
  }

  const prevConnCount = (prev.connections||[]).length;
  const nextConnCount = (next.connections||[]).length;
  if (prevConnCount !== nextConnCount) {
    appendAudit(next, makeAuditEntry('modified', module, `Connections: ${prevConnCount} → ${nextConnCount}`, { field:'connections', from:prevConnCount, to:nextConnCount }));
  }

  auditEntries.forEach(e => appendAudit(next, e));

  if (!auditEntries.length && prev.status === next.status && prevNodeCount === nextNodeCount && prevConnCount === nextConnCount) {
    appendAudit(next, makeAuditEntry('modified', module, `Process "${next.name}" saved (v${next.version})`));
  }

  data.processes[idx] = next;
  writeData(data);
  res.json(next);
});

app.delete('/api/processes/:id', (req, res) => {
  const data = readData();
  data.processes = data.processes.filter(p => p.id !== req.params.id);
  writeData(data);
  res.json({ success: true });
});

app.get('/api/processes/:id/audit', (req, res) => {
  const p = readData().processes.find(p => p.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json({ auditLog: p.auditLog || [], process: { id: p.id, name: p.name } });
});

// ── FILE UPLOAD (ARCŌ) ───────────────────────────
let multer, pdfParse, mammoth;
try { multer = require('multer'); } catch(e) {}
try { pdfParse = require('pdf-parse'); } catch(e) {}
try { mammoth = require('mammoth'); } catch(e) {}

if (multer) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
  app.post('/api/arco/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const name = req.file.originalname.toLowerCase();
    try {
      let text = '';
      if (name.endsWith('.txt')) {
        text = req.file.buffer.toString('utf8');
      } else if (name.endsWith('.pdf') && pdfParse) {
        const data = await pdfParse(req.file.buffer);
        text = data.text;
      } else if ((name.endsWith('.docx') || name.endsWith('.doc')) && mammoth) {
        const result = await mammoth.extractRawText({ buffer: req.file.buffer });
        text = result.value;
      } else {
        return res.status(400).json({ error: 'Unsupported file type or missing parser' });
      }
      res.json({ text: text.slice(0, 12000), filename: req.file.originalname });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });
}

// ── ARCŌ CHAT ────────────────────────────────────
const ARCO_SYSTEM = `You are ARCŌ — the conversational process intake assistant for MERIDIAN...`; 

app.get('/api/arco/mode', (req, res) => res.json({ mode: ARCO_MODE }));

app.post('/api/arco/chat', async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'No API key configured. Add ANTHROPIC_API_KEY to .env file.' });
  }
  try {
    const { messages, cortexContext, processContext } = req.body;
    const extras = [processContext, cortexContext].filter(Boolean).join('\n\n');
    const system = extras
      ? `${ARCO_SYSTEM}\n\n## CURRENT CONTEXT\n${extras}`
      : ARCO_SYSTEM;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',	
        max_tokens: 8000,
        system,
        messages
      })
    });
    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }
    const data = await response.json();
    res.json({ reply: data.content[0].text, mode: 'live' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// REMOVE this:
//app.listen(PORT, () => { ... });

// REPLACE with:
//if (require.main === module) {
//  app.listen(PORT, () => {
//    console.log(`MERIDIAN running on :${PORT}`);
//  });
//}

//module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => console.log(`MERIDIAN :${PORT}`));
}
module.exports = app;