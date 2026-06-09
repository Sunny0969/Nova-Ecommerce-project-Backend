const mongoose = require('mongoose');
const {
  parsePunjabHandicraftCategoryHtml,
  parsePunjabHandicraftCategoryHtmlFile,
  fetchPunjabHandicraftCategoryHtml,
  fetchProductOgImage
} = require('./parsePunjabHandicraftCategoryHtml');
const { syncCategoryVisibility } = require('./syncCategoryVisibility');

async function resolveHtml(options) {
  if (options.html) return options.html;
  if (options.htmlPath) return parsePunjabHandicraftCategoryHtmlFile(options.htmlPath, options);
  if (options.fetchCategorySlug) {
    return fetchPunjabHandicraftCategoryHtml(options.fetchCategorySlug);
  }
  throw new Error('Provide htmlPath, html, or fetchCategorySlug');
}

async function upsertCategory(Category, categorySpec, displayOrder, categoryImageOverride) {
  const image =
    categoryImageOverride?.url
      ? categoryImageOverride
      : categorySpec.image?.url
        ? categorySpec.image
        : { url: '', public_id: '' };

  return Category.findOneAndUpdate(
    { slug: categorySpec.slug },
    {
      $set: {
        name: categorySpec.name,
        slug: categorySpec.slug,
        description: categorySpec.description || '',
        image,
        displayOrder: Number.isFinite(displayOrder) ? displayOrder : 0,
        isActive: true
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function fillMissingImages(products) {
  for (const p of products) {
    if (p.imageUrl) continue;
    const url = await fetchProductOgImage(p.slug);
    if (url) {
      p.imageUrl = url;
      p.images = [{ url, public_id: '' }];
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return products;
}

async function upsertProducts(Product, categoryDoc, products) {
  const results = [];
  for (const p of products) {
    const images = p.images?.length ? p.images : p.imageUrl ? [{ url: p.imageUrl, public_id: '' }] : [];
    const hasImage = images.some((im) => {
      const u = String(im?.url || '').trim();
      return u && !/placeholder/i.test(u);
    });
    const existing = await Product.findOne({ productId: p.productId }).select('_id slug').lean();
    const doc = await Product.findOneAndUpdate(
      { productId: p.productId },
      {
        $set: {
          productId: p.productId,
          name: p.name,
          slug: existing?.slug || p.slug,
          description: p.description || '',
          shortDescription: p.shortDescription || '',
          price: p.price,
          images,
          category: categoryDoc._id,
          tags: Array.isArray(p.tags) ? p.tags : [],
          stock: 25,
          isPublished: hasImage,
          approvalStatus: 'approved',
          rejectionReason: '',
          isFeatured: false,
          ratings: 0,
          numReviews: 0
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (!doc.slug) {
      doc.slug = p.slug;
      await doc.save();
    }
    results.push({ name: doc.name, slug: doc.slug, price: doc.price });
  }
  return results;
}

/**
 * Import category + products from Punjab Handicrafts HTML into MongoDB.
 */
async function importHandicraftCategoryToDb(models, options = {}) {
  const Category = models.Category;
  const Product = models.Product;
  if (!Category || !Product) {
    throw new Error('Category and Product models are required');
  }

  let html;
  if (options.htmlPath) {
    html = require('fs').readFileSync(require('path').resolve(options.htmlPath), 'utf8');
  } else if (options.html) {
    html = options.html;
  } else if (options.fetchCategorySlug) {
    html = await fetchPunjabHandicraftCategoryHtml(options.fetchCategorySlug);
  } else {
    throw new Error('Provide htmlPath, html, or fetchCategorySlug');
  }

  const parsed = parsePunjabHandicraftCategoryHtml(html, {
    categorySlug: options.categorySlug,
    categoryName: options.categoryName
  });

  if (options.fillMissingImages !== false) {
    await fillMissingImages(parsed.products);
  }

  const categoryDoc = await upsertCategory(
    Category,
    parsed.category,
    options.displayOrder,
    options.categoryImage
  );

  const products = await upsertProducts(Product, categoryDoc, parsed.products);

  const importedIds = parsed.products.map((p) => p.productId);
  const stale = await Product.updateMany(
    {
      category: categoryDoc._id,
      productId: { $nin: importedIds }
    },
    { $set: { isPublished: false } }
  );

  const visibility = await syncCategoryVisibility(Category, Product);

  return {
    category: {
      name: categoryDoc.name,
      slug: categoryDoc.slug,
      _id: String(categoryDoc._id)
    },
    products,
    unpublishedStale: stale.modifiedCount || 0,
    visibility
  };
}

module.exports = {
  importHandicraftCategoryToDb
};
