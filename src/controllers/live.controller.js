// src/controllers/live.controller.js — Facade (نفس نمط courseController.js)
const sessionController = require('./live/session.controller');
const joinController = require('./live/join.controller');

module.exports = {
  ...sessionController,
  ...joinController,
};
