const http = require('http');
const Order = require('../models/Order');
const User = require('../models/User');
const Blocklist = require('../models/Blocklist');
const PaymentFailureLog = require('../models/PaymentFailureLog');

/**
 * Curated disposable / temporary inbox domains (open-source style list).
 * Extend via env FRAUD_EXTRA_DISPOSABLE_DOMAINS=comma,separated
 */
const DISPOSABLE_EMAIL_DOMAINS = new Set(
  [
    'mailinator.com',
    'guerrillamail.com',
    'guerrillamailblock.com',
    'sharklasers.com',
    'yopmail.com',
    'yopmail.fr',
    'throwaway.email',
    'tempmail.com',
    'temp-mail.org',
    'dispostable.com',
    'mailnesia.com',
    'getairmail.com',
    'trashmail.com',
    'emailondeck.com',
    'fakeinbox.com',
    'maildrop.cc',
    'getnada.com',
    'mailcatch.com',
    'spam4.me',
    'mintemail.com',
    'mytemp.email',
    'tempail.com',
    'burnermail.io',
    'moakt.com',
    'tmpmail.org',
    '10minutemail.com',
    '10minutemail.net',
    '20minutemail.com',
    '33mail.com',
    'anonbox.net',
    'armyspy.com',
    'cuvox.de',
    'dayrep.com',
    'einrot.com',
    'fleckens.hu',
    'gustr.com',
    'jourrapide.com',
    'rhyta.com',
    'superrito.com',
    'teleworm.us',
    'throwam.com',
    'trashmail.de',
    'wegwerfemail.de',
    'mailnull.com',
    'spamgourmet.com',
    'mailforspam.com',
    'discard.email',
    'discardmail.com',
    'spamdecoy.net',
    'mailcatch.com',
    'tmpmail.net',
    'tmpmail.com',
    'emailfake.com',
    'crazymailing.com',
    'dropmail.me',
    'harakirimail.com',
    'mailinator.net',
    'mailinator2.com',
    'notmailinator.com',
    'bobmail.info',
    'chammy.info',
    'devnullmail.com',
    'mailmetrash.com',
    'mailzilla.com',
    'trashmail.net',
    'spambox.us',
    'jetable.org',
    'jetable.net',
    'nospam.ze.tc',
    'spam.la',
    'boun.cr',
    'trillianpro.com',
    'mailhazard.com',
    'mailhazard.us',
    'mailhz.me',
    'mailrock.biz',
    'instantemailaddress.com'
  ].map((d) => d.toLowerCase())
);

(function mergeExtraDomains() {
  const raw = process.env.FRAUD_EXTRA_DISPOSABLE_DOMAINS;
  if (!raw) return;
  for (const d of raw.split(',')) {
    const x = d.trim().toLowerCase();
    if (x) DISPOSABLE_EMAIL_DOMAINS.add(x);
  }
})();

function extractDomain(email) {
  const s = String(email || '').split('@')[1];
  return s ? s.toLowerCase().trim() : '';
}

function extractCardFingerprint(paymentIntent) {
  const pm = paymentIntent?.payment_method;
  if (pm && typeof pm === 'object' && pm.card?.fingerprint) {
    return String(pm.card.fingerprint);
  }
  const ch0 = paymentIntent?.charges?.data?.[0];
  const fp = ch0?.payment_method_details?.card?.fingerprint;
  return fp ? String(fp) : '';
}

function blocklistExpiryQuery() {
  const now = new Date();
  return {
    $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }]
  };
}

async function isBlocklisted(type, value) {
  if (!value) return false;
  const v = String(value).toLowerCase().trim();
  if (!v) return false;
  const hit = await Blocklist.findOne({
    type,
    value: v,
    ...blocklistExpiryQuery()
  })
    .select('_id')
    .lean();
  return Boolean(hit);
}

/**
 * ip-api.com (free HTTP API). Returns null on failure / local IPs.
 * @param {string} ip
 * @returns {Promise<{ proxy?: boolean, hosting?: boolean } | null>}
 */
function lookupIpWithIpApi(ip) {
  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('169.254.')) {
    return Promise.resolve(null);
  }
  const path = `/json/${encodeURIComponent(ip)}?fields=status,message,proxy,hosting`;
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: 'ip-api.com',
        path,
        timeout: 4500
      },
      (res) => {
        let data = '';
        res.on('data', (c) => {
          data += c;
        });
        res.on('end', () => {
          try {
            const j = JSON.parse(data);
            if (j.status !== 'success') resolve(null);
            else resolve({ proxy: j.proxy === true, hosting: j.hosting === true });
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * @param {object} params
 * @param {object} params.paymentIntent — expanded with payment_method when possible
 * @param {string} params.userId
 * @param {string} params.clientIp
 * @param {object} params.shippingAddress
 * @param {object} [params.billingAddress]
 * @param {object} params.snapshot — buildCheckoutSnapshot result
 * @param {string} params.deliveryOption
 * @param {string} params.currency
 * @returns {Promise<{ score: number, factors: { code: string, detail: string, weight: number }[], tier: 'approve'|'flag'|'reject' }>}
 */
async function analyzeOrderRisk(params) {
  const {
    paymentIntent,
    userId,
    clientIp,
    shippingAddress,
    billingAddress,
    snapshot,
    deliveryOption,
    currency
  } = params;

  const factors = [];
  let score = 0;

  const user = await User.findById(userId).select('email createdAt name');
  const email = (user?.email || '').toLowerCase();
  const domain = extractDomain(email);

  const ipNorm = clientIp ? String(clientIp).split(',')[0].trim() : '';
  if (await isBlocklisted('ip', ipNorm)) {
    return {
      score: 100,
      factors: [{ code: 'blocklist_ip', detail: ipNorm, weight: 100 }],
      tier: 'reject'
    };
  }
  if (await isBlocklisted('email', email)) {
    return {
      score: 100,
      factors: [{ code: 'blocklist_email', detail: email, weight: 100 }],
      tier: 'reject'
    };
  }

  const fp = extractCardFingerprint(paymentIntent);
  if (fp && (await isBlocklisted('card_fingerprint', fp))) {
    return {
      score: 100,
      factors: [{ code: 'blocklist_card', detail: 'fingerprint match', weight: 100 }],
      tier: 'reject'
    };
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  if (ipNorm) {
    const ipCount = await Order.countDocuments({
      clientIp: ipNorm,
      createdAt: { $gte: hourAgo },
      status: { $nin: ['cancelled', 'rejected'] }
    });
    if (ipCount >= 3) {
      factors.push({
        code: 'ip_order_velocity_1h',
        detail: `${ipCount} paid orders from this IP in 1 hour`,
        weight: 40
      });
      score += 40;
    } else if (ipCount >= 2) {
      factors.push({
        code: 'ip_order_velocity_1h',
        detail: `${ipCount} paid orders from this IP in 1 hour`,
        weight: 28
      });
      score += 28;
    }
  }

  const shipCo = String(shippingAddress?.country || '').trim().toUpperCase();
  const billCo = String(billingAddress?.country || '').trim().toUpperCase();
  if (shipCo && billCo && shipCo !== billCo) {
    factors.push({
      code: 'billing_shipping_country_mismatch',
      detail: `Billing ${billCo} vs shipping ${shipCo}`,
      weight: 25
    });
    score += 25;
  }

  const priorPaid = await Order.countDocuments({
    user: userId,
    status: { $nin: ['cancelled', 'rejected'] }
  });
  const highVal = Math.max(0, Number(process.env.FRAUD_HIGH_VALUE_THRESHOLD || 500));
  if (priorPaid === 0 && Number(snapshot.totalPrice) > highVal) {
    factors.push({
      code: 'first_order_high_value',
      detail: `First order total ${snapshot.totalPrice} > ${highVal} ${String(currency || '').toUpperCase()}`,
      weight: 28
    });
    score += 28;
  }

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const fails = await PaymentFailureLog.countDocuments({
    user: userId,
    createdAt: { $gte: dayAgo }
  });
  if (fails >= 3) {
    factors.push({
      code: 'failed_payments_24h',
      detail: `${fails} failed payment attempts (24h)`,
      weight: 38
    });
    score += 38;
  } else if (fails >= 2) {
    factors.push({
      code: 'failed_payments_24h',
      detail: `${fails} failed payment attempts (24h)`,
      weight: 22
    });
    score += 22;
  }

  const accountAgeMs = user?.createdAt ? Date.now() - new Date(user.createdAt).getTime() : Infinity;
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const del = String(deliveryOption || 'standard').toLowerCase();
  const express = del === 'express' || del === 'nextday';
  if (accountAgeMs < sevenDays && express && Number(snapshot.totalPrice) > 150) {
    factors.push({
      code: 'new_account_express_high_value',
      detail: 'Account <7d + expedited shipping + cart > 150',
      weight: 32
    });
    score += 32;
  }

  const ipIntel = await lookupIpWithIpApi(ipNorm);
  if (ipIntel && (ipIntel.proxy || ipIntel.hosting)) {
    factors.push({
      code: 'proxy_or_datacenter_ip',
      detail: 'ip-api.com indicates proxy or hosting/datacenter',
      weight: 28
    });
    score += 28;
  }

  if (domain && DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
    factors.push({
      code: 'disposable_email_domain',
      detail: domain,
      weight: 22
    });
    score += 22;
  }

  if (fp) {
    const cardUses = await Order.countDocuments({
      paymentCardFingerprint: fp,
      createdAt: { $gte: dayAgo },
      status: { $nin: ['cancelled', 'rejected'] }
    });
    if (cardUses >= 3) {
      factors.push({
        code: 'card_velocity_24h',
        detail: `Same card fingerprint used on ${cardUses} orders in 24h`,
        weight: 38
      });
      score += 38;
    } else if (cardUses >= 2) {
      factors.push({
        code: 'card_velocity_24h',
        detail: `Same card fingerprint used on ${cardUses} orders in 24h`,
        weight: 24
      });
      score += 24;
    }
  }

  score = Math.min(100, Math.round(score));

  let tier = 'approve';
  if (score >= 71) tier = 'reject';
  else if (score >= 31) tier = 'flag';

  return {
    score,
    factors,
    tier,
    cardFingerprint: fp || '',
    currency: String(currency || '').toLowerCase()
  };
}

function tierToAction(tier) {
  if (tier === 'reject') return 'rejected';
  if (tier === 'flag') return 'flagged';
  return 'approved';
}

module.exports = {
  analyzeOrderRisk,
  tierToAction,
  extractCardFingerprint,
  extractDomain,
  DISPOSABLE_EMAIL_DOMAINS
};
