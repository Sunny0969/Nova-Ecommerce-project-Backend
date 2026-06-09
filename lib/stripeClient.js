const Stripe = require('stripe');

let cached;
let cachedKey;

/**
 * @returns {Stripe | null}
 */
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY && String(process.env.STRIPE_SECRET_KEY).trim();
  if (!key) {
    return null;
  }
  if (!/^sk_(test|live)_/.test(key)) {
    console.error(
      '[stripe] STRIPE_SECRET_KEY must start with sk_test_ or sk_live_ (mk_ keys are not valid). ' +
        'Copy the Secret key from Stripe Dashboard → Developers → API keys.'
    );
    return null;
  }
  if (!cached || cachedKey !== key) {
    cached = new Stripe(key);
    cachedKey = key;
  }
  return cached;
}

module.exports = { getStripe };
