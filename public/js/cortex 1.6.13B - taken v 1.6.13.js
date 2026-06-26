/* ═══════════════════════════════════════════════
   MERIDIAN — CORTEX Risk & Controls Engine v1.6.13
   Updated: 2026-06-25
   ═══════════════════════════════════════════════ */

const CORTEX = {
  lastReport: null,
};

// ── COSO COMPONENTS ───────────────────────────────
const COSO_COMPONENTS = [
  {
    id: 'control-environment',
    name: 'Control Environment',
    desc: 'Process ownership and RACI assignment',
    check: (nodes) => {
      const functional = nodes.filter(n => !['start','end','decision'].includes(n.type));
      if (!functional.length) return { score:0, gaps:['No steps defined'] };
      const withRaci = functional.filter(n => n.responsible || n.accountable);
      const gaps = functional.filter(n => !n.responsible && !n.accountable).map(n => `"${n.name}" missing R and A`);
      return { score: Math.round((withRaci.length/functional.length)*100), gaps };
    }
  },
  {
    id: 'risk-assessment',
    name: 'Risk Assessment',
    desc: 'CCP designation and threshold definition',
    check: (nodes) => {
      const controls = nodes.filter(n => n.type==='control'||n.type==='ccp');
      if (!controls.length) return { score:0, gaps:['No control or CCP steps defined'] };
      const withThresholds = controls.filter(n => n.thresholds&&n.thresholds.length>0);
      const gaps = controls.filter(n => !n.thresholds||!n.thresholds.length).map(n => `"${n.name}" has no thresholds`);
      return { score: Math.round((withThresholds.length/controls.length)*100), gaps };
    }
  },
  {
    id: 'control-activities',
    name: 'Control Activities',
    desc: 'Step classification coverage',
    check: (nodes) => {
      const functional = nodes.filter(n => !['start','end','decision'].includes(n.type));
      if (!functional.length) return { score:0, gaps:['No steps defined'] };
      const classified = functional.filter(n => n.classifications&&n.classifications.length>0);
      const gaps = functional.filter(n => !n.classifications||!n.classifications.length).map(n => `"${n.name}" unclassified`);
      return { score: Math.round((classified.length/functional.length)*100), gaps };
    }
  },
  {
    id: 'information-communication',
    name: 'Information & Communication',
    desc: 'Reporting classifications and SMART monitoring',
    check: (nodes) => {
      const functional = nodes.filter(n => !['start','end','decision'].includes(n.type));
      if (!functional.length) return { score:0, gaps:['No steps defined'] };
      const monitored = functional.filter(n => n.monitoring);
      const gaps = functional.filter(n => (n.type==='control'||n.type==='ccp'||n.type==='compliance') && !n.monitoring)
        .map(n => `"${n.name}" is ${n.type} but monitoring off`);
      return { score: Math.round((monitored.length/functional.length)*100), gaps };
    }
  },
  {
    id: 'monitoring-activities',
    name: 'Monitoring Activities',
    desc: 'Record keeping and retention completeness',
    check: (nodes) => {
      const functional = nodes.filter(n => !['start','end','decision'].includes(n.type));
      if (!functional.length) return { score:0, gaps:['No steps defined'] };
      const withRecords = functional.filter(n => n.recordRequired&&n.retentionPeriod);
      const gaps = functional.filter(n => n.recordRequired&&!n.retentionPeriod).map(n => `"${n.name}" record required but no retention period`);
      return { score: Math.round((withRecords.length/functional.length)*100), gaps };
    }
  },
];

// ── RISK RULES ────────────────────────────────────
const RISK_RULES = [
  {
    id:'R001', severity:'critical',
    name:'CCP without threshold',
    check: (nodes) => nodes.filter(n => n.type==='ccp'&&(!n.thresholds||!n.thresholds.length))
      .map(n => ({ nodeId:n.id, step:n.name, detail:'Critical Control Point has no threshold — cannot be monitored or verified' }))
  },
  {
    id:'R002', severity:'critical',
    name:'Control step unclassified',
    check: (nodes) => nodes.filter(n => (n.type==='control'||n.type==='ccp')&&(!n.classifications||!n.classifications.length))
      .map(n => ({ nodeId:n.id, step:n.name, detail:'Control step has no classification — cannot be categorised for compliance reporting' }))
  },
  {
    id:'R003', severity:'high',
    name:'Missing accountability',
    check: (nodes) => nodes.filter(n => !['start','end','decision'].includes(n.type)&&!n.accountable)
      .map(n => ({ nodeId:n.id, step:n.name, detail:'No Accountable party — failure ownership undefined' }))
  },
  {
    id:'R004', severity:'high',
    name:'Missing responsibility',
    check: (nodes) => nodes.filter(n => !['start','end','decision'].includes(n.type)&&!n.responsible)
      .map(n => ({ nodeId:n.id, step:n.name, detail:'No Responsible party — execution ownership undefined' }))
  },
  {
    id:'R005', severity:'high',
    name:'Record required but incomplete',
    check: (nodes) => nodes.filter(n => n.recordRequired&&!n.retentionPeriod)
      .map(n => ({ nodeId:n.id, step:n.name, detail:'Record required but retention period not defined' }))
  },
  {
    id:'R006', severity:'medium',
    name:'Frequency undefined',
    check: (nodes) => nodes.filter(n => !['start','end','decision'].includes(n.type)&&!n.frequency)
      .map(n => ({ nodeId:n.id, step:n.name, detail:'Frequency not defined — cannot schedule or trigger execution' }))
  },
  {
    id:'R007', severity:'medium',
    name:'Control not monitored',
    check: (nodes) => nodes.filter(n => (n.type==='control'||n.type==='ccp')&&!n.monitoring)
      .map(n => ({ nodeId:n.id, step:n.name, detail:'Control/CCP step has SMART monitoring disabled' }))
  },
  {
    id:'R008', severity:'medium',
    name:'Handoff without RACI',
    check: (nodes) => nodes.filter(n => n.type==='handoff'&&!n.responsible&&!n.accountable)
      .map(n => ({ nodeId:n.id, step:n.name, detail:'Cross-function handoff has no ownership — transfer accountability gap' }))
  },
  {
    id:'R009', severity:'low',
    name:'No loop-back on control',
    check: (nodes) => nodes.filter(n => (n.type==='control'||n.type==='ccp')&&!n.loopConfirm)
      .map(n => ({ nodeId:n.id, step:n.name, detail:'Control step has no loop-back confirmation — downstream may proceed without verification' }))
  },
  {
    id:'R010', severity:'low',
    name:'Compliance step not classified',
    check: (nodes) => nodes.filter(n => n.type==='compliance'&&(!n.classifications||(!n.classifications.includes('compliance-regulatory')&&!n.classifications.includes('compliance-internal'))))
      .map(n => ({ nodeId:n.id, step:n.name, detail:'Compliance step not classified as internal or regulatory' }))
  },
];

// ── MAIN EVALUATE ─────────────────────────────────
function cortexEvaluate() {
  if (!window.State || !window.State.currentProcess) {
    if (typeof notify === 'function') notify('No process loaded — open a process in PROMAP first','error');
    renderCortexNA();
    return;
  }

  const nodes = window.State.nodes;
  const functional = nodes.filter(n => !['start','end','decision'].includes(n.type));

  if (!functional.length) {
    renderCortexNA();
    return;
  }

  // Step numbering P001/C001 — C matches P index
  let stepCounter=0, ctrlCounter=0;
  const stepNumberMap={}, ctrlNumberMap={};
  functional.forEach(n => {
    stepCounter++;
    stepNumberMap[n.id]='P'+String(stepCounter).padStart(3,'0');
    if (n.type==='control'||n.type==='ccp') {
      ctrlNumberMap[n.id]='C'+String(stepCounter).padStart(3,'0'); // matches P index (NUM-01)
    }
  });

  // COSO
  const cosoResults = COSO_COMPONENTS.map(c => ({ ...c, result:c.check(nodes) }));
  const overallCoso = Math.round(cosoResults.reduce((sum,c)=>sum+c.result.score,0)/COSO_COMPONENTS.length);

  // Risk flags — R number aligned to P step index
  const riskFlags=[];
  const riskCountPerStep={};
  RISK_RULES.forEach(rule => {
    const hits=rule.check(nodes);
    hits.forEach(h => {
      const stepNum=stepNumberMap[h.nodeId]||'P000';
      const stepIdx=parseInt(stepNum.slice(1));
      if (!riskCountPerStep[stepIdx]) riskCountPerStep[stepIdx]=0;
      riskCountPerStep[stepIdx]++;
      const count=riskCountPerStep[stepIdx];
      const riskNum=count===1
        ? 'R'+String(stepIdx).padStart(3,'0')
        : 'R'+String(stepIdx).padStart(3,'0')+'.'+(count-1);
      riskFlags.push({ ...rule, ...h, riskNum, stepNum, ctrlNum:ctrlNumberMap[h.nodeId]||null });
    });
  });

  // SoD — R=A on control/CCP steps
  const sodFlags=[];
  functional.forEach(n => {
    if ((n.type==='control'||n.type==='ccp')&&n.responsible&&n.accountable&&n.responsible.trim()===n.accountable.trim()) {
      sodFlags.push({ nodeId:n.id, step:n.name, stepNum:stepNumberMap[n.id]||'—', responsible:n.responsible, accountable:n.accountable,
        message:`Responsible and Accountable are the same role (${n.responsible}) — Segregation of Duties risk.` });
    }
  });

  // Coverage stats
  const totalSteps=functional.length;
  const controlSteps=nodes.filter(n=>n.type==='control').length;
  const ccpSteps=nodes.filter(n=>n.type==='ccp').length;
  const monitoredSteps=functional.filter(n=>n.monitoring).length;
  const recordedSteps=functional.filter(n=>n.recordRequired).length;
  const classifiedSteps=functional.filter(n=>n.classifications&&n.classifications.length).length;

  // Health score
  const criticalFlags=riskFlags.filter(r=>r.severity==='critical').length;
  const highFlags=riskFlags.filter(r=>r.severity==='high').length;
  const healthScore=Math.max(0,100-(criticalFlags*20)-(highFlags*10)-(riskFlags.filter(r=>r.severity==='medium').length*5));

  CORTEX.lastReport={
    cosoResults, overallCoso, riskFlags, sodFlags,
    totalSteps, controlSteps, ccpSteps, monitoredSteps, recordedSteps, classifiedSteps,
    healthScore, process:State.currentProcess,
    generatedAt:new Date(), stepNumberMap, ctrlNumberMap,
    notApplicable:false
  };

  renderCortexReport(CORTEX.lastReport);

  if (typeof MeridianBus !== 'undefined')
    MeridianBus.emit('cortex:evaluation-complete', CORTEX.lastReport);

  if (typeof auditEntry === 'function')
    auditEntry('cortex-eval', `Health:${healthScore}% Flags:${riskFlags.length} SoD:${sodFlags.length}`, 'cortex');
}

function renderCortexNA() {
  const container=document.getElementById('cortex-content');
  if (!container) return;
  container.innerHTML=`<div style="text-align:center;padding:60px 20px;">
    <div style="font-size:16px;color:var(--text2);letter-spacing:.1em;margin-bottom:10px;">CORTEX</div>
    <div style="font-size:13px;color:var(--text2);">Load a process in PROMAP then click RUN EVALUATION</div>
  </div>`;
  CORTEX.lastReport={ notApplicable:true };
  if (typeof MeridianBus !== 'undefined')
    MeridianBus.emit('cortex:evaluation-complete', CORTEX.lastReport);
}

// ── RENDER REPORT ─────────────────────────────────
function renderCortexReport(r) {
  const container=document.getElementById('cortex-content');
  if (!container) return;

  const sevColor={ critical:'var(--coral)', high:'var(--amber)', medium:'var(--blue)', low:'var(--text1)' };
  const sevBg   ={ critical:'var(--coral-lo)', high:'var(--amber-lo)', medium:'var(--blue-lo)', low:'var(--bg3)' };
  const scoreColor=s=>s>=80?'var(--green)':s>=60?'var(--amber)':'var(--coral)';

  container.innerHTML=`
    <!-- Header -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <div>
        <div style="font-size:16px;font-weight:600;color:var(--text0);">${r.process.name}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:3px;">${r.process.processId||'—'} · ${r.process.function||'—'} · ${r.process.level||'L2'} · ${r.generatedAt.toLocaleTimeString('en-GB')}</div>
      </div>
      <button class="hdr-btn" onclick="cortexExport()">EXPORT REPORT</button>
    </div>

    <!-- KPI Strip -->
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:16px;">
      ${[
        { label:'Process Health',  value:r.healthScore+'%',               color:scoreColor(r.healthScore) },
        { label:'Coverage Score',  value:r.overallCoso+'%',               color:scoreColor(r.overallCoso) },
        { label:'Risk Flags',      value:r.riskFlags.length,              color:r.riskFlags.filter(f=>f.severity==='critical').length?'var(--coral)':'var(--amber)' },
        { label:'SoD Flags',       value:(r.sodFlags||[]).length,         color:(r.sodFlags||[]).length?'var(--coral)':'var(--green)' },
        { label:'Control Steps',   value:`${r.controlSteps+r.ccpSteps}/${r.totalSteps}`, color:'var(--teal)' },
        { label:'SMART Monitored', value:`${r.monitoredSteps}/${r.totalSteps}`,           color:'var(--violet)' },
      ].map(k=>`
        <div style="background:var(--bg2);border:1px solid var(--border);border-top:2px solid ${k.color};border-radius:5px;padding:10px 12px;">
          <div style="font-size:10px;letter-spacing:.1em;color:var(--text2);margin-bottom:6px;text-transform:uppercase;">${k.label}</div>
          <div style="font-size:22px;font-weight:700;color:${k.color};">${k.value}</div>
        </div>`).join('')}
    </div>

    <!-- Control Framework + SoD -->
    <div style="display:grid;grid-template-columns:1fr 1.2fr;gap:12px;margin-bottom:16px;">

      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:5px;padding:14px;">
        <div style="font-size:11px;letter-spacing:.1em;color:var(--text2);margin-bottom:12px;text-transform:uppercase;">Control Framework Coverage</div>
        ${r.cosoResults.map(c=>`
          <div style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
              <span style="font-size:12px;color:var(--text0);">${c.name}</span>
              <span style="font-size:12px;font-weight:600;color:${scoreColor(c.result.score)};">${c.result.score}%</span>
            </div>
            <div style="height:4px;background:var(--bg3);border-radius:2px;">
              <div style="height:4px;width:${c.result.score}%;background:${scoreColor(c.result.score)};border-radius:2px;"></div>
            </div>
            ${c.result.gaps.length?`<div style="font-size:10px;color:var(--coral);margin-top:3px;">⚠ ${c.result.gaps[0]}${c.result.gaps.length>1?` +${c.result.gaps.length-1} more`:''}</div>`:''}
          </div>`).join('')}
      </div>

      ${(r.sodFlags||[]).length?`
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
      </div>`:`
      <div style="background:var(--green-lo);border:1px solid var(--green);border-radius:5px;padding:10px 14px;font-size:12px;color:var(--green);display:flex;align-items:center;">✓ No Segregation of Duties issues detected</div>`}
    </div>

    <!-- Risk Flags -->
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:5px;padding:14px;margin-bottom:16px;">
      <div style="font-size:11px;letter-spacing:.1em;color:var(--text2);margin-bottom:10px;text-transform:uppercase;">
        Risk Flags (${r.riskFlags.length})
        <span style="margin-left:12px;font-size:10px;">
          ${['critical','high','medium','low'].map(s=>{
            const c=r.riskFlags.filter(f=>f.severity===s).length;
            return c?`<span style="color:${sevColor[s]};margin-right:8px;">${s.toUpperCase()}: ${c}</span>`:'';
          }).join('')}
        </span>
      </div>
      <!-- Flag Legend -->
      <div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
        ${Object.entries(sevColor).map(([s,c])=>`<span style="font-size:10px;color:${c};border:1px solid ${c};border-radius:3px;padding:2px 7px;">${s.toUpperCase()}</span>`).join('')}
      </div>
      ${!r.riskFlags.length
        ?`<div style="font-size:13px;color:var(--green);padding:8px 0;">✓ No risk flags detected</div>`
        :`<div style="display:flex;flex-direction:column;gap:6px;max-height:260px;overflow-y:auto;">
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

    <!-- Step Coverage Table -->
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:5px;padding:14px;overflow-x:auto;">
      <div style="font-size:11px;letter-spacing:.1em;color:var(--text2);margin-bottom:12px;text-transform:uppercase;">Step Control Coverage</div>
      <div style="min-width:720px;">
        <div style="display:grid;grid-template-columns:52px 52px minmax(140px,1fr) 90px 90px 70px 70px 70px 52px minmax(90px,1fr);gap:5px;padding:0 8px 8px;font-size:10px;color:var(--text2);letter-spacing:.08em;border-bottom:1px solid var(--border);">
          <span>STEP#</span><span>CTRL#</span><span>STEP</span><span>TYPE</span><span>RISK#</span><span>CLASS</span><span>SMART</span><span>RACI</span><span>SoD</span><span>FLAGS</span>
        </div>
        ${window.State.nodes.filter(n=>!['start','end','decision'].includes(n.type)).map(n=>{
          const stepNum=r.stepNumberMap?.[n.id]||'—';
          const ctrlNum=r.ctrlNumberMap?.[n.id]||'—';
          const flags=r.riskFlags.filter(f=>f.nodeId===n.id);
          const riskNums=flags.map(f=>f.riskNum).join(', ')||'—';
          const hasClass=n.classifications&&n.classifications.length;
          const hasRaci=n.responsible||n.accountable;
          const sodHit=(r.sodFlags||[]).some(f=>f.nodeId===n.id);
          return `
          <div style="display:grid;grid-template-columns:52px 52px minmax(140px,1fr) 90px 90px 70px 70px 70px 52px minmax(90px,1fr);gap:5px;padding:7px 8px;border-bottom:1px solid var(--border);align-items:center;">
            <span style="font-size:11px;color:var(--amber);font-family:var(--font-mono);">${stepNum}</span>
            <span style="font-size:11px;color:var(--teal);font-family:var(--font-mono);">${ctrlNum}</span>
            <span style="font-size:12px;color:var(--text0);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${n.name}">${n.name}</span>
            <span style="font-size:10px;color:${NODE_COLORS[n.type]?.text||'var(--text1)'};text-transform:uppercase;">${n.type}</span>
            <span style="font-size:11px;color:${flags.length?'var(--coral)':'var(--text2)'};font-family:var(--font-mono);">${riskNums}</span>
            <span style="font-size:12px;color:${hasClass?'var(--green)':'var(--coral)'};">${hasClass?'✓':'✗'}</span>
            <span style="font-size:12px;color:${n.monitoring?'var(--green)':'var(--text2)'};">${n.monitoring?'✓':'—'}</span>
            <span style="font-size:12px;color:${hasRaci?'var(--green)':'var(--coral)'};">${hasRaci?'✓':'✗'}</span>
            <span style="font-size:12px;color:${sodHit?'var(--coral)':'var(--text2)'};">${sodHit?'⚠':'—'}</span>
            <span style="font-size:11px;color:${flags.length?'var(--coral)':'var(--text2)'};">${flags.length?flags.map(f=>f.id).join(', '):'—'}</span>
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

// ── EXPORT REPORT ─────────────────────────────────
function cortexExport() {
  if (!CORTEX.lastReport || CORTEX.lastReport.notApplicable) { if(typeof notify==='function') notify('No evaluation to export','error'); return; }
  const r=CORTEX.lastReport;
  const sevLabel={ critical:'CRITICAL', high:'HIGH', medium:'MEDIUM', low:'LOW' };

  let txt=`================================================================================
CORTEX RISK & CONTROLS REPORT — MERIDIAN v1.6.13
================================================================================
Process:     ${r.process.name}
Process ID:  ${r.process.processId||'—'}
Function:    ${r.process.function||'—'}
Generated:   ${r.generatedAt.toLocaleString('en-GB')}
--------------------------------------------------------------------------------

EXECUTIVE SUMMARY
--------------------------------------------------------------------------------
Process Health Index:  ${r.healthScore}%
Coverage Score:        ${r.overallCoso}%
Total Risk Flags:      ${r.riskFlags.length} (${r.riskFlags.filter(f=>f.severity==='critical').length} critical, ${r.riskFlags.filter(f=>f.severity==='high').length} high)
SoD Flags:             ${(r.sodFlags||[]).length}
Control Steps:         ${r.controlSteps+r.ccpSteps} of ${r.totalSteps}
SMART Monitored:       ${r.monitoredSteps} of ${r.totalSteps}
Records Defined:       ${r.recordedSteps} of ${r.totalSteps}

CONTROL FRAMEWORK COVERAGE
--------------------------------------------------------------------------------
${r.cosoResults.map(c=>c.name.padEnd(35)+' '+c.result.score+'%'+(c.result.gaps.length?'\n  Gaps: '+c.result.gaps.join('\n        '):'') ).join('\n')}

SEGREGATION OF DUTIES
--------------------------------------------------------------------------------
${!(r.sodFlags||[]).length?'No SoD issues detected.'
  :r.sodFlags.map(f=>`[${f.stepNum}] ${f.step}\n  ${f.message}`).join('\n\n')}

RISK FLAGS
--------------------------------------------------------------------------------
${!r.riskFlags.length?'No risk flags detected.'
  :r.riskFlags.map(f=>`[${sevLabel[f.severity]}] ${f.riskNum||f.id} — ${f.step}\n  ${f.detail}`).join('\n\n')}

STEP COVERAGE
--------------------------------------------------------------------------------
${'STEP#'.padEnd(7)} ${'CTRL#'.padEnd(7)} ${'STEP'.padEnd(30)} ${'TYPE'.padEnd(12)} ${'CLASS'.padEnd(6)} ${'MON'.padEnd(5)} ${'REC'.padEnd(5)} ${'SoD'.padEnd(5)} RACI
${State.nodes.filter(n=>!['start','end','decision'].includes(n.type)).map(n=>{
  const sn=r.stepNumberMap?.[n.id]||'—';
  const cn=r.ctrlNumberMap?.[n.id]||'—';
  const sodHit=(r.sodFlags||[]).some(f=>f.nodeId===n.id);
  return `${sn.padEnd(7)} ${cn.padEnd(7)} ${n.name.substring(0,28).padEnd(30)} ${n.type.padEnd(12)} ${(n.classifications?.length?'YES':'NO').padEnd(6)} ${(n.monitoring?'YES':'NO').padEnd(5)} ${(n.recordRequired?'YES':'NO').padEnd(5)} ${(sodHit?'FLAG':'—').padEnd(5)} ${(n.responsible||n.accountable)?'YES':'NO'}`;
}).join('\n')}

================================================================================
END — CORTEX v1.6.13 | MERIDIAN
================================================================================`;

  const blob=new Blob([txt],{type:'text/plain'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`CORTEX_${(r.process.processId||r.process.name).replace(/\s+/g,'_')}_${new Date().toISOString().split('T')[0]}.txt`;
  a.click();
  if (typeof notify==='function') notify('CORTEX report exported','success');
  if (typeof auditEntry==='function') auditEntry('cortex-exported','CORTEX report exported','cortex');
}
