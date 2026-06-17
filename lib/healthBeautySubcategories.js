/**
 * Health & Beauty main category + 8 subcategories.
 */
const HEALTH_BEAUTY_SUBCATEGORIES = [
  {
    name: 'Oral Care',
    slug: 'oral-care',
    displayOrder: 1,
    matchKeywords: [
      'toothpaste',
      'tooth brush',
      'toothbrush',
      'mouth wash',
      'mouthwash',
      'dental',
      'floss',
      'oral care',
      'colgate',
      'listerine'
    ]
  },
  {
    name: 'Body & Skin Care',
    slug: 'body-skin-care',
    displayOrder: 2,
    matchKeywords: [
      'body lotion',
      'body cream',
      'moisturizer',
      'moisturiser',
      'body wash',
      'shower gel',
      'skin care',
      'skincare',
      'vaseline',
      'nivea body'
    ]
  },
  {
    name: 'Hair Care',
    slug: 'hair-care',
    displayOrder: 3,
    matchKeywords: [
      'shampoo',
      'conditioner',
      'hair oil',
      'hair color',
      'hair colour',
      'hair care',
      'hair mask',
      'hair serum',
      'pantene',
      'sunsilk'
    ]
  },
  {
    name: 'Facial Care',
    slug: 'facial-care',
    displayOrder: 4,
    matchKeywords: [
      'face wash',
      'facial',
      'face cream',
      'face mask',
      'scrub',
      'cleanser',
      'ponds',
      'garnier face',
      'fair & lovely',
      'fair and lovely'
    ]
  },
  {
    name: 'Personal Hygiene',
    slug: 'personal-hygiene',
    displayOrder: 5,
    matchKeywords: [
      'soap',
      'hand wash',
      'handwash',
      'sanitizer',
      'cotton bud',
      'cotton buds',
      'wipes',
      'hygiene',
      'dettol',
      'safeguard',
      'protex'
    ]
  },
  {
    name: "Men's Grooming",
    slug: 'mens-grooming',
    displayOrder: 6,
    matchKeywords: [
      'shaving',
      'shave',
      'razor',
      'trimmer',
      'beard',
      'aftershave',
      'after shave',
      "men's",
      'for men',
      'gillette',
      'axe men',
      'grooming'
    ]
  },
  {
    name: 'Feminine Care',
    slug: 'feminine-care',
    displayOrder: 7,
    matchKeywords: [
      'sanitary',
      'pad',
      'tampon',
      'feminine',
      'veet',
      'whisper',
      'always',
      'hair removal'
    ]
  },
  {
    name: 'Fragrances',
    slug: 'fragrances',
    displayOrder: 8,
    matchKeywords: [
      'perfume',
      'fragrance',
      'eau de',
      'attar',
      'body mist',
      'cologne',
      'deodorant spray',
      'imported perfume'
    ]
  }
];

/** Former top-level category slug → health-beauty subcategory slug */
const LEGACY_CATEGORY_TO_SUB = {
  'oral-care': 'oral-care',
  'body-skin-care': 'body-skin-care',
  'hair-care': 'hair-care',
  'facial-care': 'facial-care',
  'personal-hygiene': 'personal-hygiene',
  'feminine-care': 'feminine-care',
  'soaps-handwashes': 'personal-hygiene',
  'personal-care': 'mens-grooming',
  'imported-perfume': 'fragrances'
};

const LEGACY_CATEGORY_SLUGS = Object.keys(LEGACY_CATEGORY_TO_SUB);

const HEALTH_BEAUTY_SUBCATEGORY_RULES = [
  {
    slug: 'fragrances',
    test: (name) =>
      /perfume|fragrance|eau\s*de|attar|body\s*mist|cologne|imported\s*perfume/i.test(name) &&
      !/tooth|dental/i.test(name)
  },
  {
    slug: 'oral-care',
    test: (name) => /toothpaste|tooth\s*brush|toothbrush|mouth\s*wash|mouthwash|dental|floss|oral\s*care/i.test(name)
  },
  {
    slug: 'mens-grooming',
    test: (name) =>
      /shav(e|ing)|razor|trimmer|beard|after\s*shave|aftershave|\bmen'?s\b|for\s*men|gillette|axe\s*men|grooming/i.test(
        name
      ) && !/women|feminine|sanitary/i.test(name)
  },
  {
    slug: 'feminine-care',
    test: (name) => /sanitary|tampon|\bpad\b|feminine|whisper|always|veet/i.test(name)
  },
  {
    slug: 'facial-care',
    test: (name) =>
      /face\s*wash|facial|face\s*cream|face\s*mask|cleanser|ponds|garnier\s*face|fair\s*&\s*lovely/i.test(name) &&
      !/body\s*wash|shower\s*gel/i.test(name)
  },
  {
    slug: 'hair-care',
    test: (name) => /shampoo|conditioner|hair\s*oil|hair\s*color|hair\s*colour|hair\s*care|hair\s*mask|hair\s*serum/i.test(name)
  },
  {
    slug: 'body-skin-care',
    test: (name) =>
      /body\s*lotion|body\s*cream|moisturiz|body\s*wash|shower\s*gel|skin\s*care|skincare|vaseline|nivea\s*body/i.test(
        name
      )
  },
  {
    slug: 'personal-hygiene',
    test: (name) =>
      /\bsoap\b|hand\s*wash|handwash|sanitizer|cotton\s*bud|wipes|hygiene|dettol|safeguard|protex/i.test(name)
  }
];

function resolveHealthBeautySubcategorySlug(productName) {
  const name = String(productName || '');
  for (const rule of HEALTH_BEAUTY_SUBCATEGORY_RULES) {
    if (rule.test(name)) return rule.slug;
  }
  return '';
}

module.exports = {
  HEALTH_BEAUTY_SUBCATEGORIES,
  LEGACY_CATEGORY_TO_SUB,
  LEGACY_CATEGORY_SLUGS,
  resolveHealthBeautySubcategorySlug
};
