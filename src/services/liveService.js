// src/services/liveService.js — Facade (نفس نمط courseService.js)
const sessionService = require('./live/session.service');
const joinAccessService = require('./live/joinAccess.service');

module.exports = {
  ...sessionService,
  ...joinAccessService,
};
