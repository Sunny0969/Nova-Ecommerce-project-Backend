/**
 * Test customer + admin order notification emails.
 * Usage: node scripts/testOrderEmail.js
 * Local: EMAIL_HOST, EMAIL_USER, EMAIL_PASS in backend/.env
 * Railway/production: RESEND_API_KEY + EMAIL_FROM
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { verifyEmailOnStartup, sendMail, getEmailProvider } = require('../lib/email');

async function main() {
  const check = await verifyEmailOnStartup();
  if (!check.ok) {
    process.exit(1);
  }

  console.log('Email provider:', getEmailProvider());

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
