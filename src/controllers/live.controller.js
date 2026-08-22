// src/controllers/live.controller.js — Facade (نفس نمط courseController.js)
const sessionController = require('./live/session.controller');
const joinController = require('./live/join.controller');
const lobbyController = require('./live/lobby.controller');
const chatController = require('./live/chat.controller');
const moderationController = require('./live/moderation.controller');

module.exports = {
  ...sessionController,
  ...joinController,
  ...lobbyController,
  ...chatController,
  ...moderationController,
};
