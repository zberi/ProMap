/* ═══════════════════════════════════════════════
   MERIDIAN — PROMAP Engine v1.6.13
   Fixes: LAY-10 LAY-11 LAY-12
   Updated: 2026-06-25
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
  auditLog: [],
};

// ── LAYOUT CONSTANTS (single source of truth) ──
const LAYOUT = {
  GAP_X: 260,
  GAP_Y: 160,
  START_X: 80,
  START_Y: 80,
  NODE_W: 200,
  NODE_H: 100,
  MARGIN: 24,
  PAD: 36,
  HEADER_H: 36,
  DEPT_GAP: 30,
  MAX_COLS: 4,
  TITLE_H: 24,
};

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

// ── SMART DEFAULTS ────────────────────────────────
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
    department: '',
  };
}

// ── INIT ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => { loadProcesses(); });

// ── AUDIT ─────────────────────────────────────────
function auditEntry(event, detail, source='user') {
  if (!State.currentProcess) return;
  const entry = { ts: new Date().toISOString(), event, detail, source };
  State.auditLog.push(entry);
  if (State.auditLog.length > 500) State.auditLog = State.auditLog.slice(-500);
  // Fire and forget to server
  fetch(`/api/processes/${State.currentProcess.id}/audit`, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ event, detail, source })
  }).catch(()=>{});
}

// ── UNDO ─────────────────────────────────────────
function pushUndo() {
  State.undoStack.push({ nodes: JSON.parse(JSON.stringify(State.nodes)), connections: JSON.parse(JSON.stringify(State.connections)) });
  if (State.undoStack.length > MAX_UNDO) State.undoStack.shift();
  const btn = document.getElementById('btn-undo');
  if (btn) btn.style.display = '';
}

function undoAction() {
  if (!State.undoStack.length) { notify('Nothing to undo','info'); return; }
  const snap = State.undoStack.pop();
  State.nodes = snap.nodes; State.connections = snap.connections;
  State.dirty = true; State.selectedNode = null; State.selectedConn = null;
  renderCanvas(); renderPropsEmpty();
  if (!State.undoStack.length) { const btn=document.getElementById('btn-undo'); if(btn) btn.style.display='none'; }
  const ind = document.getElementById('undo-indicator');
  if (ind) { ind.classList.add('show'); setTimeout(() => ind.classList.remove('show'), 1200); }
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
  try {
    const h = await api('GET','/api/health');
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
    archived: State.currentProcess.archived || false,
    nodes: JSON.parse(JSON.stringify(State.nodes)),
    connections: JSON.parse(JSON.stringify(State.connections)),
  };
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
  const parentId = document.getElementById('np-parent').value || null;
  // Guard: prevent circular pedigree
  if (parentId === State.currentProcess?.id) { notify('Cannot set process as its own parent','error'); return; }
  const proc = {
    name, processId: document.getElementById('np-id').value.trim(),
    parentId,
    function: document.getElementById('np-fn').value,
    description: document.getElementById('np-desc').value.trim(),
    owner: document.getElementById('np-owner').value.trim(),
    level: document.getElementById('np-level').value,
    nodes:[], connections:[], status:'draft', archived:false,
  };
  const created = await api('POST','/api/processes', proc);
  State.processes.push(created);
  closeModal('modal-new');
  loadProcess(created);
  renderProcessList();
  auditEntry('process-created', `Created: ${created.name}`);
  notify(`Process "${created.name}" created`,'success');
}

async function deleteProcessPermanent(id) {
  await api('DELETE', `/api/processes/${id}`);
  State.processes = State.processes.filter(p => p.id !== id);
  if (State.currentProcess?.id === id) {
    State.currentProcess = null; State.nodes = []; State.connections = [];
    updateHeader(); updatePedigree();
    renderCanvas(); renderPropsEmpty();
    const es = document.getElementById('empty-state');
    if (es) es.style.display = 'block';
  }
  renderProcessList();
  notify('Process permanently deleted','info');
}

async function archiveProcess(id) {
  const data = readDataLocal();
  const p = State.processes.find(p => p.id === id);
  if (!p) return;
  p.archived = true; p.status = 'archived';
  await api('PUT', `/api/processes/${id}`, { ...p, archived:true, status:'archived' });
  if (State.currentProcess?.id === id) {
    State.currentProcess = null; State.nodes = []; State.connections = [];
    updateHeader(); updatePedigree();
    renderCanvas(); renderPropsEmpty();
    const es = document.getElementById('empty-state');
    if (es) es.style.display = 'block';
  }
  renderProcessList();
  notify(`"${p.name}" archived`,'info');
}

function readDataLocal() { return { processes: State.processes }; }

async function restoreProcess(id) {
  const p = State.processes.find(p => p.id === id);
  if (!p) return;
  p.archived = false; p.status = 'draft';
  await api('PUT', `/api/processes/${id}`, { ...p, archived:false, status:'draft' });
  renderProcessList();
  notify(`"${p.name}" restored`,'success');
}

async function publishProcess() {
  if (!State.currentProcess) return;
  State.currentProcess.status = 'published';
  await saveProcess(); updateHeader();
  auditEntry('published', `Published v${State.currentProcess.version}`);
}

function loadProcess(proc) {
  if (State.dirty) saveProcess().catch(()=>{});
  State.currentProcess = JSON.parse(JSON.stringify(proc));
  State.nodes = proc.nodes ? JSON.parse(JSON.stringify(proc.nodes)) : [];
  State.connections = proc.connections ? JSON.parse(JSON.stringify(proc.connections)) : [];
  State.nodeCounter = State.nodes.reduce((max,n) => Math.max(max, parseInt(n.id.replace('N-',''))||0), 0);
  State.selectedNode = null; State.selectedConn = null;
  State.dirty = false; State.undoStack = [];
  State.auditLog = proc.auditLog || [];
  const needsLayout = State.nodes.length > 0 && State.nodes.some(n => !n.x && !n.y);
  const btn = document.getElementById('btn-undo');
  if (btn) btn.style.display = 'none';
  setTool('select');
  updateHeader(); updatePedigree();
  renderCanvas(); renderProcessList();
  const es = document.getElementById('empty-state');
  if (es) es.style.display = State.nodes.length ? 'none' : 'block';
  if (needsLayout) setTimeout(() => autoLayout(), 80);
  if (typeof MeridianBus !== 'undefined')
    MeridianBus.emit('promap:process-loaded', { process: State.currentProcess, nodes: State.nodes, connections: State.connections });
}

// ── PEDIGREE ──────────────────────────────────────
function updatePedigree() {
  const bar = document.getElementById('pedigree-bar');
  if (!bar) return;
  if (!State.currentProcess) { bar.textContent = 'No process selected'; return; }
  const crumbs = buildPedigree(State.currentProcess.id);
  bar.innerHTML = crumbs.map((c,i) =>
    i === crumbs.length-1
      ? `<span class="crumb-active">${c.name}</span>`
      : `<span>${c.name}</span><span style="color:var(--text2);margin:0 5px;">›</span>`
  ).join('');
}

function buildPedigree(id) {
  const crumbs = []; let cur = State.processes.find(p => p.id === id);
  const visited = new Set();
  while(cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    crumbs.unshift({id:cur.id, name:cur.name});
    cur = cur.parentId ? State.processes.find(p=>p.id===cur.parentId) : null;
  }
  return crumbs;
}

// ── PROCESS LIST ──────────────────────────────────
function renderProcessList() {
  const el = document.getElementById('process-list');
  if (!el) return;
  el.innerHTML = '';

  const addBtn = document.createElement('div');
  addBtn.style.cssText = 'padding:6px 10px;';
  addBtn.innerHTML = `<button class="hdr-btn primary" style="width:100%;font-size:12px;" onclick="newProcess()">+ ADD PROCESS</button>`;
  el.appendChild(addBtn);

  const active = State.processes.filter(p => !p.archived);
  const archived = State.processes.filter(p => p.archived);

  if (!active.length && !archived.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:8px 14px;font-size:13px;color:var(--text2);';
    empty.textContent = 'No processes yet.';
    el.appendChild(empty);
    return;
  }

  function renderItem(p, depth) {
    const div = document.createElement('div');
    div.className = 'process-item' + (State.currentProcess?.id === p.id ? ' active' : '');
    div.style.cssText = `padding-left:${14+depth*14}px;`;
    div.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div style="flex:1;min-width:0;">
          <div class="pi-name">${depth>0?'└ ':''}${p.name}${p.archived?' <span style="color:var(--text2);font-size:10px;">[archived]</span>':''}</div>
          <div class="pi-meta">${p.processId||'—'} · ${p.level||'L2'} · ${p.function||'—'}</div>
        </div>
        <div style="display:flex;gap:3px;flex-shrink:0;">
          ${p.archived
            ? `<span onclick="event.stopPropagation();restoreProcess('${p.id}');" style="color:var(--teal);cursor:pointer;font-size:11px;padding:0 4px;" title="Restore">↺</span>
               <span onclick="event.stopPropagation();confirmDeletePermanent('${p.id}','${p.name.replace(/'/g,"\\'")}');" style="color:var(--coral);cursor:pointer;font-size:13px;padding:0 4px;" title="Delete permanently">🗑</span>`
            : `<span onclick="event.stopPropagation();confirmArchiveProcess('${p.id}','${p.name.replace(/'/g,"\\'")}');" style="color:var(--text2);cursor:pointer;font-size:15px;padding:0 4px;" title="Archive">×</span>`
          }
        </div>
      </div>`;
    if (!p.archived) div.addEventListener('click', () => loadProcess(p));
    el.appendChild(div);
    if (!p.archived) active.filter(c => c.parentId === p.id).forEach(child => renderItem(child, depth+1));
  }

  active.filter(p => !p.parentId).forEach(p => renderItem(p, 0));

  // SOP Register — published only
  const published = active.filter(p => p.status === 'published');
  if (published.length) {
    const sec = document.createElement('div');
    sec.innerHTML = `<div class="sb-hr" style="margin:8px 14px;"></div><div class="sb-section">SOP Register</div>`;
    el.appendChild(sec);
    published.forEach(p => {
      const d = document.createElement('div');
      d.style.cssText = 'padding:5px 14px;font-size:11px;color:var(--teal);cursor:pointer;';
      d.textContent = `${p.processId||'—'} · ${p.name}`;
      d.onclick = () => loadProcess(p);
      el.appendChild(d);
    });
  }

  // Archived section
  if (archived.length) {
    const sec = document.createElement('div');
    sec.innerHTML = `<div class="sb-hr" style="margin:8px 14px;"></div><div class="sb-section" style="color:var(--text2);">Archived</div>`;
    el.appendChild(sec);
    archived.forEach(p => renderItem(p, 0));
  }
}

// ── HEADER ────────────────────────────────────────
function updateHeader() {
  const p = State.currentProcess;
  const nameEl = document.getElementById('hdr-process-name');
  if (nameEl) nameEl.textContent = p ? p.name : 'No process selected';
  const statusEl = document.getElementById('hdr-status');
  const versionEl = document.getElementById('hdr-version');
  if (p) {
    if (statusEl) { statusEl.textContent = (p.status||'DRAFT').toUpperCase(); statusEl.className = 'status-badge '+(p.status==='published'?'status-published':'status-draft'); statusEl.style.display = ''; }
    if (versionEl) { versionEl.textContent = `v${p.version||1}`; versionEl.style.display = ''; }
    ['btn-save','btn-publish','btn-export'].forEach(id => { const b=document.getElementById(id); if(b) b.style.display=''; });
  } else {
    if (statusEl) statusEl.style.display='none';
    if (versionEl) versionEl.style.display='none';
    ['btn-save','btn-publish','btn-export'].forEach(id => { const b=document.getElementById(id); if(b) b.style.display='none'; });
  }
}

// ── DEPARTMENT BAND LAYOUT ────────────────────────

function getDeptNodes(deptName) {
  return State.nodes.filter(n => (n.department||'') === deptName && !['start','end'].includes(n.type));
}

function getDepts() {
  const depts = new Set();
  State.nodes.forEach(n => { if (n.department) depts.add(n.department); });
  return [...depts];
}

function getNodeSize(nodeId) {
  const el = document.getElementById(`node-${nodeId}`);
  if (el && el.offsetWidth > 0) return { w: el.offsetWidth, h: el.offsetHeight };
  const node = State.nodes.find(n=>n.id===nodeId);
  if (!node) return { w: LAYOUT.NODE_W, h: LAYOUT.NODE_H };
  return { w: ['start','end'].includes(node.type) ? 120 : LAYOUT.NODE_W, h: LAYOUT.NODE_H };
}

// Compute bounding box of a dept (includes PAD + HEADER_H)
function getDeptBBox(deptName) {
  const nodes = getDeptNodes(deptName);
  if (!nodes.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    const sz = getNodeSize(n.id);
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + sz.w);
    maxY = Math.max(maxY, n.y + sz.h);
  });
  return {
    x: minX - LAYOUT.PAD,
    y: minY - LAYOUT.PAD - LAYOUT.HEADER_H,
    w: (maxX - minX) + LAYOUT.PAD * 2,
    h: (maxY - minY) + LAYOUT.PAD * 2 + LAYOUT.HEADER_H,
    name: deptName
  };
}

// LAY-10/11 FIX: enforce dept gaps bidirectionally, called after ANY state change
function enforceAllDeptGaps() {
  const depts = getDepts();
  if (depts.length < 2) return;

  // Iterative relaxation — up to 5 passes for stability
  for (let pass = 0; pass < 5; pass++) {
    let moved = false;
    for (let i = 0; i < depts.length; i++) {
      for (let j = i + 1; j < depts.length; j++) {
        const bA = getDeptBBox(depts[i]);
        const bB = getDeptBBox(depts[j]);
        if (!bA || !bB) continue;

        // Horizontal overlap
        const overlapX = (bA.x + bA.w + LAYOUT.DEPT_GAP) - bB.x;
        // Vertical overlap
        const overlapY = (bA.y + bA.h + LAYOUT.DEPT_GAP) - bB.y;

        if (overlapX > 0 && overlapY > 0) {
          // Push B away from A (choose smaller push axis)
          if (overlapX < overlapY) {
            // Push horizontally
            const pushX = overlapX / 2;
            getDeptNodes(depts[j]).forEach(n => { n.x += pushX; });
            getDeptNodes(depts[i]).forEach(n => { n.x -= pushX; });
          } else {
            // Push vertically
            const pushY = overlapY / 2;
            getDeptNodes(depts[j]).forEach(n => { n.y += pushY; });
            getDeptNodes(depts[i]).forEach(n => { n.y -= pushY; });
          }
          moved = true;
        }

        // LAY-11 FIX: bidirectional pull — if gap is too large, pull B toward A
        // (only pull if no nodes between them — simple heuristic: gap > 3x DEPT_GAP)
        const bANew = getDeptBBox(depts[i]);
        const bBNew = getDeptBBox(depts[j]);
        if (!bANew || !bBNew) continue;
        const gapX = bBNew.x - (bANew.x + bANew.w);
        const gapY = bBNew.y - (bANew.y + bANew.h);
        if (gapX > LAYOUT.DEPT_GAP * 4) {
          const pullX = (gapX - LAYOUT.DEPT_GAP * 2) / 2;
          getDeptNodes(depts[j]).forEach(n => { n.x -= pullX; });
          moved = true;
        }
        if (gapY > LAYOUT.DEPT_GAP * 4) {
          const pullY = (gapY - LAYOUT.DEPT_GAP * 2) / 2;
          getDeptNodes(depts[j]).forEach(n => { n.y -= pullY; });
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

// Render department boundary boxes on SVG
function renderDeptBands() {
  const svg = document.getElementById('canvas-svg');
  if (!svg) return;
  // Remove existing dept rects
  svg.querySelectorAll('.dept-band').forEach(el => el.remove());

  const depts = getDepts();
  const colors = ['var(--teal-lo)','var(--amber-lo)','var(--blue-lo)','var(--violet-lo)','var(--green-lo)'];
  const borders = ['var(--teal)','var(--amber)','var(--blue)','var(--violet)','var(--green)'];

  depts.forEach((dept, idx) => {
    const bb = getDeptBBox(dept);
    if (!bb) return;
    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.classList.add('dept-band');

    const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
    rect.setAttribute('x', bb.x); rect.setAttribute('y', bb.y);
    rect.setAttribute('width', bb.w); rect.setAttribute('height', bb.h);
    rect.setAttribute('rx','6'); rect.setAttribute('ry','6');
    rect.setAttribute('fill', colors[idx % colors.length]);
    rect.setAttribute('stroke', borders[idx % borders.length]);
    rect.setAttribute('stroke-width','1.5');
    rect.setAttribute('stroke-dasharray','6 3');
    rect.setAttribute('opacity','0.5');

    const label = document.createElementNS('http://www.w3.org/2000/svg','text');
    label.setAttribute('x', bb.x + 10);
    label.setAttribute('y', bb.y + LAYOUT.HEADER_H - 8);
    label.setAttribute('font-size','11');
    label.setAttribute('font-weight','600');
    label.setAttribute('fill', borders[idx % borders.length]);
    label.setAttribute('font-family','IBM Plex Mono,monospace');
    label.setAttribute('letter-spacing','0.08em');
    label.textContent = dept.toUpperCase();

    g.appendChild(rect);
    g.appendChild(label);
    // Insert at beginning of SVG so nodes sit on top
    svg.insertBefore(g, svg.firstChild);
  });
}

// ── CANVAS ────────────────────────────────────────
function renderCanvas() {
  const canvas = document.getElementById('canvas');
  const svg = document.getElementById('canvas-svg');
  if (!canvas || !svg) return;
  canvas.innerHTML = '';

  if (State.nodes.length) {
    const maxX = Math.max(...State.nodes.map(n => (n.x||0) + LAYOUT.NODE_W + 200)) + 200;
    const maxY = Math.max(...State.nodes.map(n => (n.y||0) + LAYOUT.NODE_H + 200)) + 200;
    canvas.style.width  = maxX + 'px';
    canvas.style.height = maxY + 'px';
    if (svg) { svg.style.width = maxX + 'px'; svg.style.height = maxY + 'px'; }
  }

  State.nodes.forEach(n => renderNode(n));
  renderConnections();
  renderDeptBands();
  applyTransform();
  applyLayerFilter();
}

function renderNode(node) {
  const canvas = document.getElementById('canvas');
  if (!canvas) return;
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

  if (node.type==='start'||node.type==='end') {
    div.style.cssText = `left:${node.x}px;top:${node.y}px;width:120px;border-radius:28px;text-align:center;`;
    div.innerHTML = `<div class="node-body" style="padding:9px 8px;text-align:center;">
      <span style="font-size:12px;font-weight:700;letter-spacing:.08em;">${node.name||node.type.toUpperCase()}</span>
    </div>`;
  } else if (node.type==='decision') {
    div.style.cssText = `left:${node.x}px;top:${node.y}px;width:140px;height:90px;background:transparent;border:none;`;
    div.innerHTML = `
      <svg width="140" height="90" style="position:absolute;top:0;left:0;">
        <polygon points="70,4 136,45 70,86 4,45" fill="var(--amber-lo)" stroke="var(--amber)" stroke-width="1.5"/>
      </svg>
      <div style="position:relative;z-index:1;display:flex;flex-direction:column;justify-content:center;align-items:center;height:100%;padding:0 20px;text-align:center;">
        <div style="font-size:10px;color:var(--amber);letter-spacing:.06em;font-weight:600;">DECISION</div>
        <div style="font-size:11px;color:var(--text0);font-weight:500;line-height:1.3;margin-top:2px;">${node.name||'Decision'}</div>
      </div>`;
  } else if (node.type==='system') {
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
    div.style.cssText = `left:${node.x}px;top:${node.y}px;width:172px;clip-path:polygon(0% 0%, 90% 0%, 100% 50%, 90% 100%, 0% 100%);`;
    div.innerHTML = `
      <div class="node-header" style="padding:6px 24px 4px 10px;">
        <span class="node-id" style="color:${col.text};">${node.stepId||node.id}</span>
        <div class="node-badges">${badges.join('')}</div>
      </div>
      <div class="node-body" style="padding:4px 24px 8px 10px;">
        <div class="node-name">${node.name||'Handoff'}</div>
        ${node.toProcess?`<div style="font-size:10px;color:var(--violet);margin-top:2px;">→ ${node.toProcess}</div>`:''}
        <div class="node-meta">${meta}</div>
      </div>`;
  } else {
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

// ── CONNECTIONS ───────────────────────────────────
function getConnGeometry(conn) {
  const fn = State.nodes.find(n=>n.id===conn.from);
  const tn = State.nodes.find(n=>n.id===conn.to);
  if (!fn||!tn) return null;
  const fe = document.getElementById(`node-${conn.from}`);
  const te = document.getElementById(`node-${conn.to}`);
  const fw = (fe && fe.offsetWidth  > 0) ? fe.offsetWidth  : (['start','end'].includes(fn.type) ? 110 : 170);
  const fh = (fe && fe.offsetHeight > 0) ? fe.offsetHeight : 70;
  const tw = (te && te.offsetWidth  > 0) ? te.offsetWidth  : (['start','end'].includes(tn.type) ? 110 : 170);
  const th = (te && te.offsetHeight > 0) ? te.offsetHeight : 70;
  const x1 = fn.x + fw, y1 = fn.y + fh/2;
  const x2 = tn.x,      y2 = tn.y + th/2;
  const GAP = 20;
  const isBack = x2 < x1 + GAP*2;

  let segments;
  if (conn.type === 'loop') {
    const lx1=fn.x+fw/2, ly1=fn.y, lx2=tn.x+tw/2, ly2=tn.y;
    const loopY = Math.min(ly1,ly2) - 50;
    segments = [
      {x1:lx1,y1:ly1,x2:lx1,y2:loopY},
      {x1:lx1,y1:loopY,x2:lx2,y2:loopY},
      {x1:lx2,y1:loopY,x2:lx2,y2:ly2},
    ];
    return { x1:lx1,y1:ly1,x2:lx2,y2:ly2, segments, isBack:true, isLoop:true, fn,tn,fw,fh,tw,th,GAP };
  }
  if (isBack) {
    const stubX = Math.max(x1, tn.x+tw)+GAP+30;
    const routeY = y1>y2 ? Math.min(fn.y,tn.y)-40 : Math.max(fn.y+fh,tn.y+th)+40;
    segments = [
      {x1,y1,x2:stubX,y2:y1},
      {x1:stubX,y1,x2:stubX,y2:routeY},
      {x1:stubX,y1:routeY,x2:x2-GAP,y2:routeY},
      {x1:x2-GAP,y1:routeY,x2:x2-GAP,y2},
      {x1:x2-GAP,y1:y2,x2,y2},
    ];
  } else {
    segments = [{x1,y1,x2,y2}];
  }
  return { x1,y1,x2,y2, segments, isBack, isLoop:false, fn,tn,fw,fh,tw,th,GAP };
}

function segIntersect(ax1,ay1,ax2,ay2,bx1,by1,bx2,by2) {
  const dx1=ax2-ax1,dy1=ay2-ay1,dx2=bx2-bx1,dy2=by2-by1;
  const denom=dx1*dy2-dy1*dx2;
  if (Math.abs(denom)<1e-9) return null;
  const t=((bx1-ax1)*dy2-(by1-ay1)*dx2)/denom;
  const u=((bx1-ax1)*dy1-(by1-ay1)*dx1)/denom;
  if (t>0.05&&t<0.95&&u>0.05&&u<0.95) return { x:ax1+t*dx1, y:ay1+t*dy1 };
  return null;
}

function findCrossings(geomA,geomB) {
  const pts=[];
  if (!geomA||!geomB) return pts;
  for (const sa of geomA.segments) for (const sb of geomB.segments) {
    const pt=segIntersect(sa.x1,sa.y1,sa.x2,sa.y2,sb.x1,sb.y1,sb.x2,sb.y2);
    if (pt) pts.push({ ...pt, seg:sa });
  }
  return pts;
}

function renderConnections() {
  const svg = document.getElementById('canvas-svg');
  if (!svg) return;
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

  const geoms = State.connections.map(c => ({ conn:c, geom: getConnGeometry(c) }));
  const crossingMap = new Map();
  for (let i=0;i<geoms.length;i++) for (let j=i+1;j<geoms.length;j++) {
    const pts=findCrossings(geoms[i].geom,geoms[j].geom);
    if (pts.length) {
      if (!crossingMap.has(geoms[j].conn.id)) crossingMap.set(geoms[j].conn.id,[]);
      crossingMap.get(geoms[j].conn.id).push(...pts);
    }
  }
  geoms.forEach(({conn,geom}) => drawConnection(conn,svg,geom,crossingMap.get(conn.id)||[]));

  if (State.connectingFrom && State.connectMouse) {
    const line=document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1',State.connectingFrom.x); line.setAttribute('y1',State.connectingFrom.y);
    line.setAttribute('x2',State.connectMouse.x); line.setAttribute('y2',State.connectMouse.y);
    line.setAttribute('stroke','#f0a500'); line.setAttribute('stroke-width','1.5'); line.setAttribute('stroke-dasharray','4,3');
    svg.appendChild(line);
  }

  // Re-render dept bands on top of connections but under nodes
  renderDeptBands();
}

function drawConnection(conn,svg,geom,crossings) {
  if (!geom) return;
  const { x1,y1,x2,y2, isBack,isLoop, fn,tn,fw,fh,tw,th,GAP } = geom;
  const styleMap={ sequence:'seq', dependency:'dep', loop:'loop', yes:'yes', no:'no' };
  const cs=CONN_STYLES[conn.type]||CONN_STYLES.sequence;
  const markerId='arr-'+(styleMap[conn.type]||'seq');
  const isHighlighted=conn._highlighted;
  const strokeColor=isHighlighted==='forward'?'#4d79ff':isHighlighted==='backward'?'#ff4d4d':
    isHighlighted==='adj-next'?'#4d79ff':isHighlighted==='adj-prev'?'#ff4d4d':cs.color;
  const strokeWidth=isHighlighted?'2.5':'1.5';
  const HOP_R=7;

  if (isLoop) {
    const lx1=fn.x+fw/2,ly1=fn.y,lx2=tn.x+tw/2,ly2=tn.y;
    const loopY=Math.min(ly1,ly2)-50;
    const d=`M${lx1} ${ly1} L${lx1} ${loopY} L${lx2} ${loopY} L${lx2} ${ly2}`;
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',d); path.setAttribute('stroke',strokeColor); path.setAttribute('stroke-width',strokeWidth);
    path.setAttribute('stroke-dasharray',cs.dash||''); path.setAttribute('fill','none');
    path.setAttribute('marker-end',`url(#${markerId})`);
    path.style.cursor='pointer'; path.addEventListener('click',()=>selectConnection(conn));
    svg.appendChild(path);
    addSvgLabel(svg,(lx1+lx2)/2,loopY-8,'loop-back',cs.color);
    return;
  }

  if (isBack) {
    const stubX=Math.max(x1,tn.x+tw)+GAP+30;
    const routeY=y1>y2?Math.min(fn.y,tn.y)-40:Math.max(fn.y+fh,tn.y+th)+40;
    const d=`M${x1} ${y1} L${stubX} ${y1} L${stubX} ${routeY} L${x2-GAP} ${routeY} L${x2-GAP} ${y2} L${x2} ${y2}`;
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',d); path.setAttribute('stroke',strokeColor); path.setAttribute('stroke-width',strokeWidth);
    if (cs.dash) path.setAttribute('stroke-dasharray',cs.dash);
    path.setAttribute('fill','none'); path.setAttribute('marker-end',`url(#${markerId})`);
    path.style.cursor='pointer'; path.addEventListener('click',()=>selectConnection(conn));
    svg.appendChild(path);
    const lbl=conn.label||cs.label;
    if (lbl) addSvgLabel(svg,(x1+stubX)/2,y1-6,lbl,cs.color);
    return;
  }

  const dx=Math.abs(x2-x1);
  const cx=dx>80?dx*0.45:60;
  const dStr=`M${x1} ${y1} C${x1+cx} ${y1} ${x2-cx} ${y2} ${x2} ${y2}`;
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('d',dStr); path.setAttribute('stroke',strokeColor); path.setAttribute('stroke-width',strokeWidth);
  if (cs.dash) path.setAttribute('stroke-dasharray',cs.dash);
  path.setAttribute('fill','none'); path.setAttribute('marker-end',`url(#${markerId})`);
  path.style.cursor='pointer'; path.addEventListener('click',()=>selectConnection(conn));
  svg.appendChild(path);

  if (crossings.length) {
    crossings.forEach(pt => {
      const ang=Math.atan2(y2-y1,x2-x1);
      const gap=document.createElementNS('http://www.w3.org/2000/svg','circle');
      gap.setAttribute('cx',pt.x); gap.setAttribute('cy',pt.y);
      gap.setAttribute('r',HOP_R+1); gap.setAttribute('fill','var(--bg0,#07090c)');
      svg.appendChild(gap);
      const bx1=pt.x-Math.cos(ang)*HOP_R,by1=pt.y-Math.sin(ang)*HOP_R;
      const bx2=pt.x+Math.cos(ang)*HOP_R,by2=pt.y+Math.sin(ang)*HOP_R;
      const arc=document.createElementNS('http://www.w3.org/2000/svg','path');
      arc.setAttribute('d',`M${bx1} ${by1} A${HOP_R} ${HOP_R} 0 0 1 ${bx2} ${by2}`);
      arc.setAttribute('stroke',strokeColor); arc.setAttribute('stroke-width',strokeWidth);
      arc.setAttribute('fill','none');
      svg.appendChild(arc);
    });
  }

  const lbl=conn.label||cs.label;
  if (lbl) addSvgLabel(svg,(x1+x2)/2,(y1+y2)/2-8,lbl,cs.color);
}

function addSvgLabel(svg,x,y,text,color) {
  const t=document.createElementNS('http://www.w3.org/2000/svg','text');
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
  const rect=document.getElementById('canvas-wrap').getBoundingClientRect();
  const x=(e.clientX-rect.left-State.offset.x)/State.scale;
  const y=(e.clientY-rect.top-State.offset.y)/State.scale;
  if (dragType) { addNode(dragType,x-85,y-35); dragType=null; }
}

function addNode(type, x, y) {
  pushUndo();
  State.nodeCounter++;
  const id=`N-${String(State.nodeCounter).padStart(3,'0')}`;
  const defaults=getSmartDefaults(type);
  const node={
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
  State.lastNodeLevel=node.level;
  State.dirty=true;
  const es=document.getElementById('empty-state');
  if (es) es.style.display='none';
  // LAY-10 FIX: recompute dept bands after add
  renderNode(node); renderConnections(); selectNode(node);
  enforceAllDeptGaps();
  renderDeptBands();
  auditEntry('node-added', `Added: ${node.name} [${node.type}]`);
}

// ── NODE DRAG ─────────────────────────────────────
function startNodeDrag(e,node) {
  const rect=document.getElementById('canvas-wrap').getBoundingClientRect();
  State.dragging=node;
  State.dragOffset={
    x:(e.clientX-rect.left-State.offset.x)/State.scale-node.x,
    y:(e.clientY-rect.top-State.offset.y)/State.scale-node.y,
  };
}

function onCanvasMouseDown(e) {
  if (e.target.classList.contains('port')) return;
  const isCanvas=['canvas-wrap','canvas','canvas-svg'].includes(e.target.id) ||
    e.target.closest('.dept-band');
  if (isCanvas && State.tool==='select') {
    State.panning=true; State.panStart={x:e.clientX-State.offset.x,y:e.clientY-State.offset.y};
    clearSelection();
  }
  if (isCanvas && State.connectingFrom) { State.connectingFrom=null; State.connectMouse=null; renderConnections(); }
}

function onCanvasMouseMove(e) {
  const rect=document.getElementById('canvas-wrap').getBoundingClientRect();
  if (State.panning) { State.offset.x=e.clientX-State.panStart.x; State.offset.y=e.clientY-State.panStart.y; applyTransform(); return; }
  if (State.dragging) {
    const mx=(e.clientX-rect.left-State.offset.x)/State.scale;
    const my=(e.clientY-rect.top-State.offset.y)/State.scale;
    State.dragging.x=Math.round(mx-State.dragOffset.x);
    State.dragging.y=Math.round(my-State.dragOffset.y);
    const el=document.getElementById(`node-${State.dragging.id}`);
    if (el) { el.style.left=State.dragging.x+'px'; el.style.top=State.dragging.y+'px'; }
    renderConnections(); State.dirty=true; return;
  }
  if (State.connectingFrom) {
    State.connectMouse={x:(e.clientX-rect.left-State.offset.x)/State.scale,y:(e.clientY-rect.top-State.offset.y)/State.scale};
    renderConnections();
  }
}

function onCanvasMouseUp(e) {
  if (State.dragging) {
    State.dirty=true;
    // LAY-10 FIX: recompute dept bands on drag end
    enforceAllDeptGaps();
    renderDeptBands();
    State.dragging=null;
  }
  State.panning=false;
}

function applyTransform() {
  const t=`translate(${State.offset.x}px,${State.offset.y}px) scale(${State.scale})`;
  const canvas=document.getElementById('canvas');
  const svg=document.getElementById('canvas-svg');
  if (canvas) { canvas.style.transformOrigin='0 0'; canvas.style.transform=t; }
  if (svg) { svg.style.transformOrigin='0 0'; svg.style.transform=t; }
}

// ── PORT CONNECT ──────────────────────────────────
function onPortDown(e) {
  e.stopPropagation(); e.preventDefault();
  const nodeId=e.currentTarget.dataset.node, portType=e.currentTarget.dataset.port;
  if (!State.connectingFrom) {
    if (portType==='out'||State.tool!=='select') {
      const node=State.nodes.find(n=>n.id===nodeId);
      const el=document.getElementById(`node-${nodeId}`);
      State.connectingFrom={ nodeId, x:node.x+(el?el.offsetWidth:170), y:node.y+(el?el.offsetHeight/2:35) };
    }
  } else {
    if (State.connectingFrom.nodeId!==nodeId) {
      const ct=State.tool==='loop'?'loop':State.tool==='dependency'?'dependency':'sequence';
      addConnection(State.connectingFrom.nodeId,nodeId,ct);
    }
    State.connectingFrom=null; State.connectMouse=null; renderConnections();
  }
}

function addConnection(fromId,toId,type='sequence') {
  if (State.connections.find(c=>c.from===fromId&&c.to===toId&&c.type===type)) { notify('Connection already exists','error'); return; }
  pushUndo();
  State.connections.push({ id:'C-'+Date.now(), from:fromId, to:toId, type, label:'' });
  State.dirty=true;
  // LAY-10 FIX: recompute dept bands on connect
  renderConnections();
  enforceAllDeptGaps();
  renderDeptBands();
  auditEntry('connection-added',`${type}: ${fromId}→${toId}`);
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
  if (!State.currentProcess) {
    const pb=document.getElementById('props-body');
    if (pb) pb.innerHTML='<div style="font-size:13px;color:var(--text2);padding:8px 0;">Select or create a process to begin.</div>';
    return;
  }
  const p=State.currentProcess;
  const pb=document.getElementById('props-body');
  if (!pb) return;
  pb.innerHTML=`
    <div style="font-size:10px;color:var(--text2);letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px;">Process Properties</div>
    <div class="field-group"><label class="field-label">Process Name</label>
      <input class="field-input" value="${esc(p.name||'')}" oninput="updateProcessProp('name',this.value)" style="user-select:text;"/>
    </div>
    <div class="field-group"><label class="field-label">Process ID</label>
      <input class="field-input" value="${esc(p.processId||'')}" oninput="updateProcessProp('processId',this.value)" style="user-select:text;"/>
    </div>
    <div class="field-group"><label class="field-label">Level</label>
      <select class="field-select" onchange="updateProcessProp('level',this.value)">
        ${['L1','L2','L3','L4','L5','L6','L7','L8'].map(l=>`<option ${p.level===l?'selected':''}>${l}</option>`).join('')}
      </select>
    </div>
    <div class="field-group"><label class="field-label">Owner</label>
      <input class="field-input" value="${esc(p.owner||'')}" oninput="updateProcessProp('owner',this.value)" style="user-select:text;"/>
    </div>
    <div class="field-group"><label class="field-label">Function</label>
      <input class="field-input" value="${esc(p.function||'')}" oninput="updateProcessProp('function',this.value)" style="user-select:text;"/>
    </div>
    <div class="field-group"><label class="field-label">Description</label>
      <textarea class="field-textarea" oninput="updateProcessProp('description',this.value)" style="user-select:text;">${esc(p.description||'')}</textarea>
    </div>
    <button class="hdr-btn primary" style="width:100%;margin-top:8px;" onclick="saveProcess().then(()=>notify('Saved','success'))">SAVE PROCESS</button>`;
}

function updateProcessProp(key,value) {
  if (!State.currentProcess) return;
  State.currentProcess[key]=value;
  State.dirty=true;
  if (key==='name') updateHeader();
}

// ── PROPERTIES PANEL ──────────────────────────────
function renderPropsPanel(node) {
  const gaps=getGaps(node), col=NODE_COLORS[node.type]||NODE_COLORS.process;
  const classArr=Array.isArray(node.classifications)?node.classifications:[];
  const thresholds=Array.isArray(node.thresholds)?node.thresholds:[];
  const isFunctional=!['start','end'].includes(node.type);
  const pb=document.getElementById('props-body');
  if (!pb) return;

  pb.innerHTML=`
    <div style="margin-bottom:13px;">
      <div style="font-size:12px;color:${col.text};letter-spacing:.1em;margin-bottom:5px;text-transform:uppercase;">${node.type} · ${node.id}</div>
      ${gaps.length?`<div class="gap-flag">⚠ ${gaps.join('<br/>⚠ ')}</div>`:`<div class="ok-flag">✓ No gaps detected</div>`}
    </div>
    <div class="field-group"><label class="field-label">Step Name</label>
      <input class="field-input" value="${esc(node.name)}" oninput="upNode('${node.id}','name',this.value)" style="user-select:text;"/>
    </div>
    ${isFunctional?`
    <div class="field-row">
      <div class="field-group"><label class="field-label">Step ID</label>
        <input class="field-input" value="${esc(node.stepId||'')}" oninput="upNode('${node.id}','stepId',this.value)" style="user-select:text;"/>
      </div>
      <div class="field-group"><label class="field-label">Step Type</label>
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
      <div class="field-group"><label class="field-label">Level</label>
        <select class="field-select" onchange="upNode('${node.id}','level',this.value)">
          ${['L1','L2','L3','L4','L5','L6','L7','L8'].map(l=>`<option ${node.level===l?'selected':''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="field-group"><label class="field-label">Input Type</label>
        <select class="field-select" onchange="upNode('${node.id}','inputType',this.value)">
          <option ${node.inputType==='manual'?'selected':''}>manual</option>
          <option ${node.inputType==='system'?'selected':''}>system</option>
          <option ${node.inputType==='both'?'selected':''}>both</option>
        </select>
      </div>
    </div>
    <div class="field-group"><label class="field-label">Department</label>
      <input class="field-input" value="${esc(node.department||'')}" placeholder="e.g. Finance, Warehouse..." oninput="upNode('${node.id}','department',this.value)" style="user-select:text;"/>
    </div>
    ${node.type==='handoff'?`
    <div class="field-group"><label class="field-label">Handoff To Process</label>
      <input class="field-input" value="${esc(node.toProcess||'')}" placeholder="Referenced process..." oninput="upNode('${node.id}','toProcess',this.value)" style="user-select:text;"/>
    </div>`:''}
    ${(node.type==='control'||node.type==='ccp')?`
    <div class="field-group"><label class="field-label">Control Nature</label>
      <select class="field-select" onchange="upNode('${node.id}','controlNature',this.value)">
        <option value="P" ${(node.controlNature||'P')==='P'?'selected':''}>Preventive (P)</option>
        <option value="D" ${node.controlNature==='D'?'selected':''}>Detective (D)</option>
      </select>
    </div>`:''}
    <div class="field-group"><label class="field-label">Classifications</label>
      <div class="tag-row">
        ${CLASSIFICATION_OPTIONS.map(opt=>{
          const active=classArr.includes(opt.key);
          return `<span class="tag-pill ${active?'t-active':''}"
            style="color:${active?opt.color:'var(--text2)'};border-color:${active?opt.color:'var(--border)'};background:${active?'rgba(0,0,0,.3)':'transparent'}"
            onclick="toggleClass('${node.id}','${opt.key}')">${opt.label}</span>`;
        }).join('')}
      </div>
    </div>
    <div class="field-group"><label class="field-label">Monitoring (SMART)</label>
      <label class="field-check ${node.monitoring?'active-check':''}">
        <input type="checkbox" ${node.monitoring?'checked':''} onchange="upNode('${node.id}','monitoring',this.checked)"/>
        Include in SMART monitoring
      </label>
    </div>
    <div class="field-row">
      <div class="field-group"><label class="field-label">Timing Window</label>
        <input class="field-input" value="${esc(node.timing||'')}" placeholder="e.g. 09:00" oninput="upNode('${node.id}','timing',this.value)" style="user-select:text;"/>
      </div>
      <div class="field-group"><label class="field-label">Frequency</label>
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
    <div class="field-group"><label class="field-label">Thresholds</label>
      <div id="threshold-list">
        ${thresholds.map((t,i)=>`
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:4px;padding:9px;margin-bottom:7px;">
          <div class="field-row" style="margin-bottom:6px;">
            <div><label class="field-label">Parameter</label><input class="field-input" value="${esc(t.parameter||'')}" placeholder="e.g. Temperature" oninput="upThreshold('${node.id}',${i},'parameter',this.value)" style="user-select:text;"/></div>
            <div><label class="field-label">Unit</label><input class="field-input" value="${esc(t.unit||'')}" placeholder="e.g. °C" oninput="upThreshold('${node.id}',${i},'unit',this.value)" style="user-select:text;"/></div>
          </div>
          <div class="field-row" style="margin-bottom:6px;">
            <div><label class="field-label">Min</label><input class="field-input" value="${esc(t.min||'')}" oninput="upThreshold('${node.id}',${i},'min',this.value)" style="user-select:text;"/></div>
            <div><label class="field-label">Max</label><input class="field-input" value="${esc(t.max||'')}" oninput="upThreshold('${node.id}',${i},'max',this.value)" style="user-select:text;"/></div>
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
    <div class="field-group"><label class="field-label">Record Keeping</label>
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
        <div><label class="field-label">Retention</label>
          <input class="field-input" value="${esc(node.retentionPeriod||'10 years')}" oninput="upNode('${node.id}','retentionPeriod',this.value)" style="user-select:text;"/>
        </div>
      </div>`:''}
    </div>
    <div class="field-group"><label class="field-label">Loop-back Confirmation</label>
      <label class="field-check ${node.loopConfirm?'active-check':''}">
        <input type="checkbox" ${node.loopConfirm?'checked':''} onchange="upNode('${node.id}','loopConfirm',this.checked)"/>
        Requires output confirmation before proceeding
      </label>
    </div>
    <div class="field-group"><label class="field-label">Notes</label>
      <textarea class="field-textarea" oninput="upNode('${node.id}','notes',this.value)" style="user-select:text;" placeholder="Additional notes...">${esc(node.notes||'')}</textarea>
    </div>
    <div style="margin-top:10px;">
      <button class="hdr-btn warn" style="width:100%;" onclick="deleteSelectedConfirm()">DELETE STEP</button>
    </div>
    `:''}
  `;
}

function renderConnPropsPanel(conn) {
  const pb=document.getElementById('props-body');
  if (!pb) return;
  pb.innerHTML=`
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
function upNode(id,key,value) {
  const node=State.nodes.find(n=>n.id===id); if (!node) return;
  const prev=node[key];
  node[key]=value;
  if (key==='level') State.lastNodeLevel=value;
  if (key==='department') {
    // LAY-10 FIX: recompute bands on dept change
    State.dirty=true;
    const el=document.getElementById(`node-${id}`); if (el) el.remove();
    renderNode(node); renderConnections();
    enforceAllDeptGaps(); renderDeptBands();
    const el2=document.getElementById(`node-${id}`);
    if (el2) el2.style.boxShadow='0 0 0 2.5px var(--amber)';
    refreshGapFlag(node);
    return;
  }
  State.dirty=true;
  const el=document.getElementById(`node-${id}`); if (el) el.remove();
  renderNode(node); renderConnections();
  const el2=document.getElementById(`node-${id}`);
  if (el2) el2.style.boxShadow='0 0 0 2.5px var(--amber)';
  refreshGapFlag(node);
  auditEntry('node-updated', `${node.name}: ${key} changed`);
}

function refreshGapFlag(node) {
  const gaps=getGaps(node);
  const gEl=document.querySelector('.gap-flag,.ok-flag'); if (!gEl) return;
  if (gaps.length) { gEl.className='gap-flag'; gEl.innerHTML='⚠ '+gaps.join('<br/>⚠ '); }
  else { gEl.className='ok-flag'; gEl.textContent='✓ No gaps detected'; }
}

function toggleClass(nodeId,key) {
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

function changeNodeType(id,newType) {
  pushUndo();
  const node=State.nodes.find(n=>n.id===id); if (!node) return;
  const prev=node.type;
  node.type=newType;
  if (newType==='control'||newType==='ccp') node.classifications=['control'];
  else if (newType==='compliance') node.classifications=['compliance-internal'];
  State.dirty=true;
  const el=document.getElementById(`node-${id}`); if (el) el.remove();
  renderNode(node); renderConnections();
  const el2=document.getElementById(`node-${id}`);
  if (el2) el2.style.boxShadow='0 0 0 2.5px var(--amber)';
  renderPropsPanel(node);
  auditEntry('node-type-changed',`${node.name}: ${prev}→${newType}`);
  notify(`Step changed to ${newType}`,'success');
}

function upConn(id,key,value) {
  const conn=State.connections.find(c=>c.id===id); if (!conn) return;
  conn[key]=value; State.dirty=true; renderConnections();
}

// ── THRESHOLDS ────────────────────────────────────
function addThreshold(nodeId) {
  const node=State.nodes.find(n=>n.id===nodeId); if (!node) return;
  if (!Array.isArray(node.thresholds)) node.thresholds=[];
  node.thresholds.push({parameter:'',min:'',max:'',unit:'',action:''}); State.dirty=true; renderPropsPanel(node);
}
function upThreshold(nodeId,idx,key,value) {
  const node=State.nodes.find(n=>n.id===nodeId); if (!node||!node.thresholds[idx]) return;
  node.thresholds[idx][key]=value; State.dirty=true;
}
function removeThreshold(nodeId,idx) {
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
function confirmArchiveProcess(id,name) {
  document.getElementById('confirm-title').textContent='ARCHIVE PROCESS';
  document.getElementById('confirm-msg').textContent=`Archive "${name}"?`;
  document.getElementById('confirm-sub').textContent='Process will be hidden but can be restored.';
  State.confirmCallback=()=>archiveProcess(id);
  document.getElementById('modal-confirm').style.display='flex';
}

function confirmDeletePermanent(id,name) {
  document.getElementById('confirm-title').textContent='PERMANENT DELETE';
  document.getElementById('confirm-msg').textContent=`Permanently delete "${name}"?`;
  document.getElementById('confirm-sub').textContent='This cannot be undone.';
  State.confirmCallback=()=>deleteProcessPermanent(id);
  document.getElementById('modal-confirm').style.display='flex';
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
    const name=State.selectedNode.name;
    State.nodes=State.nodes.filter(n=>n.id!==id);
    State.connections=State.connections.filter(c=>c.from!==id&&c.to!==id);
    State.dirty=true; clearSelection();
    // LAY-10 FIX: recompute bands on delete
    renderCanvas();
    enforceAllDeptGaps(); renderDeptBands();
    if (!State.nodes.length) { const es=document.getElementById('empty-state'); if(es) es.style.display='block'; }
    auditEntry('node-deleted',`Deleted: ${name}`);
    notify('Step deleted','info');
  } else if (State.selectedConn) {
    const id=State.selectedConn.id;
    State.connections=State.connections.filter(c=>c.id!==id);
    State.dirty=true; clearSelection();
    // LAY-10 FIX: recompute bands on connector delete
    renderConnections();
    enforceAllDeptGaps(); renderDeptBands();
    auditEntry('connection-deleted',`Deleted connection: ${id}`);
    notify('Connection deleted','info');
  }
}

// ── TOOLS ─────────────────────────────────────────
function setTool(tool) {
  State.tool=tool; State.connectingFrom=null; State.connectMouse=null; renderConnections();
  ['select','connect','loop','dep'].forEach(t=>{ const b=document.getElementById(`tb-${t}`); if(b) b.classList.toggle('active',t===tool); });
  const cw=document.getElementById('canvas-wrap');
  if (cw) cw.style.cursor=tool==='select'?'default':'crosshair';
}

function zoom(delta) {
  State.scale=Math.min(2.5,Math.max(0.25,State.scale+delta));
  const zl=document.getElementById('zoom-label');
  if (zl) zl.textContent=Math.round(State.scale*100)+'%';
  applyTransform();
}
function onWheel(e) { e.preventDefault(); zoom(e.deltaY>0?-0.08:0.08); }
function fitView() {
  if (!State.nodes.length) return;
  const xs=State.nodes.map(n=>n.x), ys=State.nodes.map(n=>n.y);
  State.offset.x=-Math.min(...xs)*State.scale+80;
  State.offset.y=-Math.min(...ys)*State.scale+80;
  applyTransform();
}

// ── AUTO-LAYOUT ───────────────────────────────────
function autoLayout() {
  if (!State.nodes.length) return;
  pushUndo();

  // Topological sort for column assignment
  const depth={};
  State.nodes.forEach(n=>depth[n.id]=0);
  const roots=State.nodes.filter(n=>!State.connections.some(c=>c.to===n.id));
  const queue=[...roots.map(n=>({id:n.id,d:0}))];
  const visited=new Set();
  while(queue.length) {
    const {id,d}=queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    depth[id]=Math.max(depth[id]||0,d);
    State.connections.filter(c=>c.from===id).forEach(c=>queue.push({id:c.to,d:d+1}));
  }

  // Group by department
  const deptGroups={};
  State.nodes.forEach(n=>{
    const dept=n.department||'_nodept';
    if (!deptGroups[dept]) deptGroups[dept]=[];
    deptGroups[dept].push(n);
  });

  const depts=Object.keys(deptGroups);
  let deptOffsetY=LAYOUT.START_Y;

  depts.forEach(dept=>{
    const nodes=deptGroups[dept];
    // Sort by column depth
    nodes.sort((a,b)=>(depth[a.id]||0)-(depth[b.id]||0));
    // Place in rows of MAX_COLS
    nodes.forEach((n,i)=>{
      const col=i % LAYOUT.MAX_COLS;
      const row=Math.floor(i/LAYOUT.MAX_COLS);
      n.x=LAYOUT.START_X + col*LAYOUT.GAP_X;
      n.y=deptOffsetY + LAYOUT.HEADER_H + LAYOUT.PAD + row*LAYOUT.GAP_Y;
    });
    // Advance Y for next dept
    const rows=Math.ceil(nodes.length/LAYOUT.MAX_COLS);
    deptOffsetY+=LAYOUT.HEADER_H+LAYOUT.PAD*2+rows*LAYOUT.GAP_Y+LAYOUT.DEPT_GAP;
  });

  State.dirty=true;
  // LAY-12 FIX: render first pass, then after DOM updates run second pass with real sizes
  renderCanvas();
  setTimeout(()=>{
    enforceAllDeptGaps();
    renderCanvas();
    notify('Layout applied','success');
  },80);
}

// ── EXPORT SOP ────────────────────────────────────
function exportSOP() {
  if (!State.currentProcess) return;
  const p=State.currentProcess;
  const steps=State.nodes.filter(n=>!['start','end','decision'].includes(n.type));
  const pedigree=buildPedigree(p.id).map(c=>c.name).join(' › ');
  const raciRows=steps.map(s=>`| ${s.stepId||s.id} | ${s.name} | ${s.responsible||'—'} | ${s.accountable||'—'} | ${s.consulted||'—'} | ${s.informed||'—'} |`).join('\n');

  let txt=`================================================================================
STANDARD OPERATING PROCEDURE — GENERATED BY MERIDIAN v1.6.13
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
  Department:      ${n.department||'—'}
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
END — Generated by MERIDIAN v1.6.13
================================================================================`;

  const blob=new Blob([txt],{type:'text/plain'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`SOP_${(p.processId||p.name).replace(/\s+/g,'_')}_v${p.version||1}.txt`;
  a.click();
  auditEntry('sop-exported',`SOP exported v${p.version||1}`);
  notify('SOP exported','success');
}

// ── AUDIT TRAIL VIEWER ────────────────────────────
function showAuditTrail() {
  if (!State.currentProcess) { notify('No process loaded','error'); return; }
  const log=State.auditLog||[];
  const html=log.length
    ? log.slice().reverse().map(e=>`
      <div style="padding:7px 0;border-bottom:1px solid var(--border);font-size:12px;">
        <span style="color:var(--text2);font-size:10px;">${new Date(e.ts).toLocaleString('en-GB')}</span>
        <span style="color:var(--amber);margin:0 8px;font-size:10px;text-transform:uppercase;">${e.event}</span>
        <span style="color:var(--text1);">${e.detail||''}</span>
      </div>`).join('')
    : '<div style="color:var(--text2);font-size:13px;padding:16px 0;">No audit entries yet.</div>';

  document.getElementById('confirm-title').textContent='AUDIT TRAIL';
  document.getElementById('confirm-msg').innerHTML=`<div style="max-height:340px;overflow-y:auto;">${html}</div>`;
  document.getElementById('confirm-sub').textContent=`${log.length} entries · ${State.currentProcess.name}`;
  // Override buttons
  const ok=document.querySelector('#modal-confirm .hdr-btn.warn');
  const cancel=document.querySelector('#modal-confirm .hdr-btn:not(.warn)');
  if (ok) { ok.textContent='EXPORT'; ok.onclick=()=>{ exportAuditLog(); closeModal('modal-confirm'); }; }
  if (cancel) { cancel.textContent='CLOSE'; cancel.onclick=()=>closeModal('modal-confirm'); }
  State.confirmCallback=null;
  document.getElementById('modal-confirm').style.display='flex';
}

function exportAuditLog() {
  if (!State.currentProcess) return;
  const log=State.auditLog||[];
  const txt=log.map(e=>`${e.ts}\t${e.event}\t${e.source||'system'}\t${e.detail||''}`).join('\n');
  const blob=new Blob([`MERIDIAN AUDIT TRAIL — ${State.currentProcess.name}\nGenerated: ${new Date().toISOString()}\n\n${txt}`],{type:'text/plain'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`AUDIT_${(State.currentProcess.processId||State.currentProcess.name).replace(/\s+/g,'_')}_${new Date().toISOString().split('T')[0]}.txt`;
  a.click();
}

// ── MODALS ────────────────────────────────────────
function newProcess() {
  const sel=document.getElementById('np-parent');
  if (sel) {
    sel.innerHTML='<option value="">— None (Top Level) —</option>';
    State.processes.filter(p=>!p.archived).forEach(p=>{
      const o=document.createElement('option'); o.value=p.id; o.textContent=`${p.name} (${p.level||'L2'})`; sel.appendChild(o);
    });
  }
  ['np-name','np-id','np-desc','np-owner'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  const fn=document.getElementById('np-fn'); if(fn) fn.value='';
  document.getElementById('modal-new').style.display='flex';
  setTimeout(()=>{ const n=document.getElementById('np-name'); if(n) n.focus(); },100);
}

function closeModal(id) {
  const el=document.getElementById(id);
  if (el) el.style.display='none';
  // Reset confirm modal buttons to defaults
  if (id==='modal-confirm') {
    const ok=document.querySelector('#modal-confirm .hdr-btn.warn');
    const cancel=document.querySelector('#modal-confirm .hdr-btn:not(.warn)');
    if (ok) { ok.textContent='DELETE'; ok.onclick=confirmDeleteOk; }
    if (cancel) { cancel.textContent='CANCEL'; cancel.onclick=confirmDeleteCancel; }
  }
}

// ── NOTIFICATIONS ─────────────────────────────────
function notify(msg,type='info') {
  const area=document.getElementById('notif-area');
  if (!area) return;
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

// ── LAYER FILTERS ─────────────────────────────────
const LAYER_FILTERS = {
  'all':             { nodeTypes: null },
  'controls-only':   { nodeTypes: ['control','ccp'] },
  'critical-only':   { nodeTypes: ['ccp'] },
  'manual-controls': { nodeTypes: ['control','ccp'], inputTypeFilter:'manual' },
  'compliance-view': { nodeTypes: ['compliance','control','ccp'] },
  'process-only':    { nodeTypes: ['start','end','process','decision','handoff','system'] },
  'monitoring-view': { nodeTypes: null, monitoringFilter:true },
};
let activeLayerFilter='all';

function setLayerFilter(key) {
  activeLayerFilter=key;
  document.querySelectorAll('.lf-btn').forEach(b=>b.classList.remove('active'));
  const btn=[...document.querySelectorAll('.lf-btn')].find(b=>b.getAttribute('data-filter')===key);
  if (btn) btn.classList.add('active');
  applyLayerFilter();
}

function applyLayerFilter() {
  const f=LAYER_FILTERS[activeLayerFilter];
  if (!f) return;
  State.nodes.forEach(n=>{
    const el=document.getElementById(`node-${n.id}`);
    if (!el) return;
    let show=true;
    if (f.nodeTypes&&!f.nodeTypes.includes(n.type)) show=false;
    if (f.inputTypeFilter&&n.inputType!==f.inputTypeFilter) show=false;
    if (f.monitoringFilter&&!n.monitoring) show=false;
    el.style.opacity=show?'1':'0.15';
    el.style.pointerEvents=show?'':'none';
  });
}

// ── FLOAT PANELS ─────────────────────────────────
function toggleFloatPanel(name) {
  const panel=document.getElementById(`float-${name}`);
  const trigger=document.getElementById(`ft-${name}`);
  if (!panel) return;
  const visible=panel.style.display!=='none'&&panel.style.display!=='';
  panel.style.display=visible?'none':'flex';
  panel.classList.remove('minimized');
  if (trigger) trigger.classList.toggle('active',!visible);
  if (!visible&&name==='arco') {
    const feed=document.getElementById('float-arco-feed');
    if (feed&&feed.children.length===0&&typeof appendFloatArcoMsg==='function')
      appendFloatArcoMsg('assistant',`Hello. I'm **ARCŌ** — ask me about this process or describe steps to add.`);
  }
}

function minimizeFloatPanel(name) {
  const panel=document.getElementById(`float-${name}`);
  if (panel) panel.classList.toggle('minimized');
}

// Draggable float panels
document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('.float-panel-header').forEach(header=>{
    let dragging=false,ox=0,oy=0;
    header.addEventListener('mousedown',e=>{
      if (e.target.classList.contains('float-ctrl-btn')) return;
      dragging=true;
      const panel=header.closest('.float-panel');
      const rect=panel.getBoundingClientRect();
      ox=e.clientX-rect.left; oy=e.clientY-rect.top;
      panel.style.right='auto'; panel.style.left=rect.left+'px'; panel.style.top=rect.top+'px';
    });
    document.addEventListener('mousemove',e=>{
      if (!dragging) return;
      const panel=header.closest('.float-panel');
      panel.style.left=(e.clientX-ox)+'px'; panel.style.top=(e.clientY-oy)+'px';
    });
    document.addEventListener('mouseup',()=>{ dragging=false; });
  });
});

// ── GLOSSARY ENFORCEMENT ──────────────────────────
const MERIDIAN_GLOSSARY=[
  { ext:/flowcharts?/gi, mer:'Process Blueprint' },
  { ext:/flow\s+charts?/gi, mer:'Process Blueprint' },
  { ext:/process\s+maps?/gi, mer:'Process Blueprint' },
  { ext:/\bworkflows?\b/gi, mer:'Process Flow' },
  { ext:/\bswim\s*lanes?\b/gi, mer:'Role Track' },
  { ext:/key\s+control\s+points?\b/gi, mer:'Critical Control Point' },
  { ext:/\bKPIs?\b/g, mer:'Performance Indicator' },
  { ext:/\btask\s+owners?\b/gi, mer:'Responsible' },
  { ext:/\bapprovers?\b/gi, mer:'Accountable' },
  { ext:/\bprocess\s+owners?\b/gi, mer:'Accountable' },
  { ext:/\baudit\s+trails?\b/gi, mer:'Record Trail' },
  { ext:/real[\s-]time\s+monitoring/gi, mer:'SMART Monitoring' },
  { ext:/\bhand[\s-]?overs?\b/gi, mer:'Handoff' },
  { ext:/\brework\s+loops?\b/gi, mer:'Loopback' },
];

function applyGlossary(text) {
  if (!text) return '';
  let out=text;
  MERIDIAN_GLOSSARY.forEach(({ext,mer})=>{ out=out.replace(ext,mer); });
  return out;
}

// ── PATH HIGHLIGHTING ─────────────────────────────
function getForwardPath(nodeId) {
  const visited=new Set(), queue=[nodeId];
  while(queue.length) { const id=queue.shift(); if(visited.has(id)) continue; visited.add(id); State.connections.filter(c=>c.from===id).forEach(c=>queue.push(c.to)); }
  visited.delete(nodeId); return visited;
}
function getBackwardPath(nodeId) {
  const visited=new Set(), queue=[nodeId];
  while(queue.length) { const id=queue.shift(); if(visited.has(id)) continue; visited.add(id); State.connections.filter(c=>c.to===id).forEach(c=>queue.push(c.from)); }
  visited.delete(nodeId); return visited;
}

function highlightPath(nodeId) {
  clearPathHighlight();
  if (!nodeId) return;
  const forward=getForwardPath(nodeId);
  const backward=getBackwardPath(nodeId);
  // Adjacent nodes
  const adjNext=new Set(State.connections.filter(c=>c.from===nodeId).map(c=>c.to));
  const adjPrev=new Set(State.connections.filter(c=>c.to===nodeId).map(c=>c.from));

  State.nodes.forEach(n=>{
    const el=document.getElementById(`node-${n.id}`);
    if (!el) return;
    if (n.id===nodeId||forward.has(n.id)||backward.has(n.id)) { el.style.opacity='1'; el.style.filter=''; }
    else { el.style.opacity='0.2'; el.style.filter='grayscale(1)'; }
  });
  State.connections.forEach(c=>{
    if (adjNext.has(c.to)&&c.from===nodeId) c._highlighted='adj-next';
    else if (adjPrev.has(c.from)&&c.to===nodeId) c._highlighted='adj-prev';
    else if (forward.has(c.to)&&(c.from===nodeId||forward.has(c.from))) c._highlighted='forward';
    else if (backward.has(c.from)&&(c.to===nodeId||backward.has(c.to))) c._highlighted='backward';
    else c._highlighted=null;
  });
  renderConnections();
}

function clearPathHighlight() {
  State.nodes.forEach(n=>{ const el=document.getElementById(`node-${n.id}`); if(el){el.style.opacity='1';el.style.filter='';} });
  State.connections.forEach(c=>c._highlighted=null);
}

// Override selectNode to trigger path highlight + bus emit
const _origSelectNode=selectNode;
window.selectNode=function(node) {
  _origSelectNode(node); highlightPath(node.id);
  if (typeof MeridianBus!=='undefined') MeridianBus.emit('promap:node-selected',{node,nodes:State.nodes,connections:State.connections});
};
const _origClearSelection=clearSelection;
window.clearSelection=function() {
  _origClearSelection(); clearPathHighlight();
  if (typeof MeridianBus!=='undefined') MeridianBus.emit('promap:node-deselected',{});
};

// ── BUS INTEGRATION ───────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  if (typeof MeridianBus==='undefined') return;

  MeridianBus.on('arco:patch-proposed',({patch})=>{
    if (!State.currentProcess||!patch?.length) return;
    pushUndo();
    patch.forEach(op=>{
      if (op.op==='insert-after'||op.op==='insert-before') {
        const anchorIdx=State.nodes.findIndex(n=>n.stepId===op.afterStepId||n.stepId===op.beforeStepId||n.id===op.afterStepId||n.id===op.beforeStepId);
        State.nodeCounter++;
        const id=`N-${String(State.nodeCounter).padStart(3,'0')}`;
        const newNode={id,...op.step,stepId:op.step.stepId||id,level:op.step.level||'L4',classifications:op.step.classifications||[],thresholds:op.step.thresholds||[],x:0,y:0};
        if (anchorIdx>=0) {
          const insertIdx=op.op==='insert-after'?anchorIdx+1:anchorIdx;
          State.nodes.splice(insertIdx,0,newNode);
          if (op.op==='insert-after') {
            const anchor=State.nodes[anchorIdx];
            const outgoing=State.connections.filter(c=>c.from===anchor.id);
            if (outgoing.length) { const first=outgoing[0]; const oldTo=first.to; first.to=newNode.id; State.connections.push({id:'C-'+Date.now()+'b',from:newNode.id,to:oldTo,type:'sequence',label:''}); }
            else State.connections.push({id:'C-'+Date.now()+'a',from:anchor.id,to:newNode.id,type:'sequence',label:''});
          }
        } else State.nodes.push(newNode);
      } else if (op.op==='update') {
        const node=State.nodes.find(n=>n.stepId===op.stepId||n.id===op.stepId);
        if (node) Object.assign(node,op.changes);
      } else if (op.op==='delete') {
        const idx=State.nodes.findIndex(n=>n.stepId===op.stepId||n.id===op.stepId);
        if (idx>=0) { const removed=State.nodes[idx]; State.nodes.splice(idx,1); State.connections=State.connections.filter(c=>c.from!==removed.id&&c.to!==removed.id); }
      } else if (op.op==='add-connection') {
        const fromNode=State.nodes.find(n=>n.stepId===op.from||n.id===op.from);
        const toNode=State.nodes.find(n=>n.stepId===op.to||n.id===op.to);
        if (fromNode&&toNode) State.connections.push({id:'C-'+Date.now(),from:fromNode.id,to:toNode.id,type:op.type||'sequence',label:op.label||''});
      }
    });
    State.dirty=true;
    // LAY-12 FIX: two-pass after ARCŌ insert
    renderCanvas();
    setTimeout(()=>{ enforceAllDeptGaps(); renderCanvas(); notify(`ARCŌ applied ${patch.length} change${patch.length>1?'s':''}.`,'success'); },80);
  });
});
