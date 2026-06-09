/**
 * Check Resend domain + from-address setup.
 * Usage: node scripts/checkResendSetup.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { getEmailProvider, emailFromAddress, isEmailConfigured } = require('../lib/email');

async function main() {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) {
    console.error('RESEND_API_KEY is not set in backend/.env');
    process.exit(1);
  }

  console.log('Email provider:', getEmailProvider());
  console.log('Configured:', isEmailConfigured());
  console.log('From address used by app:', emailFromAddress());

  const listRes = await fetch('https://api.resend.com/domains', {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  const listBody = await listRes.json().catch(() => ({}));

  if (!listRes.ok) {
    console.error('Failed to list domains:', listBody?.message || listRes.status);
    process.exit(1);
  }

  const domains = listBody?.data || [];
  console.log('\nResend domains:');
  for (const d of domains) {
    console.log(`- ${d.name} | status: ${d.status} | id: ${d.id}`);
  }

  const verified = domains.find((d) => d.name === 'bazaar-pk.com' && d.status === 'verified');
  if (verified) {
    console.log('\n✓ bazaar-pk.com is verified — customer emails will work with orders@bazaar-pk.com');
  } else {
    console.log('\n✗ bazaar-pk.com is not verified yet — complete DNS in Resend dashboard');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
