// src/services/attendanceService.js
const trackingService = require('./attendance/tracking.service');
const reportService = require('./attendance/report.service');

module.exports = {
  ...trackingService,
  ...reportService,
};
