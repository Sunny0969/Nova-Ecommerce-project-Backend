#!/usr/bin/env node
/**
 * Generate VAPID keys for web push.
 * Run: node scripts/generate-vapid-keys.js
 */
const webpush = require('web-push');

const keys = webpush.generateVAPIDKeys();

console.log('Add these to backend/.env and frontend/.env.local:\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`REACT_APP_VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_SUBJECT=mailto:orders@bazaar-pk.com`);
console.log(`SERVICE_WORKER_PATH=/service-worker.js`);
