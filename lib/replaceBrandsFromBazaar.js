const { parseBazaarBrandsFromHtmlFile } = require('./parseBazaarBrandsHtml');
const { isBlockedBrand, productMatchesBrand, normalizeBrandText } = require('./brandFilters');

function slugifyBrand(name) {
  return normalizeBrandText(name).replace(/\s+/g, '-');
}

async function replaceBrandsFromBazaarHtml(Brand, Product, filePath) {
  const parsed = await parseBazaarBrandsFromHtmlFile(filePath);
  const products = await Product.find({ isPublished: true }).select('name').lean();

  const withProducts = parsed.brands.filter(
    (b) => !isBlockedBrand(b) && products.some((p) => productMatchesBrand(p.name, b.name))
  );

  if (!withProducts.length) {
    throw new Error('No Bazaar brands matched products in your store');
  }

  await Brand.updateMany({}, { $set: { isActive: false, isPopular: false } });

  await Promise.all(
    withProducts.map((b, index) => {
      const slug = String(b.slug || slugifyBrand(b.name)).toLowerCase();
      return Brand.findOneAndUpdate(
        { slug },
        {
          $set: {
            name: b.name,
            slug,
            image: { url: b.imageUrl, public_id: '' },
            isActive: true,
            isPopular: index < 12,
            displayOrder: index
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    })
  );

  return {
    htmlBrandLogos: parsed.imageIds,
    bazaarBrandsInFile: parsed.matchedFromApi,
    replaced: withProducts.length,
    brands: withProducts.map((b) => ({ name: b.name, slug: b.slug, imageUrl: b.imageUrl }))
  };
}

module.exports = {
  productMatchesBrand,
  replaceBrandsFromBazaarHtml
};
