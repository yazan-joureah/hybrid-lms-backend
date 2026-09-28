// src/controllers/live.controller.js
const sessionController = require('./live/session.controller');
const joinController = require('./live/join.controller');

module.exports = {
  ...sessionController,
  ...joinController,
};
