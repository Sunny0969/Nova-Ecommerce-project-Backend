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
    image: unsplash('photo-1581579186913-45acb4f62f8a')
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
    image: unsplash('photo-1580915411954-282cb1f6a1ef')
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
    image: unsplash('photo-1550583724-b2692b85b150')
  },
  {
    name: 'Oil & Ghee',
    slug: 'oil-ghee',
    description: 'Cooking oil, ghee, and fats',
    displayOrder: 14,
    image: unsplash('photo-1474979269574-791a30b959be')
  },
  {
    name: 'Pasta & Noodles',
    slug: 'pasta-noodles',
    description: 'Pasta, noodles, and quick meals',
    displayOrder: 15,
    image: unsplash('photo-1526318472351-c75fcf070305')
  },
  {
    name: 'Personal Care',
    slug: 'personal-care',
    description: 'Personal care and grooming essentials',
    displayOrder: 16,
    image: unsplash('photo-1514996937319-344454492b37')
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
    image: unsplash('photo-1516594798947-e65505dbb29d')
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
    image: unsplash('photo-1607082349566-187342175e2f')
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
    image: unsplash('photo-1519681393784-d120267933ba')
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
    image: unsplash('photo-1509042239860-f550ce710b93')
  },
  {
    name: 'Tissues',
    slug: 'tissues',
    description: 'Tissues, paper rolls, and wipes',
    displayOrder: 26,
    image: unsplash('photo-1581579186913-45acb4f62f8a')
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
  LEGACY_DEMO_SLUGS,
  ensureHomeCategories
};
