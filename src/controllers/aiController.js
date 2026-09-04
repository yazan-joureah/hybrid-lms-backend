// src/controllers/aiController.js — Facade (نفس نمط peerController.js)
const instructorSessionController = require('./ai/instructorSession.controller');
const studentSessionController = require('./ai/studentSession.controller');
const studentQueryController = require('./ai/studentQuery.controller');
const instructorQueryController = require('./ai/instructorQuery.controller');
const historyController = require('./ai/history.controller');

module.exports = {
  ...instructorSessionController,
  ...studentSessionController,
  ...studentQueryController,
  ...instructorQueryController,
  ...historyController,
};
