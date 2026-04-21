/**
 * Builds a Mongoose query from Express-style query string params.
 *
 * @example
 * const features = new APIFeatures(Product.find({ isPublished: true }), req.query)
 *   .search(['name', 'description', 'tags'])
 *   .filter()
 *   .sort()
 *   .paginate();
 * const products = await features.query;
 */
class APIFeatures {
  /**
   * @param {import('mongoose').Query} query - Mongoose query (e.g. Model.find({ ... }))
   * @param {Record<string, string | string[] | undefined>} queryStr - Usually `req.query`
   */
  constructor(query, queryStr) {
    this.query = query;
    this.queryString = queryStr || {};
  }

  /**
   * Keyword search across string fields (case-insensitive regex).
   * Reads `search`, `keyword`, or `q` from the query string (first non-empty wins).
   *
   * @param {string[]} [fields=['name', 'description']] - document fields to match
   * @returns {this}
   */
  search(fields = ['name', 'description']) {
    const term =
      this.queryString.search ??
      this.queryString.keyword ??
      this.queryString.q;
    if (term == null || String(term).trim() === '') {
      return this;
    }

    const escaped = String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');

    const or = fields.map((field) => ({ [field]: regex }));
    if (or.length === 0) {
      return this;
    }

    this.query = this.query.find(or.length === 1 ? or[0] : { $or: or });
    return this;
  }

  /**
   * Applies remaining query params as MongoDB filters.
   * Strips pagination/sorting/meta keys, then maps `gte` → `$gte`, etc. in nested objects.
   *
   * @returns {this}
   */
  filter() {
    const queryObj = { ...this.queryString };

    const excludedFields = [
      'page',
      'limit',
      'sort',
      'fields',
      'search',
      'keyword',
      'q'
    ];
    excludedFields.forEach((key) => {
      delete queryObj[key];
    });

    let queryStr = JSON.stringify(queryObj);
    queryStr = queryStr.replace(/\b(gte|gt|lte|lt)\b/g, (match) => `$${match}`);

    if (queryStr === '{}') {
      return this;
    }

    this.query = this.query.find(JSON.parse(queryStr));
    return this;
  }

  /**
   * Sort results. Use `sort=field` or `sort=-field` for descending; comma-separated for multiple.
   * Default: `-createdAt`
   *
   * @returns {this}
   */
  sort() {
    if (this.queryString.sort) {
      const sortBy = String(this.queryString.sort)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .join(' ');
      this.query = this.query.sort(sortBy);
    } else {
      this.query = this.query.sort('-createdAt');
    }
    return this;
  }

  /**
   * Pagination via `page` and `limit` query params.
   *
   * @param {number} [defaultLimit=10]
   * @param {number} [maxLimit=100]
   * @returns {this}
   */
  paginate(defaultLimit = 10, maxLimit = 100) {
    const page = Math.max(1, parseInt(this.queryString.page, 10) || 1);
    const rawLimit = parseInt(this.queryString.limit, 10);
    const limit = Math.min(
      maxLimit,
      Math.max(1, Number.isFinite(rawLimit) ? rawLimit : defaultLimit)
    );
    const skip = (page - 1) * limit;

    this.query = this.query.skip(skip).limit(limit);
    return this;
  }
}

module.exports = APIFeatures;
