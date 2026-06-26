/* ═══════════════════════════════════════════════
   MERIDIAN — Event Bus v1.6.13
   Module independence enforced via pub/sub
   Updated: 2026-06-25
   ═══════════════════════════════════════════════ */

window.MeridianBus = {
  _listeners: {},

  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
  },

  off(event, callback) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
  },

  emit(event, data) {
    (this._listeners[event] || []).forEach(cb => {
      try { cb(data); } catch(e) { console.error(`MeridianBus error on ${event}:`, e); }
    });
  }
};

/* ── DEFINED EVENTS ──────────────────────────────
  promap:process-loaded      { process, nodes, connections }
  promap:blueprint-changed   { process, nodes, connections }
  promap:node-selected       { node, nodes, connections }
  promap:node-deselected     {}
  arco:steps-extracted       { steps }
  arco:steps-sent-to-promap  { count }
  cortex:evaluation-complete { report }
  cortex:suggestion-proposed { suggestions[] }
  cortex:suggestion-accepted { suggestionId, nodeId, changes }
  cortex:suggestion-rejected { suggestionId, reason }
  promap:suggestion-applied  { suggestionId }
  audit:entry                { processId, event, detail, source }
─────────────────────────────────────────────── */
