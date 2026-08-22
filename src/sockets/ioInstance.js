/**
 * حاوية بسيطة لمثيل Socket.IO الوحيد في التطبيق — تتجنب الاستيراد الدائري
 * (server.js ينشئ io ويسجّله هنا مرة واحدة عند الإقلاع؛ أي service/controller
 * يحتاج البث اللحظي يستدعي getIO() بدل استيراد server.js مباشرة).
 */
let ioInstance = null;

function setIO(io) {
  ioInstance = io;
}

/** @returns {import('socket.io').Server | null} */
function getIO() {
  return ioInstance;
}

module.exports = { setIO, getIO };
