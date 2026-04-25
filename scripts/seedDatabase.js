/**
 * Seed categories, products, admin user, and coupons.
 * Run from the backend folder: node scripts/seedDatabase.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const {
  configureMongoDns,
  MONGOOSE_CONNECT_OPTS
} = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const Category = require('../models/Category');
const Product = require('../models/Product');
const User = require('../models/User');
const Coupon = require('../models/Coupon');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set. Add it to backend/.env');
  process.exit(1);
}

const CATEGORY_SPECS = [
  {
    name: 'Electronics',
    slug: 'electronics',
    description: 'Tech, gadgets, and accessories',
    displayOrder: 0
  },
  {
    name: 'Fashion',
    slug: 'fashion',
    description: 'Apparel and style',
    displayOrder: 1
  },
  {
    name: 'Home',
    slug: 'home',
    description: 'Home and living',
    displayOrder: 2
  },
  {
    name: 'Beauty',
    slug: 'beauty',
    description: 'Beauty and personal care',
    displayOrder: 3
  },
  {
    name: 'Sports',
    slug: 'sports',
    description: 'Sports and fitness',
    displayOrder: 4
  }
];

/** 20 products (4 per category) — `productId` is stable; URL slug is auto-generated from `name` */
function productSeeds(categoryIds) {
  const img = (id) => ({
    url: `https://images.unsplash.com/${id}?w=800&auto=format&fit=crop&q=70`,
    public_id: ''
  });

  return [
    {
      productId: 'seed-nova-electronics-1',
      name: 'Wireless Noise-Cancelling Headphones',
      category: categoryIds.electronics,
      price: 149.99,
      comparePrice: 199.99,
      images: [img('photo-1505740420928-5e560c06d30e')],
      shortDescription: 'Premium ANC over-ear headphones.',
      description:
        'Comfortable over-ear design with active noise cancellation and 30-hour battery life.',
      stock: 42,
      ratings: 4.7,
      numReviews: 128,
      isFeatured: true,
      isPublished: true,
      tags: ['audio', 'headphones']
    },
    {
      productId: 'seed-nova-electronics-2',
      name: 'USB-C 7-in-1 Hub',
      category: categoryIds.electronics,
      price: 49.99,
      images: [img('photo-1625948515291-69613eec1970')],
      shortDescription: 'HDMI, SD, USB-A, and power delivery.',
      description:
        'Compact aluminium hub for laptops and tablets with pass-through charging.',
      stock: 80,
      ratings: 4.5,
      numReviews: 56,
      isFeatured: false,
      isPublished: true,
      tags: ['usb', 'hub']
    },
    {
      productId: 'seed-nova-electronics-3',
      name: 'Smart Watch — Nova Fit',
      category: categoryIds.electronics,
      price: 199.99,
      comparePrice: 249.99,
      images: [img('photo-1579586337278-3befd40fd17a')],
      shortDescription: 'Heart rate, GPS, and sleep tracking.',
      description:
        'Bright AMOLED display, 5 ATM water resistance, and multi-day battery.',
      stock: 35,
      ratings: 4.6,
      numReviews: 301,
      isFeatured: true,
      isPublished: true,
      tags: ['wearable', 'fitness']
    },
    {
      productId: 'seed-nova-electronics-4',
      name: 'Portable 20W Power Bank',
      category: categoryIds.electronics,
      price: 34.99,
      images: [img('photo-1609091839311-d5365f9ff1c5')],
      shortDescription: 'Slim 10000 mAh with USB-C.',
      description: 'Fast charging for phones and small devices; airline-friendly capacity.',
      stock: 120,
      ratings: 4.4,
      numReviews: 89,
      isFeatured: false,
      isPublished: true,
      tags: ['charger', 'travel']
    },

    {
      productId: 'seed-nova-fashion-1',
      name: 'Organic Cotton Crew Tee',
      category: categoryIds.fashion,
      price: 24.99,
      comparePrice: 32.0,
      images: [img('photo-1521572163474-6864f9cf17ab')],
      shortDescription: 'Soft everyday tee in charcoal.',
      description: 'Relaxed fit, organic cotton, reinforced collar.',
      stock: 90,
      ratings: 4.6,
      numReviews: 210,
      isFeatured: true,
      isPublished: true,
      tags: ['tee', 'basics']
    },
    {
      productId: 'seed-nova-fashion-2',
      name: 'Slim Denim Jacket — Indigo',
      category: categoryIds.fashion,
      price: 89.99,
      images: [img('photo-1576995853123-5a103989d0aa')],
      shortDescription: 'Classic indigo denim with stretch.',
      description: 'Layer-friendly jacket with antique brass hardware.',
      stock: 40,
      ratings: 4.5,
      numReviews: 74,
      isFeatured: false,
      isPublished: true,
      tags: ['denim', 'outerwear']
    },
    {
      productId: 'seed-nova-fashion-3',
      name: 'Leather Minimal Sneakers',
      category: categoryIds.fashion,
    price: 119.99,
      comparePrice: 149.99,
      images: [img('photo-1549298916-b41d281d4532')],
      shortDescription: 'Full-grain leather, cushioned sole.',
      description: 'Dress up or down; breathable lining for all-day wear.',
      stock: 55,
      ratings: 4.8,
      numReviews: 156,
      isFeatured: true,
      isPublished: true,
      tags: ['shoes', 'leather']
    },
    {
      productId: 'seed-nova-fashion-4',
      name: 'Canvas Roll-Top Backpack',
      category: categoryIds.fashion,
      price: 64.5,
      images: [img('photo-1553062407-98eeb64c6a62')],
      shortDescription: 'Water-resistant canvas with laptop sleeve.',
      description: 'Fits up to 15" laptop; padded straps and front zip pocket.',
      stock: 38,
      ratings: 4.3,
      numReviews: 41,
      isFeatured: false,
      isPublished: true,
      tags: ['bag', 'commute']
    },

    {
      productId: 'seed-nova-home-1',
      name: 'Matte Black Desk Lamp',
      category: categoryIds.home,
      price: 59.99,
      images: [img('photo-1507473885765-e6ed057f782c')],
      shortDescription: 'Warm LED with touch dimmer.',
      description: 'Small footprint; ideal for desk or bedside.',
      stock: 48,
      ratings: 4.5,
      numReviews: 92,
      isFeatured: true,
      isPublished: true,
      tags: ['lighting', 'desk']
    },
    {
      productId: 'seed-nova-home-2',
      name: 'Linen Throw Pillow Set (x2)',
      category: categoryIds.home,
      price: 44.99,
      images: [img('photo-1584100936595-c0654b55a2fc')],
      shortDescription: 'Soft linen-blend covers with inserts.',
      description: 'Neutral tones to match modern living spaces.',
      stock: 60,
      ratings: 4.4,
      numReviews: 33,
      isFeatured: false,
      isPublished: true,
      tags: ['decor', 'pillow']
    },
    {
      productId: 'seed-nova-home-3',
      name: 'Stoneware Mug Set (x4)',
      category: categoryIds.home,
      price: 36.0,
      images: [img('photo-1514228742587-6b1558fcca3d')],
      shortDescription: 'Microwave-safe reactive glaze.',
      description: 'Stackable mugs for coffee or tea; dishwasher safe.',
      stock: 72,
      ratings: 4.7,
      numReviews: 58,
      isFeatured: false,
      isPublished: true,
      tags: ['kitchen', 'mugs']
    },
    {
      productId: 'seed-nova-home-4',
      name: 'Silent Wall Clock 12"',
      category: categoryIds.home,
      price: 29.99,
      images: [img('photo-1563861826100-9cb868c06a76')],
      shortDescription: 'Non-ticking sweep movement.',
      description: 'Minimal face with metal frame; easy to read.',
      stock: 45,
      ratings: 4.2,
      numReviews: 27,
      isFeatured: false,
      isPublished: true,
      tags: ['clock', 'minimal']
    },

    {
      productId: 'seed-nova-beauty-1',
      name: 'Daily Hydrating Face Moisturiser',
      category: categoryIds.beauty,
      price: 22.99,
      images: [img('photo-1556228578-0d85b1a4d571')],
      shortDescription: 'Hyaluronic acid + ceramides.',
      description: 'Lightweight cream for morning and night; fragrance-free.',
      stock: 100,
      ratings: 4.6,
      numReviews: 412,
      isFeatured: true,
      isPublished: true,
      tags: ['skincare', 'moisturiser']
    },
    {
      productId: 'seed-nova-beauty-2',
      name: 'Tinted Lip Balm Trio',
      category: categoryIds.beauty,
      price: 18.5,
      images: [img('photo-1596462502278-27bfdc403348')],
      shortDescription: 'Sheer colour with SPF 15.',
      description: 'Three flattering shades in a recyclable paper tube set.',
      stock: 85,
      ratings: 4.5,
      numReviews: 96,
      isFeatured: false,
      isPublished: true,
      tags: ['lips', 'spf']
    },
    {
      productId: 'seed-nova-beauty-3',
      name: 'Argan Oil Shampoo Bar',
      category: categoryIds.beauty,
      price: 12.99,
      images: [img('photo-1608248543803-ba4f8c70ae0b')],
      shortDescription: 'Plastic-free solid shampoo.',
      description: 'Gentle cleanse with argan and coconut; colour-safe.',
      stock: 150,
      ratings: 4.4,
      numReviews: 67,
      isFeatured: false,
      isPublished: true,
      tags: ['hair', 'eco']
    },
    {
      productId: 'seed-nova-beauty-4',
      name: 'Shea Butter Hand Cream',
      category: categoryIds.beauty,
      price: 14.0,
      images: [img('photo-1617897903246-719242758050')],
      shortDescription: 'Fast-absorbing, non-greasy.',
      description: 'Travel size; enriched with vitamin E.',
      stock: 200,
      ratings: 4.5,
      numReviews: 142,
      isFeatured: false,
      isPublished: true,
      tags: ['hands', 'care']
    },

    {
      productId: 'seed-nova-sports-1',
      name: 'Pro Grip Yoga Mat 6mm',
      category: categoryIds.sports,
      price: 39.99,
      comparePrice: 49.99,
      images: [img('photo-1601925260368-ae2f83cf8b7f')],
      shortDescription: 'Non-slip surface with alignment lines.',
      description: 'Eco-friendly TPE; includes carrying strap.',
      stock: 70,
      ratings: 4.8,
      numReviews: 288,
      isFeatured: true,
      isPublished: true,
      tags: ['yoga', 'mat']
    },
    {
      productId: 'seed-nova-sports-2',
      name: 'Insulated Steel Water Bottle 750ml',
      category: categoryIds.sports,
      price: 28.99,
      images: [img('photo-1602143407151-7111542de6e8')],
      shortDescription: 'Keeps drinks cold 24h / hot 12h.',
      description: 'Powder coat finish; leak-proof sport cap.',
      stock: 95,
      ratings: 4.7,
      numReviews: 201,
      isFeatured: false,
      isPublished: true,
      tags: ['hydration', 'bottle']
    },
    {
      productId: 'seed-nova-sports-3',
      name: 'Resistance Bands Set (5)',
      category: categoryIds.sports,
      price: 24.99,
      images: [img('photo-1598289431512-b97b0917affc')],
      shortDescription: 'Latex bands with door anchor.',
      description: 'Progressive resistance for strength and mobility work.',
      stock: 110,
      ratings: 4.5,
      numReviews: 155,
      isFeatured: false,
      isPublished: true,
      tags: ['training', 'bands']
    },
    {
      productId: 'seed-nova-sports-4',
      name: 'Speed Jump Rope — Steel Cable',
      category: categoryIds.sports,
      price: 19.99,
      images: [img('photo-1594882645126-14020914d58d')],
      shortDescription: 'Ball bearings for smooth rotation.',
      description: 'Adjustable length; compact for travel workouts.',
      stock: 130,
      ratings: 4.4,
      numReviews: 88,
      isFeatured: false,
      isPublished: true,
      tags: ['cardio', 'rope']
    }
  ];
}

async function ensureCategories() {
  const map = {};
  for (const spec of CATEGORY_SPECS) {
    let cat = await Category.findOne({ slug: spec.slug });
    if (!cat) {
      cat = await Category.create({
        name: spec.name,
        slug: spec.slug,
        description: spec.description,
        isActive: true,
        displayOrder: spec.displayOrder
      });
      console.log(`[seed] Created category: ${spec.name}`);
    } else {
      console.log(`[seed] Category exists: ${spec.slug}`);
    }
    map[spec.slug] = cat._id;
  }
  return map;
}

async function seedProducts(categoryIds) {
  const seeds = productSeeds(categoryIds);
  let created = 0;
  let skipped = 0;

  for (const doc of seeds) {
    const exists = await Product.exists({ productId: doc.productId });
    if (exists) {
      skipped += 1;
      continue;
    }
    await Product.create(doc);
    created += 1;
  }

  console.log(`[seed] Products: ${created} created, ${skipped} already present`);
}

async function seedAdmin() {
  const email = 'admin@novashop.com';
  const existing = await User.findOne({ email });
  if (existing) {
    console.log('[seed] Admin user already exists — skip create');
    return;
  }

  await User.create({
    name: 'Nova Shop Admin',
    email,
    password: 'Admin123!',
    role: 'admin',
    isActive: true,
    isVerified: true
  });
  console.log('[seed] Created admin user (admin@novashop.com / Admin123!)');
}

async function seedCoupons() {
  const specs = [
    {
      code: 'NOVA20',
      discountType: 'percentage',
      discountValue: 20,
      minOrderAmount: 0,
      maxUses: null,
      perCustomerLimit: null,
      expiresAt: null,
      isActive: true,
      appliesTo: { type: 'all', categories: [], products: [] }
    },
    {
      code: 'SAVE10',
      discountType: 'fixed',
      discountValue: 10,
      minOrderAmount: 0,
      maxUses: null,
      perCustomerLimit: null,
      expiresAt: null,
      isActive: true,
      appliesTo: { type: 'all', categories: [], products: [] }
    }
  ];

  for (const spec of specs) {
    const found = await Coupon.findOne({ code: spec.code });
    if (found) {
      console.log(`[seed] Coupon ${spec.code} already exists — skip`);
      continue;
    }
    await Coupon.create(spec);
    console.log(`[seed] Created coupon ${spec.code}`);
  }
}

async function main() {
  try {
    await mongoose.connect(MONGODB_URI, MONGOOSE_CONNECT_OPTS);
    console.log('[seed] Connected to MongoDB');

    const categoryIds = await ensureCategories();
    await seedProducts(categoryIds);
    await seedAdmin();
    await seedCoupons();

    console.log('[seed] Done.');
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('[seed] Failed:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

main();
