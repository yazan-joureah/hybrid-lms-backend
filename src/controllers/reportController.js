const personalProgressController = require('./report/personalProgress.controller');
const instructorAnalyticsController = require('./report/instructorAnalytics.controller');

module.exports = {
  ...personalProgressController,
  ...instructorAnalyticsController,
};
