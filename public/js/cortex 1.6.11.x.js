/* ═══════════════════════════════════════════════
   MERIDIAN — CORTEX Risk & Controls Engine v1.0
   Rule-based evaluation of PROMAP blueprint
   ═══════════════════════════════════════════════ */

const CORTEX = {
  lastReport: null,
};

// ── COSO COMPONENT DEFINITIONS ───────────────────
const COSO_COMPONENTS = [
  {
    id: 'control-environment',
    name: 'Control Environment',
    desc: 'Process ownership and RACI assignment',
    check: (nodes) => {
      const functional = nodes.filter(n => !['start','end','decision'].includes(n.type));
      if (!functional.length) return { score: 0, gaps: ['No steps defined'] };
      const withRaci = functional.filter(n => n.responsible || n.accountable);
      const gaps = functional.filter(n => !n.responsible && !n.accountable).map(n => `"${n.name}" missing R and A`);
      return { score: Math.round((withRaci.length / functional.length) * 100), gaps };
    }
  },
  {
    id: 'risk-assessment',
    name: 'Risk Assessment',
    desc: 'CCP designation and threshold definition',
    check: (nodes) => {
      const controls = nodes.filter(n => n.type === 'control' || n.type === 'ccp');
      if (!controls.length) return { score: 0, gaps: ['No control or CCP steps defined'] };
      const withThresholds = controls.filter(n => n.thresholds && n.thresholds.length > 0);
      const gaps = controls.filter(n => !n.thresholds || !n.thresholds.length).map(n => `"${n.name}" has no thresholds defined`);
      return { score: Math.round((withThresholds.length / controls.length) * 100), gaps };
    }
  },
  {
    id: 'control-activities',
    name: 'Control Activities',
    desc: 'Step classification coverage',
    check: (nodes) => {
      const functional = nodes.filter(n => !['start','end','decision'].includes(n.type));
      if (!functional.length) return { score: 0, gaps: ['No steps defined'] };
      const classified = functional.filter(n => n.classifications && n.classifications.length > 0);
      const gaps = functional.filter(n => !n.classifications || !n.classifications.length).map(n => `"${n.name}" has no classification`);
      return { score: Math.round((classified.length / functional.length) * 100), gaps };
    }
  },
  {
    id: 'information-communication',
    name: 'Information & Communication',
    desc: 'Reporting classifications and SMART monitoring',
    check: (nodes) => {
      const functional = nodes.filter(n => !['start','end','decision'].includes(n.type));
      if (!functional.length) return { score: 0, gaps: ['No steps defined'] };
      const monitored = functional.filter(n => n.monitoring);
      const gaps = functional.filter(n => (n.type==='control'||n.type==='ccp'||n.type==='compliance') && !n.monitoring)
        .map(n => `"${n.name}" is a ${n.type} but monitoring is off`);
      return { score: Math.round((monitored.length / functional.length) * 100), gaps };
    }
  },
  {
    id: 'monitoring-activities',
    name: 'Monitoring Activities',
    desc: 'Record keeping and retention completeness',
    check: (nodes) => {
      const functional = nodes.filter(n => !['start','end','decision'].includes(n.type));
      if (!functional.length) return { score: 0, gaps: ['No steps defined'] };
      const withRecords = functional.filter(n => n.recordRequired && n.retentionPeriod);
      const gaps = functional.filter(n => n.recordRequired && !n.retentionPeriod).map(n => `"${n.name}" record required but retention period missing`);
      return { score: Math.round((withRecords.length / functional.length) * 100), gaps };
    }
  },
];

// ── RISK FLAGS ────────────────────────────────────
const RISK_RULES = [
  {
    id: 'R001', severity: 'critical',
    name: 'CCP without threshold',
    check: (nodes) => nodes.filter(n => n.type==='ccp' && (!n.thresholds||!n.thresholds.length))
      .map(n => ({ nodeId: n.id, step: n.name, detail: 'Critical Control Point has no threshold defined — cannot be monitored or verified' }))
  },
  {
    id: 'R002', severity: 'critical',
    name: 'Control step unclassified',
    check: (nodes) => nodes.filter(n => (n.type==='control'||n.type==='ccp') && (!n.classifications||!n.classifications.length))
      .map(n => ({ nodeId: n.id, step: n.name, detail: 'Control step has no classification — cannot be categorised for compliance reporting' }))
  },
  {
    id: 'R003', severity: 'high',
    name: 'Missing accountability',
    check: (nodes) => nodes.filter(n => !['start','end','decision'].includes(n.type) && !n.accountable)
      .map(n => ({ nodeId: n.id, step: n.name, detail: 'No Accountable party — failure ownership undefined' }))
  },
  {
    id: 'R004', severity: 'high',
    name: 'Missing responsibility',
    check: (nodes) => nodes.filter(n => !['start','end','decision'].includes(n.type) && !n.responsible)
      .map(n => ({ nodeId: n.id, step: n.name, detail: 'No Responsible party — execution ownership undefined' }))
  },
  {
    id: 'R005', severity: 'high',
    name: 'Record required but incomplete',
    check: (nodes) => nodes.filter(n => n.recordRequired && !n.retentionPeriod)
      .map(n => ({ nodeId: n.id, step: n.name, detail: 'Record required but retention period not defined' }))
  },
  {
    id: 'R006', severity: 'medium',
    name: 'Frequency undefined',
    check: (nodes) => nodes.filter(n => !['start','end','decision'].includes(n.type) && !n.frequency)
      .map(n => ({ nodeId: n.id, step: n.name, detail: 'Frequency not defined — cannot schedule or trigger execution' }))
  },
  {
    id: 'R007', severity: 'medium',
    name: 'Control not monitored',
    check: (nodes) => nodes.filter(n => (n.type==='control'||n.type==='ccp') && !n.monitoring)
      .map(n => ({ nodeId: n.id, step: n.name, detail: 'Control or CCP step has SMART monitoring disabled' }))
  },
  {
    id: 'R008', severity: 'medium',
    name: 'Handoff without RACI',
    check: (nodes) => nodes.filter(n => n.type==='handoff' && !n.responsible && !n.accountable)
      .map(n => ({ nodeId: n.id, step: n.name, detail: 'Cross-function handoff has no ownership defined — transfer accountability gap' }))
  },
  {
    id: 'R009', severity: 'low',
    name: 'No loop-back on control',
    check: (nodes) => nodes.filter(n => (n.type==='control'||n.type==='ccp') && !n.loopConfirm)
      .map(n => ({ nodeId: n.id, step: n.name, detail: 'Control step has no loop-back confirmation — downstream may proceed without verification' }))
  },
  {
    id: 'R010', severity: 'low',
    name: 'Compliance step not classified regulatory',
    check: (nodes) => nodes.filter(n => n.type==='compliance' && (!n.classifications || (!n.classifications.includes('compliance-regulatory') && !n.classifications.includes('compliance-internal'))))
      .map(n => ({ nodeId: n.id, step: n.name, detail: 'Compliance step not classified as internal or regulatory' }))
  },
];

// ── MAIN EVALUATE ─────────────────────────────────
function cortexEvaluate() {
  if (!window.State.currentProcess) { notify('No process loaded — open a process in PROMAP first', 'error'); return; }

  const nodes = window.State.nodes;
  const connections = window.State.connections;
  const functional = nodes.filter(n => !['start','end','decision'].includes(n.type));

  // Assign step numbers P001, P002... and control numbers C001, C002...
  let stepCounter = 0, ctrlCounter = 0;
  const stepNumberMap = {}; // nodeId → P001 etc
  const ctrlNumberMap = {}; // nodeId → C001 etc
  functional.forEach(n => {
    stepCounter++;
    stepNumberMap[n.id] = 'P' + String(stepCounter).padStart(3,'0');
    if (n.type === 'control' || n.type === 'ccp') {
      ctrlCounter++;
      ctrlNumberMap[n.id] = 'C' + String(ctrlCounter).padStart(3,'0');
    }
  });

  // COSO scores
  const cosoResults = COSO_COMPONENTS.map(c => ({ ...c, result: c.check(nodes) }));
  const overallCoso = Math.round(cosoResults.reduce((sum, c) => sum + c.result.score, 0) / COSO_COMPONENTS.length);

  // Risk flags — assign per-step risk numbers R001, R001.1, R001.2...
  const riskFlags = [];
  const riskCountPerStep = {}; // stepNum → count
  RISK_RULES.forEach(rule => {
    const hits = rule.check(nodes);
    hits.forEach(h => {
      const stepNum = stepNumberMap[h.nodeId] || 'P000';
      const stepIdx = parseInt(stepNum.slice(1));
      if (!riskCountPerStep[stepIdx]) riskCountPerStep[stepIdx] = 0;
      riskCountPerStep[stepIdx]++;
      const count = riskCountPerStep[stepIdx];
      // Generate risk number: first risk = R001, second = R001.1, third = R001.2...
      const riskNum = count === 1
        ? 'R' + String(stepIdx).padStart(3,'0')
        : 'R' + String(stepIdx).padStart(3,'0') + '.' + (count - 1);
      riskFlags.push({ ...rule, ...h, riskNum, stepNum, ctrlNum: ctrlNumberMap[h.nodeId]||null });
    });
  });

  // Control coverage
  const totalSteps = functional.length;
  const controlSteps = nodes.filter(n => n.type==='control'||n.type==='ccp').length;
  const ccpSteps = nodes.filter(n => n.type==='ccp').length;
  const monitoredSteps = functional.filter(n => n.monitoring).length;
  const recordedSteps = functional.filter(n => n.recordRequired).length;
  const classifiedSteps = functional.filter(n => n.classifications && n.classifications.length).length;

  // Process health index
  const criticalFlags = riskFlags.filter(r => r.severity==='critical').length;
  const highFlags = riskFlags.filter(r => r.severity==='high').length;
  const healthScore = Math.max(0, 100 - (criticalFlags * 20) - (highFlags * 10) - (riskFlags.filter(r=>r.severity==='medium').length * 5));

  // SoD flags — R=A on control/CCP steps
  const sodFlags = [];
  functional.forEach(n => {
    if ((n.type==='control'||n.type==='ccp') && n.responsible && n.accountable && n.responsible.trim()===n.accountable.trim()) {
      const stepNum = stepNumberMap[n.id] || '—';
      sodFlags.push({ nodeId:n.id, step:n.name, stepNum, responsible:n.responsible, accountable:n.accountable, message:`Responsible and Accountable are the same role (${n.responsible}) — Segregation of Duties risk.` });
    }
  });

  CORTEX.lastReport = { cosoResults, overallCoso, riskFlags, sodFlags, totalSteps, controlSteps, ccpSteps, monitoredSteps, recordedSteps, classifiedSteps, healthScore, process: State.currentProcess, generatedAt: new Date(), stepNumberMap, ctrlNumberMap };

  renderCortexReport(CORTEX.lastReport);
}

// ── RENDER REPORT ─────────────────────────────────
function renderCortexReport(r) {
  const container = document.getElementById('cortex-content');

  const sevColor = { critical:'var(--coral)', high:'var(--amber)', medium:'var(--blue)', low:'var(--text1)' };
  const sevBg    = { critical:'var(--coral-lo)', high:'var(--amber-lo)', medium:'var(--blue-lo)', low:'var(--bg3)' };
  const scoreColor = s => s >= 80 ? 'var(--green)' : s >= 60 ? 'var(--amber)' : 'var(--coral)';

  container.innerHTML = `
    <!-- Header -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <div>
        <div style="font-size:16px;font-weight:600;color:var(--text0);">${r.process.name}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:3px;">${r.process.processId||'—'} · ${r.process.function||'—'} · ${r.process.level||'L2'} · Generated ${r.generatedAt.toLocaleTimeString('en-GB')}</div>
      </div>
      <button class="hdr-btn" onclick="cortexExport()">EXPORT REPORT</button>
    </div>

    <!-- KPI Strip -->
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:16px;">
      ${[
        { label:'Process Health', value:r.healthScore+'%', color:scoreColor(r.healthScore) },
        { label:'COSO Coverage', value:r.overallCoso+'%', color:scoreColor(r.overallCoso) },
        { label:'Risk Flags', value:r.riskFlags.length, color:r.riskFlags.filter(f=>f.severity==='critical').length?'var(--coral)':'var(--amber)' },
        { label:'SoD Flags', value:(r.sodFlags||[]).length, color:(r.sodFlags||[]).length?'var(--coral)':'var(--green)' },
        { label:'Control Steps', value:`${r.controlSteps+r.ccpSteps}/${r.totalSteps}`, color:'var(--teal)' },
        { label:'SMART Monitored', value:`${r.monitoredSteps}/${r.totalSteps}`, color:'var(--violet)' },
      ].map(k=>`
        <div style="background:var(--bg2);border:1px solid var(--border);border-top:2px solid ${k.color};border-radius:5px;padding:11px 13px;">
          <div style="font-size:10px;letter-spacing:.1em;color:var(--text2);margin-bottom:7px;text-transform:uppercase;">${k.label}</div>
          <div style="font-size:24px;font-weight:700;color:${k.color};">${k.value}</div>
        </div>`).join('')}
    </div>

    <!-- COSO + Risk Flags -->
    <div style="display:grid;grid-template-columns:1fr 1.2fr;gap:12px;margin-bottom:16px;">

      <!-- COSO -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:5px;padding:14px;">
        <div style="font-size:11px;letter-spacing:.1em;color:var(--text2);margin-bottom:12px;text-transform:uppercase;">COSO Framework Coverage</div>
        ${r.cosoResults.map(c=>`
          <div style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
              <span style="font-size:12px;color:var(--text0);">${c.name}</span>
              <span style="font-size:12px;font-weight:600;color:${scoreColor(c.result.score)};">${c.result.score}%</span>
            </div>
            <div style="height:4px;background:var(--bg3);border-radius:2px;">
              <div style="height:4px;width:${c.result.score}%;background:${scoreColor(c.result.score)};border-radius:2px;transition:width .4s;"></div>
            </div>
            ${c.result.gaps.length?`<div style="font-size:10px;color:var(--coral);margin-top:3px;">⚠ ${c.result.gaps[0]}${c.result.gaps.length>1?` +${c.result.gaps.length-1} more`:''}</div>`:''}
          </div>`).join('')}
      </div>

      <!-- SoD Flags -->
      ${(r.sodFlags||[]).length ? `
      <div style="background:var(--coral-lo);border:1px solid var(--coral);border-radius:5px;padding:14px;">
        <div style="font-size:11px;letter-spacing:.1em;color:var(--coral);margin-bottom:10px;text-transform:uppercase;">⚠ Segregation of Duties (${r.sodFlags.length})</div>
        ${r.sodFlags.map(f=>`
          <div style="padding:7px 0;border-bottom:1px solid rgba(255,255,255,.06);">
            <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
              <span style="font-size:12px;color:var(--text0);font-weight:500;">${f.step}</span>
              <span style="font-size:11px;color:var(--coral);font-family:var(--font-mono);">${f.stepNum}</span>
            </div>
            <div style="font-size:11px;color:var(--text1);">${f.message}</div>
          </div>`).join('')}
      </div>` : `
      <div style="background:var(--green-lo);border:1px solid var(--green);border-radius:5px;padding:10px 14px;font-size:12px;color:var(--green);">✓ No Segregation of Duties issues detected</div>`}

      <!-- Risk Flags -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:5px;padding:14px;">
        <div style="font-size:11px;letter-spacing:.1em;color:var(--text2);margin-bottom:12px;text-transform:uppercase;">Risk Flags (${r.riskFlags.length})</div>
        ${!r.riskFlags.length
          ? `<div style="font-size:13px;color:var(--green);padding:8px 0;">✓ No risk flags detected</div>`
          : `<div style="display:flex;flex-direction:column;gap:6px;max-height:280px;overflow-y:auto;">
              ${r.riskFlags.map(f=>`
                <div style="background:${sevBg[f.severity]};border:1px solid ${sevColor[f.severity]};border-radius:4px;padding:8px 10px;">
                  <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
                    <span style="font-size:10px;color:${sevColor[f.severity]};letter-spacing:.08em;text-transform:uppercase;">${f.severity} · ${f.riskNum||f.id}</span>
                    <span style="font-size:10px;color:var(--text2);">${f.stepNum||''} ${f.ctrlNum?'· '+f.ctrlNum:''}</span>
                  </div>
                  <div style="font-size:12px;color:var(--text0);margin-bottom:2px;">${f.step}</div>
                  <div style="font-size:11px;color:var(--text1);">${f.detail}</div>
                </div>`).join('')}
            </div>`}
      </div>
    </div>

    <!-- Step Coverage Table -->
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:5px;padding:14px;overflow-x:auto;">
      <div style="font-size:11px;letter-spacing:.1em;color:var(--text2);margin-bottom:12px;text-transform:uppercase;">Step Control Coverage</div>
      <div style="min-width:700px;">
      <div style="display:grid;grid-template-columns:48px 48px minmax(140px,1fr) 90px 90px 80px 80px 80px minmax(100px,1fr);gap:6px;padding:0 8px 8px;font-size:10px;color:var(--text2);letter-spacing:.08em;border-bottom:1px solid var(--border);">
        <span>STEP#</span><span>CTRL#</span><span>STEP</span><span>TYPE</span><span>RISK#</span><span>CLASS</span><span>SMART</span><span>RACI</span><span>FLAGS</span>
      </div>
      ${window.State.nodes.filter(n=>!['start','end','decision'].includes(n.type)).map(n=>{
        const stepNum = r.stepNumberMap?.[n.id] || '—';
        const ctrlNum = r.ctrlNumberMap?.[n.id] || '—';
        const flags = r.riskFlags.filter(f=>f.nodeId===n.id);
        const riskNums = flags.map(f=>f.riskNum).join(', ') || '—';
        const hasClass = n.classifications&&n.classifications.length;
        const hasRaci = n.responsible||n.accountable;
        return `
        <div style="display:grid;grid-template-columns:48px 48px minmax(140px,1fr) 90px 90px 80px 80px 80px minmax(100px,1fr);gap:6px;padding:7px 8px;border-bottom:1px solid var(--border);align-items:center;">
          <span style="font-size:11px;color:var(--amber);font-family:var(--font-mono);">${stepNum}</span>
          <span style="font-size:11px;color:var(--teal);font-family:var(--font-mono);">${ctrlNum}</span>
          <span style="font-size:12px;color:var(--text0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${n.name}">${n.name}</span>
          <span style="font-size:10px;color:${NODE_COLORS[n.type]?.text||'var(--text1)'};text-transform:uppercase;">${n.type}</span>
          <span style="font-size:11px;color:${flags.length?'var(--coral)':'var(--text2)'};font-family:var(--font-mono);">${riskNums}</span>
          <span style="font-size:12px;color:${hasClass?'var(--green)':'var(--coral)'};">${hasClass?'✓':'✗'}</span>
          <span style="font-size:12px;color:${n.monitoring?'var(--green)':'var(--text2)'};">${n.monitoring?'✓':'—'}</span>
          <span style="font-size:12px;color:${hasRaci?'var(--green)':'var(--coral)'};">${hasRaci?'✓':'✗'}</span>
          <span style="font-size:11px;color:${flags.length?'var(--coral)':'var(--text2)'};">${flags.length?flags.map(f=>f.id).join(', '):'—'}</span>
        </div>`}).join('')}
      </div>
    </div>
  `;
}

// ── EXPORT REPORT ─────────────────────────────────
function cortexExport() {
  if (!CORTEX.lastReport) return;
  const r = CORTEX.lastReport;
  const sevLabel = { critical:'CRITICAL', high:'HIGH', medium:'MEDIUM', low:'LOW' };

  let txt = `================================================================================
CORTEX RISK & CONTROLS REPORT — MERIDIAN
================================================================================
Process:     ${r.process.name}
Process ID:  ${r.process.processId||'—'}
Function:    ${r.process.function||'—'}
Generated:   ${r.generatedAt.toLocaleString('en-GB')}
--------------------------------------------------------------------------------

EXECUTIVE SUMMARY
--------------------------------------------------------------------------------
Process Health Index:  ${r.healthScore}%
COSO Coverage:         ${r.overallCoso}%
Total Risk Flags:      ${r.riskFlags.length} (${r.riskFlags.filter(f=>f.severity==='critical').length} critical, ${r.riskFlags.filter(f=>f.severity==='high').length} high)
Control Steps:         ${r.controlSteps + r.ccpSteps} of ${r.totalSteps}
SMART Monitored:       ${r.monitoredSteps} of ${r.totalSteps}
Records Defined:       ${r.recordedSteps} of ${r.totalSteps}

COSO FRAMEWORK COVERAGE
--------------------------------------------------------------------------------
${r.cosoResults.map(c=>c.name.padEnd(35)+' '+c.result.score+'%'+(c.result.gaps.length?'\n  Gaps: '+c.result.gaps.join('\n        '):'') ).join('\n')}

RISK FLAGS
--------------------------------------------------------------------------------
${!r.riskFlags.length?'No risk flags detected.'
  :r.riskFlags.map(f=>`[${sevLabel[f.severity]}] ${f.id} — ${f.step}\n  ${f.detail}`).join('\n\n')}

STEP COVERAGE
--------------------------------------------------------------------------------
${'STEP'.padEnd(30)} ${'TYPE'.padEnd(12)} ${'CLASS'.padEnd(8)} ${'MON'.padEnd(6)} ${'REC'.padEnd(6)} RACI
${State.nodes.filter(n=>!['start','end','decision'].includes(n.type)).map(n=>
  `${n.name.substring(0,28).padEnd(30)} ${n.type.padEnd(12)} ${(n.classifications?.length?'YES':'NO').padEnd(8)} ${(n.monitoring?'YES':'NO').padEnd(6)} ${(n.recordRequired?'YES':'NO').padEnd(6)} ${(n.responsible||n.accountable)?'YES':'NO'}`
).join('\n')}

================================================================================
END — CORTEX v1.0 | MERIDIAN
================================================================================`;

  const blob = new Blob([txt],{type:'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `CORTEX_${(r.process.processId||r.process.name).replace(/\s+/g,'_')}_${new Date().toISOString().split('T')[0]}.txt`;
  a.click();
  notify('CORTEX report exported','success');
}
