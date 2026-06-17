/**
 * Grocery main category + 15 subcategories (no duplicate names).
 */
const GROCERY_SUBCATEGORIES = [
  {
    name: 'Pulses & Grains',
    slug: 'pulses-grains',
    displayOrder: 1,
    matchKeywords: ['pulse', 'pulses', 'dal', 'daal', 'chana', 'moong', 'masoor', 'gram', 'grain', 'lentil']
  },
  {
    name: 'Noodles & Pasta',
    slug: 'noodles-pasta',
    displayOrder: 2,
    matchKeywords: ['noodle', 'noodles', 'pasta', 'macaroni', 'spaghetti', 'vermicelli', 'ketchup pasta']
  },
  {
    name: 'Salt, Spices & Herbs',
    slug: 'salt-spices-herbs',
    displayOrder: 3,
    matchKeywords: ['spice', 'spices', 'masala', 'salt', 'herb', 'herbs', 'cumin', 'turmeric', 'chilli', 'pepper']
  },
  {
    name: 'Cereals & Oats',
    slug: 'cereals-oats',
    displayOrder: 4,
    matchKeywords: ['cereal', 'cereals', 'oats', 'oat', 'corn flakes', 'muesli', 'breakfast']
  },
  {
    name: 'Edible Oil & Ghee',
    slug: 'edible-oil-ghee',
    displayOrder: 5,
    matchKeywords: ['oil', 'ghee', 'banaspati', 'olive oil', 'canola', 'sunflower oil', 'cooking oil']
  },
  {
    name: 'Rice',
    slug: 'rice',
    displayOrder: 6,
    matchKeywords: ['rice', 'basmati', 'sella', 'steamed rice']
  },
  {
    name: 'Flour',
    slug: 'flour',
    displayOrder: 7,
    matchKeywords: ['flour', 'atta', 'maida', 'suji', 'semolina', 'besan']
  },
  {
    name: 'Sugar',
    slug: 'sugar',
    displayOrder: 8,
    matchKeywords: ['sugar', 'shakkar', 'gur', 'jaggery']
  },
  {
    name: 'Dry Fruits',
    slug: 'dry-fruits',
    displayOrder: 9,
    matchKeywords: ['dry fruit', 'dry fruits', 'almond', 'almonds', 'cashew', 'pistachio', 'walnut', 'raisin', 'dates']
  },
  {
    name: 'Canned/Bottled Foods',
    slug: 'canned-bottled-foods',
    displayOrder: 10,
    matchKeywords: ['canned', 'can ', 'bottled', 'jar ', 'pickle', 'murabba', 'preserve']
  },
  {
    name: 'Sauces, Dressings & Seasonings',
    slug: 'sauces-dressings-seasonings',
    displayOrder: 11,
    matchKeywords: ['sauce', 'sauces', 'ketchup', 'mayonnaise', 'mayo', 'dressing', 'seasoning', 'vinegar', 'soy sauce']
  },
  {
    name: 'Spreads',
    slug: 'spreads',
    displayOrder: 12,
    matchKeywords: ['spread', 'spreads', 'jam', 'jelly', 'marmalade', 'peanut butter', 'nutella', 'choco']
  },
  {
    name: 'Dessert',
    slug: 'dessert',
    displayOrder: 13,
    matchKeywords: ['dessert', 'kheer', 'custard', 'jelly powder', 'falooda', 'rabri', 'sheer khurma', 'mix']
  },
  {
    name: 'Ready to Eat Meals',
    slug: 'ready-to-eat-meals',
    displayOrder: 14,
    matchKeywords: ['ready to eat', 'ready-to-eat', 'instant meal', 'frozen meal', 'biryani', 'haleem']
  },
  {
    name: 'Baking & Cooking',
    slug: 'baking-cooking',
    displayOrder: 15,
    matchKeywords: ['baking', 'baking powder', 'yeast', 'vanilla', 'essence', 'food colour', 'cooking']
  }
];

/** Former top-level category slug → grocery subcategory slug */
const LEGACY_CATEGORY_TO_SUB = {
  pulses: 'pulses-grains',
  'pasta-noodles': 'noodles-pasta',
  'spices-sauces': 'salt-spices-herbs',
  breakfast: 'cereals-oats',
  'oil-ghee': 'edible-oil-ghee',
  rice: 'rice',
  flour: 'flour',
  sugar: 'sugar',
  'jar-canned-foods': 'canned-bottled-foods',
  'sauces-dressings-seasonings': 'sauces-dressings-seasonings',
  spreads: 'spreads',
  'traditional-dessert-mixes': 'dessert',
  'dessert-baking-essentials': 'baking-cooking'
};

/** Deactivate these as standalone homepage categories after migration */
const LEGACY_CATEGORY_SLUGS = Object.keys(LEGACY_CATEGORY_TO_SUB);

const GROCERY_SUBCATEGORY_RULES = GROCERY_SUBCATEGORIES.map((spec) => ({
  slug: spec.slug,
  keywords: spec.matchKeywords
})).sort((a, b) => {
  const order = Object.fromEntries(GROCERY_SUBCATEGORIES.map((s, i) => [s.slug, i]));
  return (order[a.slug] ?? 99) - (order[b.slug] ?? 99);
});

function resolveGrocerySubcategorySlug(productName) {
  const name = String(productName || '').toLowerCase();
  for (const row of GROCERY_SUBCATEGORY_RULES) {
    if (row.keywords.some((kw) => name.includes(kw.toLowerCase()))) {
      return row.slug;
    }
  }
  return '';
}

module.exports = {
  GROCERY_SUBCATEGORIES,
  LEGACY_CATEGORY_TO_SUB,
  LEGACY_CATEGORY_SLUGS,
  resolveGrocerySubcategorySlug
};
