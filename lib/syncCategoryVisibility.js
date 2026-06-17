const { productHasImageMongoMatch } = require('./productImageFilter');
const { buildProductCategoryFilter } = require('./productQueries');

/** Products visible on the storefront. */
const PUBLISHED_PRODUCT_MATCH = {
  isPublished: true,
  approvalStatus: { $in: ['approved', 'pending_approval'] },
  ...productHasImageMongoMatch()
};

/**
 * Count published storefront products for one category (ObjectId or legacy slug on product.category).
 */
async function countPublishedProductsForCategory(Product, categoryDoc) {
  const catFilter = await buildProductCategoryFilter(categoryDoc.slug || categoryDoc._id);
  if (catFilter._id && Array.isArray(catFilter._id.$in) && catFilter._id.$in.length === 0) {
    return 0;
  }
  return Product.countDocuments({
    $and: [catFilter, PUBLISHED_PRODUCT_MATCH]
  });
}

/**
 * Count published products per category and set isActive accordingly.
 * Categories with >=1 published product -> active; empty -> inactive.
 */
async function syncCategoryVisibility(Category, Product) {
  const categories = await Category.find({}).select('_id slug name').lean();
  let activated = 0;
  let deactivated = 0;

  for (const cat of categories) {
    const count = await countPublishedProductsForCategory(Product, cat);
    const shouldBeActive = count > 0;
    const result = await Category.updateOne(
      { _id: cat._id },
      { $set: { isActive: shouldBeActive } }
    );
    if (result.modifiedCount) {
      if (shouldBeActive) activated += 1;
      else deactivated += 1;
    }
  }

  return { activated, deactivated, total: categories.length };
}

/**
 * Aggregation stages: published product count per category (for public API).
 */
function publishedProductCountStages(productColl) {
  return [
    {
      $lookup: {
        from: productColl,
        let: { catId: '$_id', catSlug: '$slug' },
        pipeline: [
          {
            $match: {
              isPublished: true,
              approvalStatus: { $in: ['approved', 'pending_approval'] },
              images: {
                $elemMatch: {
                  url: {
                    $exists: true,
                    $type: 'string',
                    $nin: [''],
                    $not: /placeholder/i
                  }
                }
              },
              $expr: {
                $or: [
                  { $eq: ['$category', '$$catId'] },
                  { $eq: [{ $toString: '$category' }, { $toString: '$$catId' }] },
                  {
                    $and: [
                      { $eq: [{ $type: '$category' }, 'string'] },
                      {
                        $eq: [
                          { $toLower: '$category' },
                          { $toLower: { $ifNull: ['$$catSlug', ''] } }
                        ]
                      }
                    ]
                  }
                ]
              }
            }
          },
          { $count: 'n' }
        ],
        as: 'publishedProducts'
      }
    },
    {
      $addFields: {
        productCount: {
          $ifNull: [{ $arrayElemAt: ['$publishedProducts.n', 0] }, 0]
        }
      }
    },
    { $project: { publishedProducts: 0 } }
  ];
}

module.exports = {
  PUBLISHED_PRODUCT_MATCH,
  countPublishedProductsForCategory,
  syncCategoryVisibility,
  publishedProductCountStages
};
