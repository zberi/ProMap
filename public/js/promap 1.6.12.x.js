/* ═══════════════════════════════════════════════
   MERIDIAN — PROMAP Engine v1.6.11
   Fixes: N51 layer filter; N76 save guard; N78 pedigree guard; N79 verified
   N39/N62: Audit trail — field-level change capture, viewer panel
   ═══════════════════════════════════════════════ */

window.State = {
  processes: [], currentProcess: null,
  nodes: [], connections: [],
  selectedNode: null, selectedConn: null,
  tool: 'select',
  scale: 1, offset: { x: 60, y: 60 },
  dragging: null, dragOffset: { x:0, y:0 },
  panning: false, panStart: { x:0, y:0 },
  connectingFrom: null, connectMouse: null,
  nodeCounter: 0, dirty: false,
  undoStack: [],
  confirmCallback: null,
  confirmCancelCallback: null,
  lastNodeLevel: 'L4',
  auditBuffer: [],   // N39: pending audit entries flushed on save
};

// ── AUDIT HELPERS ─────────────────────────────────
function auditEntry(action, detail, changes, module) {
  return { ts: new Date().toISOString(), action, module: module||'PROMAP', detail, changes: changes||null };
}

function bufferAudit(action, detail, changes, module) {
  State.auditBuffer.push(auditEntry(action, detail, changes, module));
}

async function showAuditTrail() {
  if (!State.currentProcess) { notify('No process loaded','error'); return; }
  try {
    const data = await api('GET', `/api/processes/${State.currentProcess.id}/audit`);
    renderAuditPanel(data.auditLog || [], data.process.name);
  } catch(e) { notify('Could not load audit trail','error'); }
}

function renderAuditPanel(log, processName) {
  // Remove existing panel if open
  const existing = document.getElementById('audit-panel');
  if (existing) { existing.remove(); return; }

  const panel = document.createElement('div');
  panel.id = 'audit-panel';
  panel.style.cssText = `
    position:fixed;right:18px;top:110px;width:420px;max-height:calc(100vh - 130px);
    background:var(--bg1);border:1px solid var(--border);border-radius:7px;
    box-shadow:0 8px 32px rgba(0,0,0,.6);z-index:300;display:flex;flex-direction:column;overflow:hidden;`;

  const header = `
    <div style="padding:12px 16px;border-bottom:1px solid var(--border);background:var(--bg2);display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
      <div>
        <span style="font-size:12px;font-weight:600;letter-spacing:.08em;color:var(--text1);">AUDIT TRAIL</span>
        <span style="font-size:11px;color:var(--text2);margin-left:8px;">${processName}</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="hdr-btn" style="font-size:11px;padding:4px 10px;" onclick="exportAuditTrail()">EXPORT</button>
        <span style="cursor:pointer;color:var(--text2);font-size:18px;" onclick="document.getElementById('audit-panel').remove()">×</span>
      </div>
    </div>`;

  const entries = log.length ? [...log].reverse().map(e => {
    const ts = new Date(e.ts);
    const time = ts.toLocaleDateString('en-GB',{day:'2-digit',month:'short'}) + ' ' + ts.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    const actionColor = {
      created:'var(--teal)', modified:'var(--text1)', deleted:'var(--coral)',
      published:'var(--green)', archived:'var(--text2)', evaluated:'var(--violet)'
    }[e.action] || 'var(--text1)';
    return `
      <div style="padding:9px 14px;border-bottom:1px solid var(--border);display:grid;grid-template-columns:auto 1fr;gap:8px;align-items:start;">
        <div style="text-align:right;">
          <div style="font-size:10px;color:var(--text2);white-space:nowrap;">${time}</div>
          <div style="font-size:9px;color:${actionColor};letter-spacing:.06em;text-transform:uppercase;margin-top:2px;">${e.action}</div>
          <div style="font-size:9px;color:var(--text2);margin-top:1px;">${e.module}</div>
        </div>
        <div>
          <div style="font-size:12px;color:var(--text0);">${e.detail}</div>
          ${e.changes ? `<div style="font-size:10px;color:var(--text2);margin-top:3px;">${e.changes.field}: <span style="color:var(--coral);">${e.changes.from??'—'}</span> → <span style="color:var(--teal);">${e.changes.to??'—'}</span></div>` : ''}
        </div>
      </div>`;
  }).join('') : '<div style="padding:20px;text-align:center;font-size:13px;color:var(--text2);">No audit entries yet.</div>';

  panel.innerHTML = header + `<div style="overflow-y:auto;flex:1;">${entries}</div>`;
  document.body.appendChild(panel);
}

async function exportAuditTrail() {
  if (!State.currentProcess) return;
  const data = await api('GET', `/api/processes/${State.currentProcess.id}/audit`);
  const log = data.auditLog || [];
  const lines = [
    `AUDIT TRAIL — ${data.process.name}`,
    `Generated: ${new Date().toLocaleString('en-GB')}`,
    `${'─'.repeat(60)}`,
    ...log.map(e => `[${e.ts}] ${e.action.toUpperCase()} | ${e.module} | ${e.detail}${e.changes?` | ${e.changes.field}: ${e.changes.from}→${e.changes.to}`:''}`)
  ].join('\n');
  const blob = new Blob([lines],{type:'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `AUDIT_${(State.currentProcess.processId||State.currentProcess.name).replace(/\s+/g,'_')}.txt`;
  a.click();
  notify('Audit trail exported','success');
}

const MAX_UNDO = 30;

window.NODE_COLORS = {
  start:      { border:'var(--teal)',   text:'var(--teal)'   },
  end:        { border:'var(--violet)', text:'var(--violet)' },
  process:    { border:'var(--teal)',   text:'var(--teal)'   },
  control:    { border:'var(--amber)',  text:'var(--amber)'  },
  ccp:        { border:'#ff6b35',       text:'#ff6b35'       },
  decision:   { border:'var(--amber)',  text:'var(--amber)'  },
  compliance: { border:'var(--green)',  text:'var(--green)'  },
  system:     { border:'var(--blue)',   text:'var(--blue)'   },
  handoff:    { border:'var(--violet)', text:'var(--violet)' },
};

window.CONN_STYLES = {
  sequence:   { color:'#9aaac8', dash:'',      label:'' },
  dependency: { color:'var(--amber)', dash:'6 3', label:'depends' },
  loop:       { color:'var(--violet)', dash:'4 3', label:'loop' },
  yes:        { color:'var(--green)', dash:'',   label:'YES' },
  no:         { color:'var(--coral)', dash:'',   label:'NO' },
  handoff:    { color:'var(--violet)', dash:'7 4', label:'handoff' },
};

window.CLASSIFICATION_OPTIONS = [
  { key:'process',               label:'PROCESS',     color:'var(--teal)'   },
  { key:'control',               label:'CONTROL',     color:'var(--amber)'  },
  { key:'compliance-internal',   label:'COMP-INT',    color:'var(--green)'  },
  { key:'compliance-regulatory', label:'COMP-REG',    color:'var(--blue)'   },
  { key:'reporting',             label:'REPORTING',   color:'var(--violet)' },
  { key:'information',           label:'INFORMATION', color:'var(--text1)'  },
];

// ── SMART DEFAULTS FOR NEW STEPS ──────────────────
function getSmartDefaults(type) {
  const isControl = type === 'control' || type === 'ccp';
  return {
    level: State.lastNodeLevel || 'L4',
    inputType: 'manual',
    classifications: isControl ? ['control'] : type === 'compliance' ? ['compliance-internal'] : ['control'],
    monitoring: true,
    frequency: 'monthly',
    recordRequired: true,
    recordType: 'system',
    retentionPeriod: '10 years',
  };
}

// ── INIT ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => { loadProcesses(); });

// ── UNDO ─────────────────────────────────────────
function pushUndo() {
  State.undoStack.push({ nodes: JSON.parse(JSON.stringify(State.nodes)), connections: JSON.parse(JSON.stringify(State.connections)) });
  if (State.undoStack.length > MAX_UNDO) State.undoStack.shift();
  document.getElementById('btn-undo').style.display = '';
}

function undoAction() {
  if (!State.undoStack.length) { notify('Nothing to undo','info'); return; }
  const snap = State.undoStack.pop();
  State.nodes = snap.nodes; State.connections = snap.connections;
  State.dirty = true; State.selectedNode = null; State.selectedConn = null;
  renderCanvas(); renderPropsEmpty();
  if (!State.undoStack.length) document.getElementById('btn-undo').style.display = 'none';
  const ind = document.getElementById('undo-indicator');
  ind.classList.add('show'); setTimeout(() => ind.classList.remove('show'), 1200);
  notify('Undo applied','info');
}

// ── API ───────────────────────────────────────────
async function api(method, path, body) {
  try {
    const res = await fetch(path, { method, headers:{'Content-Type':'application/json'}, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch(e) { notify('API error: '+e.message,'error'); throw e; }
}

async function loadProcesses() {
  State.processes = await api('GET','/api/processes');
  // Check ARCŌ mode
  try {
    const h = await api('GET','/api/health');
    if (window.ARCO) window.ARCO.mode = h.arcoMode || 'mock';
    const ml = document.getElementById('arco-mode-label');
    if (ml) ml.textContent = h.arcoMode === 'live' ? '✓ Live — Claude API connected' : 'Mock mode — API key not set';
  } catch(e) {}
  renderProcessList();
}

async function saveProcess() {
  if (!State.currentProcess) return;
  const saveData = {
    name: State.currentProcess.name,
    processId: State.currentProcess.processId,
    function: State.currentProcess.function,
    description: State.currentProcess.description,
    owner: State.currentProcess.owner,
    level: State.currentProcess.level,
    parentId: State.currentProcess.parentId || null,
    status: State.currentProcess.status || 'draft',
    nodes: JSON.parse(JSON.stringify(State.nodes || [])),
    connections: JSON.parse(JSON.stringify(State.connections || [])),
    _auditModule: 'PROMAP',
    _auditEntries: [...State.auditBuffer],
  };
  State.auditBuffer = []; // flush buffer
  const saved = await api('PUT', `/api/processes/${State.currentProcess.id}`, saveData);
  State.currentProcess = saved;
  const idx = State.processes.findIndex(p => p.id === saved.id);
  if (idx >= 0) State.processes[idx] = saved;
  State.dirty = false;
  updateHeader(); renderProcessList();
  notify('Process saved','success');
}

async function createProcess() {
  const name = document.getElementById('np-name').value.trim();
  if (!name) { notify('Process name is required','error'); return; }
  const proc = {
    name, processId: document.getElementById('np-id').value.trim(),
    parentId: document.getElementById('np-parent').value || null,
    function: document.getElementById('np-fn').value,
    description: document.getElementById('np-desc').value.trim(),
    owner: document.getElementById('np-owner').value.trim(),
    level: document.getElementById('np-level').value,
    nodes:[], connections:[], status:'draft',
  };
  const created = await api('POST','/api/processes', proc);
  State.processes.push(created);
  closeModal('modal-new');
  loadProcess(created);
  renderProcessList();
  notify(`Process "${created.name}" created`,'success');
}

async function deleteProcess(id) {
  await api('DELETE', `/api/processes/${id}`);
  State.processes = State.processes.filter(p => p.id !== id);
  if (State.currentProcess?.id === id) {
    State.currentProcess = null; State.nodes = []; State.connections = [];
    updateHeader(); updatePedigree();
    renderCanvas(); renderPropsEmpty();
    document.getElementById('empty-state').style.display = 'block';
  }
  renderProcessList();
  notify('Process deleted','info');
}

async function publishProcess() {
  if (!State.currentProcess) return;
  bufferAudit('published', `Process "${State.currentProcess.name}" published`, { field:'status', from:'draft', to:'published' });
  State.currentProcess.status = 'published';
  await saveProcess(); updateHeader();
}

function loadProcess(proc) {
  if (State.dirty) saveProcess().catch(()=>{});
  State.currentProcess = JSON.parse(JSON.stringify(proc));
  State.nodes = proc.nodes ? JSON.parse(JSON.stringify(proc.nodes)) : [];
  State.connections = proc.connections ? JSON.parse(JSON.stringify(proc.connections)) : [];
  State.nodeCounter = State.nodes.reduce((max,n) => Math.max(max, parseInt(n.id.replace('N-',''))||0), 0);
  State.selectedNode = null; State.selectedConn = null;
  State.dirty = false; State.undoStack = [];
  const needsLayout = State.nodes.length > 0 && State.nodes.some(n => !n.x && !n.y);
  document.getElementById('btn-undo').style.display = 'none';
  setTool('select');
  updateHeader(); updatePedigree();
  renderCanvas(); renderProcessList(); renderProcessPropsPanel();
  document.getElementById('empty-state').style.display = State.nodes.length ? 'none' : 'block';
  if (needsLayout) setTimeout(() => autoLayout(), 80);
  if (typeof MeridianBus !== 'undefined') MeridianBus.emit('promap:process-loaded', { process: State.currentProcess, nodes: State.nodes, connections: State.connections });
}

function renderProcessPropsPanel() {
  if (!State.currentProcess) { renderPropsEmpty(); return; }
  const p = State.currentProcess;
  const LEVEL_OPTIONS = ['L1','L2','L3','L4','L5','L6','L7','L8'];
  document.getElementById('props-body').innerHTML = `
    <div style="font-size:11px;color:var(--text2);letter-spacing:.08em;text-transform:uppercase;margin-bottom:12px;">Process Properties</div>
    <div class="field-group">
      <label class="field-label">Process Name</label>
      <input class="field-input" value="${esc(p.name||'')}" oninput="upProcess('name',this.value)" style="user-select:text;"/>
    </div>
    <div class="field-group">
      <label class="field-label">Process ID</label>
      <input class="field-input" value="${esc(p.processId||'')}" oninput="upProcess('processId',this.value)" style="user-select:text;"/>
    </div>
    <div class="field-row">
      <div class="field-group">
        <label class="field-label">Level</label>
        <select class="field-select" onchange="upProcess('level',this.value)">
          ${LEVEL_OPTIONS.map(l=>`<option ${p.level===l?'selected':''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="field-group">
        <label class="field-label">Status</label>
        <select class="field-select" onchange="upProcess('status',this.value)">
          <option ${p.status==='draft'?'selected':''}>draft</option>
          <option ${p.status==='published'?'selected':''}>published</option>
        </select>
      </div>
    </div>
    <div class="field-group">
      <label class="field-label">Owner</label>
      <input class="field-input" value="${esc(p.owner||'')}" oninput="upProcess('owner',this.value)" style="user-select:text;"/>
    </div>
    <div class="field-group">
      <label class="field-label">Description</label>
      <textarea class="field-textarea" oninput="upProcess('description',this.value)" style="user-select:text;">${esc(p.description||'')}</textarea>
    </div>
    <div class="field-group">
      <label class="field-label">Function</label>
      <input class="field-input" value="${esc(p.function||'')}" oninput="upProcess('function',this.value)" style="user-select:text;"/>
    </div>
    <div style="margin-top:8px;">
      <button class="hdr-btn success" style="width:100%;" onclick="saveProcess().then(()=>notify('Saved','success'))">SAVE PROCESS</button>
    </div>`;
}

function upProcess(key, value) {
  if (!State.currentProcess) return;
  State.currentProcess[key] = value;
  State.dirty = true;
  updateHeader();
}

// ── PEDIGREE ──────────────────────────────────────
function updatePedigree() {
  const bar = document.getElementById('pedigree-bar');
  if (!State.currentProcess) { bar.textContent = 'No process selected'; return; }
  const crumbs = buildPedigree(State.currentProcess.id);
  bar.innerHTML = crumbs.map((c,i) =>
    i === crumbs.length-1
      ? `<span class="crumb-active">${c.name}</span>`
      : `<span>${c.name}</span><span style="color:var(--text2);margin:0 5px;">›</span>`
  ).join('');
}

function buildPedigree(id) {
  const crumbs = [];
  if (!id) return crumbs;
  let cur = State.processes.find(p => p.id === id);
  const seen = new Set();
  while(cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    crumbs.unshift({id:cur.id, name:cur.name});
    cur = cur.parentId ? State.processes.find(p=>p.id===cur.parentId) : null;
  }
  return crumbs;
}

// ── PROCESS LIST ──────────────────────────────────
function renderProcessList() {
  const el = document.getElementById('process-list');
  el.innerHTML = '';

  // Add Process button
  const addBtn = document.createElement('div');
  addBtn.style.cssText = 'padding:8px 14px;';
  addBtn.innerHTML = `<button class="hdr-btn primary" style="width:100%;font-size:12px;" onclick="newProcess()">+ ADD PROCESS</button>`;
  el.appendChild(addBtn);

  const active = State.processes.filter(p => p.status !== 'archived');
  const archived = State.processes.filter(p => p.status === 'archived');
  const published = State.processes.filter(p => p.status === 'published');

  if (!active.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:8px 14px;font-size:13px;color:var(--text2);';
    empty.textContent = 'No processes yet.';
    el.appendChild(empty);
  }

  function renderItem(p, depth) {
    const div = document.createElement('div');
    div.className = 'process-item' + (State.currentProcess?.id === p.id ? ' active' : '');
    div.style.cssText = `padding-left:${14+depth*14}px;`;
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div style="flex:1;min-width:0;">
          <div class="pi-name">${depth>0?'└ ':''}${p.name}</div>
          <div class="pi-meta">${p.processId||'—'} · ${p.level||'L2'} · ${p.function||'—'}</div>
        </div>
        <div style="display:flex;gap:2px;flex-shrink:0;">
          <span onclick="event.stopPropagation();archiveProcess('${p.id}','${p.name.replace(/'/g,"\\'")}');"
            style="color:var(--text2);cursor:pointer;font-size:15px;padding:0 3px;" title="Archive process">×</span>
          <span onclick="event.stopPropagation();confirmDeleteProcess('${p.id}','${p.name.replace(/'/g,"\\'")}');"
            style="color:var(--coral);cursor:pointer;font-size:13px;padding:0 3px;" title="Permanently delete">🗑</span>
        </div>
      </div>`;
    div.addEventListener('click', () => loadProcess(p));
    el.appendChild(div);
    active.filter(c => c.parentId === p.id).forEach(child => renderItem(child, depth+1));
  }
  active.filter(p => !p.parentId).forEach(p => renderItem(p, 0));

  // N73 — Archived processes section
  if (archived.length) {
    const archHdr = document.createElement('div');
    archHdr.innerHTML = `<div class="sb-hr"></div><div class="sb-section" style="color:var(--text2);">Archived (${archived.length})</div>`;
    el.appendChild(archHdr);
    archived.forEach(p => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:6px 14px;display:flex;justify-content:space-between;align-items:center;opacity:.6;';
      div.innerHTML = `
        <div style="font-size:12px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${p.name}</div>
        <span onclick="restoreProcess('${p.id}');" style="font-size:11px;color:var(--teal);cursor:pointer;padding:0 4px;flex-shrink:0;" title="Restore">↺</span>
        <span onclick="confirmDeleteProcess('${p.id}','${p.name.replace(/'/g,"\\'")}');" style="font-size:13px;color:var(--coral);cursor:pointer;padding:0 3px;flex-shrink:0;" title="Permanently delete">🗑</span>`;
      el.appendChild(div);
    });
  }

  // N70 — SOP register: published SOPs at bottom
  if (published.length) {
    const sopHdr = document.createElement('div');
    sopHdr.innerHTML = `<div class="sb-hr"></div><div class="sb-section" style="color:var(--teal);">Published SOPs (${published.length})</div>`;
    el.appendChild(sopHdr);
    published.forEach(p => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:5px 14px;cursor:pointer;';
      div.innerHTML = `<div style="font-size:11px;color:var(--teal);">${p.processId||'—'} · ${p.name}</div><div style="font-size:10px;color:var(--text2);">v${p.version||1} · Published</div>`;
      div.addEventListener('click', () => loadProcess(p));
      el.appendChild(div);
    });
  }
}

async function archiveProcess(id, name) {
  // N71: × = archive not delete
  const data = await api('GET', `/api/processes/${id}`);
  if (!data) return;
  await api('PUT', `/api/processes/${id}`, { ...data, status: 'archived' });
  const idx = State.processes.findIndex(p => p.id === id);
  if (idx >= 0) State.processes[idx].status = 'archived';
  if (State.currentProcess?.id === id) {
    State.currentProcess.status = 'archived';
    updateHeader();
  }
  renderProcessList();
  notify(`"${name}" archived`, 'info');
}

async function restoreProcess(id) {
  // N73: restore archived process to draft
  const data = await api('GET', `/api/processes/${id}`);
  if (!data) return;
  await api('PUT', `/api/processes/${id}`, { ...data, status: 'draft' });
  const idx = State.processes.findIndex(p => p.id === id);
  if (idx >= 0) State.processes[idx].status = 'draft';
  renderProcessList();
  notify('Process restored to draft', 'success');
}

// ── HEADER ────────────────────────────────────────
function updateHeader() {
  const p = State.currentProcess;
  document.getElementById('hdr-process-name').textContent = p ? p.name : 'No process selected';
  const statusEl = document.getElementById('hdr-status');
  const versionEl = document.getElementById('hdr-version');
  if (p) {
    statusEl.textContent = (p.status||'DRAFT').toUpperCase();
    statusEl.className = 'status-badge '+(p.status==='published'?'status-published':'status-draft');
    statusEl.style.display = ''; versionEl.textContent = `v${p.version||1}`; versionEl.style.display = '';
    ['btn-save','btn-publish','btn-export','btn-export-pdf','btn-audit'].forEach(id => { const el=document.getElementById(id); if(el) el.style.display=''; });
  } else {
    statusEl.style.display='none'; versionEl.style.display='none';
    ['btn-save','btn-publish','btn-export','btn-export-pdf','btn-audit'].forEach(id => { const el=document.getElementById(id); if(el) el.style.display='none'; });
  }
}

// ── CANVAS ────────────────────────────────────────
function renderCanvas() {
  const canvas = document.getElementById('canvas');
  const svg = document.getElementById('canvas-svg');
  canvas.innerHTML = '';

  // Dynamically size canvas to fit all nodes — fixes C (connectors invisible beyond boundary)
  if (State.nodes.length) {
    const maxX = Math.max(...State.nodes.map(n => (n.x||0) + 300)) + 300;
    const maxY = Math.max(...State.nodes.map(n => (n.y||0) + 200)) + 300;
    canvas.style.width  = maxX + 'px';
    canvas.style.height = maxY + 'px';
    if (svg) { svg.style.width = maxX + 'px'; svg.style.height = maxY + 'px'; }
  }

  // Render nodes first so getConnGeometry/group containers can read real DOM
  // dimensions immediately — fixes connectors appearing straight until a
  // selection forces a re-render with correct measurements (item c)
  State.nodes.forEach(n => renderNode(n));
  renderConnections();
  applyTransform();
}

function renderNode(node) {
  const canvas = document.getElementById('canvas');
  const div = document.createElement('div');
  div.id = `node-${node.id}`;
  div.className = `pnode node-${node.type}`;
  if (State.selectedNode?.id === node.id) div.style.boxShadow = '0 0 0 2.5px var(--amber)';

  const badges = [];
  if (node.type==='ccp') badges.push(`<span class="node-badge" style="background:#1a0a00;color:#ff6b35;border-color:#ff6b35;">CCP</span>`);
  if (node.monitoring) badges.push(`<span class="node-badge" style="background:var(--violet-lo);color:var(--violet);border-color:var(--violet);">MON</span>`);
  if (node.inputType==='system') badges.push(`<span class="node-badge" style="background:var(--blue-lo);color:var(--blue);border-color:var(--blue);">SYS</span>`);
  if (node.type==='control'||node.type==='ccp') {
    const pd = node.controlNature || 'P';
    const pdColor = pd==='D' ? 'var(--blue)' : 'var(--green)';
    badges.push(`<span class="node-badge" style="color:${pdColor};border-color:${pdColor};">${pd}</span>`);
  }
  const classArr = Array.isArray(node.classifications)?node.classifications:[];
  classArr.forEach(c => {
    const opt = CLASSIFICATION_OPTIONS.find(o=>o.key===c);
    if (opt) badges.push(`<span class="node-badge" style="color:${opt.color};border-color:${opt.color};">${opt.label}</span>`);
  });
  const col = NODE_COLORS[node.type]||NODE_COLORS.process;
  const meta = `${node.responsible||''}${node.frequency?' · '+node.frequency:''}`;

  // ── ISO-inspired shapes ────────────────────────
  if (node.type==='start'||node.type==='end') {
    // ISO: circle/oval terminator
    div.style.cssText = `left:${node.x}px;top:${node.y}px;width:120px;border-radius:28px;text-align:center;`;
    div.innerHTML = `<div class="node-body" style="padding:9px 8px;text-align:center;">
      <span style="font-size:12px;font-weight:700;letter-spacing:.08em;">${node.name||node.type.toUpperCase()}</span>
    </div>`;

  } else if (node.type==='decision') {
    // ISO: proper diamond — clip-path matches polygon so label never spills past edges
    div.style.cssText = `left:${node.x}px;top:${node.y}px;width:160px;height:100px;background:transparent;border:none;clip-path:polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);`;
    div.innerHTML = `
      <svg width="160" height="100" style="position:absolute;top:0;left:0;">
        <polygon points="80,4 156,50 80,96 4,50" fill="var(--amber-lo)" stroke="var(--amber)" stroke-width="1.5"/>
      </svg>
      <div style="position:relative;z-index:1;display:flex;flex-direction:column;justify-content:center;align-items:center;height:100%;padding:0 36px;text-align:center;">
        <div style="font-size:10px;color:var(--amber);letter-spacing:.06em;font-weight:600;">DECISION</div>
        <div style="font-size:11px;color:var(--text0);font-weight:500;line-height:1.25;margin-top:2px;max-width:88px;overflow:hidden;text-overflow:ellipsis;">${node.name||'Decision'}</div>
      </div>`;

  } else if (node.type==='system') {
    // ISO: parallelogram for automated/system step
    div.style.cssText = `left:${node.x}px;top:${node.y}px;width:172px;clip-path:polygon(8px 0%, 100% 0%, calc(100% - 8px) 100%, 0% 100%);`;
    div.innerHTML = `
      <div class="node-header" style="padding:6px 18px 4px 14px;">
        <span class="node-id" style="color:${col.text};">${node.stepId||node.id}</span>
        <div class="node-badges">${badges.join('')}</div>
      </div>
      <div class="node-body" style="padding:4px 18px 8px 14px;">
        <div class="node-name">${node.name||'System Step'}</div>
        <div class="node-meta">${meta}</div>
      </div>`;

  } else if (node.type==='handoff') {
    // ISO: arrow/chevron shape for handoff — N92
    div.style.cssText = `left:${node.x}px;top:${node.y}px;width:172px;clip-path:polygon(0% 0%, 90% 0%, 100% 50%, 90% 100%, 0% 100%);`;
    const toProcess = node.toProcess || '';
    div.innerHTML = `
      <div class="node-header" style="padding:6px 24px 4px 10px;">
        <span class="node-id" style="color:${col.text};">${node.stepId||node.id}</span>
        <div class="node-badges">${badges.join('')}</div>
      </div>
      <div class="node-body" style="padding:4px 24px 8px 10px;">
        <div class="node-name">${node.name||'Handoff'}</div>
        ${toProcess?`<div style="font-size:10px;color:var(--violet);margin-top:2px;">→ ${toProcess}</div>`:''}
        <div class="node-meta">${meta}</div>
      </div>`;

  } else {
    // process, control, ccp, compliance — rounded rect with left accent
    const accentColor = col.text || 'var(--teal)';
    div.style.cssText = `left:${node.x}px;top:${node.y}px;width:172px;`;
    div.innerHTML = `
      <div style="position:absolute;left:0;top:0;bottom:0;width:3px;background:${accentColor};border-radius:var(--radius) 0 0 var(--radius);"></div>
      <div class="node-header" style="padding:6px 8px 4px 12px;">
        <span class="node-id" style="color:${accentColor};">${node.stepId||node.id}</span>
        <div class="node-badges">${badges.join('')}</div>
      </div>
      <div class="node-body" style="padding:4px 8px 8px 12px;">
        <div class="node-name">${node.name||'Unnamed Step'}</div>
        <div class="node-meta">
          ${node.responsible?node.responsible+'<br/>':''}
          ${node.frequency||''}${node.timing?' · '+node.timing:''}
          ${node.recordRequired?'<br/><span style="color:var(--green);font-size:10px;">● Record · '+node.retentionPeriod+'</span>':''}
        </div>
      </div>`;
  }

  div.innerHTML += `<div class="node-ports">
    <div class="port port-in"  data-node="${node.id}" data-port="in"  onmousedown="onPortDown(event)"></div>
    <div class="port port-out" data-node="${node.id}" data-port="out" onmousedown="onPortDown(event)"></div>
  </div>`;

  div.addEventListener('mousedown', e => {
    if (e.target.classList.contains('port')) return;
    e.stopPropagation();
    if (State.tool==='select') { startNodeDrag(e,node); selectNode(node); }
  });
  canvas.appendChild(div);
}

// ── CONNECTION GEOMETRY HELPERS ───────────────────

// Get the two endpoints and path description for a connection (no SVG created)
function getConnGeometry(conn) {
  const fn = State.nodes.find(n=>n.id===conn.from);
  const tn = State.nodes.find(n=>n.id===conn.to);
  if (!fn||!tn) return null;
  const fe = document.getElementById(`node-${conn.from}`);
  const te = document.getElementById(`node-${conn.to}`);
  const fw = (fe && fe.offsetWidth  > 0) ? fe.offsetWidth  : (['start','end'].includes(fn.type) ? 120 : 172);
  const fh = (fe && fe.offsetHeight > 0) ? fe.offsetHeight : 80;
  const tw = (te && te.offsetWidth  > 0) ? te.offsetWidth  : (['start','end'].includes(tn.type) ? 120 : 172);
  const th = (te && te.offsetHeight > 0) ? te.offsetHeight : 80;
  const GAP = 20;
  const TITLE_H = 24; // approximate node title/header height — connector clears this

  // ── LOOP: top-centre → soft bezier arc above → top-centre ──
  if (conn.type === 'loop') {
    const lx1 = fn.x + fw/2, ly1 = fn.y;
    const lx2 = tn.x + tw/2, ly2 = tn.y;
    const loopY = Math.min(ly1, ly2) - 60;
    const segments = [
      {x1:lx1, y1:ly1, x2:lx1, y2:loopY},
      {x1:lx1, y1:loopY, x2:lx2, y2:loopY},
      {x1:lx2, y1:loopY, x2:lx2, y2:ly2},
    ];
    return { x1:lx1, y1:ly1, x2:lx2, y2:ly2, segments, isBack:true, isLoop:true, fn,tn,fw,fh,tw,th,GAP };
  }

  // Normal forward: right-centre (below title) → left-centre
  // Clearance from dept boundary edges — shift exit/entry Y if too close to boundary
  const { PAD: CPPAD } = LAYOUT;
  const deptBounds = computeDeptBounds();
  let adjY1 = fn.y + Math.max(fh/2, 24);
  let adjY2 = tn.y + Math.max(th/2, 24);
  // If exit point is within PAD of any dept boundary top or bottom, nudge inside
  Object.values(deptBounds).forEach(b => {
    if (Math.abs(adjY1 - b.top) < CPPAD)    adjY1 = b.top + CPPAD;
    if (Math.abs(adjY1 - b.bottom) < CPPAD) adjY1 = b.bottom - CPPAD;
    if (Math.abs(adjY2 - b.top) < CPPAD)    adjY2 = b.top + CPPAD;
    if (Math.abs(adjY2 - b.bottom) < CPPAD) adjY2 = b.bottom - CPPAD;
  });
  const x1 = fn.x + fw, y1 = adjY1;
  const x2 = tn.x,      y2 = adjY2;

  const isBack = x2 < x1 + GAP*2;

  if (isBack) {
    const isWrapDown = fn.y < tn.y - 20;

    if (isWrapDown) {
      const ox1 = fn.x + fw/2, oy1 = fn.y + fh;    // bottom-centre source
      const ox2 = tn.x + tw/2, oy2 = tn.y;          // top-centre target
      // Route in the GAP between source bottom and target top — midpoint
      // Also respect dept boundary clearance (LAYOUT.PAD from boundary edge)
      let routeY = (oy1 + oy2) / 2; // midpoint of inter-row gap
      // Ensure clearance from dept boundary bottom edges
      const { PAD } = LAYOUT;
      const deptBounds = computeDeptBounds();
      Object.values(deptBounds).forEach(b => {
        // If route passes through a dept boundary bottom, push below it
        if (routeY > b.bottom - PAD && routeY < b.bottom + PAD) {
          routeY = b.bottom + PAD;
        }
      });
      const segments = [
        {x1:ox1, y1:oy1, x2:ox1, y2:routeY},
        {x1:ox1, y1:routeY, x2:ox2, y2:routeY},
        {x1:ox2, y1:routeY, x2:ox2, y2:oy2},
      ];
      return { x1:ox1, y1:oy1, x2:ox2, y2:oy2, routeY, segments, isBack:true, isWrapDown:true, isLoop:false, fn,tn,fw,fh,tw,th,GAP };

    } else {
      // Same-row back: right-centre exit → orthogonal arc above → top-centre entry
      const segments = [{x1, y1, x2:tn.x+tw/2, y2:tn.y}];
      return { x1, y1, x2:tn.x+tw/2, y2:tn.y, segments, isBack:true, isSameRowBack:true, isWrapDown:false, isLoop:false, fn,tn,fw,fh,tw,th,GAP };
    }
  }

  // Normal forward — bezier right→left
  const segments = [{x1, y1, x2, y2}];
  return { x1, y1, x2, y2, segments, isBack:false, isLoop:false, fn,tn,fw,fh,tw,th,GAP };
}

// Segment intersection (excluding endpoints)
function segIntersect(ax1,ay1,ax2,ay2, bx1,by1,bx2,by2) {
  const dx1=ax2-ax1, dy1=ay2-ay1, dx2=bx2-bx1, dy2=by2-by1;
  const denom = dx1*dy2 - dy1*dx2;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((bx1-ax1)*dy2-(by1-ay1)*dx2)/denom;
  const u = ((bx1-ax1)*dy1-(by1-ay1)*dx1)/denom;
  if (t>0.05&&t<0.95&&u>0.05&&u<0.95)
    return { x: ax1+t*dx1, y: ay1+t*dy1 };
  return null;
}

// Find all crossing points on connA's segments from connB's segments
function findCrossings(geomA, geomB) {
  const pts = [];
  if (!geomA||!geomB) return pts;
  for (const sa of geomA.segments) {
    for (const sb of geomB.segments) {
      const pt = segIntersect(sa.x1,sa.y1,sa.x2,sa.y2, sb.x1,sb.y1,sb.x2,sb.y2);
      if (pt) pts.push({ ...pt, seg: sa });
    }
  }
  return pts;
}

// ── GROUP CONTAINERS ─────────────────────────────
// Draws bounded boxes in SVG for each L1/L2 process node that has children (by parentId match)
// Also groups nodes sharing the same process-level parent visually
function renderGroupContainers(svg) {
  // Auto-derive groups from process list parentId hierarchy.
  // If current process has a parentId → it belongs to a group (sibling processes share parent).
  // On canvas: group = all nodes of current process, labelled by parent process name.
  // If multiple child-processes exist under same parent, each gets its own container.
  // Also: nodes with explicit groupId field still group (manual override).

  const { PAD, HEADER_H, DEPT_GAP: MIN_DEPT_GAP } = LAYOUT;

  const groups = {}; // key → { label, nodes[] }

  // 1. Manual groupId on nodes (explicit override)
  State.nodes.forEach(n => {
    if (!n.groupId) return;
    if (!groups[n.groupId]) groups[n.groupId] = { label: n.groupId, nodes: [] };
    groups[n.groupId].nodes.push(n);
  });

  // 2. Auto-group: if current process has a parentId, wrap ALL canvas nodes
  if (State.currentProcess && State.currentProcess.parentId) {
    const parent = State.processes.find(p => p.id === State.currentProcess.parentId);
    if (parent && State.nodes.length >= 1) {
      const gid = '__parent_' + State.currentProcess.parentId;
      if (!groups[gid]) groups[gid] = { label: parent.name, nodes: [] };
      State.nodes.forEach(n => { if (!n.groupId) groups[gid].nodes.push(n); });
    }
  }

  // 3. Auto-group by department field on nodes
  State.nodes.forEach(n => {
    if (!n.department) return;
    const gid = '__dept_' + n.department;
    if (!groups[gid]) groups[gid] = { label: n.department, nodes: [] };
    groups[gid].nodes.push(n);
  });

  // Compute all boxes first, then check for overlaps and push apart
  const boxes = [];
  Object.values(groups).forEach(group => {
    if (group.nodes.length < 2) return;
    let minX = Infinity, minY = Infinity, maxRight = -Infinity, maxBottom = -Infinity;
    group.nodes.forEach(n => {
      const el = document.getElementById(`node-${n.id}`);
      const w = (el && el.offsetWidth)  ? el.offsetWidth  : 200;
      const h = (el && el.offsetHeight) ? el.offsetHeight : 90;
      const nx = n.x || 0, ny = n.y || 0;
      minX = Math.min(minX, nx);
      minY = Math.min(minY, ny);
      maxRight  = Math.max(maxRight,  nx + w);
      maxBottom = Math.max(maxBottom, ny + h);
    });
    boxes.push({
      label: group.label,
      x: minX - PAD,
      y: minY - PAD - HEADER_H,
      w: (maxRight - minX) + PAD * 2,
      h: (maxBottom - minY) + PAD * 2 + HEADER_H,
    });
  });

  // Draw all boxes
  boxes.forEach(box => {
    const { x, y, w, h, label } = box;

    // Outer box
    const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
    rect.setAttribute('x', x); rect.setAttribute('y', y);
    rect.setAttribute('width', w); rect.setAttribute('height', h);
    rect.setAttribute('rx', '8'); rect.setAttribute('ry', '8');
    rect.setAttribute('fill', 'rgba(20,28,44,0.5)');
    rect.setAttribute('stroke', '#3e5078');
    rect.setAttribute('stroke-width', '1.5');
    rect.setAttribute('stroke-dasharray', '7 3');
    svg.appendChild(rect);

    // Header band — sits fully above first node (HEADER_H reserved in layout)
    const hdr = document.createElementNS('http://www.w3.org/2000/svg','rect');
    hdr.setAttribute('x', x); hdr.setAttribute('y', y);
    hdr.setAttribute('width', w); hdr.setAttribute('height', HEADER_H);
    hdr.setAttribute('rx', '8'); hdr.setAttribute('ry', '8');
    hdr.setAttribute('fill', 'rgba(46,60,88,0.75)');
    svg.appendChild(hdr);

    // Label — vertically centred in header band
    const lbl = document.createElementNS('http://www.w3.org/2000/svg','text');
    lbl.setAttribute('x', x + 14);
    lbl.setAttribute('y', y + HEADER_H/2 + 4); // centred in header band
    lbl.setAttribute('font-size', '11');
    lbl.setAttribute('font-family', 'IBM Plex Mono, monospace');
    lbl.setAttribute('font-weight', '600');
    lbl.setAttribute('letter-spacing', '0.1em');
    lbl.setAttribute('fill', '#9aaac8');
    lbl.textContent = (label || '').toUpperCase();
    svg.appendChild(lbl);
  });
}

function renderConnections() {
  const svg = document.getElementById('canvas-svg');
  svg.innerHTML = '';
  const defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
  [['seq','#9aaac8'],['dep','#e04838'],['loop','#9b7ef8'],['yes','#3da870'],['no','#e04838']].forEach(([id,color]) => {
    const m = document.createElementNS('http://www.w3.org/2000/svg','marker');
    m.setAttribute('id','arr-'+id); m.setAttribute('viewBox','0 0 8 8');
    m.setAttribute('refX','6'); m.setAttribute('refY','4');
    m.setAttribute('markerWidth','5'); m.setAttribute('markerHeight','5'); m.setAttribute('orient','auto');
    const p = document.createElementNS('http://www.w3.org/2000/svg','polygon');
    p.setAttribute('points','0,1 7,4 0,7'); p.setAttribute('fill',color);
    m.appendChild(p); defs.appendChild(m);
  });
  svg.appendChild(defs);

  // ── GROUP CONTAINERS — bounded boxes for L1/L2 process groups ──
  renderGroupContainers(svg);

  // Pre-compute geometry for all connections
  const geoms = State.connections.map(c => ({ conn:c, geom: getConnGeometry(c) }));

  // For each connection, find crossings with all later connections (avoid duplicates)
  const crossingMap = new Map(); // conn.id → [crossing points]
  for (let i=0; i<geoms.length; i++) {
    for (let j=i+1; j<geoms.length; j++) {
      const pts = findCrossings(geoms[i].geom, geoms[j].geom);
      if (pts.length) {
        // Bridge on the LATER connection (j) — it hops over the earlier one
        if (!crossingMap.has(geoms[j].conn.id)) crossingMap.set(geoms[j].conn.id, []);
        crossingMap.get(geoms[j].conn.id).push(...pts);
      }
    }
  }

  geoms.forEach(({ conn, geom }) => drawConnection(conn, svg, geom, crossingMap.get(conn.id)||[]));

  if (State.connectingFrom && State.connectMouse) {
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1',State.connectingFrom.x); line.setAttribute('y1',State.connectingFrom.y);
    line.setAttribute('x2',State.connectMouse.x); line.setAttribute('y2',State.connectMouse.y);
    line.setAttribute('stroke','#f0a500'); line.setAttribute('stroke-width','1.5'); line.setAttribute('stroke-dasharray','4,3');
    svg.appendChild(line);
  }
}

function drawConnection(conn, svg, geom, crossings) {
  if (!geom) return;
  const { x1,y1,x2,y2, isBack, isLoop, isSameRowBack, isWrapDown, fn,tn,fw,fh,tw,th,GAP } = geom;

  const styleMap = { sequence:'seq', dependency:'dep', loop:'loop', yes:'yes', no:'no' };
  const cs = CONN_STYLES[conn.type]||CONN_STYLES.sequence;
  const markerId = 'arr-'+(styleMap[conn.type]||'seq');

  // CON-04: immediate upstream = red, immediate downstream = bright blue, path = teal/coral
  const isHighlighted = conn._highlighted;
  const isImmediate = conn._immediateHighlight;
  const strokeColor = isImmediate==='downstream' ? '#4d79ff'
    : isImmediate==='upstream' ? '#ff4d4d'
    : isHighlighted==='forward' ? 'var(--teal)'
    : isHighlighted==='backward' ? 'var(--coral)'
    : cs.color;
  const strokeWidth = isImmediate ? '2.5' : isHighlighted ? '2' : '1.5';

  function drawPath(d, markerEnd) {
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', strokeColor);
    path.setAttribute('stroke-width', strokeWidth);
    if (cs.dash) path.setAttribute('stroke-dasharray', cs.dash);
    path.setAttribute('fill','none');
    if (markerEnd !== false) path.setAttribute('marker-end',`url(#${markerId})`);
    path.style.cursor='pointer';
    path.addEventListener('click',()=>selectConnection(conn));
    svg.appendChild(path);
  }

  // ── LOOP: soft bezier arc above, top→top ──
  if (isLoop) {
    const lx1=fn.x+fw/2, ly1=fn.y;
    const lx2=tn.x+tw/2, ly2=tn.y;
    const loopY = Math.min(ly1,ly2) - 60;
    // Cubic bezier: start top, curve high above, arrive top of target
    const d = `M${lx1} ${ly1} C${lx1} ${loopY} ${lx2} ${loopY} ${lx2} ${ly2}`;
    drawPath(d);
    addSvgLabel(svg,(lx1+lx2)/2, loopY-10, 'loop-back', cs.color);
    return;
  }

  // ── ROW-WRAP: bottom-centre → orthogonal rounded → top-centre ──
  if (isWrapDown) {
    const ox1 = fn.x + fw/2, oy1 = fn.y + fh;
    const ox2 = tn.x + tw/2, oy2 = tn.y;
    const routeY = geom.routeY || (oy1 + oy2) / 2;
    const R = 10;
    const d = `M${ox1} ${oy1}
      L${ox1} ${routeY - R} Q${ox1} ${routeY} ${ox1 + R} ${routeY}
      L${ox2 - R} ${routeY} Q${ox2} ${routeY} ${ox2} ${routeY - R}
      L${ox2} ${oy2}`.replace(/\n\s+/g,' ');
    drawPath(d);
    return;
  }

  // ── SAME-ROW BACK: right-centre → orthogonal rounded arc above → top-centre ──
  if (isSameRowBack) {
    const ex = fn.x + fw,    ey = fn.y + fh/2;
    const tx = tn.x + tw/2,  ty = tn.y;
    const arcY = Math.min(fn.y, tn.y) - 50;
    const R = 12;
    // Orthogonal: right → up → left → down into top of target, rounded corners
    const d = `M${ex} ${ey}
      L${ex + R} ${ey} Q${ex + R*2} ${ey} ${ex + R*2} ${ey - R}
      L${ex + R*2} ${arcY + R} Q${ex + R*2} ${arcY} ${ex + R} ${arcY}
      L${tx + R} ${arcY} Q${tx} ${arcY} ${tx} ${arcY + R}
      L${tx} ${ty}`.replace(/\n\s+/g,' ');
    drawPath(d);
    const lbl = conn.label||cs.label;
    if (lbl) addSvgLabel(svg,(ex+tx)/2, arcY-8, lbl, cs.color);
    return;
  }

  // ── NORMAL FORWARD: right-centre → soft bezier → left-centre ──
  const dx = Math.abs(x2-x1);
  const cx = dx > 80 ? dx*0.45 : 60;
  const dStr = `M${x1} ${y1} C${x1+cx} ${y1} ${x2-cx} ${y2} ${x2} ${y2}`;
  drawPath(dStr);

  // Standard flowchart crossing — small hop arc (semicircle) where connectors cross
  if (crossings && crossings.length) {
    const HOP_R = 6;
    crossings.forEach(pt => {
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const bx1 = pt.x - Math.cos(ang)*HOP_R, by1 = pt.y - Math.sin(ang)*HOP_R;
      const bx2 = pt.x + Math.cos(ang)*HOP_R, by2 = pt.y + Math.sin(ang)*HOP_R;
      // Erase background under arc so it reads cleanly
      const gap = document.createElementNS('http://www.w3.org/2000/svg','circle');
      gap.setAttribute('cx', pt.x); gap.setAttribute('cy', pt.y);
      gap.setAttribute('r', HOP_R + 1);
      gap.setAttribute('fill', 'var(--bg0, #07090c)');
      svg.appendChild(gap);
      // Hop arc
      const arc = document.createElementNS('http://www.w3.org/2000/svg','path');
      arc.setAttribute('d', `M${bx1} ${by1} A${HOP_R} ${HOP_R} 0 0 1 ${bx2} ${by2}`);
      arc.setAttribute('stroke', strokeColor);
      arc.setAttribute('stroke-width', strokeWidth);
      arc.setAttribute('fill', 'none');
      svg.appendChild(arc);
    });
  }

  const lbl = conn.label||cs.label;
  if (lbl) addSvgLabel(svg,(x1+x2)/2,(y1+y2)/2-8, lbl, cs.color);
}

function addSvgLabel(svg,x,y,text,color) {
  const t = document.createElementNS('http://www.w3.org/2000/svg','text');
  t.setAttribute('x',x); t.setAttribute('y',y); t.setAttribute('text-anchor','middle');
  t.setAttribute('font-size','11'); t.setAttribute('fill',color);
  t.setAttribute('font-family','IBM Plex Mono,monospace'); t.textContent=text;
  svg.appendChild(t);
}

// ── DRAG FROM PALETTE ─────────────────────────────
let dragType = null;
function onDragStart(e) { dragType = e.currentTarget.dataset.type; }
function onDrop(e) {
  if (!State.currentProcess) { notify('Create or select a process first','error'); return; }
  e.preventDefault();
  const rect = document.getElementById('canvas-wrap').getBoundingClientRect();
  const x = (e.clientX-rect.left-State.offset.x)/State.scale;
  const y = (e.clientY-rect.top-State.offset.y)/State.scale;
  if (dragType) { addNode(dragType,x-85,y-35); dragType=null; }
}

function addNode(type, x, y) {
  pushUndo();
  State.nodeCounter++;
  const id = `N-${String(State.nodeCounter).padStart(3,'0')}`;
  const defaults = getSmartDefaults(type);
  const node = {
    id, type,
    name: type==='start'?'START':type==='end'?'END':type==='decision'?'Decision':type==='ccp'?'Critical Control Point':'New Step',
    stepId: (type==='start'||type==='end')?'':id,
    x:Math.round(x), y:Math.round(y),
    responsible:'', accountable:'', consulted:'', informed:'',
    timing:'', notes:'', loopConfirm:false,
    thresholds:[],
    ...defaults,
  };
  State.nodes.push(node);
  State.lastNodeLevel = node.level;
  State.dirty = true;
  bufferAudit('modified', `Step added: "${node.name}" [${type}]`, { field:'node', from:null, to:node.name });
  document.getElementById('empty-state').style.display = 'none';
  renderNode(node); renderConnections(); selectNode(node);
}

// ── NODE DRAG ─────────────────────────────────────
function startNodeDrag(e, node) {
  const rect = document.getElementById('canvas-wrap').getBoundingClientRect();
  State.dragging = node;
  State.dragOffset = {
    x:(e.clientX-rect.left-State.offset.x)/State.scale-node.x,
    y:(e.clientY-rect.top-State.offset.y)/State.scale-node.y,
  };
}

function onCanvasMouseDown(e) {
  if (e.target.classList.contains('port')) return;
  const isCanvas = ['canvas-wrap','canvas','canvas-svg'].includes(e.target.id);
  if (isCanvas && State.tool==='select') {
    State.panning=true; State.panStart={x:e.clientX-State.offset.x, y:e.clientY-State.offset.y};
    clearSelection();
  }
  if (isCanvas && State.connectingFrom) { State.connectingFrom=null; State.connectMouse=null; renderConnections(); }
}

function onCanvasMouseMove(e) {
  const rect = document.getElementById('canvas-wrap').getBoundingClientRect();
  if (State.panning) { State.offset.x=e.clientX-State.panStart.x; State.offset.y=e.clientY-State.panStart.y; applyTransform(); return; }
  if (State.dragging) {
    const mx=(e.clientX-rect.left-State.offset.x)/State.scale;
    const my=(e.clientY-rect.top-State.offset.y)/State.scale;
    State.dragging.x=Math.round(mx-State.dragOffset.x); State.dragging.y=Math.round(my-State.dragOffset.y);
    const el=document.getElementById(`node-${State.dragging.id}`);
    if (el) { el.style.left=State.dragging.x+'px'; el.style.top=State.dragging.y+'px'; }
    renderConnections(); State.dirty=true; return;
  }
  if (State.connectingFrom) {
    State.connectMouse={x:(e.clientX-rect.left-State.offset.x)/State.scale, y:(e.clientY-rect.top-State.offset.y)/State.scale};
    renderConnections();
  }
}

function onCanvasMouseUp(e) {
  if (State.dragging) {
    State.dirty = true;
    State.dragging = null;
    // LAY-03/07: reflow department bands after drag — box follows nodes, no clamping
    reflowDepartmentBands();
    renderCanvas();
  }
  State.panning = false;
}

function reflowDepartmentBands() {
  const deptGroups = {};
  State.nodes.forEach(n => {
    if (!n.department || !n.department.trim()) return;
    if (!deptGroups[n.department]) deptGroups[n.department] = [];
    deptGroups[n.department].push(n);
  });

  const { PAD, HEADER_H, DEPT_GAP: VISUAL_GAP } = LAYOUT;
  const NODE_H = LAYOUT.NODE_H, NODE_W = LAYOUT.NODE_W;

  const bands = Object.entries(deptGroups).map(([dept, nodes]) => {
    const xs = nodes.map(n => n.x || 0);
    const ys = nodes.map(n => n.y || 0);
    return {
      dept, nodes,
      left:   Math.min(...xs) - PAD,
      right:  Math.max(...xs) + NODE_W + PAD,
      top:    Math.min(...ys) - PAD - HEADER_H,
      bottom: Math.max(...ys) + NODE_H + PAD,
    };
  });

  let changed = true, passes = 0;
  while (changed && passes++ < 20) {
    changed = false;
    for (let i = 0; i < bands.length; i++) {
      for (let j = i+1; j < bands.length; j++) {
        const a = bands[i], b = bands[j];
        const overlapX = a.left < b.right + VISUAL_GAP && a.right + VISUAL_GAP > b.left;
        const overlapY = a.top  < b.bottom + VISUAL_GAP && a.bottom + VISUAL_GAP > b.top;
        if (overlapX && overlapY) {
          const pushDown  = a.bottom + VISUAL_GAP - b.top;
          const pushRight = a.right  + VISUAL_GAP - b.left;
          if (pushDown <= pushRight) {
            b.nodes.forEach(n => { n.y = (n.y||0) + pushDown; });
            b.top += pushDown; b.bottom += pushDown;
          } else {
            b.nodes.forEach(n => { n.x = (n.x||0) + pushRight; });
            b.left += pushRight; b.right += pushRight;
          }
          changed = true;
        }
      }
    }
  }
}

function applyTransform() {
  const t=`translate(${State.offset.x}px,${State.offset.y}px) scale(${State.scale})`;
  const canvas=document.getElementById('canvas'); const svg=document.getElementById('canvas-svg');
  canvas.style.transformOrigin='0 0'; canvas.style.transform=t;
  svg.style.transformOrigin='0 0'; svg.style.transform=t;
}

// ── PORT CONNECT ──────────────────────────────────
function onPortDown(e) {
  e.stopPropagation(); e.preventDefault();
  const nodeId=e.currentTarget.dataset.node, portType=e.currentTarget.dataset.port;
  if (!State.connectingFrom) {
    if (portType==='out'||State.tool!=='select') {
      const node=State.nodes.find(n=>n.id===nodeId);
      const el=document.getElementById(`node-${nodeId}`);
      State.connectingFrom = { nodeId, x:node.x+el.offsetWidth, y:node.y+el.offsetHeight/2 };
    }
  } else {
    if (State.connectingFrom.nodeId!==nodeId) {
      const ct = State.tool==='loop'?'loop':State.tool==='dependency'?'dependency':'sequence';
      addConnection(State.connectingFrom.nodeId, nodeId, ct);
    }
    State.connectingFrom=null; State.connectMouse=null; renderConnections();
  }
}

function addConnection(fromId, toId, type='sequence') {
  if (State.connections.find(c=>c.from===fromId&&c.to===toId&&c.type===type)) { notify('Connection already exists','error'); return; }
  pushUndo();
  State.connections.push({ id:'C-'+Date.now(), from:fromId, to:toId, type, label:'' });
  State.dirty=true; renderConnections();
  notify(`${type} connection added`,'success');
}

// ── SELECTION ─────────────────────────────────────
function selectNode(node) {
  State.selectedNode=node; State.selectedConn=null;
  document.querySelectorAll('.pnode').forEach(el=>el.style.boxShadow='');
  const el=document.getElementById(`node-${node.id}`);
  if (el) el.style.boxShadow='0 0 0 2.5px var(--amber)';
  renderPropsPanel(node);
}

function selectConnection(conn) { State.selectedConn=conn; State.selectedNode=null; renderConnPropsPanel(conn); }

function clearSelection() {
  State.selectedNode=null; State.selectedConn=null;
  document.querySelectorAll('.pnode').forEach(el=>el.style.boxShadow='');
  renderPropsEmpty();
}

function renderPropsEmpty() {
  if (State.currentProcess) {
    const p = State.currentProcess;
    document.getElementById('props-body').innerHTML = `
      <div style="margin-bottom:12px;">
        <div style="font-size:10px;color:var(--text2);letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">Process Properties</div>
      </div>
      <div class="field-group">
        <label class="field-label">Process Name</label>
        <input class="field-input" value="${esc(p.name||'')}" oninput="updateProcessProp('name',this.value)" style="user-select:text;"/>
      </div>
      <div class="field-group">
        <label class="field-label">Process ID</label>
        <input class="field-input" value="${esc(p.processId||'')}" oninput="updateProcessProp('processId',this.value)" style="user-select:text;"/>
      </div>
      <div class="field-group">
        <label class="field-label">Level</label>
        <select class="field-select" onchange="updateProcessProp('level',this.value)">
          ${['L1','L2','L3','L4','L5','L6','L7','L8'].map(l=>`<option ${p.level===l?'selected':''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="field-group">
        <label class="field-label">Owner</label>
        <input class="field-input" value="${esc(p.owner||'')}" oninput="updateProcessProp('owner',this.value)" style="user-select:text;"/>
      </div>
      <div class="field-group">
        <label class="field-label">Function</label>
        <input class="field-input" value="${esc(p.function||'')}" oninput="updateProcessProp('function',this.value)" style="user-select:text;"/>
      </div>
      <div class="field-group">
        <label class="field-label">Description</label>
        <textarea class="field-textarea" oninput="updateProcessProp('description',this.value)" style="user-select:text;">${esc(p.description||'')}</textarea>
      </div>
      <div class="field-group">
        <label class="field-label">Status</label>
        <div style="font-size:13px;color:${p.status==='published'?'var(--teal)':'var(--text1)'};">${p.status||'draft'}</div>
      </div>
      <button class="hdr-btn primary" style="width:100%;margin-top:8px;" onclick="saveProcess().then(()=>notify('Process saved','success'))">Save Process</button>`;
  } else {
    document.getElementById('props-body').innerHTML = '<div style="font-size:13px;color:var(--text2);padding:8px 0;">Select or create a process to begin.</div>';
  }
}

function updateProcessProp(key, value) {
  if (!State.currentProcess) return;
  State.currentProcess[key] = value;
  State.dirty = true;
  // Update header display
  if (key === 'name') updateHeader();
}

// ── PROPERTIES PANEL ──────────────────────────────
function renderPropsPanel(node) {
  const gaps=getGaps(node), col=NODE_COLORS[node.type]||NODE_COLORS.process;
  const classArr=Array.isArray(node.classifications)?node.classifications:[];
  const thresholds=Array.isArray(node.thresholds)?node.thresholds:[];
  const isFunctional=!['start','end'].includes(node.type);

  document.getElementById('props-body').innerHTML = `
    <div style="margin-bottom:13px;">
      <div style="font-size:12px;color:${col.text};letter-spacing:.1em;margin-bottom:5px;text-transform:uppercase;">${node.type} · ${node.id}</div>
      ${gaps.length?`<div class="gap-flag">⚠ ${gaps.join('<br/>⚠ ')}</div>`:`<div class="ok-flag">✓ No gaps detected</div>`}
    </div>

    <div class="field-group">
      <label class="field-label">Step Name</label>
      <input class="field-input" value="${esc(node.name)}" oninput="upNode('${node.id}','name',this.value)" style="user-select:text;"/>
    </div>

    ${isFunctional?`
    <div class="field-row">
      <div class="field-group">
        <label class="field-label">Step ID</label>
        <input class="field-input" value="${esc(node.stepId||'')}" oninput="upNode('${node.id}','stepId',this.value)" style="user-select:text;"/>
      </div>
      <div class="field-group">
        <label class="field-label">Step Type</label>
        <select class="field-select" onchange="changeNodeType('${node.id}',this.value)">
          <option value="process"    ${node.type==='process'?'selected':''}>Process Step</option>
          <option value="control"    ${node.type==='control'?'selected':''}>Control Point</option>
          <option value="ccp"        ${node.type==='ccp'?'selected':''}>Critical Control Pt</option>
          <option value="compliance" ${node.type==='compliance'?'selected':''}>Compliance</option>
          <option value="system"     ${node.type==='system'?'selected':''}>System Step</option>
          <option value="handoff"    ${node.type==='handoff'?'selected':''}>Handoff</option>
          <option value="decision"   ${node.type==='decision'?'selected':''}>Decision Gate</option>
        </select>
      </div>
    </div>

    <div class="field-row">
      <div class="field-group">
        <label class="field-label">Level</label>
        <select class="field-select" onchange="upNode('${node.id}','level',this.value)">
          ${['L1','L2','L3','L4','L5','L6','L7','L8'].map(l=>`<option ${node.level===l?'selected':''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="field-group">
        <label class="field-label">Input Type</label>
        <select class="field-select" onchange="upNode('${node.id}','inputType',this.value)">
          <option ${node.inputType==='manual'?'selected':''}>manual</option>
          <option ${node.inputType==='system'?'selected':''}>system</option>
          <option ${node.inputType==='both'?'selected':''}>both</option>
        </select>
      </div>
    </div>

    ${node.type==='handoff'?`
    <div class="field-group">
      <label class="field-label">Handoff To Process</label>
      <input class="field-input" value="${esc(node.toProcess||'')}" placeholder="Referenced process name..." oninput="upNode('${node.id}','toProcess',this.value)" style="user-select:text;"/>
    </div>`:''}

    ${(node.type==='control'||node.type==='ccp')?`
    <div class="field-group">
      <label class="field-label">Control Nature</label>
      <select class="field-select" onchange="upNode('${node.id}','controlNature',this.value)">
        <option value="P" ${(node.controlNature||'P')==='P'?'selected':''}>Preventive (P)</option>
        <option value="D" ${node.controlNature==='D'?'selected':''}>Detective (D)</option>
      </select>
    </div>`:''}

    <div class="field-group">
      <label class="field-label">Classifications</label>
      <div class="tag-row">
        ${CLASSIFICATION_OPTIONS.map(opt=>{
          const active=classArr.includes(opt.key);
          return `<span class="tag-pill ${active?'t-active':''}"
            style="color:${active?opt.color:'var(--text2)'};border-color:${active?opt.color:'var(--border)'};background:${active?'rgba(0,0,0,.3)':'transparent'}"
            onclick="toggleClass('${node.id}','${opt.key}')">${opt.label}</span>`;
        }).join('')}
      </div>
    </div>

    <div class="field-group">
      <label class="field-label">Monitoring (SMART)</label>
      <label class="field-check ${node.monitoring?'active-check':''}">
        <input type="checkbox" ${node.monitoring?'checked':''} onchange="upNode('${node.id}','monitoring',this.checked)"/>
        Include in SMART monitoring
      </label>
    </div>

    <div class="field-row">
      <div class="field-group">
        <label class="field-label">Timing Window</label>
        <input class="field-input" value="${esc(node.timing||'')}" placeholder="e.g. 09:00" oninput="upNode('${node.id}','timing',this.value)" style="user-select:text;"/>
      </div>
      <div class="field-group">
        <label class="field-label">Frequency</label>
        <select class="field-select" onchange="upNode('${node.id}','frequency',this.value)">
          <option value="" ${!node.frequency?'selected':''}>—</option>
          ${['per-event','daily','weekly','monthly','quarterly','annual'].map(f=>`<option ${node.frequency===f?'selected':''}>${f}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="sb-hr" style="margin:12px 0;"></div>
    <div class="field-label" style="margin-bottom:9px;">RACI</div>
    <table class="raci-table">
      ${[['R','responsible'],['A','accountable'],['C','consulted'],['I','informed']].map(([k,f])=>`
      <tr><td class="raci-key">${k}</td><td>
        <input class="raci-input" value="${esc(node[f]||'')}" placeholder="${f}..." oninput="upNode('${node.id}','${f}',this.value)" style="user-select:text;"/>
      </td></tr>`).join('')}
    </table>

    <div class="sb-hr" style="margin:12px 0;"></div>

    ${(node.type==='control'||node.type==='ccp')?`
    <div class="field-group">
      <label class="field-label">Thresholds</label>
      <div id="threshold-list">
        ${thresholds.map((t,i)=>`
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:9px;margin-bottom:7px;">
          <div class="field-row" style="margin-bottom:6px;">
            <div><label class="field-label">Parameter</label><input class="field-input" value="${esc(t.parameter||'')}" placeholder="e.g. Temperature" oninput="upThreshold('${node.id}',${i},'parameter',this.value)" style="user-select:text;"/></div>
            <div><label class="field-label">Unit</label><input class="field-input" value="${esc(t.unit||'')}" placeholder="e.g. °C" oninput="upThreshold('${node.id}',${i},'unit',this.value)" style="user-select:text;"/></div>
          </div>
          <div class="field-row" style="margin-bottom:6px;">
            <div><label class="field-label">Min</label><input class="field-input" value="${esc(t.min||'')}" placeholder="Min" oninput="upThreshold('${node.id}',${i},'min',this.value)" style="user-select:text;"/></div>
            <div><label class="field-label">Max</label><input class="field-input" value="${esc(t.max||'')}" placeholder="Max" oninput="upThreshold('${node.id}',${i},'max',this.value)" style="user-select:text;"/></div>
          </div>
          <div class="field-group" style="margin-bottom:4px;"><label class="field-label">Corrective Action</label>
            <input class="field-input" value="${esc(t.action||'')}" placeholder="Action if breached..." oninput="upThreshold('${node.id}',${i},'action',this.value)" style="user-select:text;"/>
          </div>
          <button class="hdr-btn" style="font-size:11px;color:var(--coral);border-color:var(--coral);" onclick="removeThreshold('${node.id}',${i})">REMOVE</button>
        </div>`).join('')}
      </div>
      <button class="hdr-btn" style="width:100%;margin-top:4px;" onclick="addThreshold('${node.id}')">+ ADD THRESHOLD</button>
    </div>
    <div class="sb-hr" style="margin:12px 0;"></div>
    `:''}

    <div class="field-group">
      <label class="field-label">Record Keeping</label>
      <label class="field-check ${node.recordRequired?'active-check':''}">
        <input type="checkbox" ${node.recordRequired?'checked':''} onchange="upNode('${node.id}','recordRequired',this.checked)"/>
        Record required for this step
      </label>
      ${node.recordRequired?`
      <div class="field-row" style="margin-top:8px;">
        <div><label class="field-label">Type</label>
          <select class="field-select" onchange="upNode('${node.id}','recordType',this.value)">
            <option ${node.recordType==='system'?'selected':''}>system</option>
            <option ${node.recordType==='paper'?'selected':''}>paper</option>
            <option ${node.recordType==='both'?'selected':''}>both</option>
          </select>
        </div>
        <div><label class="field-label">Retention Period</label>
          <input class="field-input" value="${esc(node.retentionPeriod||'10 years')}" placeholder="e.g. 10 years" oninput="upNode('${node.id}','retentionPeriod',this.value)" style="user-select:text;"/>
        </div>
      </div>`:''}
    </div>

    <div class="field-group">
      <label class="field-label">Loop-back Confirmation</label>
      <label class="field-check ${node.loopConfirm?'active-check':''}">
        <input type="checkbox" ${node.loopConfirm?'checked':''} onchange="upNode('${node.id}','loopConfirm',this.checked)"/>
        Requires output confirmation before proceeding
      </label>
    </div>

    <div class="field-group">
      <label class="field-label">Department</label>
      <input class="field-input" value="${esc(node.department||'')}" placeholder="e.g. Finance, Sales, Warehouse" oninput="upNode('${node.id}','department',this.value);renderCanvas();" style="user-select:text;"/>
    </div>

    <div class="field-group">
      <label class="field-label">Group Container</label>
      <input class="field-input" value="${esc(node.groupId||'')}" placeholder="e.g. Customer Intake" oninput="upNode('${node.id}','groupId',this.value);renderCanvas();" style="user-select:text;" title="Assign to a named group container — shared name draws a bounded box"/>
      <div style="font-size:10px;color:var(--text2);margin-top:3px;">Nodes sharing a group name are enclosed in a bounded box</div>
    </div>

    <div class="field-group">
      <label class="field-label">Notes</label>
      <textarea class="field-textarea" oninput="upNode('${node.id}','notes',this.value)" style="user-select:text;" placeholder="Additional notes...">${esc(node.notes||'')}</textarea>
    </div>

    <div style="margin-top:10px;">
      <button class="hdr-btn warn" style="width:100%;" onclick="deleteSelectedConfirm()">DELETE STEP</button>
    </div>
    `:''}
  `;
}

function renderConnPropsPanel(conn) {
  document.getElementById('props-body').innerHTML = `
    <div style="font-size:12px;color:var(--text1);letter-spacing:.1em;margin-bottom:13px;">CONNECTION · ${conn.id}</div>
    <div class="field-group"><label class="field-label">Type</label>
      <select class="field-select" onchange="upConn('${conn.id}','type',this.value)">
        ${Object.keys(CONN_STYLES).map(t=>`<option ${conn.type===t?'selected':''}>${t}</option>`).join('')}
      </select>
    </div>
    <div class="field-group"><label class="field-label">Label</label>
      <input class="field-input" value="${esc(conn.label||'')}" placeholder="Optional label..." oninput="upConn('${conn.id}','label',this.value)" style="user-select:text;"/>
    </div>
    <div style="margin-top:10px;"><button class="hdr-btn warn" style="width:100%;" onclick="deleteSelectedConfirm()">DELETE CONNECTION</button></div>`;
}

// ── UPDATE HELPERS ────────────────────────────────
function upNode(id, key, value) {
  const node=State.nodes.find(n=>n.id===id); if (!node) return;
  const oldVal = node[key];
  node[key]=value; if (key==='level') State.lastNodeLevel=value;
  State.dirty=true;
  // N39: buffer field-level audit entry for meaningful fields only
  const auditFields = ['name','type','responsible','accountable','classifications','monitoring','frequency','recordRequired','retentionPeriod','department'];
  if (auditFields.includes(key) && String(oldVal) !== String(value)) {
    bufferAudit('modified', `"${node.name}" — ${key} changed`, { field:key, from:oldVal??'—', to:value??'—' });
  }
  const el=document.getElementById(`node-${id}`); if (el) el.remove();
  renderNode(node); renderConnections();
  const el2=document.getElementById(`node-${id}`);
  if (el2) el2.style.boxShadow='0 0 0 2.5px var(--amber)';
  refreshGapFlag(node);
}

function refreshGapFlag(node) {
  const gaps=getGaps(node), gEl=document.querySelector('.gap-flag,.ok-flag'); if (!gEl) return;
  if (gaps.length) { gEl.className='gap-flag'; gEl.innerHTML='⚠ '+gaps.join('<br/>⚠ '); }
  else { gEl.className='ok-flag'; gEl.textContent='✓ No gaps detected'; }
}

function toggleClass(nodeId, key) {
  const node=State.nodes.find(n=>n.id===nodeId); if (!node) return;
  if (!Array.isArray(node.classifications)) node.classifications=[];
  const idx=node.classifications.indexOf(key);
  if (idx>=0) node.classifications.splice(idx,1); else node.classifications.push(key);
  State.dirty=true;
  const el=document.getElementById(`node-${nodeId}`); if (el) el.remove();
  renderNode(node); renderConnections();
  const el2=document.getElementById(`node-${nodeId}`);
  if (el2) el2.style.boxShadow='0 0 0 2.5px var(--amber)';
  renderPropsPanel(node);
}

function changeNodeType(id, newType) {
  pushUndo();
  const node=State.nodes.find(n=>n.id===id); if (!node) return;
  node.type=newType;
  if (newType==='control'||newType==='ccp') node.classifications=['control'];
  else if (newType==='compliance') node.classifications=['compliance-internal'];
  State.dirty=true;
  const el=document.getElementById(`node-${id}`); if (el) el.remove();
  renderNode(node); renderConnections();
  const el2=document.getElementById(`node-${id}`);
  if (el2) el2.style.boxShadow='0 0 0 2.5px var(--amber)';
  renderPropsPanel(node); notify(`Step changed to ${newType}`,'success');
}

function upConn(id, key, value) {
  const conn=State.connections.find(c=>c.id===id); if (!conn) return;
  conn[key]=value; State.dirty=true; renderConnections();
}

// ── THRESHOLDS ────────────────────────────────────
function addThreshold(nodeId) {
  const node=State.nodes.find(n=>n.id===nodeId); if (!node) return;
  if (!Array.isArray(node.thresholds)) node.thresholds=[];
  node.thresholds.push({parameter:'',min:'',max:'',unit:'',action:''}); State.dirty=true; renderPropsPanel(node);
}
function upThreshold(nodeId, idx, key, value) {
  const node=State.nodes.find(n=>n.id===nodeId); if (!node||!node.thresholds[idx]) return;
  node.thresholds[idx][key]=value; State.dirty=true;
}
function removeThreshold(nodeId, idx) {
  const node=State.nodes.find(n=>n.id===nodeId); if (!node) return;
  pushUndo(); node.thresholds.splice(idx,1); State.dirty=true; renderPropsPanel(node);
}

// ── GAP DETECTION ─────────────────────────────────
function getGaps(node) {
  if (['start','end','decision'].includes(node.type)) return [];
  const gaps=[];
  if (!node.responsible&&!node.accountable) gaps.push('RACI: Responsible/Accountable missing');
  if (!node.frequency) gaps.push('Frequency not defined');
  if (!node.classifications||!node.classifications.length) gaps.push('No classification assigned');
  if (node.recordRequired&&!node.retentionPeriod) gaps.push('Retention period missing');
  if ((node.type==='control'||node.type==='ccp')&&(!node.thresholds||!node.thresholds.length)) gaps.push('No thresholds defined');
  return gaps;
}

// ── DELETE WITH CONFIRM ───────────────────────────
function confirmDeleteProcess(id, name) {
  document.getElementById('confirm-title').textContent = 'CONFIRM DELETE PROCESS';
  document.getElementById('confirm-msg').textContent = `Delete process: "${name}"?`;
  document.getElementById('confirm-sub').textContent = 'All steps and connections in this process will be permanently deleted.';
  State.confirmCallback = () => deleteProcess(id);
  document.getElementById('modal-confirm').style.display = 'flex';
}

function deleteSelectedConfirm() {
  if (!State.selectedNode&&!State.selectedConn) return;
  const name=State.selectedNode?(State.selectedNode.name||State.selectedNode.id):`connection ${State.selectedConn.id}`;
  const type=State.selectedNode?'step':'connection';
  document.getElementById('confirm-title').textContent='CONFIRM DELETE';
  document.getElementById('confirm-msg').textContent=`Delete ${type}: "${name}"?`;
  document.getElementById('confirm-sub').textContent='This action can be undone with the Undo button.';
  State.confirmCallback=executeDelete;
  document.getElementById('modal-confirm').style.display='flex';
}

function confirmDeleteOk() {
  closeModal('modal-confirm');
  if (State.confirmCallback) { State.confirmCallback(); State.confirmCallback=null; State.confirmCancelCallback=null; }
}

function confirmDeleteCancel() {
  closeModal('modal-confirm');
  if (State.confirmCancelCallback) { State.confirmCancelCallback(); State.confirmCancelCallback=null; }
  State.confirmCallback=null;
}

function executeDelete() {
  pushUndo();
  if (State.selectedNode) {
    const id=State.selectedNode.id;
    bufferAudit('deleted', `Step deleted: "${State.selectedNode.name}" [${State.selectedNode.type}]`, { field:'node', from:State.selectedNode.name, to:null });
    State.nodes=State.nodes.filter(n=>n.id!==id);
    State.connections=State.connections.filter(c=>c.from!==id&&c.to!==id);
    State.dirty=true; clearSelection(); renderCanvas();
    if (!State.nodes.length) document.getElementById('empty-state').style.display='block';
    notify('Step deleted','info');
  } else if (State.selectedConn) {
    bufferAudit('modified', `Connector deleted: ${State.selectedConn.type}`, { field:'connection', from:State.selectedConn.id, to:null });
    State.connections=State.connections.filter(c=>c.id!==State.selectedConn.id);
    State.dirty=true; clearSelection(); renderConnections();
    notify('Connection deleted','info');
  }
}

// ── TOOLS ─────────────────────────────────────────
function setTool(tool) {
  State.tool=tool; State.connectingFrom=null; State.connectMouse=null; renderConnections();
  ['select','connect','loop','dep'].forEach(t => document.getElementById(`tb-${t}`)?.classList.toggle('active',t===tool));
  document.getElementById('canvas-wrap').style.cursor=tool==='select'?'default':'crosshair';
}

function zoom(delta) {
  State.scale=Math.min(2.5,Math.max(0.25,State.scale+delta));
  document.getElementById('zoom-label').textContent=Math.round(State.scale*100)+'%';
  applyTransform();
}
function onWheel(e) { e.preventDefault(); zoom(e.deltaY>0?-0.08:0.08); }
function fitView() {
  if (!State.nodes.length) return;
  const xs=State.nodes.map(n=>n.x), ys=State.nodes.map(n=>n.y);
  State.offset.x=-Math.min(...xs)*State.scale+80; State.offset.y=-Math.min(...ys)*State.scale+80;
  applyTransform();
}
// ── LAYOUT CONSTANTS (single source of truth) ────
const LAYOUT = {
  GAP_X:    260,   // horizontal gap between nodes
  GAP_Y:    160,   // vertical gap between rows
  START_X:  80,
  START_Y:  80,
  NODE_W:   200,   // default node width estimate
  NODE_H:   100,   // default node height estimate
  MARGIN:   24,    // minimum gap between nodes
  PAD:      36,    // dept box padding around nodes
  HEADER_H: 36,    // dept box header band height
  DEPT_GAP: 30,    // minimum gap between dept boxes
};

// Get real node dimensions from DOM, fallback to estimates
function nodeSize(n) {
  const el = document.getElementById(`node-${n.id}`);
  return {
    w: (el && el.offsetWidth  > 0) ? el.offsetWidth  : LAYOUT.NODE_W,
    h: (el && el.offsetHeight > 0) ? el.offsetHeight : LAYOUT.NODE_H,
  };
}

// Layout a group of nodes sequentially following connection order.
// New rows continue from the X position of the last node in the previous row
// (not reset to START_X) — keeps flow readable.
function layoutGroup(nodes, originX, originY) {
  if (!nodes.length) return originY;
  const { GAP_X, GAP_Y, MARGIN, HEADER_H } = LAYOUT;
  const effectiveY = originY + HEADER_H; // reserve header space above first node

  // BFS order if connections exist, else original order
  const ids = new Set(nodes.map(n => n.id));
  const hasConns = State.connections.some(c => ids.has(c.from) && ids.has(c.to));
  let ordered;
  if (hasConns) {
    const visited = new Set();
    const roots = nodes.filter(n => !State.connections.some(c => c.to === n.id && ids.has(c.from)));
    const queue = (roots.length ? roots : [nodes[0]]).map(n => n.id);
    ordered = [];
    while (queue.length) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      const node = nodes.find(n => n.id === id);
      if (node) ordered.push(node);
      State.connections.filter(c => c.from === id && ids.has(c.to)).forEach(c => queue.push(c.to));
    }
    nodes.forEach(n => { if (!visited.has(n.id)) ordered.push(n); });
  } else {
    ordered = [...nodes];
  }

  // Place nodes — new row continues from rightmost position of previous row
  let curX = originX, curY = effectiveY, rowMaxH = 0, colCount = 0;
  const MAX_COLS = 4;
  ordered.forEach((n, i) => {
    const sz = nodeSize(n);
    if (colCount > 0 && colCount % MAX_COLS === 0) {
      // New row — start from current X (rightmost of last row), not origin
      curX = originX; // reset to origin X for new row
      curY += rowMaxH + LAYOUT.GAP_Y;
      rowMaxH = 0;
      colCount = 0;
    }
    n.x = curX;
    n.y = curY;
    curX += sz.w + GAP_X;
    rowMaxH = Math.max(rowMaxH, sz.h);
    colCount++;
  });

  // Collision pass — real sizes, push down only (maintain left-to-right order)
  let changed = true, passes = 0;
  while (changed && passes++ < 30) {
    changed = false;
    for (let i = 0; i < ordered.length; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        const a = ordered[i], b = ordered[j];
        const szA = nodeSize(a), szB = nodeSize(b);
        const overlapX = a.x < b.x + szB.w + MARGIN && a.x + szA.w + MARGIN > b.x;
        const overlapY = a.y < b.y + szB.h + MARGIN && a.y + szA.h + MARGIN > b.y;
        if (overlapX && overlapY) {
          b.y = a.y + szA.h + MARGIN;
          changed = true;
        }
      }
    }
  }

  // Return actual bottom edge
  return Math.max(...ordered.map(n => (n.y||0) + nodeSize(n).h));
}

function autoLayout() {
  if (!State.nodes.length) return;
  pushUndo();

  const { START_X, START_Y, PAD, HEADER_H, DEPT_GAP } = LAYOUT;
  const BAND_GAP = PAD * 2 + HEADER_H + DEPT_GAP;

  const deptGroups = {};
  const undeptNodes = [];
  State.nodes.forEach(n => {
    if (n.department && n.department.trim()) {
      if (!deptGroups[n.department]) deptGroups[n.department] = [];
      deptGroups[n.department].push(n);
    } else {
      undeptNodes.push(n);
    }
  });

  const deptKeys = Object.keys(deptGroups);
  const useHorizontal = deptKeys.length >= 2 && deptKeys.length <= 3 &&
    deptKeys.every(d => deptGroups[d].length <= 5);

  function runLayout() {
    if (deptKeys.length >= 2) {
      if (useHorizontal) {
        let x = START_X;
        deptKeys.forEach(dept => {
          const nodes = deptGroups[dept];
          layoutGroup(nodes, x, START_Y);
          const maxRight = Math.max(...nodes.map(n => (n.x||0) + nodeSize(n).w));
          x = maxRight + BAND_GAP;
        });
        if (undeptNodes.length) layoutGroup(undeptNodes, x, START_Y);
      } else {
        let y = START_Y;
        deptKeys.forEach(dept => {
          y = layoutGroup(deptGroups[dept], START_X, y) + BAND_GAP;
        });
        if (undeptNodes.length) layoutGroup(undeptNodes, START_X, y);
      }
    } else {
      layoutGroup(State.nodes, START_X, START_Y);
    }
  }

  // Pass 1 — initial placement with estimated sizes
  runLayout();
  renderCanvas(); // render so DOM elements exist with real sizes

  // Pass 2 — re-run collision with real DOM sizes now available
  runLayout();
  enforceAllDeptGaps();

  State.dirty = true;
  renderCanvas();
  notify('Layout applied', 'success');
}

// Unified dept gap enforcement — push AND pull, all 4 sides
// Used by both autoLayout and post-drag reflow
function enforceAllDeptGaps() {
  const { PAD, HEADER_H, DEPT_GAP } = LAYOUT;
  const MIN_GAP = DEPT_GAP;
  const MAX_GAP = DEPT_GAP + 20; // tolerated maximum before pulling together

  const deptGroups = {};
  State.nodes.forEach(n => {
    if (!n.department || !n.department.trim()) return;
    if (!deptGroups[n.department]) deptGroups[n.department] = [];
    deptGroups[n.department].push(n);
  });

  function getBBox(nodes) {
    let minX = Infinity, minY = Infinity, maxR = -Infinity, maxB = -Infinity;
    nodes.forEach(n => {
      const sz = nodeSize(n);
      minX = Math.min(minX, n.x||0);
      minY = Math.min(minY, n.y||0);
      maxR = Math.max(maxR, (n.x||0) + sz.w);
      maxB = Math.max(maxB, (n.y||0) + sz.h);
    });
    return { left: minX - PAD, top: minY - PAD - HEADER_H, right: maxR + PAD, bottom: maxB + PAD };
  }

  const depts = Object.entries(deptGroups).map(([dept, nodes]) => ({ dept, nodes, ...getBBox(nodes) }));

  let changed = true, passes = 0;
  while (changed && passes++ < 25) {
    changed = false;
    for (let i = 0; i < depts.length; i++) {
      for (let j = i + 1; j < depts.length; j++) {
        const a = depts[i], b = depts[j];
        // Recompute each iteration since nodes moved
        Object.assign(a, getBBox(a.nodes));
        Object.assign(b, getBBox(b.nodes));

        const gapX_ab = b.left - a.right;   // gap between a's right and b's left
        const gapY_ab = b.top  - a.bottom;  // gap between a's bottom and b's top
        const overlapX = a.left < b.right && a.right > b.left;
        const overlapY = a.top  < b.bottom && a.bottom > b.top;

        if (overlapX && overlapY) {
          // Overlapping — push apart
          const pushDown  = a.bottom + MIN_GAP - b.top;
          const pushRight = a.right  + MIN_GAP - b.left;
          if (pushDown <= pushRight) {
            b.nodes.forEach(n => { n.y = (n.y||0) + pushDown; });
          } else {
            b.nodes.forEach(n => { n.x = (n.x||0) + pushRight; });
          }
          changed = true;
        } else if (gapY_ab > MAX_GAP && !overlapX) {
          // Too far apart vertically — pull b up
          const pull = gapY_ab - MIN_GAP;
          b.nodes.forEach(n => { n.y = (n.y||0) - pull; });
          changed = true;
        } else if (gapX_ab > MAX_GAP && !overlapY) {
          // Too far apart horizontally — pull b left
          const pull = gapX_ab - MIN_GAP;
          b.nodes.forEach(n => { n.x = (n.x||0) - pull; });
          changed = true;
        }
      }
    }
  }
}

function reflowDepartmentBands() {
  enforceAllDeptGaps();
}

// computeDeptBounds kept for compatibility
function computeDeptBounds() {
  const { PAD, HEADER_H } = LAYOUT;
  const bounds = {};
  State.nodes.forEach(n => {
    if (!n.department || !n.department.trim()) return;
    if (!bounds[n.department]) bounds[n.department] = { left:Infinity, top:Infinity, right:-Infinity, bottom:-Infinity, nodes:[] };
    const b = bounds[n.department];
    const sz = nodeSize(n);
    b.nodes.push(n);
    b.left   = Math.min(b.left,   (n.x||0) - PAD);
    b.top    = Math.min(b.top,    (n.y||0) - PAD - HEADER_H);
    b.right  = Math.max(b.right,  (n.x||0) + sz.w + PAD);
    b.bottom = Math.max(b.bottom, (n.y||0) + sz.h + PAD);
  });
  return bounds;
}

function exportCanvasPDF() {
  if (!State.currentProcess) return;
  const p = State.currentProcess;

  // Get canvas bounds
  const allX = State.nodes.map(n => n.x||0);
  const allY = State.nodes.map(n => n.y||0);
  if (!allX.length) { notify('No steps on canvas to export','error'); return; }
  const minX = Math.min(...allX) - 60;
  const minY = Math.min(...allY) - 60;
  const maxX = Math.max(...allX) + 300;
  const maxY = Math.max(...allY) + 200;
  const W = maxX - minX;
  const H = maxY - minY;

  // Clone SVG (connectors + group containers)
  const svgEl = document.getElementById('canvas-svg');
  const svgClone = svgEl ? svgEl.cloneNode(true) : document.createElementNS('http://www.w3.org/2000/svg','svg');
  svgClone.setAttribute('viewBox', `${minX} ${minY} ${W} ${H}`);
  svgClone.setAttribute('width', W);
  svgClone.setAttribute('height', H);

  // Clone node HTML elements as foreign objects won't work in print — snapshot as SVG text labels
  const nodesSVG = State.nodes.map(n => {
    const el = document.getElementById(`node-${n.id}`);
    const w = el ? el.offsetWidth : 172;
    const h = el ? el.offsetHeight : 80;
    const col = NODE_COLORS[n.type]||NODE_COLORS.process;
    return `
      <rect x="${n.x}" y="${n.y}" width="${w}" height="${h}" rx="5"
        fill="#131824" stroke="${col.border||col.text||'#0db89e'}" stroke-width="1.5"/>
      <text x="${n.x+10}" y="${n.y+18}" font-size="9" fill="${col.text||'#0db89e'}"
        font-family="IBM Plex Mono,monospace" font-weight="600">${n.stepId||n.id}</text>
      <text x="${n.x+10}" y="${n.y+33}" font-size="11" fill="#f0f3f8"
        font-family="IBM Plex Mono,monospace" font-weight="500"
        textLength="${w-20}" lengthAdjust="spacingAndGlyphs">${(n.name||'').slice(0,28)}</text>
      <text x="${n.x+10}" y="${n.y+47}" font-size="9" fill="#9aaac8"
        font-family="IBM Plex Mono,monospace">${n.type.toUpperCase()} · ${n.responsible||'—'}</text>`;
  }).join('');

  const fullSVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${W} ${H}" width="${W}" height="${H}">
  <rect x="${minX}" y="${minY}" width="${W}" height="${H}" fill="#07090c"/>
  ${svgClone.innerHTML}
  ${nodesSVG}
</svg>`;

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head>
    <title>${p.name} — MERIDIAN Process Blueprint</title>
    <style>
      body { margin:0; background:#07090c; }
      .header { font-family:monospace; color:#9aaac8; padding:16px 24px; border-bottom:1px solid #2e3c58; display:flex; justify-content:space-between; }
      .header h1 { color:#f0f3f8; font-size:16px; margin:0 0 4px; }
      .header p { margin:0; font-size:11px; }
      svg { display:block; max-width:100%; }
      @media print {
        .no-print { display:none; }
        body { background:white; }
        svg { filter:invert(1) hue-rotate(180deg); }
      }
    </style>
  </head><body>
    <div class="header">
      <div><h1>${p.name}</h1><p>${p.processId||'—'} · ${p.function||'—'} · v${p.version||1} · ${new Date().toLocaleDateString('en-GB')}</p></div>
      <button class="no-print" onclick="window.print()" style="background:#f0a500;border:none;border-radius:5px;color:#07090c;font-weight:700;padding:8px 18px;cursor:pointer;font-size:13px;">PRINT / SAVE PDF</button>
    </div>
    ${fullSVG}
  </body></html>`);
  win.document.close();
  notify('PDF preview opened — use Print to save as PDF','success');
}
function exportSOP() {
  if (!State.currentProcess) return;
  const p=State.currentProcess;
  const steps=State.nodes.filter(n=>!['start','end','decision'].includes(n.type));
  const pedigree=buildPedigree(p.id).map(c=>c.name).join(' › ');

  // RACI annexure
  const raciRows = steps.map(s =>
    `| ${s.stepId||s.id} | ${s.name} | ${s.responsible||'—'} | ${s.accountable||'—'} | ${s.consulted||'—'} | ${s.informed||'—'} |`
  ).join('\n');

  let txt = `================================================================================
STANDARD OPERATING PROCEDURE — GENERATED BY MERIDIAN
================================================================================
Process ID:  ${p.processId||'—'}
Department:  ${p.function||'—'}
Title:       ${p.name}
Pedigree:    ${pedigree}
Level:       ${p.level||'L2'}
Owner:       ${p.owner||'—'}
Generated:   ${new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}
Version:     ${p.version||1}  |  Status: ${(p.status||'draft').toUpperCase()}
--------------------------------------------------------------------------------

1. DESCRIPTION
${p.description||'—'}

2. STEPS
--------------------------------------------------------------------------------
${steps.map((n,i)=>`
Step ${i+1}: ${n.name} [${n.stepId||n.id}]
  Type:            ${n.type.toUpperCase()}
  Level:           ${n.level||'L4'}
  Classifications: ${(n.classifications||[]).join(', ')||'None'}
  Input Type:      ${n.inputType||'manual'}
  Frequency:       ${n.frequency||'—'}
  Timing:          ${n.timing||'—'}
  Monitoring:      ${n.monitoring?'YES (SMART)':'No'}
  Record Required: ${n.recordRequired?`YES — ${n.recordType||'system'} — Retain: ${n.retentionPeriod||'10 years'}`:'No'}
  Loop-back:       ${n.loopConfirm?'YES':'No'}
  ${n.thresholds&&n.thresholds.length?'Thresholds:\n'+n.thresholds.map(t=>`    ${t.parameter}: ${t.min}–${t.max} ${t.unit} | Action: ${t.action||'—'}`).join('\n'):''}
  ${n.notes?'Notes: '+n.notes:''}`).join('\n')}

3. CONTROL POINTS
--------------------------------------------------------------------------------
${steps.filter(n=>n.type==='control'||n.type==='ccp').map(n=>`* ${n.name} [${n.stepId||n.id}]${n.type==='ccp'?' — CRITICAL CONTROL POINT':''}`).join('\n')||'None defined.'}

4. DEPENDENCIES
--------------------------------------------------------------------------------
${State.connections.filter(c=>c.type==='dependency').map(c=>{
  const f=State.nodes.find(n=>n.id===c.from),t=State.nodes.find(n=>n.id===c.to);
  return `* ${f?.name||c.from} BLOCKS ${t?.name||c.to}`;
}).join('\n')||'None defined.'}

================================================================================
ANNEXURE A — RACI MATRIX
================================================================================
| Step ID | Step Name | Responsible | Accountable | Consulted | Informed |
|---------|-----------|-------------|-------------|-----------|----------|
${raciRows||'| — | No steps defined | — | — | — | — |'}

================================================================================
END — Generated by MERIDIAN v1.3
================================================================================`;

  const blob=new Blob([txt],{type:'text/plain'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`SOP_${(p.processId||p.name).replace(/\s+/g,'_')}_v${p.version||1}.txt`;
  a.click(); notify('SOP exported','success');
}

// ── MODALS ────────────────────────────────────────
function newProcess() {
  const sel=document.getElementById('np-parent');
  sel.innerHTML='<option value="">— None (Top Level) —</option>';
  State.processes.forEach(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=`${p.name} (${p.level||'L2'})`;sel.appendChild(o);});
  ['np-name','np-id','np-desc','np-owner'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('np-fn').value='';
  document.getElementById('modal-new').style.display='flex';
  setTimeout(()=>document.getElementById('np-name').focus(),100);
}
function closeModal(id) { document.getElementById(id).style.display='none'; }

// ── NOTIFICATIONS ─────────────────────────────────
function notify(msg,type='info') {
  const area=document.getElementById('notif-area');
  const el=document.createElement('div'); el.className=`notif ${type}`; el.textContent=msg;
  area.appendChild(el); setTimeout(()=>el.remove(),3000);
}

function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── KEYBOARD ─────────────────────────────────────
document.addEventListener('keydown', e => {
  const typing=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName);
  if ((e.key==='Delete'||e.key==='Backspace')&&!typing) { e.preventDefault(); deleteSelectedConfirm(); }
  if ((e.ctrlKey||e.metaKey)&&e.key==='s') { e.preventDefault(); saveProcess(); }
  if ((e.ctrlKey||e.metaKey)&&e.key==='z') { e.preventDefault(); undoAction(); }
  if (e.key==='Escape') { clearSelection(); State.connectingFrom=null; State.connectMouse=null; renderConnections(); setTool('select'); }
});

// ── V1.6 BUS INTEGRATION ─────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (typeof MeridianBus === 'undefined') return;

  MeridianBus.on('arco:patch-proposed', ({ patch }) => {
    if (!window.State.currentProcess || !patch?.length) return;
    pushUndo();
    patch.forEach(op => {
      if (op.op === 'insert-after' || op.op === 'insert-before') {
        const anchorIdx = window.State.nodes.findIndex(n => n.stepId === op.afterStepId || n.stepId === op.beforeStepId || n.id === op.afterStepId || n.id === op.beforeStepId);
        window.State.nodeCounter++;
        const id = `N-${String(window.State.nodeCounter).padStart(3,'0')}`;
        const newNode = { id, ...op.step, stepId: op.step.stepId || id, level: op.step.level||'L4', classifications: op.step.classifications||[], thresholds: op.step.thresholds||[], x:0, y:0 };
        if (anchorIdx >= 0) {
          const insertIdx = op.op === 'insert-after' ? anchorIdx + 1 : anchorIdx;
          window.State.nodes.splice(insertIdx, 0, newNode);
          if (op.op === 'insert-after') {
            const anchor = window.State.nodes[anchorIdx];
            const outgoing = window.State.connections.filter(c => c.from === anchor.id);
            if (outgoing.length) { const first = outgoing[0]; const oldTo = first.to; first.to = newNode.id; window.State.connections.push({ id:'C-'+Date.now()+'b', from:newNode.id, to:oldTo, type:'sequence', label:'' }); }
            else { window.State.connections.push({ id:'C-'+Date.now()+'a', from:anchor.id, to:newNode.id, type:'sequence', label:'' }); }
          }
        } else { window.State.nodes.push(newNode); }
      } else if (op.op === 'update') {
        const node = window.State.nodes.find(n => n.stepId === op.stepId || n.id === op.stepId);
        if (node) Object.assign(node, op.changes);
      } else if (op.op === 'delete') {
        const idx = window.State.nodes.findIndex(n => n.stepId === op.stepId || n.id === op.stepId);
        if (idx >= 0) { const removed = window.State.nodes[idx]; window.State.nodes.splice(idx, 1); window.State.connections = window.State.connections.filter(c => c.from !== removed.id && c.to !== removed.id); }
      } else if (op.op === 'add-connection') {
        const fromNode = window.State.nodes.find(n => n.stepId === op.from || n.id === op.from);
        const toNode   = window.State.nodes.find(n => n.stepId === op.to   || n.id === op.to);
        if (fromNode && toNode) window.State.connections.push({ id:'C-'+Date.now(), from:fromNode.id, to:toNode.id, type:op.type||'sequence', label:op.label||'' });
      }
    });
    window.State.dirty = true;
    renderCanvas(); autoLayout();
    notify(`ARCŌ applied ${patch.length} change${patch.length>1?'s':''}.`, 'success');
  });

  MeridianBus.on('promap:blueprint-changed', () => {
    const badge = document.getElementById('cortex-stale-badge');
    if (badge) badge.style.display = '';
  });
});

// ── V1.6 LAYER FILTERS ───────────────────────────
const LAYER_FILTERS = {
  'all':            { nodeTypes: null },
  'controls-only':  { nodeTypes: ['control','ccp'] },
  'critical-only':  { nodeTypes: ['ccp'] },
  'manual-controls':{ nodeTypes: ['control','ccp'], inputTypeFilter: 'manual' },
  'compliance-view':{ nodeTypes: ['compliance','control','ccp'] },
  'process-only':   { nodeTypes: ['start','end','process','decision','handoff','system'] },
  'monitoring-view':{ nodeTypes: null, monitoringFilter: true },
};
let activeLayerFilter = 'all';
let activeLevelFilter = 'all';

function setLayerFilter(key) {
  activeLayerFilter = key;
  document.querySelectorAll('#layer-filter .lf-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === key);
  });
  applyLayerFilter();
}

// Item 5 — Level layer filter
function setLevelFilter(key) {
  activeLevelFilter = key;
  document.querySelectorAll('#level-filter .lf-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.level === key);
  });
  applyLayerFilter();
}

function applyLayerFilter() {
  const f = LAYER_FILTERS[activeLayerFilter];
  if (!f) return;
  window.State.nodes.forEach(n => {
    const el = document.getElementById(`node-${n.id}`);
    if (!el) return;
    let show = true;
    // Classification/type filter
    if (f.nodeTypes && !f.nodeTypes.includes(n.type)) show = false;
    if (f.inputTypeFilter && n.inputType !== f.inputTypeFilter) show = false;
    if (f.monitoringFilter && !n.monitoring) show = false;
    // Level filter
    if (activeLevelFilter !== 'all') {
      if (activeLevelFilter === 'L5') {
        // L5+ means L5, L6, L7, L8
        const lvl = parseInt((n.level||'L4').slice(1));
        if (lvl < 5) show = false;
      } else {
        if (n.level !== activeLevelFilter) show = false;
      }
    }
    el.style.opacity = show ? '1' : '0.12';
    el.style.pointerEvents = show ? '' : 'none';
  });
}

// Item 3 — Adjacent node highlight: selected + immediate next + immediate prior
function highlightAdjacentNodes(nodeId) {
  const nextIds  = new Set(State.connections.filter(c => c.from === nodeId).map(c => c.to));
  const priorIds = new Set(State.connections.filter(c => c.to   === nodeId).map(c => c.from));
  State.nodes.forEach(n => {
    const el = document.getElementById(`node-${n.id}`);
    if (!el) return;
    if (n.id === nodeId) {
      el.style.boxShadow = '0 0 0 2.5px var(--amber)';
      el.style.opacity = '1';
    } else if (nextIds.has(n.id)) {
      el.style.boxShadow = '0 0 0 2px #4d79ff';
      el.style.opacity = '1';
    } else if (priorIds.has(n.id)) {
      el.style.boxShadow = '0 0 0 2px #ff4d4d';
      el.style.opacity = '1';
    } else {
      el.style.boxShadow = '';
      el.style.opacity = '0.25';
    }
  });
}

// Re-apply filter after render
const _origRenderCanvas = renderCanvas;
window.renderCanvas = function() { _origRenderCanvas(); applyLayerFilter(); };

// ── V1.6 FLOAT PANELS ────────────────────────────
function toggleFloatPanel(name) {
  const panel = document.getElementById(`float-${name}`);
  const trigger = document.getElementById(`ft-${name}`);
  if (!panel) return;
  const visible = panel.style.display !== 'none' && panel.style.display !== '';
  panel.style.display = visible ? 'none' : 'flex';
  panel.classList.remove('minimized');
  if (trigger) trigger.classList.toggle('active', !visible);
  if (!visible && name === 'arco') {
    const feed = document.getElementById('float-arco-feed');
    if (feed && feed.children.length === 0 && typeof appendFloatArcoMsg === 'function') {
      // N64: sync float feed from main feed on open
      const mainFeed = document.getElementById('arco-feed');
      const floatFeed = document.getElementById('float-arco-feed');
      if (floatFeed && mainFeed) {
        if (mainFeed.children.length === 0 && typeof arcoGreet === 'function') arcoGreet();
        floatFeed.innerHTML = mainFeed.innerHTML;
        floatFeed.scrollTop = floatFeed.scrollHeight;
      }
    }
  }
}

function minimizeFloatPanel(name) {
  const panel = document.getElementById(`float-${name}`);
  if (panel) panel.classList.toggle('minimized');
}

// Draggable float panels
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.float-panel-header').forEach(header => {
    let dragging = false, ox = 0, oy = 0;
    header.addEventListener('mousedown', e => {
      if (e.target.classList.contains('float-ctrl-btn')) return;
      dragging = true;
      const panel = header.closest('.float-panel');
      const rect = panel.getBoundingClientRect();
      ox = e.clientX - rect.left; oy = e.clientY - rect.top;
      panel.style.right = 'auto'; panel.style.left = rect.left + 'px'; panel.style.top = rect.top + 'px';
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const panel = header.closest('.float-panel');
      panel.style.left = (e.clientX - ox) + 'px';
      panel.style.top  = (e.clientY - oy) + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  });
});

// ── V1.6 GLOSSARY ENFORCEMENT ────────────────────
const MERIDIAN_GLOSSARY = [
  { ext:/flowcharts?/gi,            mer:'Process Blueprint' },
  { ext:/flow\s+charts?/gi,         mer:'Process Blueprint' },
  { ext:/process\s+maps?/gi,        mer:'Process Blueprint' },
  { ext:/\bworkflows?\b/gi,         mer:'Process Flow' },
  { ext:/\bswim\s*lanes?\b/gi,      mer:'Role Track' },
  { ext:/key\s+control\s+points?\b/gi, mer:'Critical Control Point' },
  { ext:/\bKPIs?\b/g,               mer:'Performance Indicator' },
  { ext:/\btask\s+owners?\b/gi,     mer:'Responsible' },
  { ext:/\bapprovers?\b/gi,         mer:'Accountable' },
  { ext:/\bprocess\s+owners?\b/gi,  mer:'Accountable' },
  { ext:/\baudit\s+trails?\b/gi,    mer:'Record Trail' },
  { ext:/real[\s-]time\s+monitoring/gi, mer:'SMART Monitoring' },
  { ext:/\bhand[\s-]?overs?\b/gi,   mer:'Handoff' },
  { ext:/\brework\s+loops?\b/gi,    mer:'Loopback' },
  { ext:/\bsub[\s-]?processes?\b/gi,mer:'Sub-Process' },
];

function applyGlossary(text) {
  if (!text) return '';
  let out = text;
  MERIDIAN_GLOSSARY.forEach(({ ext, mer }) => { out = out.replace(ext, mer); });
  return out;
}

// ── PATH HIGHLIGHTING (BUG-20 restore) ───────────
function getForwardPath(nodeId) {
  const visited = new Set();
  const queue = [nodeId];
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    State.connections.filter(c => c.from === id).forEach(c => queue.push(c.to));
  }
  visited.delete(nodeId);
  return visited;
}

function getBackwardPath(nodeId) {
  const visited = new Set();
  const queue = [nodeId];
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    State.connections.filter(c => c.to === id).forEach(c => queue.push(c.from));
  }
  visited.delete(nodeId);
  return visited;
}

function highlightPath(nodeId) {
  clearPathHighlight();
  if (!nodeId) return;
  const forward  = getForwardPath(nodeId);
  const backward = getBackwardPath(nodeId);

  State.nodes.forEach(n => {
    const el = document.getElementById(`node-${n.id}`);
    if (!el) return;
    if (n.id === nodeId || forward.has(n.id) || backward.has(n.id)) {
      el.style.opacity = '1'; el.style.filter = '';
    } else {
      el.style.opacity = '0.2'; el.style.filter = 'grayscale(1)';
    }
  });

  // CON-04: immediate upstream = red (#ff4d4d), immediate downstream = bright blue (#4d79ff)
  // Path = teal/coral; rest = default
  const immediateDown = State.connections.filter(c => c.from === nodeId);
  const immediateUp   = State.connections.filter(c => c.to   === nodeId);
  const immediateDownIds = new Set(immediateDown.map(c => c.id));
  const immediateUpIds   = new Set(immediateUp.map(c => c.id));

  State.connections.forEach(c => {
    c._immediateHighlight = immediateDownIds.has(c.id) ? 'downstream'
      : immediateUpIds.has(c.id) ? 'upstream' : null;
    if (!c._immediateHighlight) {
      if (forward.has(c.to) && (c.from === nodeId || forward.has(c.from))) c._highlighted = 'forward';
      else if (backward.has(c.from) && (c.to === nodeId || backward.has(c.to))) c._highlighted = 'backward';
      else c._highlighted = null;
    } else {
      c._highlighted = null;
    }
  });
  renderConnections();
}

function clearPathHighlight() {
  State.nodes.forEach(n => {
    const el = document.getElementById(`node-${n.id}`);
    if (el) { el.style.opacity = '1'; el.style.filter = ''; }
  });
  State.connections.forEach(c => { c._highlighted = null; c._immediateHighlight = null; });
}

// Override selectNode to trigger path highlight
const _origSelectNode = selectNode;
window.selectNode = function(node) {
  _origSelectNode(node);
  highlightPath(node.id);
  highlightAdjacentNodes(node.id); // Item 3 — adjacent nodes highlighted
  if (typeof MeridianBus !== 'undefined') MeridianBus.emit('promap:node-selected', { node, nodes: window.State.nodes, connections: window.State.connections });
};

const _origClearSelection = clearSelection;
window.clearSelection = function() {
  _origClearSelection();
  clearPathHighlight();
  if (typeof MeridianBus !== 'undefined') MeridianBus.emit('promap:node-deselected', {});
};


// Dead code removed in v1.6.11
