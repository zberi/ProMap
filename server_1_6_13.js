require('dotenv').config();
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || null;
const ARCO_MODE = ANTHROPIC_API_KEY ? 'live' : 'mock';

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const fs = require('fs');
const path = require('path');
const DATA_FILE = path.join(__dirname, 'data', 'processes.json');
if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'));
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ processes: [] }, null, 2));

function readData() { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
function writeData(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

// ── HEALTH ───────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status:'ok', system:'MERIDIAN', version:'1.6.13', arcoMode: ARCO_MODE }));

// ── AUDIT LOG HELPERS ────────────────────────────
function makeAuditEntry(action, module, detail, changes) {
  return {
    ts: new Date().toISOString(),
    action,   // created | modified | deleted | published | archived | evaluated
    module,   // PROMAP | ARCŌ | CORTEX | SYSTEM
    detail,   // human-readable summary
    changes: changes || null,  // { field, from, to } or null
  };
}

function appendAudit(process, entry) {
  if (!process.auditLog) process.auditLog = [];
  process.auditLog.push(entry);
  // Cap at 500 entries per process
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

  // Preserve existing audit log + append new entries
  if (!next.auditLog) next.auditLog = prev.auditLog || [];

  const module = req.body._auditModule || 'PROMAP';
  const auditEntries = req.body._auditEntries || [];
  delete next._auditModule;
  delete next._auditEntries;

  // Status change
  if (prev.status !== next.status) {
    appendAudit(next, makeAuditEntry(next.status, module, `Status changed: ${prev.status} → ${next.status}`, { field:'status', from:prev.status, to:next.status }));
  }

  // Node count change
  const prevNodeCount = (prev.nodes||[]).length;
  const nextNodeCount = (next.nodes||[]).length;
  if (prevNodeCount !== nextNodeCount) {
    const delta = nextNodeCount - prevNodeCount;
    appendAudit(next, makeAuditEntry('modified', module, `${delta>0?'Added':'Removed'} ${Math.abs(delta)} step(s) — total: ${nextNodeCount}`, { field:'nodes', from:prevNodeCount, to:nextNodeCount }));
  }

  // Connection count change
  const prevConnCount = (prev.connections||[]).length;
  const nextConnCount = (next.connections||[]).length;
  if (prevConnCount !== nextConnCount) {
    appendAudit(next, makeAuditEntry('modified', module, `Connections: ${prevConnCount} → ${nextConnCount}`, { field:'connections', from:prevConnCount, to:nextConnCount }));
  }

  // Extra audit entries passed from client (field-level changes)
  auditEntries.forEach(e => appendAudit(next, e));

  // Generic save entry if no specific changes detected
  if (!auditEntries.length && prev.status === next.status && prevNodeCount === nextNodeCount && prevConnCount === nextConnCount) {
    appendAudit(next, makeAuditEntry('modified', module, `Process "${next.name}" saved (v${next.version})`));
  }

  data.processes[idx] = next;
  writeData(data);
  res.json(next);
});

app.delete('/api/processes/:id', (req, res) => {
  const data = readData();
  const p = data.processes.find(p => p.id === req.params.id);
  if (p) {
    // Archive the audit log to a separate deleted log before removing
    // (For V1 — just remove; in V2 soft-delete will preserve)
  }
  data.processes = data.processes.filter(p => p.id !== req.params.id);
  writeData(data);
  res.json({ success: true });
});

// ── AUDIT LOG ENDPOINT ───────────────────────────
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
const ARCO_SYSTEM = `You are ARCŌ — the conversational process intake assistant for MERIDIAN, a proprietary enterprise process intelligence platform used in FMCG and large manufacturing organisations.

You are a process architect and control systems analyst. You are NOT a generic AI assistant.

## YOUR ROLE
Help users design, structure and validate business processes through natural conversation. Extract structured process data, identify control and risk gaps, and output machine-readable process blueprints for the MERIDIAN PROMAP canvas.

## MERIDIAN FRAMEWORK

### Process Hierarchy (L1-L8)
L1=Process Group, L2=Process, L3=Sub-Process, L4=Step (default), L5=Task, L6=Sub-Task, L7=Action, L8=Detail.

### Step Types
- process: standard operational step
- control: defined control point with thresholds, verification, corrective action
- ccp: Critical Control Point — failure propagates irreversibly downstream; threshold + corrective action mandatory
- compliance: step driven by internal policy or external regulation
- system: automated/system-generated step
- handoff: cross-function transfer of ownership or output
- decision: branching gate (YES/NO or conditional)
- start/end: process boundaries

### RACI
Every non-trivial step must have: Responsible (R), Accountable (A), Consulted (C), Informed (I). Flag missing R and A.

### Department
Every step must have a department (e.g. Finance, Sales, Warehouse, HR, Procurement, Manufacturing). Infer from context or owner role. Always populate — never leave blank. Used for process grouping on canvas.

### Classifications (multi-select)
control, compliance-internal, compliance-regulatory, reporting, information

### Critical Control Points (CCPs)
A CCP is a step where failure cannot be recovered downstream. Capture: parameter, min/max, unit, corrective action, verifier.
Auto-suggest CCP review for: duplicate payments, approval bypasses, batch traceability gaps, supplier verification, quality gate failures.
Human confirmation required before final CCP designation.

### SMART Monitoring
Control points, CCPs, compliance steps and handoffs default to monitoring=true.

### Record Keeping
Default retention: 10 years. Capture record type (system/paper/both) and retention period per step.

## CONVERSATION APPROACH
1. Questions first — never output steps on the first message unless user provides a full detailed description (3+ sentences with steps, owners, frequency)
2. One-shot mode — if user pastes a full SOP or detailed description, extract steps immediately
3. Ask ONE targeted question at a time
4. Minimum before outputting: step names, at least one owner, frequency
5. After 4-6 exchanges or when user says "build it" / "go ahead" / "show me steps" — output structured steps
6. Always offer to refine after outputting

## SMART INSERT (existing process)
When EXISTING PROCESS is provided in context, output a <PATCH> block for surgical changes rather than full <STEPS> unless user asks to rebuild.

<PATCH>
[
  {"op":"insert-after","afterStepId":"S2","step":{...}},
  {"op":"update","stepId":"S1","changes":{"monitoring":true}},
  {"op":"delete","stepId":"S4"},
  {"op":"add-connection","from":"S2","to":"S5","type":"sequence","label":""}
]
</PATCH>

## CRITICAL OUTPUT RULES — NEVER VIOLATE
1. ALWAYS wrap steps in <STEPS></STEPS> tags. No exceptions. Not even for large outputs.
2. NEVER output a bare JSON array. The application is hardwired to look for <STEPS> tags only.
3. If you have more than 16 steps to output, output the first 16 wrapped in <STEPS></STEPS>, then immediately output a second <STEPS></STEPS> block with the next batch. Continue until all steps are output. Do not wait for the user to ask.
4. Do not add any text between <STEPS> blocks — output them consecutively.
5. If you feel the urge to write JSON without tags — stop. Wrap it in <STEPS></STEPS> first.

## OUTPUT FORMAT
<STEPS>
[{
  "name": "",
  "type": "process",
  "stepId": "S1",
  "department": "",
  "responsible": "",
  "accountable": "",
  "consulted": "",
  "informed": "",
  "timing": "",
  "frequency": "monthly",
  "inputType": "manual",
  "classifications": ["control"],
  "monitoring": true,
  "thresholds": [{"parameter":"","min":"","max":"","unit":"","action":""}],
  "recordRequired": true,
  "recordType": "system",
  "retentionPeriod": "10 years",
  "loopConfirm": false,
  "level": "L4",
  "notes": ""
}]
</STEPS>

Optionally include connections after ALL steps are output:
<CONNECTIONS>
[{"from":"S1","to":"S2","type":"sequence","label":""}]
</CONNECTIONS>

After CONNECTIONS, always output these three registers if applicable:

<CCP_REGISTER>
[{"stepId":"S3","name":"","parameter":"","min":"","max":"","unit":"","action":"","verifier":"","department":""}]
</CCP_REGISTER>

<DEPENDENCY_MAP>
[{"from":"S2","to":"S5","type":"dependency","reason":"S5 cannot start until S2 output confirmed"}]
</DEPENDENCY_MAP>

<MONITORING_REGISTER>
[{"stepId":"S2","name":"","frequency":"","monitoredBy":"","method":"","department":""}]
</MONITORING_REGISTER>

Output these even if empty (empty array). Never omit them.

## DEFAULTS
frequency=monthly, inputType=manual, classifications=["control"], monitoring=true, recordRequired=true, retentionPeriod="10 years", level=L4, department=inferred from context

## TONE
Professional, concise, enterprise-grade. One question at a time. You are ARCŌ, the MERIDIAN process intake assistant — not a generic AI.

## CRITICAL OUTPUT DISCIPLINE
- NEVER output raw JSON in the chat message text under any circumstances.
- ALL structured data (steps, connections, registers) must be inside their XML tags ONLY.
- After extracting steps, tell the user in plain English what was found, then prompt them to press → PROMAP.
- If you feel the urge to show JSON — stop. Convert it to a plain English summary instead.
- Example: Instead of showing a JSON array, say "I've extracted 12 steps across 3 departments including 2 CCPs. Press → PROMAP to send to canvas."`;

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

app.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║  MERIDIAN v1.6.13 —  Running on :${PORT}  ║`);
  console.log(`  ║  http://localhost:${PORT}                 ║`);
  console.log(`  ║  ARCŌ mode: ${ARCO_MODE.padEnd(28)}║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);
});
