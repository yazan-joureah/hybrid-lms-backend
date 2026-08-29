// src/sockets/liveSocketEmitter.js
let liveNamespace = null;

function setLiveNamespace(nsp) {
  liveNamespace = nsp;
}

function emitToSession(sessionId, event, payload) {
  if (!liveNamespace) return;
  liveNamespace.to(`session:${sessionId}`).emit(event, payload);
}

module.exports = { setLiveNamespace, emitToSession };
