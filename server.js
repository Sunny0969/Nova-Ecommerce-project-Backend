require('dotenv').config();
const { assertSecureProductionEnv, getJwtSecret } = require('./lib/envSecurity');
const { getAiBlogConfigStatus } = require('./controllers/aiBlogController');
assertSecureProductionEnv();

const hfBlog = getAiBlogConfigStatus();
if (hfBlog.configured) {
  console.log(`[AI-BLOG] Hugging Face ready (model: ${hfBlog.model})`);
} else {
  console.warn(
    '[AI-BLOG] HUGGINGFACE_API_KEY is not set — AI blog generation disabled. ' +
      'Add it to Railway Variables (backend service) or backend/.env for localhost.'
  );
}
const { configureWebPush, isPushConfigured } = require('./lib/pushVapid');
const {
  configureMongoDns,
  MONGOOSE_CONNECT_OPTS
} = require('./lib/configureMongoDns');
configureMongoDns();

if (isPushConfigured()) {
  configureWebPush();
  console.log('[push] Web Push VAPID configured');
} else {
  console.warn(
    '[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — push notifications disabled. ' +
      'Run: node scripts/generate-vapid-keys.js'
  );
}

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const { Server } = require('socket.io');
const { initWhatsAppSocket } = require('./lib/whatsappSocket');
const {
  createCachedStaticMiddleware,
  createSpaFallbackHandler,
  CACHE_SEO_CONTROL
} = require('./lib/staticCacheHeaders');

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
    secret: getJwtSecret(),
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
app.use('/api/subcategories', require('./routes/subcategories'));
app.use('/api/brands', require('./routes/brands'));
app.use('/api/products', require('./routes/products'));
app.use('/api/events', require('./routes/events'));
app.use('/api/recommendations', require('./routes/recommendations'));
app.use('/api/chatbot', require('./routes/chatbot.impl'));
app.use('/api/chat', require('./routes/whatsappChat'));
app.use('/api/staff', require('./routes/staff')); // ✅ public staff auth
app.use('/api/blog', require('./routes/blog'));
app.use('/api/public', require('./routes/public'));
app.use('/api/seo', require('./routes/seo'));
app.use('/api/meta', require('./routes/meta'));
app.use('/api/internal/cache', require('./routes/internal/cache'));

/* ============================
   AUTH REQUIRED ROUTES
============================ */
app.use('/api/cart', requireJwtAuth, require('./routes/cart'));
app.use('/api/wishlist', requireJwtAuth, require('./routes/wishlist'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/wallet', requireJwtAuth, require('./routes/wallet'));
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
  '/api/admin/subcategories',
  ...adminOrStaffPermission('manageCategories'),
  require('./routes/admin/subcategories')
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
  '/api/admin/notifications',
  requireJwtAuth,
  requireAdmin,
  require('./routes/admin/notifications')
);

app.use(
  '/api/admin/blog/ai',
  requireJwtAuth,
  requireAdmin,
  require('./routes/admin/aiBlog')
);

app.use(
  '/api/admin/blogs',
  requireJwtAuth,
  requireAdmin,
  require('./routes/admin/blogs')
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

app.get('/api/health', async (req, res) => {
  const { isEmailConfigured, getAdminEmail, getEmailProvider } = require('./lib/email');
  let pendingOrderEmails = null;
  try {
    const PendingOrderEmail = require('./models/PendingOrderEmail');
    pendingOrderEmails = await PendingOrderEmail.countDocuments({ status: 'pending' });
  } catch {
    pendingOrderEmails = null;
  }
  res.json({
    status: 'OK',
    message: 'Bazaar API is running',
    email: {
      configured: isEmailConfigured(),
      provider: getEmailProvider(),
      adminRecipient: Boolean(getAdminEmail()),
      pendingOrderEmails
    }
  });
});

app.get('/sitemap.xml', require('./routes/sitemap'));
app.get('/robots.txt', require('./routes/robots'));

app.use(require('./middleware/normalizeSpaUrl'));

/**
 * Optional: serve CRA build from Express (same host as API).
 * Set FRONTEND_BUILD_PATH=/absolute/path/to/frontend/build on Railway or VPS.
 * Hostinger static deploy uses frontend/public/.htaccess instead.
 */
const frontendBuildPath = process.env.FRONTEND_BUILD_PATH
  ? path.resolve(process.env.FRONTEND_BUILD_PATH)
  : null;
const frontendIndexPath =
  frontendBuildPath && fs.existsSync(path.join(frontendBuildPath, 'index.html'))
    ? path.join(frontendBuildPath, 'index.html')
    : null;

if (frontendIndexPath) {
  app.use(createCachedStaticMiddleware(frontendBuildPath));
  app.get('*', createSpaFallbackHandler(frontendIndexPath));
  console.log('[static] Serving frontend build with 1-year immutable asset cache:', frontendBuildPath);
}

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
      const Product = require('./models/Product');
      const { ensureHomeCategories } = require('./lib/homeCategoriesSeed');
      const { upserted } = await ensureHomeCategories(Category);
      console.log(`[seed] Synced ${upserted} home categories (images + metadata)`);

      const { syncCategoryVisibility } = require('./lib/syncCategoryVisibility');
      const { flushAll } = require('./lib/apiCache');
      const { invalidateCatalogCache } = require('./lib/invalidatePublicCache');
      const vis = await syncCategoryVisibility(Category, Product);
      flushAll();
      invalidateCatalogCache();
      const activeCount = await Category.countDocuments({ isActive: true });
      console.log(
        `[categories] ${activeCount} active (sync: ${vis.activated} with products, ${vis.deactivated} empty hidden)`
      );
    } catch (seedErr) {
      console.warn('[seed] Home categories sync skipped:', seedErr.message);
    }

    try {
      const { ensureProductIndexes } = require('./lib/ensureProductIndexes');
      await ensureProductIndexes();
      console.log('[MongoDB] Product indexes synced');
    } catch (idxErr) {
      console.warn('[MongoDB] Product index sync skipped:', idxErr.message);
    }

    try {
      const { ensureBootstrapAdmin } = require('./lib/ensureBootstrapAdmin');
      await ensureBootstrapAdmin();
    } catch (adminErr) {
      console.warn('[Admin] Bootstrap admin skipped:', adminErr.message);
    }

    const { verifyEmailOnStartup } = require('./lib/email');
    void Promise.race([
      verifyEmailOnStartup(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('SMTP verify timeout')), 12_000)
      )
    ]).catch((err) => {
      console.warn('[email] Startup verify skipped:', err.message);
    });

    const { startOrderEmailRetryWorker } = require('./services/orderEmailDelivery');
    startOrderEmailRetryWorker();

    if (process.env.AI_BLOG_CRON_ENABLED === 'true') {
      const { autoGenerateTrendingBlog } = require('./controllers/aiBlogController');
      const intervalMs = Math.max(
        60 * 60 * 1000,
        Number(process.env.AI_BLOG_CRON_INTERVAL_MS) || 24 * 60 * 60 * 1000
      );
      setInterval(() => {
        autoGenerateTrendingBlog().catch((err) => {
          console.warn('[AI-BLOG] Cron run failed:', err.message);
        });
      }, intervalMs);
      console.log(`[AI-BLOG] Cron enabled — every ${Math.round(intervalMs / 3600000)}h`);
    }

    const httpServer = http.createServer(app);
    const io = new Server(httpServer, {
      cors: {
        origin(origin, callback) {
          if (isAllowedCorsOrigin(origin)) {
            callback(null, true);
            return;
          }
          callback(null, false);
        },
        credentials: true
      },
      path: '/socket.io'
    });
    app.set('io', io);
    initWhatsAppSocket(io);

    const server = httpServer.listen(PORT, HOST, () => {
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