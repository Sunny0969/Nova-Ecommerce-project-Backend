const Category = require('../models/Category');
const Product = require('../models/Product');

const CATEGORY_SPECS = [
  { name: 'Fashion', slug: 'fashion', description: 'Apparel and accessories' },
  { name: 'Home', slug: 'home', description: 'Home and living' },
  { name: 'Electronics', slug: 'electronics', description: 'Tech and gadgets' },
  { name: 'Beauty', slug: 'beauty', description: 'Beauty and care' },
  { name: 'Sports', slug: 'sports', description: 'Sports and outdoors' }
];

/**
 * Ensures demo categories exist; returns map slug -> ObjectId.
 */
async function ensureDemoCategories() {
  const map = {};
  for (const spec of CATEGORY_SPECS) {
    let cat = await Category.findOne({ slug: spec.slug });
    if (!cat) {
      cat = await Category.create({
        name: spec.name,
        slug: spec.slug,
        description: spec.description,
        isActive: true,
        displayOrder: 0
      });
    }
    map[spec.slug] = cat._id;
  }
  return map;
}

const SAMPLES = (categoryIds) => [
  {
    slug: 'nova-demo-1',
    name: 'Essential Cotton Crew Tee — Charcoal',
    category: categoryIds.fashion,
    price: 24.99,
    comparePrice: 32.99,
    images: [
      {
        url:
          'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600&auto=format&fit=crop&q=60',
        public_id: ''
      }
    ],
    description:
      'Soft organic cotton, relaxed fit. Everyday layer for city or weekend.',
    shortDescription: 'Soft organic cotton tee.',
    stock: 48,
    ratings: 4.7,
    numReviews: 126,
    isFeatured: true,
    isPublished: true,
    tags: ['apparel', 'cotton']
  },
  {
    slug: 'nova-demo-2',
    name: 'Minimal Desk Lamp — Matte Black',
    category: categoryIds.home,
    price: 59.99,
    images: [
      {
        url:
          'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=600&auto=format&fit=crop&q=60',
        public_id: ''
      }
    ],
    description:
      'Warm LED, touch dimmer, small footprint — perfect for bedside or workspace.',
    shortDescription: 'LED desk lamp with dimmer.',
    stock: 30,
    ratings: 4.5,
    numReviews: 89,
    isFeatured: true,
    isPublished: true,
    tags: ['lighting', 'desk']
  },
  {
    slug: 'nova-demo-3',
    name: 'Wireless Everyday Earbuds',
    category: categoryIds.electronics,
    price: 49.99,
    comparePrice: 69.99,
    images: [
      {
        url:
          'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=600&auto=format&fit=crop&q=60',
        public_id: ''
      }
    ],
    description: 'Clear sound, compact case, quick pairing. Up to 24h with charging case.',
    shortDescription: 'Wireless earbuds with charging case.',
    stock: 75,
    ratings: 4.6,
    numReviews: 412,
    isFeatured: false,
    isPublished: true,
    tags: ['audio', 'wireless']
  }
];

/**
 * Inserts sample rows for any slug that does not exist yet.
 */
async function insertSampleProducts() {
  const categoryIds = await ensureDemoCategories();
  const samples = SAMPLES(categoryIds);
  let added = 0;
  let skipped = 0;

  for (const doc of samples) {
    const exists = await Product.exists({ slug: doc.slug });
    if (exists) {
      skipped += 1;
      continue;
    }
    await Product.create(doc);
    added += 1;
  }

  const total = await Product.countDocuments();
  return { added, skipped, total };
}

/**
 * If the catalog is empty, inserts all samples (first-time / demo).
 */
async function ensureSampleProductsIfDbEmpty() {
  if (process.env.DISABLE_AUTO_SAMPLE_SEED === 'true') {
    const total = await Product.countDocuments();
    return { seeded: false, added: 0, total };
  }

  const before = await Product.countDocuments();
  if (before > 0) {
    return { seeded: false, added: 0, total: before };
  }

  const categoryIds = await ensureDemoCategories();
  const samples = SAMPLES(categoryIds);
  for (const doc of samples) {
    await Product.create(doc);
  }

  const total = await Product.countDocuments();
  return { seeded: true, added: samples.length, total };
}

module.exports = {
  insertSampleProducts,
  ensureSampleProductsIfDbEmpty,
  ensureDemoCategories
};
