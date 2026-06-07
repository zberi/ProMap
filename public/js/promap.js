/* ═══════════════════════════════════════════════
   MERIDIAN — PROMAP Engine v1.3
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
  document.getElementById('btn-undo').style.display = 'none';
  setTool('select');
  updateHeader(); updatePedigree();
  renderCanvas(); renderProcessList(); renderPropsEmpty();
  document.getElementById('empty-state').style.display = State.nodes.length ? 'none' : 'block';
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
  const crumbs = []; let cur = State.processes.find(p => p.id === id);
  while(cur) { crumbs.unshift({id:cur.id, name:cur.name}); cur = cur.parentId ? State.processes.find(p=>p.id===cur.parentId) : null; }
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

  if (!State.processes.length) {
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
          <div class="pi-name">${depth>0?'└ ':''}${p.name}</div>
          <div class="pi-meta">${p.processId||'—'} · ${p.level||'L2'} · ${p.function||'—'}</div>
        </div>
        <span onclick="event.stopPropagation();confirmDeleteProcess('${p.id}','${p.name.replace(/'/g,"\\'")}');"
          style="color:var(--text2);cursor:pointer;font-size:15px;padding:0 4px;flex-shrink:0;" title="Delete process">×</span>
      </div>`;
    div.addEventListener('click', () => loadProcess(p));
    el.appendChild(div);
    State.processes.filter(c => c.parentId === p.id).forEach(child => renderItem(child, depth+1));
  }
  State.processes.filter(p => !p.parentId).forEach(p => renderItem(p, 0));
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
    ['btn-save','btn-publish','btn-export'].forEach(id => document.getElementById(id).style.display='');
  } else {
    statusEl.style.display='none'; versionEl.style.display='none';
    ['btn-save','btn-publish','btn-export'].forEach(id => document.getElementById(id).style.display='none');
  }
}

// ── CANVAS ────────────────────────────────────────
function renderCanvas() {
  document.getElementById('canvas').innerHTML = '';
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
    // ISO: diamond — rendered as rotated square with inner content
    div.style.cssText = `left:${node.x}px;top:${node.y}px;width:120px;height:80px;transform:none;border-radius:4px;`;
    div.innerHTML = `
      <div style="position:absolute;inset:0;transform:rotate(45deg);background:var(--amber-lo);border:1.5px solid var(--amber);border-radius:4px;"></div>
      <div style="position:relative;z-index:1;padding:10px 8px;text-align:center;display:flex;flex-direction:column;justify-content:center;height:100%;">
        <div style="font-size:11px;color:var(--amber);letter-spacing:.06em;margin-bottom:2px;">DECISION</div>
        <div style="font-size:12px;color:var(--text0);font-weight:500;line-height:1.3;">${node.name||'Decision'}</div>
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
  State.connections.forEach(c => drawConnection(c,svg));
  if (State.connectingFrom && State.connectMouse) {
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1',State.connectingFrom.x); line.setAttribute('y1',State.connectingFrom.y);
    line.setAttribute('x2',State.connectMouse.x); line.setAttribute('y2',State.connectMouse.y);
    line.setAttribute('stroke','#f0a500'); line.setAttribute('stroke-width','1.5'); line.setAttribute('stroke-dasharray','4,3');
    svg.appendChild(line);
  }
}

function drawConnection(conn, svg) {
  const fn = State.nodes.find(n=>n.id===conn.from), tn = State.nodes.find(n=>n.id===conn.to);
  if (!fn||!tn) return;

  // Use DOM dimensions if available, fall back to fixed estimates (fixes BUG-09 — off-screen nodes)
  const fe = document.getElementById(`node-${conn.from}`);
  const te = document.getElementById(`node-${conn.to}`);
  const fw = (fe && fe.offsetWidth  > 0) ? fe.offsetWidth  : (['start','end'].includes(fn.type) ? 110 : 170);
  const fh = (fe && fe.offsetHeight > 0) ? fe.offsetHeight : 70;
  const tw = (te && te.offsetWidth  > 0) ? te.offsetWidth  : (['start','end'].includes(tn.type) ? 110 : 170);
  const th = (te && te.offsetHeight > 0) ? te.offsetHeight : 70;

  const styleMap = { sequence:'seq', dependency:'dep', loop:'loop', yes:'yes', no:'no' };
  const cs = CONN_STYLES[conn.type]||CONN_STYLES.sequence;
  const markerId = 'arr-'+(styleMap[conn.type]||'seq');

  if (conn.type==='loop') {
    const x1=fn.x+fw/2, y1=fn.y, x2=tn.x+tw/2, y2=tn.y, loopY=Math.min(y1,y2)-50;
    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d',`M${x1} ${y1} C${x1} ${loopY} ${x2} ${loopY} ${x2} ${y2}`);
    path.setAttribute('stroke',cs.color); path.setAttribute('stroke-width','1.5');
    path.setAttribute('stroke-dasharray',cs.dash||''); path.setAttribute('fill','none');
    path.setAttribute('marker-end',`url(#${markerId})`);
    path.style.cursor='pointer'; path.addEventListener('click',()=>selectConnection(conn));
    svg.appendChild(path);
    addSvgLabel(svg,(x1+x2)/2,loopY-8,'loop-back',cs.color); return;
  }
  const x1=fn.x+fw, y1=fn.y+fh/2, x2=tn.x, y2=tn.y+th/2, mx=(x1+x2)/2;
  const path = document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('d',`M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`);
  path.setAttribute('stroke',cs.color); path.setAttribute('stroke-width','1.5');
  if (cs.dash) path.setAttribute('stroke-dasharray',cs.dash);
  path.setAttribute('fill','none'); path.setAttribute('marker-end',`url(#${markerId})`);
  path.style.cursor='pointer'; path.addEventListener('click',()=>selectConnection(conn));
  svg.appendChild(path);
  const lbl = conn.label||cs.label;
  if (lbl) addSvgLabel(svg,mx,(y1+y2)/2-8,lbl,cs.color);
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
  if (State.dragging) { State.dirty=true; State.dragging=null; }
  State.panning=false;
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
  document.getElementById('props-body').innerHTML='<div style="font-size:13px;color:var(--text2);padding:8px 0;">Select a step to edit its properties.</div>';
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
  node[key]=value; if (key==='level') State.lastNodeLevel=value;
  State.dirty=true;
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
    State.nodes=State.nodes.filter(n=>n.id!==id);
    State.connections=State.connections.filter(c=>c.from!==id&&c.to!==id);
    State.dirty=true; clearSelection(); renderCanvas();
    if (!State.nodes.length) document.getElementById('empty-state').style.display='block';
    notify('Step deleted','info');
  } else if (State.selectedConn) {
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
function autoLayout() {
  if (!State.nodes.length) return;
  pushUndo();
  const GAP_X=210,GAP_Y=140,START_X=80,START_Y=80;
  const visited=new Set(), inDegree={};
  State.nodes.forEach(n=>inDegree[n.id]=0);
  State.connections.forEach(c=>{if(inDegree[c.to]!==undefined)inDegree[c.to]++;});
  const queue=[...State.nodes.filter(n=>inDegree[n.id]===0)];
  const colMap={}; let col=0;
  while(queue.length) {
    const node=queue.shift(); if(visited.has(node.id)) continue;
    visited.add(node.id); if(!colMap[col])colMap[col]=[];
    colMap[col].push(node);
    State.connections.filter(c=>c.from===node.id).map(c=>State.nodes.find(n=>n.id===c.to)).filter(Boolean).forEach(child=>{if(!visited.has(child.id))queue.push(child);});
    col++;
  }
  State.nodes.filter(n=>!visited.has(n.id)).forEach(n=>{if(!colMap[col])colMap[col]=[];colMap[col].push(n);col++;});
  Object.entries(colMap).forEach(([c,nodes])=>nodes.forEach((n,r)=>{n.x=START_X+parseInt(c)*GAP_X;n.y=START_Y+r*GAP_Y;}));
  State.dirty=true; renderCanvas(); notify('Auto-layout applied','success');
}

// ── EXPORT SOP ────────────────────────────────────
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

function setLayerFilter(key) {
  activeLayerFilter = key;
  document.querySelectorAll('.lf-btn').forEach(b => b.classList.remove('active'));
  const btn = [...document.querySelectorAll('.lf-btn')].find(b => b.getAttribute('onclick')?.includes(`'${key}'`));
  if (btn) btn.classList.add('active');
  applyLayerFilter();
}

function applyLayerFilter() {
  const f = LAYER_FILTERS[activeLayerFilter];
  if (!f) return;
  window.State.nodes.forEach(n => {
    const el = document.getElementById(`node-${n.id}`);
    if (!el) return;
    let show = true;
    if (f.nodeTypes && !f.nodeTypes.includes(n.type)) show = false;
    if (f.inputTypeFilter && n.inputType !== f.inputTypeFilter) show = false;
    if (f.monitoringFilter && !n.monitoring) show = false;
    el.style.opacity = show ? '1' : '0.15';
    el.style.pointerEvents = show ? '' : 'none';
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
      appendFloatArcoMsg('assistant', `Hello. I'm **ARCŌ** — ask me about this process or describe steps to add.`);
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
