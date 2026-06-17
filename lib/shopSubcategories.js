const ProductSubcategory = require('../models/ProductSubcategory');
const Product = require('../models/Product');
const { productHasImageMongoMatch } = require('./productImageFilter');

const GENDER_LABELS = {
  women: 'Women',
  men: 'Men'
};

const GENDERED_CATEGORY_SLUGS = new Set(['clothing']);

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeGender(raw) {
  const g = String(raw || '')
    .trim()
    .toLowerCase();
  return g === 'women' || g === 'men' ? g : '';
}

function normalizeKeywords(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((k) => String(k || '').trim().toLowerCase()).filter(Boolean))];
}

/** Mongo filter: assigned subcategory, or keyword match when not yet assigned */
function buildSubcategoryProductMatch(subRow) {
  const or = [{ shopSubcategory: subRow._id }];
  const keywords = normalizeKeywords(subRow.matchKeywords);
  if (keywords.length) {
    const keywordOr = keywords.map((kw) => ({
      name: { $regex: escapeRegex(kw), $options: 'i' }
    }));
    or.push({
      $and: [
        { $or: [{ shopSubcategory: null }, { shopSubcategory: { $exists: false } }] },
        { $or: keywordOr }
      ]
    });
  }
  return { $or: or };
}

/** Priority-ordered rules for snacks — first match wins (exclusive assignment). */
const SNACKS_SUBCATEGORY_RULES = [
  {
    slug: 'chips-snacks',
    test: (name) =>
      /popcorn|pop\s*corn|kettle\s*pop|korneez|kernel\s*pop|kernal\s*pop|\blays\b|\blay's\b|(?<!.)chips?\b/i.test(
        name
      )
  },
  {
    slug: 'cakes-rusks',
    test: (name) => /cup\s*kake|\bkake\b|bake\s*time|\bcake\b|\brusk/i.test(name)
  },
  {
    slug: 'chocolates',
    test: (name) =>
      /chocolate|bricklane|candyland\s+chocolate|sonnet/i.test(name) &&
      !/sandwich\s+biscuit|biscuit/i.test(name)
  },
  {
    slug: 'chewing-gums-candies',
    test: (name) =>
      /\bcandy\b|candies|aamrus|\bpipes\b|candyland\s+now|\bgum\b|(?<!popcorn\s)toffee/i.test(name)
  },
  {
    slug: 'biscuits-wafers',
    test: (name) => /biscuit|wafer|wispy|cookie|short\s*bread|\blu\b|peek\s*freans|piper/i.test(name)
  }
];

function resolveSnacksSubcategorySlug(productName) {
  const name = String(productName || '');
  for (const rule of SNACKS_SUBCATEGORY_RULES) {
    if (rule.test(name)) return rule.slug;
  }
  return '';
}

/** Priority-ordered rules for beverages — first match wins. Unmatched products stay without subcategory. */
const BEVERAGES_SUBCATEGORY_RULES = [
  {
    slug: 'water',
    test: (name) =>
      /mineral\s*water|\baquafina\b|\bdasani\b|\bmasafi\b|nestle\s+mineral\s*water/i.test(name) &&
      !/nectar|juice|fruit\s*drink/i.test(name)
  },
  {
    slug: 'sports-drink',
    test: (name) => /sports?\s*drink|gatorade|powerade|staminade|electrolyte/i.test(name)
  },
  {
    slug: 'make-to-drink',
    test: (name) => /make\s*to\s*drink|\btang\b|instant\s*drink|drink\s*mix|powder\s*sachet/i.test(name)
  },
  {
    slug: 'carbonated-soft-drinks',
    test: (name) =>
      /murree|malt\s*n\/?r|\bfloat\b|\bcola\b|\bpepsi\b|\b7up\b|sprite|fanta|\bsoda\b|sparkling|carbonated|\bbeer\b/i.test(
        name
      ) && !/fruit\s*drink|juice|nectar|coconut/i.test(name)
  },
  {
    slug: 'juices-nectars',
    test: (name) =>
      /juice|nectar|fruit\s*drink|coconut\s*water|\bslice\b|\bmaza\b|\bquice\b|haleeb\s*fruit|gold\s*nectar/i.test(
        name
      )
  }
];

function resolveBeveragesSubcategorySlug(productName) {
  const name = String(productName || '');
  for (const rule of BEVERAGES_SUBCATEGORY_RULES) {
    if (rule.test(name)) return rule.slug;
  }
  return '';
}

/** Tea & Coffee — 4 subcategories only. Unmatched products stay without subcategory. */
const TEA_COFFEE_SUBCATEGORY_RULES = [
  {
    slug: 'instant-tea-coffee',
    test: (name) => /3\s*in\s*1|3in1|\bsachet\b|instant\s*tea|instant\s*coffee|blend\s*&\s*brew|danedar\s*3in1/i.test(name)
  },
  {
    slug: 'tea-whiteners',
    test: (name) =>
      /whitener|tea\s*millac|dairy\s*omung|everyday\s*tea\s*whitener|mixed\s*tea/i.test(name) &&
      !/green\s*tea|coffee/i.test(name)
  },
  {
    slug: 'coffee',
    test: (name) =>
      /\bcoffee\b|nescafe|nescafé|imtiaz\s*coffee/i.test(name) &&
      !/3\s*in\s*1|3in1|\bsachet\b|green\s*tea/i.test(name)
  },
  {
    slug: 'tea',
    test: (name) =>
      /green\s*tea|\btea\b|tapal|lipton|gulbahar/i.test(name) &&
      !/whitener|3\s*in\s*1|3in1|\bsachet\b|coffee/i.test(name)
  }
];

function resolveTeaCoffeeSubcategorySlug(productName) {
  const name = String(productName || '');
  for (const rule of TEA_COFFEE_SUBCATEGORY_RULES) {
    if (rule.test(name)) return rule.slug;
  }
  return '';
}

/** Milk & Dairy — 5 subcategories. Unmatched products stay without subcategory. */
const MILK_DAIRY_SUBCATEGORY_RULES = [
  {
    slug: 'chilled-coffee',
    test: (name) =>
      /chilled\s*coffee|iced\s*coffee|cold\s*coffee|coffee\s*drink|bottled\s*coffee|\bmocha\b|\blatte\b|frappe|cappuccino/i.test(
        name
      )
  },
  {
    slug: 'flavoured-milk',
    test: (name) =>
      /flavour\s*milk|flavor\s*milk|flavoured\s*milk|flavored\s*milk|pakola\s*milk|milo\s*drink|strawberry\s*&|salted\s*caramel|zafrani|zafran|pistachio|ice\s*cream\s*milk/i.test(
        name
      ) && !/powder|condensed|full\s*cream\s*milk/i.test(name)
  },
  {
    slug: 'butter-margarine',
    test: (name) => /butter|margarine|blue\s*band|olive\s*spread|unsalted\s*butter/i.test(name)
  },
  {
    slug: 'yogurt',
    test: (name) => /yogurt|yoghurt|\bdahi\b|lassi|raita|\bcurd\b|laban|sour\s*cream/i.test(name)
  },
  {
    slug: 'milk',
    test: (name) =>
      /\bmilk\b|powder\s*milk|condensed\s*milk|full\s*cream|lactose|dairy\s*omung|nesvita|millac|nurpur|haleeb|olper|good\s*milk|comelle|dairy\s*king/i.test(
        name
      )
  }
];

function resolveMilkDairySubcategorySlug(productName) {
  const name = String(productName || '');
  for (const rule of MILK_DAIRY_SUBCATEGORY_RULES) {
    if (rule.test(name)) return rule.slug;
  }
  return '';
}

const { resolveGrocerySubcategorySlug } = require('./grocerySubcategories');
const { resolveHealthBeautySubcategorySlug } = require('./healthBeautySubcategories');
const { resolveHomeCareSubcategorySlug } = require('./homeCareSubcategories');

const CATEGORY_SUBCATEGORY_RESOLVERS = {
  'snacks-confectionary': resolveSnacksSubcategorySlug,
  beverages: resolveBeveragesSubcategorySlug,
  'tea-coffee': resolveTeaCoffeeSubcategorySlug,
  'milk-dairy': resolveMilkDairySubcategorySlug,
  grocery: resolveGrocerySubcategorySlug,
  'health-beauty': resolveHealthBeautySubcategorySlug,
  'home-care': resolveHomeCareSubcategorySlug
};

function resolveCategorySubcategorySlug(categorySlug, productName) {
  const fn = CATEGORY_SUBCATEGORY_RESOLVERS[String(categorySlug || '').toLowerCase()];
  if (!fn) return '';
  return fn(productName);
}

async function countProductsMatchingSubcategory(categoryId, subRow) {
  return Product.countDocuments({
    category: categoryId,
    isPublished: true,
    ...productHasImageMongoMatch(),
    ...buildSubcategoryProductMatch(subRow)
  });
}

async function resolveShopSubcategoryId(input, { categoryId, gender } = {}) {
  if (input == null || input === '') return null;
  if (typeof input === 'object' && input._id) input = input._id;

  const idStr = String(input).trim();
  if (/^[a-fA-F0-9]{24}$/.test(idStr)) {
    const row = await ProductSubcategory.findById(idStr).select('_id category gender isActive').lean();
    if (!row || !row.isActive) return null;
    if (categoryId && String(row.category) !== String(categoryId)) return null;
    if (gender && row.gender && row.gender !== gender) return null;
    return row._id;
  }

  const slug = idStr.toLowerCase();
  const q = { slug, isActive: true };
  if (categoryId) q.category = categoryId;
  if (gender) q.gender = gender;
  const row = await ProductSubcategory.findOne(q).select('_id').lean();
  return row ? row._id : null;
}

async function attachSubcategoriesToProducts(docs) {
  if (!Array.isArray(docs) || !docs.length) return docs;
  const ids = [
    ...new Set(
      docs
        .map((p) => p.shopSubcategory)
        .filter(Boolean)
        .map((id) => String(id))
    )
  ];
  if (!ids.length) return docs;

  const rows = await ProductSubcategory.find({ _id: { $in: ids } })
    .select('name slug gender displayOrder')
    .lean();
  const byId = new Map(rows.map((r) => [String(r._id), r]));

  return docs.map((p) => {
    const sid = p.shopSubcategory ? String(p.shopSubcategory) : '';
    if (!sid) return p;
    const sub = byId.get(sid);
    return sub ? { ...p, shopSubcategory: sub } : { ...p, shopSubcategory: null };
  });
}

async function buildPublicSubcategoryTree(categoryId, categorySlug = '') {
  const rows = await ProductSubcategory.find({ category: categoryId, isActive: true })
    .sort({ gender: 1, displayOrder: 1, name: 1 })
    .lean();

  if (!rows.length) {
    return { mode: 'none', genders: [], subcategories: [] };
  }

  const slug = String(categorySlug || '').toLowerCase();
  const useGenderMode =
    GENDERED_CATEGORY_SLUGS.has(slug) && rows.some((r) => r.gender === 'women' || r.gender === 'men');

  const withCounts = await Promise.all(
    rows.map(async (r) => ({
      _id: r._id,
      name: r.name,
      slug: r.slug,
      gender: r.gender || '',
      displayOrder: r.displayOrder,
      productCount: await countProductsMatchingSubcategory(categoryId, r)
    }))
  );

  if (useGenderMode) {
    const genders = ['women', 'men'].map((gender) => ({
      gender,
      label: GENDER_LABELS[gender],
      subcategories: withCounts
        .filter((r) => r.gender === gender)
        .map(({ gender: _g, ...rest }) => rest)
    }));
    return { mode: 'gender', genders, subcategories: [] };
  }

  const subcategories = withCounts
    .filter((r) => !r.gender && r.productCount > 0)
    .map(({ gender: _g, ...rest }) => rest);

  return { mode: subcategories.length ? 'flat' : 'none', genders: [], subcategories };
}

async function countProductsBySubcategory(subcategoryId) {
  return Product.countDocuments({
    shopSubcategory: subcategoryId,
    isPublished: true
  });
}

/** When publishing clothing, gender + subcategory are required. */
async function validateClothingTaxonomyForPublish(Category, categoryId, shopGender, shopSubcategory, isPublished) {
  if (!isPublished) return null;
  const cat = await Category.findById(categoryId).select('slug').lean();
  if (!cat || cat.slug !== 'clothing') return null;

  const gender = normalizeGender(shopGender);
  if (!gender) {
    return 'Clothing products need "Shop for" (Women or Men) before publishing.';
  }
  if (!shopSubcategory) {
    return 'Clothing products need a clothing type (3 Piece, 2 Piece, etc.) before publishing.';
  }

  const sub = await ProductSubcategory.findById(shopSubcategory).select('gender isActive').lean();
  if (!sub || !sub.isActive) {
    return 'Invalid clothing type selected.';
  }
  if (sub.gender !== gender) {
    return 'Clothing type must match the selected gender (Women/Men).';
  }
  return null;
}

module.exports = {
  GENDER_LABELS,
  GENDERED_CATEGORY_SLUGS,
  normalizeGender,
  normalizeKeywords,
  buildSubcategoryProductMatch,
  countProductsMatchingSubcategory,
  resolveSnacksSubcategorySlug,
  SNACKS_SUBCATEGORY_RULES,
  resolveBeveragesSubcategorySlug,
  BEVERAGES_SUBCATEGORY_RULES,
  resolveTeaCoffeeSubcategorySlug,
  TEA_COFFEE_SUBCATEGORY_RULES,
  resolveCategorySubcategorySlug,
  CATEGORY_SUBCATEGORY_RESOLVERS,
  resolveShopSubcategoryId,
  attachSubcategoriesToProducts,
  countProductsBySubcategory,
  buildPublicSubcategoryTree,
  validateClothingTaxonomyForPublish
};
