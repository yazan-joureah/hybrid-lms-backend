// src/services/aiService.js — Facade (نفس نمط peerService.js / courseService.js)
const sessionService = require('./ai/session.service');
const studentQueryService = require('./ai/studentQuery.service');
const instructorQueryService = require('./ai/instructorQuery.service');
const historyService = require('./ai/history.service');

module.exports = {
  ...sessionService,
  ...studentQueryService,
  ...instructorQueryService,
  ...historyService,
};
