/* ═══════════════════════════════════════════════
   MERIDIAN — ARCŌ Conversational Intake v1.6.13
   v1.6.13: LAY-12 two-pass layout on ARCŌ insert (DOM timing fix)
   ═══════════════════════════════════════════════ */

const ARCO = {
  messages: [],
  extractedSteps: [],
  extractedConnections: [],
  extractedPatch: null,
  ccpRegister: [],
  dependencyMap: [],
  monitoringRegister: [],
  currentProcess: null,
  apiKey: null,
  mode: 'mock',
  cortexReport: null,
  processContext: null,
};

// ── BUS INTEGRATION ───────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (typeof MeridianBus === 'undefined') return;
  MeridianBus.on('cortex:evaluation-complete', (report) => {
    ARCO.cortexReport = report;
  });
  MeridianBus.on('promap:process-loaded', ({ process, nodes, connections }) => {
    ARCO.currentProcess = process;
    if (!nodes || !nodes.length) return;
    const functional = nodes.filter(n => !['start','end'].includes(n.type));
    const summary = functional.map(n =>
      `${n.stepId||n.id}: ${n.name} [${n.type}] R:${n.responsible||'?'} A:${n.accountable||'?'} freq:${n.frequency||'?'}`
    ).join('\n');
    const connSummary = (connections||[]).map(c => {
      const from = nodes.find(x=>x.id===c.from); const to = nodes.find(x=>x.id===c.to);
      return `${from?.name||c.from} → ${to?.name||c.to} [${c.type||'sequence'}]`;
    }).join('\n');
    ARCO.processContext = `EXISTING PROCESS: "${process.name}" (${process.processId||'—'})\nSTEPS:\n${summary}\nCONNECTIONS:\n${connSummary||'None'}`;
  });
});

// ── MOCK RESPONSES ────────────────────────────────
const MOCK_RESPONSES = [
  {
    trigger: /start|begin|new|process|describe/i,
    reply: `Welcome. I'm ARCŌ — I'll help you build this process step by step.\n\nTell me about the process you want to design. Describe it in your own words — what it does, where it starts, and where it ends.`
  },
  {
    trigger: /invoice|payment|accounts|payable|ap\b/i,
    reply: `Good — that's an Accounts Payable flow. A few key steps I can see:\n\n1. Invoice receipt and logging\n2. Three-way matching (PO, GRN, Invoice)\n3. Approval routing\n4. Payment scheduling\n5. Archiving\n\n**Who is responsible for the three-way match?** This is likely a Critical Control Point.`
  },
  {
    trigger: /who|responsible|owner|person|team|clerk|manager/i,
    reply: `Noted. Now — **how frequently does this process run?** Daily, per invoice, weekly batch, or event-triggered?`
  },
  {
    trigger: /daily|weekly|monthly|batch|per invoice|event/i,
    reply: `Understood. Two more:\n\n1. **Any compliance or regulatory requirements** — e.g. audit trail, record retention?\n2. **What happens when the three-way match fails?**`
  },
  {
    trigger: /record|audit|retain|compliance|regulatory|7 year|years/i,
    reply: `Good. Here's what I've extracted:\n\n<STEPS>\n[\n  {"name":"Start","type":"start","stepId":"","responsible":"","accountable":"","consulted":"","informed":"","timing":"","frequency":"","inputType":"manual","classifications":[],"monitoring":false,"thresholds":[],"recordRequired":false,"recordType":"system","retentionPeriod":"","loopConfirm":false,"level":"L4","notes":""},\n  {"name":"Invoice Receipt & Logging","type":"process","stepId":"S1","responsible":"AP Clerk","accountable":"Finance Manager","consulted":"","informed":"","timing":"09:00","frequency":"daily","inputType":"both","classifications":["control"],"monitoring":true,"thresholds":[],"recordRequired":true,"recordType":"system","retentionPeriod":"7 years","loopConfirm":false,"level":"L4","notes":"Extract from billing inbox, log to ERP"},\n  {"name":"Three-Way Match","type":"ccp","stepId":"S2","responsible":"AP Clerk","accountable":"Finance Manager","consulted":"Procurement","informed":"","timing":"","frequency":"per-event","inputType":"manual","classifications":["control","compliance-internal"],"monitoring":true,"thresholds":[{"parameter":"Price variance","min":"0","max":"5","unit":"%","action":"Hold invoice, contact Procurement"}],"recordRequired":true,"recordType":"system","retentionPeriod":"7 years","loopConfirm":true,"level":"L4","notes":"Match PO, GRN, Invoice"},\n  {"name":"Match OK?","type":"decision","stepId":"S3","responsible":"","accountable":"","consulted":"","informed":"","timing":"","frequency":"","inputType":"manual","classifications":[],"monitoring":false,"thresholds":[],"recordRequired":false,"recordType":"system","retentionPeriod":"","loopConfirm":false,"level":"L4","notes":"YES → Approval | NO → Exception"},\n  {"name":"Approval Routing","type":"process","stepId":"S4","responsible":"Dept Head","accountable":"Finance Manager","consulted":"","informed":"Treasury","timing":"","frequency":"per-event","inputType":"manual","classifications":["control"],"monitoring":false,"thresholds":[],"recordRequired":false,"recordType":"system","retentionPeriod":"","loopConfirm":false,"level":"L4","notes":""},\n  {"name":"Payment Scheduling","type":"system","stepId":"S5","responsible":"Treasury","accountable":"Finance Manager","consulted":"","informed":"","timing":"Thursday 08:00","frequency":"weekly","inputType":"system","classifications":["control"],"monitoring":true,"thresholds":[],"recordRequired":true,"recordType":"system","retentionPeriod":"7 years","loopConfirm":false,"level":"L4","notes":"Weekly batch"},\n  {"name":"Archive","type":"compliance","stepId":"S6","responsible":"AP Clerk","accountable":"Finance Manager","consulted":"","informed":"","timing":"","frequency":"per-event","inputType":"system","classifications":["compliance-internal","compliance-regulatory"],"monitoring":false,"thresholds":[],"recordRequired":true,"recordType":"both","retentionPeriod":"7 years","loopConfirm":false,"level":"L4","notes":""},\n  {"name":"End","type":"end","stepId":"","responsible":"","accountable":"","consulted":"","informed":"","timing":"","frequency":"","inputType":"manual","classifications":[],"monitoring":false,"thresholds":[],"recordRequired":false,"recordType":"system","retentionPeriod":"","loopConfirm":false,"level":"L4","notes":""}\n]\n</STEPS>`
  },
];

function getMockReply(userMsg) {
  for (const m of MOCK_RESPONSES) {
    if (m.trigger.test(userMsg)) return m.reply;
  }
  return `Understood. Can you tell me more about **who owns this step** and **how frequently** it needs to run?`;
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

// ── EXTRACT STEPS FROM REPLY ──────────────────────
function extractStepsFromReply(reply) {
  if (!reply) return null;

  // Handle multiple <STEPS> blocks (auto-batching)
  const allTagged = [...reply.matchAll(/<STEPS>([\s\S]*?)<\/STEPS>/g)];
  if (allTagged.length > 0) {
    const allSteps = [];
    allTagged.forEach(match => {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (Array.isArray(parsed)) allSteps.push(...parsed);
      } catch(e) {}
    });
    if (allSteps.length > 0) return allSteps;
  }

  // Repair: <STEPS> present but </STEPS> missing — truncated response
  const openIdx = reply.indexOf('<STEPS>');
  if (openIdx !== -1) {
    const afterTag = reply.slice(openIdx + 7);
    const bracketStart = afterTag.indexOf('[');
    if (bracketStart !== -1) {
      const str = afterTag.slice(bracketStart);
      let depth = 0, end = -1;
      for (let i = 0; i < str.length; i++) {
        if (str[i] === '[') depth++;
        else if (str[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end !== -1) {
        try {
          const parsed = JSON.parse(str.slice(0, end + 1));
          if (Array.isArray(parsed) && parsed.length && parsed[0]?.name) return parsed;
        } catch(e) {}
      }
    }
  }

  // Fallback: bare JSON array — search from last "name" key
  let searchFrom = reply.lastIndexOf('"name"');
  if (searchFrom === -1) searchFrom = 0;
  const bracketPos = reply.lastIndexOf('[', searchFrom);
  if (bracketPos !== -1) {
    let depth = 0, end = -1;
    for (let i = bracketPos; i < reply.length; i++) {
      if (reply[i] === '[') depth++;
      else if (reply[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end !== -1) {
      try {
        const parsed = JSON.parse(reply.slice(bracketPos, end + 1));
        if (Array.isArray(parsed) && parsed.length && parsed[0]?.name) return parsed;
      } catch(e) {}
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

function extractCCPRegisterFromReply(reply) {
  if (!reply) return null;
  const match = reply.match(/<CCP_REGISTER>([\s\S]*?)<\/CCP_REGISTER>/);
  if (!match) return null;
  try { return JSON.parse(match[1].trim()); } catch(e) { return null; }
}

function extractDependencyMapFromReply(reply) {
  if (!reply) return null;
  const match = reply.match(/<DEPENDENCY_MAP>([\s\S]*?)<\/DEPENDENCY_MAP>/);
  if (!match) return null;
  try { return JSON.parse(match[1].trim()); } catch(e) { return null; }
}

function extractMonitoringRegisterFromReply(reply) {
  if (!reply) return null;
  const match = reply.match(/<MONITORING_REGISTER>([\s\S]*?)<\/MONITORING_REGISTER>/);
  if (!match) return null;
  try { return JSON.parse(match[1].trim()); } catch(e) { return null; }
}

function extractPatchFromReply(reply) {
  if (!reply) return null;
  const match = reply.match(/<PATCH>([\s\S]*?)<\/PATCH>/);
  if (!match) return null;
  try { return JSON.parse(match[1].trim()); } catch(e) { return null; }
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
  input.value = '';
  autoResizeTextarea(input);

  appendMessage('user', msg);
  ARCO.messages.push({ role: 'user', content: msg });

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

  ARCO.messages.push({ role: 'assistant', content: reply });

  const steps = extractStepsFromReply(reply);
  const patch = extractPatchFromReply(reply);
  const connections = extractConnectionsFromReply(reply);
  const ccpRegister = extractCCPRegisterFromReply(reply);
  const dependencyMap = extractDependencyMapFromReply(reply);
  const monitoringRegister = extractMonitoringRegisterFromReply(reply);

  const displayReply = reply
    .replace(/<STEPS>[\s\S]*?<\/STEPS>/g, '')
    .replace(/<PATCH>[\s\S]*?<\/PATCH>/g, '')
    .replace(/<CONNECTIONS>[\s\S]*?<\/CONNECTIONS>/g, '')
    .replace(/<CCP_REGISTER>[\s\S]*?<\/CCP_REGISTER>/g, '')
    .replace(/<DEPENDENCY_MAP>[\s\S]*?<\/DEPENDENCY_MAP>/g, '')
    .replace(/<MONITORING_REGISTER>[\s\S]*?<\/MONITORING_REGISTER>/g, '')
    .replace(/```json[\s\S]*?```/g, '')
    .replace(/\[\s*\{[\s\S]*?\}\s*\]/g, '')
    .trim();

  const nudge = steps && steps.length
    ? `\n\n✓ **${steps.filter(s=>!['start','end'].includes(s.type)).length} steps ready** — press → PROMAP to send to canvas.`
    : '';

  appendMessage('assistant', (displayReply || '✓ Steps extracted.') + nudge, steps);

  if (steps && steps.length) {
    let anonCounter = 0;
    const existingById = {};
    (ARCO.extractedSteps || []).forEach(s => {
      const key = s.stepId || `_anon_${s.type}_${s.name}_${anonCounter++}`;
      existingById[key] = s;
    });
    steps.forEach(s => {
      const key = s.stepId || `_anon_${s.type}_${s.name}_${anonCounter++}`;
      existingById[key] = s;
    });
    ARCO.extractedSteps = Object.values(existingById);
    if (connections && connections.length) ARCO.extractedConnections = connections;
    if (ccpRegister) ARCO.ccpRegister = ccpRegister;
    if (dependencyMap) ARCO.dependencyMap = dependencyMap;
    if (monitoringRegister) ARCO.monitoringRegister = monitoringRegister;
    showExtractedSteps(ARCO.extractedSteps);
  }
  if (patch) {
    ARCO.extractedPatch = patch;
    if (typeof MeridianBus !== 'undefined') MeridianBus.emit('arco:patch-proposed', { patch });
  }
}

// ── SEND TO PROMAP ────────────────────────────────
function sendToPromap() {
  // OBS-02 fix: trust ARCO.extractedSteps — already merged/deduped in arcoSend.
  // Do NOT re-scan full message history here; that caused PROMAP count to diverge
  // from what the panel shows (panel = source of truth for what user sees and confirms).

  if (!ARCO.extractedSteps || !ARCO.extractedSteps.length) {
    if (typeof notify === 'function') notify('No steps found — ask ARCŌ to build the process first.', 'error');
    return;
  }

  if (!window.State || !window.State.currentProcess) {
    // N58: offer to create a new process rather than just erroring
    const suggested = ARCO.extractedSteps && ARCO.extractedSteps[0]
      ? ARCO.extractedSteps.find(s => s.type !== 'start' && s.type !== 'end')?.name || 'New Process'
      : 'New Process';
    if (typeof notify === 'function') notify('No process loaded — creating one now...', 'info');
    if (typeof newProcess === 'function') {
      // Pre-fill name from first extracted step context
      setTimeout(() => {
        const nameEl = document.getElementById('np-name');
        if (nameEl) nameEl.value = suggested;
        newProcess();
      }, 100);
    }
    return;
  }

  // BUG-03/04 fix — detect duplicates
  const existingStepIds = new Set(State.nodes.map(n => n.stepId).filter(Boolean));
  const incoming = ARCO.extractedSteps;
  const duplicates = incoming.filter(s => s.stepId && existingStepIds.has(s.stepId));

  if (duplicates.length > 0 && State.nodes.length > 0) {
    // Ask user: replace all or append new only
    const msg = `Canvas already has ${State.nodes.length} steps. ${duplicates.length} incoming step(s) overlap.\n\nReplace all existing steps, or add new steps only?`;
    State.confirmCallback = () => doInsertToPromap(true);
    State.confirmCancelCallback = () => doInsertToPromap(false);
    // Use confirm dialog
    const confirmEl = document.getElementById('modal-confirm');
    const msgEl = document.getElementById('confirm-msg');
    if (confirmEl && msgEl) {
      msgEl.textContent = msg;
      // Temporarily rename buttons
      const okBtn = confirmEl.querySelector('[onclick="confirmOk()"]') || confirmEl.querySelector('button.primary');
      const cancelBtn = confirmEl.querySelector('[onclick="confirmCancel()"]') || confirmEl.querySelector('button:not(.primary)');
      if (okBtn) okBtn.textContent = 'Replace All';
      if (cancelBtn) cancelBtn.textContent = 'Add New Only';
      confirmEl.style.display = 'flex';
    } else {
      // No modal — default to append new only
      doInsertToPromap(false);
    }
    return;
  }

  doInsertToPromap(false);
}

function doInsertToPromap(replaceAll) {
  if (typeof pushUndo === 'function') pushUndo();

  if (replaceAll) {
    State.nodes = [];
    State.connections = [];
    State.nodeCounter = 0;
  }

  const insertStart = State.nodes.length;
  const idMap = {};

  // Filter out duplicates when appending
  const existingStepIds = new Set(State.nodes.map(n => n.stepId).filter(Boolean));
  const stepsToInsert = replaceAll
    ? ARCO.extractedSteps
    : ARCO.extractedSteps.filter(s => !s.stepId || !existingStepIds.has(s.stepId));

  if (!stepsToInsert.length) {
    if (typeof notify === 'function') notify('No new steps to add — all steps already on canvas.', 'info');
    return;
  }

  stepsToInsert.forEach((step, i) => {
    State.nodeCounter++;
    const id = `N-${String(State.nodeCounter).padStart(3,'0')}`;
    const stepId = step.stepId || (step.type === 'start' || step.type === 'end' ? '' : id);
    if (step.stepId) idMap[step.stepId] = id;
    // x/y set to 0 — autoLayout() below is the single source of positioning
    State.nodes.push({
      id, ...step,
      x: 0, y: 0,
      stepId,
      level: step.level || 'L4',
      classifications: step.classifications || [],
      thresholds: step.thresholds || [],
    });
  });

  const conns = ARCO.extractedConnections;
  if (conns && conns.length) {
    conns.forEach((c, i) => {
      const from = idMap[c.from] || c.from;
      const to   = idMap[c.to]   || c.to;
      if (from && to) State.connections.push({ id:'C-'+Date.now()+i, from, to, type:c.type||'sequence', label:c.label||'' });
    });
  } else {
    // Auto-connect sequentially
    for (let i = 0; i < stepsToInsert.length - 1; i++) {
      const from = State.nodes[insertStart + i];
      const to   = State.nodes[insertStart + i + 1];
      if (from && to) State.connections.push({ id:'C-'+Date.now()+i, from:from.id, to:to.id, type:'sequence', label:'' });
    }
  }

  // Sort nodes by stepId numerically — fixes multi-batch sequence (S1→S2→...→S33)
  State.nodes.sort((a, b) => {
    const na = parseInt((a.stepId||a.id).replace(/\D/g,'')) || 0;
    const nb = parseInt((b.stepId||b.id).replace(/\D/g,'')) || 0;
    return na - nb;
  });

  State.dirty = true;
  if (typeof bufferAudit === 'function') {
    bufferAudit('modified', `ARCŌ sent ${stepsToInsert.length} step(s) to canvas (${replaceAll?'replace all':'append new'})`, { field:'nodes', from:replaceAll?0:insertStart, to:State.nodes.length }, 'ARCŌ');
  }
  const empty = document.getElementById('empty-state');
  if (empty) empty.style.display = 'none';
  // LAY-12: switch to PROMAP view FIRST so DOM renders nodes before autoLayout measures them
  if (typeof switchToPromap === 'function') switchToPromap();
  if (typeof renderCanvas === 'function') renderCanvas(); // initial render — nodes exist in DOM
  if (typeof autoLayout === 'function') {
    // Pass 1 — immediate (estimated sizes)
    autoLayout();
    // Pass 2 — deferred (real DOM sizes now available after first render)
    setTimeout(() => {
      if (typeof autoLayout === 'function') autoLayout();
    }, 120);
  }
  if (typeof notify === 'function') notify(`${stepsToInsert.length} steps sent to PROMAP`, 'success');
  appendMessage('assistant', `✓ ${stepsToInsert.length} steps sent to PROMAP canvas.`);
}

function switchToPromap() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(t => t.classList.remove('active'));
  if (tabs[0]) tabs[0].classList.add('active');
  const arcoView = document.getElementById('arco-view');
  const promapView = document.getElementById('promap-view');
  if (arcoView) arcoView.style.display = 'none';
  if (promapView) promapView.style.display = 'flex';
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
      ${role === 'assistant' ? '<div class="arco-avatar">ARCŌ</div>' : ''}
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
  const panel = document.getElementById('arco-extracted');
  const arcoPanel = document.getElementById('arco-panel');
  const hints = document.getElementById('arco-hints');
  if (arcoPanel) arcoPanel.style.display = 'flex';
  if (hints) hints.style.display = 'none';
  ['arco-send-promap','float-arco-send-promap'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) { btn.style.opacity='1'; btn.style.cursor='pointer'; }
  });
  if (!panel) return;
  const functional = steps.filter(s => !['start','end'].includes(s.type));
  const ccps = (ARCO.ccpRegister || []).filter(c => c.stepId);
  const deps = (ARCO.dependencyMap || []).filter(d => d.from && d.to);
  const monitored = (ARCO.monitoringRegister || []).filter(m => m.stepId);

  panel.innerHTML = `
    <div class="arco-extracted-header">
      <span>${functional.length} steps extracted</span>
      <button class="hdr-btn success" onclick="sendToPromap()">SEND TO PROMAP →</button>
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
    ${ccps.length ? `
    <div style="margin:10px 14px 0;padding:8px 10px;background:rgba(255,107,53,.08);border:1px solid #ff6b35;border-radius:4px;">
      <div style="font-size:10px;color:#ff6b35;letter-spacing:.08em;font-weight:600;margin-bottom:5px;">CCP REGISTER (${ccps.length})</div>
      ${ccps.map(c=>`<div style="font-size:11px;color:var(--text1);padding:2px 0;">${c.stepId} — ${c.name} | ${c.parameter||'—'}: ${c.min||''}–${c.max||''} ${c.unit||''}</div>`).join('')}
    </div>` : ''}
    ${deps.length ? `
    <div style="margin:8px 14px 0;padding:8px 10px;background:var(--amber-lo);border:1px solid var(--amber);border-radius:4px;">
      <div style="font-size:10px;color:var(--amber);letter-spacing:.08em;font-weight:600;margin-bottom:5px;">DEPENDENCY MAP (${deps.length})</div>
      ${deps.map(d=>`<div style="font-size:11px;color:var(--text1);padding:2px 0;">${d.from} → ${d.to}${d.reason?' | '+d.reason:''}</div>`).join('')}
    </div>` : ''}
    ${monitored.length ? `
    <div style="margin:8px 14px 10px;padding:8px 10px;background:var(--violet-lo);border:1px solid var(--violet);border-radius:4px;">
      <div style="font-size:10px;color:var(--violet);letter-spacing:.08em;font-weight:600;margin-bottom:5px;">MONITORING REGISTER (${monitored.length})</div>
      ${monitored.map(m=>`<div style="font-size:11px;color:var(--text1);padding:2px 0;">${m.stepId} — ${m.name} | ${m.frequency||'—'} | ${m.monitoredBy||'—'}</div>`).join('')}
    </div>` : ''}`;
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
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); arcoSend(); }
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
  if (extracted) extracted.style.display = 'none';
  ['arco-send-promap','float-arco-send-promap'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) { btn.style.opacity='.35'; btn.style.cursor='not-allowed'; }
  });
  const hints = document.getElementById('arco-hints');
  if (hints) hints.style.display = '';
  arcoGreet();
}

function syncProcessContext() {
  if (!window.State || !window.State.currentProcess) return;
  const process = window.State.currentProcess;
  const nodes = window.State.nodes || [];
  const connections = window.State.connections || [];
  if (!nodes.length) { ARCO.processContext = null; return; }
  const functional = nodes.filter(n => !['start','end'].includes(n.type));
  const summary = functional.map(n =>
    `${n.stepId||n.id}: ${n.name} [${n.type}] R:${n.responsible||'?'} A:${n.accountable||'?'} freq:${n.frequency||'?'}`
  ).join('\n');
  const connSummary = connections.map(c => {
    const from = nodes.find(x=>x.id===c.from); const to = nodes.find(x=>x.id===c.to);
    return `${from?.name||c.from} → ${to?.name||c.to} [${c.type||'sequence'}]`;
  }).join('\n');
  ARCO.processContext = `EXISTING PROCESS: "${process.name}" (${process.processId||'—'})\nSTEPS:\n${summary}\nCONNECTIONS:\n${connSummary||'None'}`;
  ARCO.currentProcess = process;
}

function arcoGreet() {
  syncProcessContext();
  const ctx = ARCO.processContext
    ? `Hello. I'm **ARCŌ**. I can see **${ARCO.currentProcess?.name}** is loaded with ${(window.State?.nodes||[]).filter(n=>!['start','end'].includes(n.type)).length} steps.\n\nWhat would you like to do — review, improve, or add to this process?`
    : `Hello. I'm **ARCŌ** — your process intake assistant.\n\nDescribe any business process in plain language and I'll extract the steps, identify control points, flag risks, and build it into your PROMAP canvas.\n\nStart by telling me: **what process would you like to design today?**`;
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
  if (zone) zone.classList.remove('drag-over');
  const file = event.dataTransfer.files[0];
  if (file) processArcoUpload(file);
}

async function processArcoUpload(file) {
  if (typeof notify === 'function') notify(`Reading ${file.name}...`, 'info');
  const name = file.name.toLowerCase();

  if (name.endsWith('.txt')) {
    const text = await file.text();
    const msg = `I've uploaded "${file.name}". Please extract the process steps:\n\n${text.slice(0, 8000)}`;
    ARCO.messages.push({ role:'user', content: msg });
    appendMessage('user', `📄 Uploaded: ${file.name}`);
    const typingId = showTyping();
    let reply;
    try { reply = await callClaudeAPI(ARCO.messages); } catch(e) { reply = `Error: ${e.message}`; }
    removeTyping(typingId);
    ARCO.messages.push({ role:'assistant', content: reply });
    const steps = extractStepsFromReply(reply);
    const display = reply.replace(/<STEPS>[\s\S]*?<\/STEPS>/g,'').replace(/<CONNECTIONS>[\s\S]*?<\/CONNECTIONS>/g,'').trim();
    appendMessage('assistant', display || '✓ Steps extracted from document.', steps);
    if (steps) { ARCO.extractedSteps = steps; showExtractedSteps(steps); }
  } else {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/arco/upload', { method:'POST', body: formData });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      const msg = `I've uploaded "${file.name}". Please extract the process steps:\n\n${data.text.slice(0, 8000)}`;
      ARCO.messages.push({ role:'user', content: msg });
      appendMessage('user', `📄 Uploaded: ${file.name}`);
      const typingId = showTyping();
      let reply;
      try { reply = await callClaudeAPI(ARCO.messages); } catch(e) { reply = `Error: ${e.message}`; }
      removeTyping(typingId);
      ARCO.messages.push({ role:'assistant', content: reply });
      const steps = extractStepsFromReply(reply);
      const display = reply.replace(/<STEPS>[\s\S]*?<\/STEPS>/g,'').replace(/<CONNECTIONS>[\s\S]*?<\/CONNECTIONS>/g,'').trim();
      appendMessage('assistant', display || '✓ Steps extracted from document.', steps);
      if (steps) { ARCO.extractedSteps = steps; showExtractedSteps(steps); }
    } catch(e) {
      if (typeof notify === 'function') notify(`Upload error: ${e.message}`, 'error');
    }
  }
}

// ── FLOAT PANEL ARCO ─────────────────────────────
function appendFloatArcoMsg(role, text) {
  // N64: mirror to main feed — float and tab share same session
  appendMessage(role, text);
  // Also update float feed to show latest from main feed
  const mainFeed = document.getElementById('arco-feed');
  const floatFeed = document.getElementById('float-arco-feed');
  if (floatFeed && mainFeed) {
    floatFeed.innerHTML = mainFeed.innerHTML;
    floatFeed.scrollTop = floatFeed.scrollHeight;
  }
}

async function floatArcoSend() {
  // N64: route through main arcoSend() so sessions are identical
  const input = document.getElementById('float-arco-input');
  if (!input) return;
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  autoResizeTextarea(input);
  // Inject into main input and send
  const mainInput = document.getElementById('arco-input');
  if (mainInput) mainInput.value = msg;
  await arcoSend();
  // Sync float feed
  const mainFeed = document.getElementById('arco-feed');
  const floatFeed = document.getElementById('float-arco-feed');
  if (floatFeed && mainFeed) {
    floatFeed.innerHTML = mainFeed.innerHTML;
    floatFeed.scrollTop = floatFeed.scrollHeight;
  }
}

function floatArcoKeydown(e) {
  if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); floatArcoSend(); }
}
