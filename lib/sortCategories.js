/** Storefront category order — alphabetical A–Z by name. */
function sortCategoriesAlphabetically(categories) {
  if (!Array.isArray(categories) || categories.length < 2) {
    return Array.isArray(categories) ? [...categories] : [];
  }

  return [...categories].sort((a, b) =>
    String(a.name || a.slug || '').localeCompare(String(b.name || b.slug || ''), 'en', {
      sensitivity: 'base',
      numeric: true
    })
  );
}

module.exports = { sortCategoriesAlphabetically };
