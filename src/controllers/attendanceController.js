// src/controllers/attendanceController.js — Facade (نفس نمط courseController.js)
const reportController = require('./attendance/report.controller');

module.exports = {
  ...reportController,
};
