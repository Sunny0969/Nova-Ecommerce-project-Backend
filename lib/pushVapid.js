const webpush = require('web-push');

let configured = false;

function getVapidKeys() {
  const publicKey = process.env.VAPID_PUBLIC_KEY || '';
  const privateKey = process.env.VAPID_PRIVATE_KEY || '';
  const subject = process.env.VAPID_SUBJECT || process.env.FRONTEND_URL || 'mailto:orders@bazaar-pk.com';
  return { publicKey, privateKey, subject };
}

function isPushConfigured() {
  const { publicKey, privateKey } = getVapidKeys();
  return Boolean(publicKey && privateKey);
}

function configureWebPush() {
  if (configured) return isPushConfigured();
  const { publicKey, privateKey, subject } = getVapidKeys();
  if (!publicKey || !privateKey) {
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

function getPublicVapidKey() {
  return getVapidKeys().publicKey || null;
}

module.exports = {
  webpush,
  configureWebPush,
  isPushConfigured,
  getPublicVapidKey
};
