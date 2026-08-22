// src/services/attendanceService.js — Facade (نفس نمط courseService.js)
const trackingService = require('./attendance/tracking.service');
const reportService = require('./attendance/report.service');

module.exports = {
  ...trackingService,
  ...reportService,
};
