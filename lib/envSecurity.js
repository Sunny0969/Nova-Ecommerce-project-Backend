/**
 * Production env validation — secrets must come from Railway/host env, never from code.
 */

const INSECURE_JWT_DEFAULTS = new Set([
  'nova-shop-secret-key-change-in-production',
  'nova-shop-dev-jwt-secret-change-in-production'
]);

function isProductionRuntime() {
  return (
    process.env.NODE_ENV === 'production' ||
    Boolean(process.env.RAILWAY_ENVIRONMENT) ||
    Boolean(process.env.RAILWAY_PUBLIC_DOMAIN) ||
    Boolean(process.env.RAILWAY_STATIC_URL) ||
    process.env.RENDER === 'true'
  );
}

function readEnv(name) {
  return String(process.env[name] || '').trim();
}

/**
 * Fail fast on Railway/production when critical secrets are missing or weak.
 */
function assertSecureProductionEnv() {
  if (!isProductionRuntime()) return;

  const required = ['MONGODB_URI', 'JWT_SECRET'];
  const missing = required.filter((key) => !readEnv(key));
  if (missing.length) {
    console.error(
      `[env] Missing required Railway variables: ${missing.join(', ')}. ` +
        'Set them in Railway → Variables (never in Git).'
    );
    process.exit(1);
  }

  const jwtSecret = readEnv('JWT_SECRET');
  if (jwtSecret.length < 32) {
    console.error('[env] JWT_SECRET must be at least 32 characters in production.');
    process.exit(1);
  }
  if (INSECURE_JWT_DEFAULTS.has(jwtSecret)) {
    console.error('[env] JWT_SECRET is an insecure default. Generate a new random secret.');
    process.exit(1);
  }

  const mongoUri = readEnv('MONGODB_URI');
  if (!/^mongodb(\+srv)?:\/\//i.test(mongoUri)) {
    console.error('[env] MONGODB_URI must be a valid mongodb:// or mongodb+srv:// connection string.');
    process.exit(1);
  }

  const stripeSecret = readEnv('STRIPE_SECRET_KEY');
  const stripePub = readEnv('STRIPE_PUBLISHABLE_KEY');
  if (stripeSecret && !/^sk_(live|test)_/.test(stripeSecret)) {
    console.error('[env] STRIPE_SECRET_KEY must start with sk_live_ or sk_test_.');
    process.exit(1);
  }
  if (stripePub && !/^pk_(live|test)_/.test(stripePub)) {
    console.error('[env] STRIPE_PUBLISHABLE_KEY must start with pk_live_ or pk_test_.');
    process.exit(1);
  }
  if (stripeSecret && stripePub) {
    const secretLive = stripeSecret.startsWith('sk_live_');
    const pubLive = stripePub.startsWith('pk_live_');
    if (secretLive !== pubLive) {
      console.error('[env] STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY must both be live or both be test.');
      process.exit(1);
    }
  }
}

/**
 * Session + JWT signing secret. Dev-only fallback when not on Railway/production.
 */
function getJwtSecret() {
  const fromEnv = readEnv('JWT_SECRET');
  if (fromEnv) return fromEnv;

  if (isProductionRuntime()) {
    console.error('[env] JWT_SECRET is required in production.');
    process.exit(1);
  }

  console.warn(
    '[auth] JWT_SECRET is not set — using a local dev default. Set JWT_SECRET in backend/.env.'
  );
  return 'nova-shop-dev-jwt-secret-change-in-production';
}

module.exports = {
  assertSecureProductionEnv,
  getJwtSecret,
  isProductionRuntime,
  readEnv
};
