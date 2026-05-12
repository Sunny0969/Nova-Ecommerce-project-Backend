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
const PORT = process.env.PORT || 5000;

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error(
    '[env] MONGODB_URI is required. Set it in backend/.env (e.g. your Atlas connection string).'
  );
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

/** Production: allow live site(s) + optional extra origins from FRONTEND_URL (comma-separated). */
function corsOriginForRequest() {
  if (process.env.NODE_ENV !== 'production') {
    const one = process.env.FRONTEND_URL || 'http://localhost:3000';
    return [one, ...devLocal];
  }
  const fromEnv = (process.env.FRONTEND_URL || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const defaults = [
    'https://souvenirhandicraft.com',
    'https://www.souvenirhandicraft.com'
  ];
  return [...new Set([...defaults, ...fromEnv])];
}

const corsOrigins = corsOriginForRequest();

app.use(
  cors({
    credentials: true,
    origin:
      process.env.NODE_ENV === 'production'
        ? (origin, callback) => {
            if (!origin) {
              return callback(null, true);
            }
            const norm = origin.replace(/\/$/, '');
            const allowed = corsOrigins.some((o) => o.replace(/\/$/, '') === norm);
            if (allowed) {
              return callback(null, true);
            }
            // Hostinger temporary / preview domains (*.hostingersite.com)
            try {
              const h = new URL(origin).hostname;
              if (h === 'hostingersite.com' || h.endsWith('.hostingersite.com')) {
                return callback(null, true);
              }
            } catch {
              /* ignore */
            }
            return callback(null, false);
          }
        : corsOrigins
  })
);

const stripeModule = require('./routes/stripe');
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  stripeModule.webhookHandler
);

app.use(
  morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev')
);

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

app.use('/api/auth', require('./routes/auth'));
app.use('/api/store-settings', require('./routes/storeSettings'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/products', require('./routes/products'));
app.use('/api/events', require('./routes/events'));
app.use('/api/recommendations', require('./routes/recommendations'));
app.use('/api/chatbot', require('./routes/chatbot.impl'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/blog', require('./routes/blog'));

app.use('/api/cart', requireJwtAuth, require('./routes/cart'));
app.use('/api/wishlist', requireJwtAuth, require('./routes/wishlist'));
app.use('/api/orders', requireJwtAuth, require('./routes/orders'));
app.use('/api/stripe', requireJwtAuth, stripeModule.router);
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
  requireJwtAuth,
  requireAdmin,
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
  requireJwtAuth,
  requireAdmin,
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
app.use(
  '/api/admin/staff',
  requireJwtAuth,
  requireAdmin,
  staffRoutes
);
//asdaddsd
// Admin-only staff management router mounted under /api/staff as well (kept for compatibility)
app.use('/api/staff', requireJwtAuth, requireAdmin, staffRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Nova Shop API is running' });
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
  if (res.headersSent) {
    return next(err);
  }
  console.error(err.stack);
  const status = err.status || err.statusCode || 500;
  const isDev = process.env.NODE_ENV === 'development';
  const safeMessage =
    status === 500 && !isDev ? 'Something went wrong!' : err.message;
  res.status(status).json({
    success: false,
    error: safeMessage || 'Something went wrong!',
    ...(isDev && err.stack ? { stack: err.stack } : {})
  });
});

async function startServer() {
  try {
    console.log('[MongoDB] Attempting to connect...');
    await mongoose.connect(MONGODB_URI, MONGOOSE_CONNECT_OPTS);
    console.log('[MongoDB] Connection succeeded.');
    console.log(
      `[MongoDB] Database: ${mongoose.connection.name}, host: ${mongoose.connection.host}`
    );

    const { ensureSampleProductsIfDbEmpty } = require('./lib/sampleProductsSeed');
    const seedResult = await ensureSampleProductsIfDbEmpty();

    const { ensureSampleBlogsIfDbEmpty } = require('./lib/sampleBlogsSeed');
    const blogSeedResult = await ensureSampleBlogsIfDbEmpty();
    if (blogSeedResult.seeded) {
      console.log(`[Seed] Blog catalog was empty — inserted ${blogSeedResult.added} sample blogs (total: ${blogSeedResult.total}). Reload the blog page.`);
    }
    if (seedResult.seeded) {
      console.log(
        `[Seed] Catalog was empty — inserted ${seedResult.added} sample products (total: ${seedResult.total}). Refresh the shop page.`
      );
    }

    const { ensureBootstrapAdmin } = require('./lib/ensureBootstrapAdmin');
    await ensureBootstrapAdmin();

    app.listen(PORT, () => {
      console.log(`[Server] Listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('[MongoDB] Connection failed:', err.message);
    if (err.cause) {
      console.error('[MongoDB] Cause:', err.cause.message || err.cause);
    }
    const msg = String(err.message || '');
    if (/queryTxt|querySrv|EREFUSED|ENOTFOUND/i.test(msg)) {
      console.error(
        '[MongoDB] DNS tip: set MONGODB_DNS_SERVERS=8.8.8.8,8.8.4.4 in backend/.env, or change Windows adapter DNS. ' +
          'If it still fails, use Atlas “Connect” → standard mongodb://… string (3 hosts) instead of mongodb+srv.'
      );
    }
    process.exit(1);
  }
}

startServer();
