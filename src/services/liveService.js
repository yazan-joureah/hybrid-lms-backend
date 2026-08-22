// src/services/liveService.js — Facade (نفس نمط courseService.js)
const sessionService = require('./live/session.service');
const joinAccessService = require('./live/joinAccess.service');
const lobbyService = require('./live/lobby.service');
const chatService = require('./live/chat.service');
const moderationService = require('./live/moderation.service');

module.exports = {
  ...sessionService,
  ...joinAccessService,
  ...lobbyService,
  ...chatService,
  ...moderationService,
};
