/**
 * Home Care main category + 6 subcategories.
 */
const HOME_CARE_SUBCATEGORIES = [
  {
    name: 'Laundry',
    slug: 'laundry',
    displayOrder: 1,
    matchKeywords: [
      'washing powder',
      'detergent',
      'bleach',
      'fabric conditioner',
      'softlan',
      'comfort fabric',
      'vanish',
      'stain devil',
      'starch spray',
      'laundry',
      'ariel',
      'persil liquid',
      'robin liquid blue',
      'robin bleach'
    ]
  },
  {
    name: 'Cleaning',
    slug: 'cleaning',
    displayOrder: 2,
    matchKeywords: [
      'cleaner',
      'dishwash',
      'mop',
      'brush',
      'sponge',
      'scour',
      'phenyl',
      'drain',
      'foil',
      'cling',
      'broom',
      'duster',
      'polish',
      'astonish',
      'dettol multi',
      'vim ',
      'lemon max dish'
    ]
  },
  {
    name: 'Disposable',
    slug: 'disposable',
    displayOrder: 3,
    matchKeywords: [
      'disposable',
      'plastic plates',
      'plastic glasses',
      'disposable fork',
      'disposable spoon',
      'disposable table'
    ]
  },
  {
    name: 'Tissue',
    slug: 'tissue',
    displayOrder: 4,
    matchKeywords: [
      'tissue',
      'toilet roll',
      'kitchen towel',
      'paper towel',
      'facial tissue',
      'wet wipes',
      'wipes',
      'toilet paper',
      'pop-up tissue',
      'hand towel'
    ]
  },
  {
    name: 'Air Fresheners & Home Fragrances',
    slug: 'air-fresheners-home-fragrances',
    displayOrder: 5,
    matchKeywords: [
      'air freshener',
      'freshener',
      'frey air',
      'perfect air freshener',
      'fresh touch toilet air',
      'matic refill',
      'room spray'
    ]
  },
  {
    name: 'Pest Control',
    slug: 'pest-control',
    displayOrder: 6,
    matchKeywords: [
      'pest',
      'insect killer',
      'mosquito',
      'repellent',
      'mospel',
      'coopermatic',
      'flying insect',
      'roach',
      'rat killer'
    ]
  }
];

const LEGACY_CATEGORY_TO_SUB = {
  laundry: 'laundry',
  'cleaning-homecare': 'cleaning',
  tissues: 'tissue'
};

const LEGACY_CATEGORY_SLUGS = Object.keys(LEGACY_CATEGORY_TO_SUB);

/** Priority rules — first match wins when re-assigning by product title */
const HOME_CARE_SUBCATEGORY_RULES = [
  {
    slug: 'pest-control',
    test: (name) =>
      /pest\s*control|insect\s*killer|mosquito|repellent|mospel|coopermatic|flying\s*insect|roach|rat\s*killer/i.test(
        name
      )
  },
  {
    slug: 'air-fresheners-home-fragrances',
    test: (name) =>
      /air\s*freshener|freshener\s*refill|frey\s*air|perfect\s*air\s*freshener|fresh\s*touch\s*toilet\s*air|matic\s*refill/i.test(
        name
      ) && !/insect|mosquito|pest/i.test(name)
  },
  {
    slug: 'disposable',
    test: (name) =>
      /disposable|plastic\s*plates|plastic\s*glasses|disposable\s*fork|disposable\s*spoon|disposable\s*table/i.test(
        name
      )
  },
  {
    slug: 'tissue',
    test: (name) =>
      /tissue|toilet\s*roll|kitchen\s*towel|paper\s*towel|facial\s*tissue|wet\s*wipes|\bwipes\b|pop-up\s*tissue|hand\s*towel/i.test(
        name
      ) && !/dishwash|detergent|washing\s*powder|unstitched|lawn|embroidered/i.test(name)
  },
  {
    slug: 'laundry',
    test: (name) =>
      /washing\s*powder|detergent|bleach|fabric\s*conditioner|softlan|comfort\s*fabric|vanish|stain\s*devil|starch\s*spray|laundry\s*brush|persil\s*liquid|robin\s*(liquid|bleach)|ariel|brite\s/i.test(
        name
      ) && !/dishwash|floor\s*cleaner|multi\s*purpose\s*cleaner/i.test(name)
  },
  {
    slug: 'cleaning',
    test: (name) =>
      /cleaner|dishwash|mop|brush|sponge|scour|phenyl|drain|foil|cling|broom|duster|polish|astonish|dettol\s*multi|vim\s|lemon\s*max\s*dish|glass\s*cleaner/i.test(
        name
      )
  }
];

function resolveHomeCareSubcategorySlug(productName) {
  const name = String(productName || '');
  for (const rule of HOME_CARE_SUBCATEGORY_RULES) {
    if (rule.test(name)) return rule.slug;
  }
  return '';
}

module.exports = {
  HOME_CARE_SUBCATEGORIES,
  LEGACY_CATEGORY_TO_SUB,
  LEGACY_CATEGORY_SLUGS,
  resolveHomeCareSubcategorySlug
};
