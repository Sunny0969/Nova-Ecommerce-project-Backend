const mongoose = require('mongoose');

/** Products visible on the storefront. */
const PUBLISHED_PRODUCT_MATCH = {
  isPublished: true,
  approvalStatus: { $in: ['approved', 'pending_approval'] }
};

/**
 * Count published products per category and set isActive accordingly.
 * Categories with >=1 published product -> active; empty -> inactive.
 */
async function syncCategoryVisibility(Category, Product) {
  const categories = await Category.find({}).select('_id slug name').lean();
  let activated = 0;
  let deactivated = 0;

  for (const cat of categories) {
    const count = await Product.countDocuments({
      category: cat._id,
      ...PUBLISHED_PRODUCT_MATCH
    });
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
        let: { catId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ['$category', '$$catId'] },
              isPublished: true,
              approvalStatus: { $in: ['approved', 'pending_approval'] }
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
  syncCategoryVisibility,
  publishedProductCountStages
};
