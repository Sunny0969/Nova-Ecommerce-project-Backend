require('dotenv').config();
const {
  configureMongoDns,
  MONGOOSE_CONNECT_OPTS
} = require('./lib/configureMongoDns');
configureMongoDns();

const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');

const app = express();
// Port 5000 is often blocked/reserved on Windows — use 5001 locally. Render sets PORT (e.g. 10000).
const PORT = Number(process.env.PORT) || 5001;
const onRailway = Boolean(
  process.env.RAILWAY_ENVIRONMENT ||
    process.env.RAILWAY_PUBLIC_DOMAIN ||
    process.env.RAILWAY_STATIC_URL
);
const isProduction =
  process.env.NODE_ENV === 'production' ||
  process.env.RENDER === 'true' ||
  onRailway;
const HOST = process.env.HOST || (isProduction ? '0.0.0.0' : '127.0.0.1');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('[env] MONGODB_URI is required.');
  process.exit(1);
}

app.set('trust proxy', 1);
app.use(compression());

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);

const devLocal = [
  /^https?:\/\/localhost(?::\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i
];

function corsOriginForRequest() {
  const fromEnv = (process.env.FRONTEND_URL || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const defaults = [
    'https://souvenirhandicraft.com',
    'https://www.souvenirhandicraft.com',
    'https://bazaar-pk.com',
    'https://www.bazaar-pk.com'
  ];
  const merged = [...new Set([...defaults, ...fromEnv])];
  if (process.env.NODE_ENV !== 'production' && !onRailway) {
    return [...merged, ...devLocal];
  }
  return merged;
}

const corsOrigins = corsOriginForRequest();

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  const norm = origin.replace(/\/$/, '');
  if (corsOrigins.some((o) => typeof o === 'string' && o.replace(/\/$/, '') === norm)) {
    return true;
  }
  for (const o of corsOrigins) {
    if (o instanceof RegExp && o.test(origin)) return true;
  }
  try {
    const h = new URL(origin).hostname;
    if (h === 'hostingersite.com' || h.endsWith('.hostingersite.com')) return true;
    if (h === 'bazaar-pk.com' || h.endsWith('.bazaar-pk.com')) return true;
  } catch {
    return false;
  }
  return false;
}

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (isAllowedCorsOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    }
  })
);

const stripeModule = require('./routes/stripe');
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  stripeModule.webhookHandler
);

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(
  session({
    secret:
      process.env.JWT_SECRET || 'nova-shop-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000
    }
  })
);

mongoose.connection.on('error', (err) => {
  console.error('[MongoDB] Connection error:', err.message);
});

mongoose.connection.on('disconnected', () => {
  console.warn('[MongoDB] Mongoose disconnected.');
});

const { requireJwtAuth } = require('./middleware/jwtAuth');
const { requireAdmin } = require('./middleware/isAdmin');
const { adminOrStaffPermission } = require('./middleware/staffAuth');
const staffRoutes = require('./routes/admin/staffAccess');

/* ============================
   PUBLIC ROUTES
============================ */
app.use('/api/auth', require('./routes/auth'));
app.use('/api/store-settings', require('./routes/storeSettings'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/brands', require('./routes/brands'));
app.use('/api/products', require('./routes/products'));
app.use('/api/events', require('./routes/events'));
app.use('/api/recommendations', require('./routes/recommendations'));
app.use('/api/chatbot', require('./routes/chatbot.impl'));
app.use('/api/staff', require('./routes/staff')); // ✅ public staff auth
app.use('/api/blog', require('./routes/blog'));
app.use('/api/public', require('./routes/public'));
app.use('/api/seo', require('./routes/seo'));

/* ============================
   AUTH REQUIRED ROUTES
============================ */
app.use('/api/cart', requireJwtAuth, require('./routes/cart'));
app.use('/api/wishlist', requireJwtAuth, require('./routes/wishlist'));
app.use('/api/orders/guest', require('./routes/guestOrders'));
app.use('/api/orders', requireJwtAuth, require('./routes/orders'));
/** Guest Stripe first; authenticated routes use JWT inside routes/stripe.js (not on this mount). */
app.use('/api/stripe/guest', stripeModule.guestRouter);
app.use('/api/stripe', stripeModule.router);

/* ============================
   ADMIN + STAFF PERMISSION ROUTES
============================ */
app.use(
  '/api/admin/orders',
  ...adminOrStaffPermission('manageOrders'),
  require('./routes/admin/orders')
);

app.use(
  '/api/admin/dashboard',
  ...adminOrStaffPermission('viewAnalytics'),
  require('./routes/admin/dashboard')
);

app.use(
  '/api/admin/products',
  ...adminOrStaffPermission('manageProducts'),
  require('./routes/admin/products')
);

app.use(
  '/api/admin/customers',
  ...adminOrStaffPermission('manageCustomers'),
  require('./routes/admin/customers')
);

app.use(
  '/api/admin/coupons',
  ...adminOrStaffPermission('manageCoupons'),
  require('./routes/admin/coupons')
);

app.use(
  '/api/admin/categories',
  ...adminOrStaffPermission('manageCategories'),
  require('./routes/admin/categories')
);

app.use(
  '/api/admin/store-settings',
  requireJwtAuth,
  requireAdmin,
  require('./routes/admin/storeSettings')
);

app.use(
  '/api/admin/fraud',
  requireJwtAuth,
  requireAdmin,
  require('./routes/admin/fraud')
);

/* ✅ ADMIN STAFF MANAGEMENT ONLY */
app.use(
  '/api/admin/staff',
  requireJwtAuth,
  requireAdmin,
  staffRoutes
);

function sendHealth(res) {
  res.status(200).json({
    status: 'ok',
    service: 'nova-shop-api',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
}

/** Render/platform health checks use GET or HEAD on `/` */
app.get('/', (req, res) => sendHealth(res));
app.head('/', (req, res) => res.sendStatus(200));

app.get('/api/health', (req, res) => {
  const { isEmailConfigured, getAdminEmail } = require('./lib/email');
  res.json({
    status: 'OK',
    message: 'Bazaar API is running',
    email: {
      configured: isEmailConfigured(),
      adminRecipient: Boolean(getAdminEmail())
    }
  });
});

app.get('/sitemap.xml', require('./routes/sitemap'));
app.get('/robots.txt', require('./routes/robots'));

app.use(require('./middleware/normalizeSpaUrl'));
app.use(express.static(path.join(__dirname, '..')));

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`
  });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Something went wrong!'
  });
});

async function startServer() {
  try {
    await mongoose.connect(MONGODB_URI, MONGOOSE_CONNECT_OPTS);
    console.log('[MongoDB] Connected');

    try {
      const Category = require('./models/Category');
      const { ensureHomeCategories } = require('./lib/homeCategoriesSeed');
      const { upserted } = await ensureHomeCategories(Category);
      console.log(`[seed] Synced ${upserted} home categories (images + metadata)`);
    } catch (seedErr) {
      console.warn('[seed] Home categories sync skipped:', seedErr.message);
    }

    try {
      const { ensureBootstrapAdmin } = require('./lib/ensureBootstrapAdmin');
      await ensureBootstrapAdmin();
    } catch (adminErr) {
      console.warn('[Admin] Bootstrap admin skipped:', adminErr.message);
    }

    const { verifyEmailOnStartup } = require('./lib/email');
    await verifyEmailOnStartup();

    const server = app.listen(PORT, HOST, () => {
      console.log(`[Server] Listening on http://${HOST}:${PORT} (${isProduction ? 'production' : 'development'})`);
      if (process.env.RAILWAY_PUBLIC_DOMAIN) {
        console.log(`[Server] Railway public URL: https://${process.env.RAILWAY_PUBLIC_DOMAIN}`);
      }
    });

    server.on('error', (err) => {
      console.error('[Server] Failed to start:', err.message);
      process.exit(1);
    });
  } catch (err) {
    console.error('[MongoDB] Connection failed:', err.message);
    process.exit(1);
  }
}

startServer();