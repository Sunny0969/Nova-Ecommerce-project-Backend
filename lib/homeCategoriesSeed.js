/**
 * Homepage browse grid — categories with Unsplash images.
 *
 * Notes:
 * - We upsert by `slug`, so rerunning will not create duplicates.
 * - `image.public_id` is empty because these are external URLs (not Cloudinary uploads).
 */
const LEGACY_DEMO_SLUGS = ['electronics', 'fashion', 'home', 'beauty', 'sports'];

function unsplash(photoId) {
  return {
    url: `https://images.unsplash.com/${photoId}?w=640&auto=format&fit=crop&q=80`,
    public_id: ''
  };
}

/** Curated category hero images (w=600, WebP via auto=format). */
function categoryImage(fullUrl) {
  return { url: String(fullUrl).trim(), public_id: '' };
}

const CATEGORY_HERO_IMAGES = {
  'cleaning-homecare':
    'https://images.unsplash.com/photo-1583947581924-860bda6a26df?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8OXx8Y2xlYW5pbmclMjBhbmQlMjBob21lY2FyZXxlbnwwfDB8MHx8fDI%3D',
  'milk-dairy':
    'https://images.unsplash.com/photo-1559598467-f8b76c8155d0?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8N3x8bWlsayUyMGFuZCUyMGRhaXJ5fGVufDB8MHwwfHx8Mg%3D%3D',
  'pasta-noodles':
    'https://images.unsplash.com/photo-1613634326309-7fe54ed25ffa?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MTZ8fHBhc3RhJTIwYW5kJTIwbm9vZGVsc3xlbnwwfDB8MHx8fDI%3D',
  'personal-care':
    'https://images.unsplash.com/photo-1610595433626-e45abdb5a88b?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MTN8fHBlcnNvbmFsJTIwY2FyZXxlbnwwfDB8MHx8fDI%3D',
  pulses:
    'https://images.unsplash.com/photo-1472141521881-95d0e87e2e39?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8NHx8cHVsc2VzfGVufDB8MHwwfHx8Mg%3D%3D',
  'tea-coffee':
    'https://images.unsplash.com/photo-1523861706897-9458a5d5be0c?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8M3x8dGVhJTIwYW5kJTIwY29mZmVlfGVufDB8MHwwfHx8Mg%3D%3D',
  'jar-canned-foods':
    'https://images.unsplash.com/photo-1519147683487-66e0c2d0b5a0?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8NHx8amFyJTIwYW5kJTIwY2FubmVkfGVufDB8fDB8fHwy',
  'oil-ghee':
    'https://images.unsplash.com/photo-1707424963059-6a7a559cae28?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MTd8fG9pbCUyMGFuZCUyMGdoZWV8ZW58MHx8MHx8fDI%3D',
  'snacks-confectionary':
    'https://images.unsplash.com/photo-1688217170693-e821c6e18d72?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8M3x8c25hY2tzfGVufDB8fDB8fHwy',
  'stationery-party-supplies':
    'https://images.unsplash.com/photo-1568871391149-449702439177?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8Mnx8c3RhdGlvbmFyeSUyMHN0b3JlfGVufDB8fDB8fHwy',
  tissues:
    'https://images.unsplash.com/photo-1631524254770-03abe3f42a0d?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8OHx8dGlzc3Vlc3xlbnwwfHwwfHx8Mg%3D%3D',
  clothing:
    'https://images.unsplash.com/photo-1567401893414-76b7b1e5a7a5?w=600&auto=format&fit=crop&q=60&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8Nnx8Y2xvdGhpbmd8ZW58MHwwfDB8fHwy'
};

function imageForSlug(slug, fallbackPhotoId) {
  const url = CATEGORY_HERO_IMAGES[slug];
  return url ? categoryImage(url) : unsplash(fallbackPhotoId);
}

const HOME_CATEGORY_SPECS = [
  // Grocery-style categories (requested)
  {
    name: 'Baby Care',
    slug: 'baby-care',
    description: 'Baby essentials, diapers, and care products',
    displayOrder: 0,
    image: {
      url: 'https://images.unsplash.com/photo-1716972065448-e08a46809530?w=640&auto=format&fit=crop&q=80',
      public_id: ''
    }
  },
  {
    name: 'Beverages',
    slug: 'beverages',
    description: 'Soft drinks, juices, and refreshments',
    displayOrder: 1,
    image: {
      url: 'https://images.unsplash.com/photo-1566560155396-7b9f35a08308?w=640&auto=format&fit=crop&q=80',
      public_id: ''
    }
  },
  {
    name: 'Breakfast',
    slug: 'breakfast',
    description: 'Breakfast essentials and morning staples',
    displayOrder: 2,
    image: unsplash('photo-1494597564530-871f2b93ac55')
  },
  {
    name: 'Chicken & Meat',
    slug: 'chicken-meat',
    description: 'Fresh chicken, meat, and cuts',
    displayOrder: 3,
    image: unsplash('photo-1604908176997-125f25cc500f')
  },
  {
    name: 'Cigarettes & Nicotine',
    slug: 'cigarettes-nicotine',
    description: 'Nicotine products and accessories',
    displayOrder: 4,
    image: unsplash('photo-1599940824399-b87987ceb72a')
  },
  {
    name: 'Cleaning & Homecare',
    slug: 'cleaning-homecare',
    description: 'Home cleaning and care essentials',
    displayOrder: 5,
    image: imageForSlug('cleaning-homecare', 'photo-1581579186913-45acb4f62f8a')
  },
  {
    name: 'Dessert & Baking Essentials',
    slug: 'dessert-baking-essentials',
    description: 'Baking supplies and dessert essentials',
    displayOrder: 6,
    image: unsplash('photo-1495147466023-ac5c588e2e94')
  },
  {
    name: 'Flour',
    slug: 'flour',
    description: 'All-purpose flour and specialty flours',
    displayOrder: 7,
    image: unsplash('photo-1608198093002-ad4e005484ec')
  },
  {
    name: 'Frozen',
    slug: 'frozen',
    description: 'Frozen foods and ready-to-cook items',
    displayOrder: 8,
    image: unsplash('photo-1585238342028-4d0f2e8a1e64')
  },
  {
    name: 'Fruits & Vegetables',
    slug: 'fruits-vegetables',
    description: 'Fresh fruits and vegetables',
    displayOrder: 9,
    image: unsplash('photo-1542838132-92c53300491e')
  },
  {
    name: 'Hair Care',
    slug: 'hair-care',
    description: 'Shampoo, oils, and hair care products',
    displayOrder: 10,
    image: unsplash('photo-1522335789203-aabd1fc54bc9')
  },
  {
    name: 'Jar & Canned Foods',
    slug: 'jar-canned-foods',
    description: 'Canned foods, pickles, and jars',
    displayOrder: 11,
    image: imageForSlug('jar-canned-foods', 'photo-1580915411954-282cb1f6a1ef')
  },
  {
    name: 'Laundry',
    slug: 'laundry',
    description: 'Detergents and laundry care',
    displayOrder: 12,
    image: unsplash('photo-1582735689369-4fe89db7114c')
  },
  {
    name: 'Milk & Dairy',
    slug: 'milk-dairy',
    description: 'Milk, yogurt, cheese, and dairy',
    displayOrder: 13,
    image: imageForSlug('milk-dairy', 'photo-1550583724-b2692b85b150')
  },
  {
    name: 'Oil & Ghee',
    slug: 'oil-ghee',
    description: 'Cooking oil, ghee, and fats',
    displayOrder: 14,
    image: imageForSlug('oil-ghee', 'photo-1474979269574-791a30b959be')
  },
  {
    name: 'Pasta & Noodles',
    slug: 'pasta-noodles',
    description: 'Pasta, noodles, and quick meals',
    displayOrder: 15,
    image: imageForSlug('pasta-noodles', 'photo-1526318472351-c75fcf070305')
  },
  {
    name: 'Personal Care',
    slug: 'personal-care',
    description: 'Personal care and grooming essentials',
    displayOrder: 16,
    image: imageForSlug('personal-care', 'photo-1514996937319-344454492b37')
  },
  {
    name: 'Pet Care',
    slug: 'pet-care',
    description: 'Pet food and care essentials',
    displayOrder: 17,
    image: unsplash('photo-1548199973-03cce0bbc87b')
  },
  {
    name: 'Pulses',
    slug: 'pulses',
    description: 'Pulses, lentils, and legumes',
    displayOrder: 18,
    image: imageForSlug('pulses', 'photo-1516594798947-e65505dbb29d')
  },
  {
    name: 'Rice',
    slug: 'rice',
    description: 'Rice and grains',
    displayOrder: 19,
    image: unsplash('photo-1604908176997-125f25cc500f')
  },
  {
    name: 'Snacks & Confectionary',
    slug: 'snacks-confectionary',
    description: 'Snacks, chips, and sweets',
    displayOrder: 20,
    image: imageForSlug('snacks-confectionary', 'photo-1607082349566-187342175e2f')
  },
  {
    name: 'Soaps & Handwashes',
    slug: 'soaps-handwashes',
    description: 'Soaps, sanitizers, and handwash',
    displayOrder: 21,
    image: unsplash('photo-1583947215259-38e31be8751f')
  },
  {
    name: 'Spices & Sauces',
    slug: 'spices-sauces',
    description: 'Spices, sauces, and seasonings',
    displayOrder: 22,
    image: unsplash('photo-1506354666786-959d6d497f1a')
  },
  {
    name: 'Stationery & Party Supplies',
    slug: 'stationery-party-supplies',
    description: 'Stationery and party supplies',
    displayOrder: 23,
    image: imageForSlug('stationery-party-supplies', 'photo-1519681393784-d120267933ba')
  },
  {
    name: 'Sugar',
    slug: 'sugar',
    description: 'Sugar and sweeteners',
    displayOrder: 24,
    image: unsplash('photo-1608198093002-ad4e005484ec')
  },
  {
    name: 'Tea & Coffee',
    slug: 'tea-coffee',
    description: 'Tea, coffee, and hot drinks',
    displayOrder: 25,
    image: imageForSlug('tea-coffee', 'photo-1509042239860-f550ce710b93')
  },
  {
    name: 'Tissues',
    slug: 'tissues',
    description: 'Tissues, paper rolls, and wipes',
    displayOrder: 26,
    image: imageForSlug('tissues', 'photo-1631524254770-03abe3f42a0d')
  },
  {
    name: 'Clothing',
    slug: 'clothing',
    description: 'Fashion apparel, casual wear, and clothing for men and women',
    displayOrder: 27,
    image: imageForSlug(
      'clothing',
      'photo-1567401893414-76b7b1e5a7a5'
    )
  },

  // Original demo set (kept active, ordered after grocery-style categories)
  {
    name: '3D Printers',
    slug: '3d-printers',
    description: 'Desktop 3D printers and printing supplies',
    displayOrder: 100,
    image: unsplash('photo-1612815159313-9375972f416c')
  },
  {
    name: 'Screen Protectors',
    slug: 'screen-protectors',
    description: 'Phone and tablet screen protection',
    displayOrder: 101,
    image: unsplash('photo-1511707171634-5f897ff02aa9')
  },
  {
    name: 'Oils',
    slug: 'oils',
    description: 'Cooking and essential oils',
    displayOrder: 102,
    image: unsplash('photo-1474979269574-791a30b959be')
  },
  {
    name: 'Replacement',
    slug: 'replacement',
    description: 'Replacement parts and spare components',
    displayOrder: 103,
    image: unsplash('photo-1581094794359-985dce820ea4')
  },
  {
    name: 'Casserole Pots',
    slug: 'casserole-pots',
    description: 'Casserole pots and cookware sets',
    displayOrder: 104,
    image: unsplash('photo-1556909172-6134eb706034')
  },
  {
    name: 'Hoodies & Sweatshirts',
    slug: 'hoodies-sweatshirts',
    description: 'Comfortable hoodies and sweatshirts',
    displayOrder: 105,
    image: unsplash('photo-1556821840-3a63f95609a7')
  },
  {
    name: 'Toy Boxes & Organisers',
    slug: 'toy-boxes-organisers',
    description: 'Toy storage boxes and organisers',
    displayOrder: 106,
    image: unsplash('photo-1515488042365-fe8ddf4c66b7')
  },
  {
    name: 'Dog & Cat Electric Clippers',
    slug: 'pet-electric-clippers',
    description: 'Electric grooming clippers for pets',
    displayOrder: 107,
    image: unsplash('photo-1587300003388-59208cc962cb')
  },
  {
    name: 'Dining Sets',
    slug: 'dining-sets',
    description: 'Dinnerware and dining table sets',
    displayOrder: 108,
    image: unsplash('photo-1414235077428-338989a2e8c0')
  },
  {
    name: 'Leashes & Harnesses',
    slug: 'leashes-harnesses',
    description: 'Pet leashes, collars, and harnesses',
    displayOrder: 109,
    image: unsplash('photo-1601758228041-f3b2795255f1')
  },
  {
    name: 'Donate to Educate',
    slug: 'donate-to-educate',
    description: 'Support education initiatives',
    displayOrder: 110,
    image: unsplash('photo-1497633766535-d67809e6602e')
  },
  {
    name: 'Equipment Bags',
    slug: 'equipment-bags',
    description: 'Sports and travel equipment bags',
    displayOrder: 111,
    image: unsplash('photo-1553062407-98aeb644c4ea')
  },
  {
    name: 'Heatsinks',
    slug: 'heatsinks',
    description: 'PC heatsinks and cooling components',
    displayOrder: 112,
    image: unsplash('photo-1597872204374-eeef4b96a196')
  },
  {
    name: 'Injury Support and Braces',
    slug: 'injury-support-braces',
    description: 'Supports, braces, and recovery aids',
    displayOrder: 113,
    image: unsplash('photo-1576091160399-112ba8d25d1f')
  },
  {
    name: 'Others',
    slug: 'others',
    description: 'More products and miscellaneous items',
    displayOrder: 114,
    image: unsplash('photo-1441986300917-6466bd6d0b00')
  },
  {
    name: 'Ice Makers',
    slug: 'ice-makers',
    description: 'Ice makers and kitchen appliances',
    displayOrder: 115,
    image: unsplash('photo-1571772996212-01a641d6c234')
  }
];

async function ensureHomeCategories(Category) {
  let upserted = 0;

  for (const spec of HOME_CATEGORY_SPECS) {
    await Category.findOneAndUpdate(
      { slug: spec.slug },
      {
        $set: {
          name: spec.name,
          slug: spec.slug,
          description: spec.description,
          displayOrder: spec.displayOrder,
          image: spec.image,
          isActive: true
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    upserted += 1;
  }

  await Category.updateMany({ slug: { $in: LEGACY_DEMO_SLUGS } }, { $set: { isActive: false } });

  return { upserted, slugs: HOME_CATEGORY_SPECS.map((s) => s.slug) };
}

module.exports = {
  HOME_CATEGORY_SPECS,
  CATEGORY_HERO_IMAGES,
  LEGACY_DEMO_SLUGS,
  ensureHomeCategories
};

