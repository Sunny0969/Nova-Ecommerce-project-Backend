const { scheduleOrderEmailsFromResult } = require('../services/orderEmailDelivery');
const { scheduleMetaPurchaseFromResult } = require('../services/metaConversions');

function notifyOrderPlaced(result, res, req) {
  scheduleOrderEmailsFromResult(result, res);
  scheduleMetaPurchaseFromResult(result, req);
}

module.exports = { scheduleOrderEmailsFromResult, notifyOrderPlaced };