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
            if (!origin) return callback(null, true);
            const norm = origin.replace(/\/$/, '');
            const allowed = corsOrigins.some(
              (o) => o.replace(/\/$/, '') === norm
            );
            if (allowed) return callback(null, true);

            try {
              const h = new URL(origin).hostname;
              if (h === 'hostingersite.com' || h.endsWith('.hostingersite.com')) {
                return callback(null, true);
              }
            } catch {}

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
app.use('/api/products', require('./routes/products'));
app.use('/api/events', require('./routes/events'));
app.use('/api/recommendations', require('./routes/recommendations'));
app.use('/api/chatbot', require('./routes/chatbot.impl'));
app.use('/api/staff', require('./routes/staff')); // ✅ public staff auth
app.use('/api/blog', require('./routes/blog'));

/* ============================
   AUTH REQUIRED ROUTES
============================ */
app.use('/api/cart', requireJwtAuth, require('./routes/cart'));
app.use('/api/wishlist', requireJwtAuth, require('./routes/wishlist'));
app.use('/api/orders', requireJwtAuth, require('./routes/orders'));
app.use('/api/stripe', requireJwtAuth, stripeModule.router);

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

/* ✅ ADMIN STAFF MANAGEMENT ONLY */
app.use(
  '/api/admin/staff',
  requireJwtAuth,
  requireAdmin,
  staffRoutes
);

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

    app.listen(PORT, () => {
      console.log(`[Server] Listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('[MongoDB] Connection failed:', err.message);
    process.exit(1);
  }
}

startServer();