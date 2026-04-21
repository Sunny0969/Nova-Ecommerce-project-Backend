const Product = require('../models/Product');
const Category = require('../models/Category');
const { publicSiteUrl } = require('../lib/publicSiteUrl');

function escapeXml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatLastmod(d) {
  if (d == null) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function urlEntry(loc, { priority, changefreq, lastmod }) {
  let xml = '  <url>\n';
  xml += `    <loc>${escapeXml(loc)}</loc>\n`;
  if (lastmod) xml += `    <lastmod>${lastmod}</lastmod>\n`;
  if (changefreq) xml += `    <changefreq>${changefreq}</changefreq>\n`;
  if (priority != null && priority !== '') xml += `    <priority>${priority}</priority>\n`;
  xml += '  </url>\n';
  return xml;
}

/**
 * GET /sitemap.xml — dynamic sitemap for the SPA (see server.js mount).
 */
module.exports = async function sitemapHandler(req, res) {
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  try {
    const base = publicSiteUrl();

    const [products, categories] = await Promise.all([
      Product.find({
        isPublished: true,
        slug: { $exists: true, $nin: [null, ''] }
      })
        .select('slug updatedAt')
        .sort({ updatedAt: -1 })
        .lean(),
      Category.find({
        isActive: true,
        slug: { $exists: true, $nin: [null, ''] }
      })
        .select('slug updatedAt')
        .lean()
    ]);

    let body = '<?xml version="1.0" encoding="UTF-8"?>\n';
    body += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    body += urlEntry(`${base}/`, { priority: '1.0', changefreq: 'weekly' });
    body += urlEntry(`${base}/shop`, { priority: '0.9', changefreq: 'daily' });

    for (const c of categories) {
      const slug = String(c.slug || '').trim();
      if (!slug) continue;
      body += urlEntry(`${base}/category/${encodeURIComponent(slug)}`, {
        priority: '0.8',
        changefreq: 'weekly',
        lastmod: formatLastmod(c.updatedAt)
      });
    }

    for (const p of products) {
      const slug = String(p.slug || '').trim();
      if (!slug) continue;
      body += urlEntry(`${base}/shop/${encodeURIComponent(slug)}`, {
        priority: '0.7',
        changefreq: 'weekly',
        lastmod: formatLastmod(p.updatedAt)
      });
    }

    body += '</urlset>\n';
    res.status(200).send(body);
  } catch (err) {
    console.error('[sitemap]', err.message);
    res.status(500).setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send('Sitemap temporarily unavailable.');
  }
};
