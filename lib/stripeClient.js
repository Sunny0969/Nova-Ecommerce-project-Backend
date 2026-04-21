const Stripe = require('stripe');

let cached;

/**
 * @returns {Stripe | null}
 */
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return null;
  }
  if (!cached) {
    cached = new Stripe(key);
  }
  return cached;
}

module.exports = { getStripe };
