/* ═══════════════════════════════════════════════
   MERIDIAN — ARCŌ Conversational Intake v1.6.13
   Updated: 2026-06-25
   ═══════════════════════════════════════════════ */

const ARCO = {
  messages: [],
  extractedSteps: [],
  extractedConnections: [],
  extractedPatch: null,
  currentProcess: null,
  mode: 'mock',
  cortexReport: null,
  processContext: null,
  ccpRegister: [],
  dependencyMap: [],
  monitoringRegister: [],
};

// ── BUS INTEGRATION ───────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (typeof MeridianBus === 'undefined') return;
  MeridianBus.on('cortex:evaluation-complete', (report) => {
    ARCO.cortexReport = report;
  });
  MeridianBus.on('promap:process-loaded', ({ process, nodes, connections }) => {
    ARCO.currentProcess = process;
    if (!nodes || !nodes.length) { ARCO.processContext = null; return; }
    _buildProcessContext(process, nodes, connections);
  });
});

function _buildProcessContext(process, nodes, connections) {
  const functional = nodes.filter(n => !['start','end'].includes(n.type));
  const summary = functional.map(n =>
    `${n.stepId||n.id}: ${n.name} [${n.type}] dept:${n.department||'?'} R:${n.responsible||'?'} A:${n.accountable||'?'} freq:${n.frequency||'?'}`
  ).join('\n');
  const connSummary = (connections||[]).map(c => {
    const from = nodes.find(x=>x.id===c.from);
    const to   = nodes.find(x=>x.id===c.to);
    return `${from?.name||c.from} → ${to?.name||c.to} [${c.type||'sequence'}]`;
  }).join('\n');
  ARCO.processContext = `EXISTING PROCESS: "${process.name}" (${process.processId||'—'})\nSTEPS:\n${summary}\nCONNECTIONS:\n${connSummary||'None'}`;
  ARCO.currentProcess = process;
}

// ── MOCK RESPONSES ────────────────────────────────
const MOCK_RESPONSES = [
  {
    trigger: /start|begin|new|process|describe/i,
    reply: `Welcome. I'm ARCŌ.\n\nTell me about the process you want to design. What does it do, where does it start, and where does it end?`
  },
  {
    trigger: /invoice|payment|accounts|payable|ap\b/i,
    reply: `Accounts Payable flow — key steps:\n\n1. Invoice receipt and logging\n2. Three-way matching (PO, GRN, Invoice)\n3. Approval routing\n4. Payment scheduling\n5. Archiving\n\n**Who is responsible for the three-way match?** This is likely a Critical Control Point.`
  },
  {
    trigger: /who|responsible|owner|person|team/i,
    reply: `Noted. **How frequently does this process run?** Daily, per invoice, weekly batch, or event-triggered?`
  },
  {
    trigger: /daily|weekly|monthly|batch|per invoice|event/i,
    reply: `Understood. Two more:\n\n1. Any compliance or regulatory requirements?\n2. What happens when the three-way match fails?`
  },
  {
    trigger: /record|audit|retain|compliance|regulatory/i,
    reply: `Good. Here's what I've extracted — push to PROMAP when ready.\n\n<STEPS>\n[{"name":"Start","type":"start","stepId":"","department":"","responsible":"","accountable":"","consulted":"","informed":"","timing":"","frequency":"","inputType":"manual","classifications":[],"monitoring":false,"thresholds":[],"recordRequired":false,"recordType":"system","retentionPeriod":"","loopConfirm":false,"level":"L4","notes":""},{"name":"Invoice Receipt & Logging","type":"process","stepId":"S1","department":"Finance","responsible":"AP Clerk","accountable":"Finance Manager","consulted":"","informed":"","timing":"09:00","frequency":"daily","inputType":"both","classifications":["control"],"monitoring":true,"thresholds":[],"recordRequired":true,"recordType":"system","retentionPeriod":"10 years","loopConfirm":false,"level":"L4","notes":"Extract from billing inbox, log to ERP"},{"name":"Three-Way Match","type":"ccp","stepId":"S2","department":"Finance","responsible":"AP Clerk","accountable":"Finance Manager","consulted":"Procurement","informed":"","timing":"","frequency":"per-event","inputType":"manual","classifications":["control","compliance-internal"],"monitoring":true,"thresholds":[{"parameter":"Price variance","min":"0","max":"5","unit":"%","action":"Hold invoice, contact Procurement"}],"recordRequired":true,"recordType":"system","retentionPeriod":"10 years","loopConfirm":true,"level":"L4","notes":"Match PO, GRN, Invoice"},{"name":"Match OK?","type":"decision","stepId":"S3","department":"Finance","responsible":"","accountable":"","consulted":"","informed":"","timing":"","frequency":"","inputType":"manual","classifications":[],"monitoring":false,"thresholds":[],"recordRequired":false,"recordType":"system","retentionPeriod":"","loopConfirm":false,"level":"L4","notes":"YES → Approval | NO → Exception"},{"name":"Approval Routing","type":"process","stepId":"S4","department":"Finance","responsible":"Dept Head","accountable":"Finance Manager","consulted":"","informed":"Treasury","timing":"","frequency":"per-event","inputType":"manual","classifications":["control"],"monitoring":false,"thresholds":[],"recordRequired":false,"recordType":"system","retentionPeriod":"","loopConfirm":false,"level":"L4","notes":""},{"name":"Payment Scheduling","type":"system","stepId":"S5","department":"Treasury","responsible":"Treasury","accountable":"Finance Manager","consulted":"","informed":"","timing":"Thursday 08:00","frequency":"weekly","inputType":"system","classifications":["control"],"monitoring":true,"thresholds":[],"recordRequired":true,"recordType":"system","retentionPeriod":"10 years","loopConfirm":false,"level":"L4","notes":"Weekly batch"},{"name":"Archive","type":"compliance","stepId":"S6","department":"Finance","responsible":"AP Clerk","accountable":"Finance Manager","consulted":"","informed":"","timing":"","frequency":"per-event","inputType":"system","classifications":["compliance-internal","compliance-regulatory"],"monitoring":false,"thresholds":[],"recordRequired":true,"recordType":"both","retentionPeriod":"10 years","loopConfirm":false,"level":"L4","notes":""},{"name":"End","type":"end","stepId":"","department":"","responsible":"","accountable":"","consulted":"","informed":"","timing":"","frequency":"","inputType":"manual","classifications":[],"monitoring":false,"thresholds":[],"recordRequired":false,"recordType":"system","retentionPeriod":"","loopConfirm":false,"level":"L4","notes":""}]\n</STEPS>`
  },
];

function getMockReply(userMsg) {
  for (const m of MOCK_RESPONSES) {
    if (m.trigger.test(userMsg)) return m.reply;
  }
  return `Understood. Who owns this step and how frequently does it run?`;
}

// ── LIVE API CALL ─────────────────────────────────
async function callClaudeAPI(messages) {
  const cortexContext = ARCO.cortexReport && !ARCO.cortexReport.notApplicable
    ? `CORTEX EVALUATION: Health ${ARCO.cortexReport.healthScore}%, ${ARCO.cortexReport.riskFlags.length} flags, ${ARCO.cortexReport.sodFlags.length} SoD issues`
    : '';
  const processContext = ARCO.processContext || '';
  const res = await fetch('/api/arco/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, cortexContext, processContext })
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  return data.reply;
}

// ── EXTRACT STEPS ─────────────────────────────────
function extractStepsFromReply(reply) {
  if (!reply) return null;
  const allTagged = [...reply.matchAll(/<STEPS>([\s\S]*?)<\/STEPS>/g)];
  if (allTagged.length > 0) {
    const allSteps = [];
    allTagged.forEach(match => {
      try { const p=JSON.parse(match[1].trim()); if (Array.isArray(p)) allSteps.push(...p); } catch(e) {}
    });
    if (allSteps.length > 0) return allSteps;
  }
  // Repair: truncated response
  const openIdx = reply.indexOf('<STEPS>');
  if (openIdx !== -1) {
    const afterTag = reply.slice(openIdx + 7);
    const bracketStart = afterTag.indexOf('[');
    if (bracketStart !== -1) {
      const str = afterTag.slice(bracketStart);
      let depth=0, end=-1;
      for (let i=0;i<str.length;i++) {
        if (str[i]==='[') depth++;
        else if (str[i]===']') { depth--; if (depth===0) { end=i; break; } }
      }
      if (end !== -1) {
        try { const p=JSON.parse(str.slice(0,end+1)); if (Array.isArray(p)&&p.length&&p[0]?.name) return p; } catch(e) {}
      }
    }
  }
  return null;
}

function extractConnectionsFromReply(reply) {
  if (!reply) return null;
  const match = reply.match(/<CONNECTIONS>([\s\S]*?)<\/CONNECTIONS>/);
  if (!match) return null;
  try { return JSON.parse(match[1].trim()); } catch(e) { return null; }
}

function extractPatchFromReply(reply) {
  if (!reply) return null;
  const match = reply.match(/<PATCH>([\s\S]*?)<\/PATCH>/);
  if (!match) return null;
  try { return JSON.parse(match[1].trim()); } catch(e) { return null; }
}

// Filter bare JSON from display
function filterDisplayReply(reply) {
  if (!reply) return '';
  let out = reply
    .replace(/<STEPS>[\s\S]*?<\/STEPS>/g, '')
    .replace(/<PATCH>[\s\S]*?<\/PATCH>/g, '')
    .replace(/<CONNECTIONS>[\s\S]*?<\/CONNECTIONS>/g, '')
    .trim();
  // Strip bare JSON arrays that leaked through
  out = out.replace(/^\s*\[[\s\S]*?\]\s*$/m, '').trim();
  return out;
}

// Build registers from extracted steps
function buildRegisters(steps) {
  ARCO.ccpRegister = steps.filter(s => s.type === 'ccp').map(s => ({
    stepId: s.stepId, name: s.name, thresholds: s.thresholds||[], department: s.department||''
  }));
  ARCO.dependencyMap = steps.filter(s => s.loopConfirm || s.type === 'handoff').map(s => ({
    stepId: s.stepId, name: s.name, type: s.type
  }));
  ARCO.monitoringRegister = steps.filter(s => s.monitoring).map(s => ({
    stepId: s.stepId, name: s.name, frequency: s.frequency||'', department: s.department||''
  }));
}

// ── STOP CONTROLLER ──────────────────────────────
let arcoAbortController = null;

function arcoStop() {
  if (arcoAbortController) { arcoAbortController.abort(); arcoAbortController = null; }
  const stopBtn = document.getElementById('arco-stop-btn');
  const sendBtn = document.querySelector('.arco-send-btn');
  if (stopBtn) stopBtn.style.display = 'none';
  if (sendBtn) sendBtn.disabled = false;
  removeTyping(window._arcoTypingId);
  appendMessage('assistant', 'Stopped.');
}

// ── SEND MESSAGE ──────────────────────────────────
async function arcoSend() {
  syncProcessContext();
  const input = document.getElementById('arco-input');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = ''; autoResizeTextarea(input);

  appendMessage('user', msg);
  ARCO.messages.push({ role:'user', content:msg });

  const stopBtn = document.getElementById('arco-stop-btn');
  const sendBtn = document.querySelector('.arco-send-btn');
  if (stopBtn) stopBtn.style.display = '';
  if (sendBtn) sendBtn.disabled = true;

  const typingId = showTyping();
  window._arcoTypingId = typingId;
  arcoAbortController = new AbortController();

  let reply;
  try {
    reply = await callClaudeAPI(ARCO.messages);
  } catch(e) {
    reply = e.name === 'AbortError' ? null : `I encountered an error: ${e.message}`;
  } finally {
    if (stopBtn) stopBtn.style.display = 'none';
    if (sendBtn) sendBtn.disabled = false;
    arcoAbortController = null;
  }

  removeTyping(typingId);
  if (!reply) return;

  ARCO.messages.push({ role:'assistant', content:reply });

  const steps = extractStepsFromReply(reply);
  const patch = extractPatchFromReply(reply);
  const connections = extractConnectionsFromReply(reply);
  const displayReply = filterDisplayReply(reply);

  appendMessage('assistant', displayReply || (steps ? `✓ ${steps.filter(s=>!['start','end'].includes(s.type)).length} steps extracted. Push to PROMAP when ready.` : ''));

  if (steps) {
    ARCO.extractedSteps = steps;
    ARCO.extractedConnections = connections || [];
    buildRegisters(steps);
    showExtractedSteps(steps);
  }
  if (patch) {
    ARCO.extractedPatch = patch;
    if (typeof MeridianBus !== 'undefined') MeridianBus.emit('arco:patch-proposed', { patch });
  }
}

// ── SEND TO PROMAP ────────────────────────────────
function sendToPromap() {
  if (!ARCO.extractedSteps || !ARCO.extractedSteps.length) {
    if (typeof notify === 'function') notify('No steps extracted yet.', 'error');
    return;
  }
  if (!window.State || !window.State.currentProcess) {
    // N58: create process automatically with confirmation
    if (typeof notify === 'function') notify('No process selected — create one first.', 'error');
    if (typeof newProcess === 'function') newProcess();
    return;
  }

  const existingStepIds = new Set(State.nodes.map(n => n.stepId).filter(Boolean)
    .filter(id => id !== ''));
  const incoming = ARCO.extractedSteps;
  const duplicates = incoming.filter(s => s.stepId && existingStepIds.has(s.stepId));

  if (duplicates.length > 0 && State.nodes.length > 0) {
    const confirmEl = document.getElementById('modal-confirm');
    const msgEl = document.getElementById('confirm-msg');
    const titleEl = document.getElementById('confirm-title');
    if (confirmEl && msgEl) {
      if (titleEl) titleEl.textContent = 'SEND TO PROMAP';
      msgEl.textContent = `Canvas has ${State.nodes.length} steps. ${duplicates.length} overlap — replace all or add new only?`;
      const okBtn = confirmEl.querySelector('.hdr-btn.warn');
      const cancelBtn = confirmEl.querySelector('.hdr-btn:not(.warn)');
      if (okBtn) { okBtn.textContent = 'REPLACE ALL'; okBtn.onclick = () => { closeModal('modal-confirm'); doInsertToPromap(true); }; }
      if (cancelBtn) { cancelBtn.textContent = 'ADD NEW ONLY'; cancelBtn.onclick = () => { closeModal('modal-confirm'); doInsertToPromap(false); }; }
      confirmEl.style.display = 'flex';
    } else {
      doInsertToPromap(false);
    }
    return;
  }
  doInsertToPromap(false);
}

function doInsertToPromap(replaceAll) {
  if (typeof pushUndo === 'function') pushUndo();

  if (replaceAll) { State.nodes = []; State.connections = []; State.nodeCounter = 0; }

  const existingStepIds = new Set(State.nodes.map(n => n.stepId).filter(s => s && s !== ''));
  const stepsToInsert = replaceAll
    ? ARCO.extractedSteps
    : ARCO.extractedSteps.filter(s => !s.stepId || !existingStepIds.has(s.stepId));

  // Dedup start/end: only one of each allowed
  const hasStart = State.nodes.some(n => n.type === 'start');
  const hasEnd   = State.nodes.some(n => n.type === 'end');
  const filtered = stepsToInsert.filter(s => {
    if (s.type === 'start' && hasStart && !replaceAll) return false;
    if (s.type === 'end'   && hasEnd   && !replaceAll) return false;
    return true;
  });

  if (!filtered.length) {
    if (typeof notify === 'function') notify('No new steps to add.', 'info');
    return;
  }

  const idMap = {};
  const insertStart = State.nodes.length;

  filtered.forEach(step => {
    State.nodeCounter++;
    const id = `N-${String(State.nodeCounter).padStart(3,'0')}`;
    if (step.stepId) idMap[step.stepId] = id;
    State.nodes.push({
      id, ...step,
      x: 0, y: 0,
      stepId: step.stepId || (step.type==='start'||step.type==='end' ? '' : id),
      level: step.level || 'L4',
      department: step.department || '',
      classifications: step.classifications || [],
      thresholds: step.thresholds || [],
    });
  });

  // Connections
  const conns = ARCO.extractedConnections;
  if (conns && conns.length) {
    conns.forEach((c,i) => {
      const from = idMap[c.from] || c.from;
      const to   = idMap[c.to]   || c.to;
      if (from && to) State.connections.push({ id:'C-'+Date.now()+i, from, to, type:c.type||'sequence', label:c.label||'' });
    });
  } else if (replaceAll || insertStart === 0) {
    // Auto-sequential
    for (let i=insertStart; i<State.nodes.length-1; i++) {
      State.connections.push({ id:'C-'+Date.now()+i, from:State.nodes[i].id, to:State.nodes[i+1].id, type:'sequence', label:'' });
    }
  }

  State.dirty = true;
  const es = document.getElementById('empty-state');
  if (es) es.style.display = 'none';

  // LAY-12 FIX: delegate positioning entirely to autoLayout with two-pass
  if (typeof autoLayout === 'function') autoLayout();
  if (typeof switchToPromap === 'function') switchToPromap();
  if (typeof notify === 'function') notify(`${filtered.length} steps sent to PROMAP`, 'success');
  appendMessage('assistant', `✓ ${filtered.filter(s=>!['start','end'].includes(s.type)).length} steps sent to PROMAP canvas.`);

  // Refresh panel
  showExtractedSteps(ARCO.extractedSteps);

  if (typeof MeridianBus !== 'undefined')
    MeridianBus.emit('arco:steps-sent-to-promap', { count: filtered.length });
}

function switchToPromap() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(t => t.classList.remove('active'));
  if (tabs[0]) tabs[0].classList.add('active');
  const arcoView = document.getElementById('arco-view');
  const promapView = document.getElementById('promap-view');
  const sidebarPromap = document.getElementById('sidebar-promap');
  const sidebarArco = document.getElementById('sidebar-arco');
  if (arcoView) arcoView.style.display = 'none';
  if (promapView) promapView.style.display = 'flex';
  if (sidebarPromap) sidebarPromap.style.display = '';
  if (sidebarArco) sidebarArco.style.display = 'none';
}

// ── UI HELPERS ────────────────────────────────────
function appendMessage(role, text, steps) {
  const feed = document.getElementById('arco-feed');
  if (!feed) return;
  const div = document.createElement('div');
  div.className = `arco-msg arco-${role}`;
  const html = (text||'')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>');
  const now = new Date();
  const ts = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
  div.innerHTML = `
    <div class="arco-bubble">
      ${role==='assistant'?'<div class="arco-avatar">ARCŌ</div>':''}
      <div class="arco-text">${html}</div>
      <div style="font-size:10px;color:var(--text2);margin-top:4px;text-align:${role==='assistant'?'left':'right'};padding:0 2px;">${ts}</div>
    </div>`;
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
}

function showTyping() {
  const feed = document.getElementById('arco-feed');
  if (!feed) return '';
  const div = document.createElement('div');
  const uid = 'typing-' + Date.now();
  div.id = uid;
  div.className = 'arco-msg arco-assistant';
  div.innerHTML = `<div class="arco-bubble"><div class="arco-avatar">ARCŌ</div><div class="arco-typing"><span></span><span></span><span></span></div></div>`;
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
  return uid;
}

function removeTyping(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function showExtractedSteps(steps) {
  const panel   = document.getElementById('arco-extracted');
  const hints   = document.getElementById('arco-hints');
  if (hints) hints.style.display = 'none';

  ['arco-send-promap','float-arco-send-promap'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) { btn.style.opacity='1'; btn.style.cursor='pointer'; }
  });

  if (!panel) return;
  const functional = steps.filter(s => !['start','end'].includes(s.type));
  const ccpCount = steps.filter(s => s.type==='ccp').length;
  const ctrlCount = steps.filter(s => s.type==='control').length;

  panel.innerHTML = `
    <div class="arco-extracted-header">
      <span>${functional.length} steps · ${ctrlCount} ctrl · ${ccpCount} CCP</span>
      <button class="hdr-btn success" onclick="sendToPromap()">→ PROMAP</button>
    </div>
    <div class="arco-step-list">
      ${functional.map((s,i) => `
        <div class="arco-step-item">
          <span class="arco-step-num">${i+1}</span>
          <div class="arco-step-info">
            <div class="arco-step-name">${s.name}</div>
            <div class="arco-step-meta">${s.type.toUpperCase()} · ${s.department||s.responsible||'—'} · ${s.frequency||'—'}</div>
          </div>
          <span class="arco-step-type-badge" style="color:${typeColor(s.type)};">${s.type}</span>
        </div>`).join('')}
    </div>
    ${ARCO.ccpRegister.length ? `
    <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border);">
      <div style="font-size:10px;color:var(--coral);letter-spacing:.08em;margin-bottom:5px;">CCP REGISTER</div>
      ${ARCO.ccpRegister.map(c=>`<div style="font-size:11px;color:var(--text1);padding:2px 0;">⬡ ${c.name} [${c.stepId||'—'}]</div>`).join('')}
    </div>`:'' }
    ${ARCO.dependencyMap.length ? `
    <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">
      <div style="font-size:10px;color:var(--amber);letter-spacing:.08em;margin-bottom:5px;">DEPENDENCY / HANDOFF</div>
      ${ARCO.dependencyMap.map(d=>`<div style="font-size:11px;color:var(--text1);padding:2px 0;">→ ${d.name} [${d.type}]</div>`).join('')}
    </div>`:'' }
    ${ARCO.monitoringRegister.length ? `
    <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">
      <div style="font-size:10px;color:var(--violet);letter-spacing:.08em;margin-bottom:5px;">SMART MONITORING (${ARCO.monitoringRegister.length})</div>
      ${ARCO.monitoringRegister.map(m=>`<div style="font-size:11px;color:var(--text1);padding:2px 0;">◉ ${m.name} · ${m.frequency||'—'}</div>`).join('')}
    </div>`:'' }
  `;
  panel.style.display = 'block';
}

function typeColor(type) {
  const map = { process:'var(--teal)', control:'var(--amber)', ccp:'#ff6b35', compliance:'var(--green)', system:'var(--blue)', handoff:'var(--violet)', decision:'var(--amber)' };
  return map[type] || 'var(--text1)';
}

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function arcoKeydown(e) {
  if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); arcoSend(); }
}

function arcoReset() {
  ARCO.messages = [];
  ARCO.extractedSteps = [];
  ARCO.extractedConnections = [];
  ARCO.extractedPatch = null;
  ARCO.ccpRegister = [];
  ARCO.dependencyMap = [];
  ARCO.monitoringRegister = [];
  const feed = document.getElementById('arco-feed');
  if (feed) feed.innerHTML = '';
  const extracted = document.getElementById('arco-extracted');
  if (extracted) { extracted.style.display = 'none'; extracted.innerHTML = ''; }
  ['arco-send-promap','float-arco-send-promap'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) { btn.style.opacity='.35'; btn.style.cursor='not-allowed'; }
  });
  const hints = document.getElementById('arco-hints');
  if (hints) hints.style.display = '';
  arcoGreet();
}

function syncProcessContext() {
  if (!window.State || !window.State.currentProcess) { ARCO.processContext = null; return; }
  const process = window.State.currentProcess;
  const nodes = window.State.nodes || [];
  const connections = window.State.connections || [];
  if (!nodes.length) { ARCO.processContext = null; return; }
  _buildProcessContext(process, nodes, connections);
}

function arcoGreet() {
  syncProcessContext();
  const ctx = ARCO.processContext
    ? `Hello. I'm **ARCŌ**. I can see **${ARCO.currentProcess?.name}** is loaded with ${(window.State?.nodes||[]).filter(n=>!['start','end'].includes(n.type)).length} steps.\n\nWhat would you like to do — review, improve, or add to this process?`
    : `Hello. I'm **ARCŌ** — your process intake assistant.\n\nDescribe any business process and I'll extract the steps, identify control points, flag risks, and build it into your PROMAP canvas.\n\n**What process would you like to design today?**`;
  appendMessage('assistant', ctx);
}

// ── UPLOAD HANDLER ────────────────────────────────
function handleArcoFileSelect(event) {
  const file = event.target.files[0];
  if (file) processArcoUpload(file);
}

function handleArcoFileDrop(event) {
  event.preventDefault();
  const zone = document.getElementById('arco-upload-zone');
  if (zone) { zone.style.borderColor='var(--border)'; zone.style.background=''; }
  const file = event.dataTransfer.files[0];
  if (file) processArcoUpload(file);
}

async function processArcoUpload(file) {
  if (typeof notify === 'function') notify(`Reading ${file.name}...`, 'info');
  const name = file.name.toLowerCase();

  if (name.endsWith('.txt')) {
    const text = await file.text();
    const msg = `I've uploaded "${file.name}". Please extract the process steps:\n\n${text.slice(0, 8000)}`;
    await _arcoProcessUploadedText(msg, file.name);
  } else {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/arco/upload', { method:'POST', body:formData });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      const msg = `I've uploaded "${file.name}". Please extract the process steps:\n\n${data.text.slice(0, 8000)}`;
      await _arcoProcessUploadedText(msg, file.name);
    } catch(e) {
      if (typeof notify === 'function') notify(`Upload error: ${e.message}`, 'error');
    }
  }
}

async function _arcoProcessUploadedText(msg, filename) {
  ARCO.messages.push({ role:'user', content:msg });
  appendMessage('user', `📄 Uploaded: ${filename}`);
  const typingId = showTyping();
  let reply;
  try { reply = await callClaudeAPI(ARCO.messages); } catch(e) { reply = `Error: ${e.message}`; }
  removeTyping(typingId);
  ARCO.messages.push({ role:'assistant', content:reply });
  const steps = extractStepsFromReply(reply);
  const display = filterDisplayReply(reply);
  if (steps) { ARCO.extractedSteps = steps; ARCO.extractedConnections = extractConnectionsFromReply(reply)||[]; buildRegisters(steps); showExtractedSteps(steps); }
  appendMessage('assistant', display || (steps ? `✓ ${steps.filter(s=>!['start','end'].includes(s.type)).length} steps extracted from document.` : 'Could not extract steps from this document.'));
}

// ── FLOAT PANEL ARCŌ (shared session) ────────────
function appendFloatArcoMsg(role, text) {
  // Float panel shares session with main ARCŌ tab
  const feed = document.getElementById('float-arco-feed');
  if (!feed) return;
  const div = document.createElement('div');
  div.className = `arco-msg arco-${role}`;
  const html = (text||'').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br/>');
  div.innerHTML = `<div class="arco-bubble"><div class="arco-text" style="font-size:12px;">${html}</div></div>`;
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
  // Mirror to main feed
  appendMessage(role, text);
}

async function floatArcoSend() {
  const input = document.getElementById('float-arco-input');
  if (!input) return;
  const msg = input.value.trim();
  if (!msg) return;
  input.value = ''; autoResizeTextarea(input);
  appendFloatArcoMsg('user', msg);
  ARCO.messages.push({ role:'user', content:msg });
  let reply;
  try { reply = await callClaudeAPI(ARCO.messages); } catch(e) { reply = `Error: ${e.message}`; }
  ARCO.messages.push({ role:'assistant', content:reply });
  const steps = extractStepsFromReply(reply);
  const display = filterDisplayReply(reply);
  if (steps) { ARCO.extractedSteps=steps; ARCO.extractedConnections=extractConnectionsFromReply(reply)||[]; buildRegisters(steps); showExtractedSteps(steps); }
  appendFloatArcoMsg('assistant', display + (steps ? `\n\n**${steps.filter(s=>!['start','end'].includes(s.type)).length} steps ready** — use → PROMAP to send.` : ''));
}

function floatArcoKeydown(e) {
  if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); floatArcoSend(); }
}

// ── INIT ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  fetch('/api/health').then(r=>r.json()).then(d=>{
    ARCO.mode = d.arcoMode || 'mock';
  }).catch(()=>{});
});
