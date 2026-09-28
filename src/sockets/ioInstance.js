let ioInstance = null;

function setIO(io) {
  ioInstance = io;
}

/** @returns {import('socket.io').Server | null} */
function getIO() {
  return ioInstance;
}

module.exports = { setIO, getIO };
