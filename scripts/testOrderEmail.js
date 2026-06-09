/**
 * Test customer + admin order notification emails.
 * Usage: node scripts/testOrderEmail.js
 * Requires EMAIL_HOST, EMAIL_USER, EMAIL_PASS (Gmail App Password) in backend/.env
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { verifyEmailOnStartup, sendMail } = require('../lib/email');

async function main() {
  const check = await verifyEmailOnStartup();
  if (!check.ok) {
    process.exit(1);
  }

  const admin = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
  const customer = process.argv[2] || admin;

  await sendMail({
    to: customer,
    subject: 'Bazaar — test customer order email',
    text: 'If you received this, customer order confirmations will work.'
  });

  await sendMail({
    to: admin,
    subject: 'Bazaar — test admin new-order email',
    text: 'If you received this, admin order alerts will work.'
  });

  console.log('Test emails sent to:', customer, 'and', admin);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
