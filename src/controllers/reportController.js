// src/controllers/reportController.js — Facade (نفس نمط adminController.js/attendanceController.js)
const personalProgressController = require('./report/personalProgress.controller');

module.exports = {
  ...personalProgressController,
  // UC-REPORT-01 (Admin) و UC-REPORT-02 (Instructor) يُضافان هنا لاحقاً
  // بنفس النمط، عند توفّر خدمات QUIZ/PAY/ATT الفعلية للاطلاع عليها.
};
