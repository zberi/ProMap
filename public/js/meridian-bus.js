/* ═══════════════════════════════════════════════
   MERIDIAN — Event Bus
   Module independence enforced via pub/sub
   Modules communicate only through this bus
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
  promap:process-loaded      { process }
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
─────────────────────────────────────────────── */
