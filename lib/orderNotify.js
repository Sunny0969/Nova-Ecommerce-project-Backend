const { scheduleOrderPlacedEmails } = require('./email');

/** Schedule customer + admin order emails after the HTTP response is sent. */
function scheduleOrderEmailsFromResult(result, res) {
  if (!result || result.duplicate || !result.emailNotify || !result.populated) return;
  const { user, addr } = result.emailNotify;
  scheduleOrderPlacedEmails(result.populated, user, addr, res);
}

module.exports = { scheduleOrderEmailsFromResult };
