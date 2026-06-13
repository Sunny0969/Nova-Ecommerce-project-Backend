const fs = require('fs');
const path = require('path');
const { buildSitemapXml } = require('./buildSitemap');
const { buildRobotsTxt } = require('./seoRobots');
const { publicSiteUrl } = require('./publicSiteUrl');

/** Production URLs in static sitemap files — never write localhost for Hostinger deploy. */
function sitemapSiteUrl() {
  const override = String(process.env.SITEMAP_BASE_URL || '').trim().replace(/\/+$/, '');
  if (override) return override;

  const url = publicSiteUrl();
  if (/localhost|127\.0\.0\.1/i.test(url)) {
    return 'https://www.bazaar-pk.com';
  }
  return url;
}

function repoFrontendPublicDir() {
  return path.join(__dirname, '..', '..', 'frontend', 'public');
}

function sitemapWriteTargets() {
  const publicDir = repoFrontendPublicDir();
  const targets = new Set([path.join(publicDir, 'sitemap.xml')]);

  const buildSitemap = path.join(__dirname, '..', '..', 'frontend', 'build', 'sitemap.xml');
  if (fs.existsSync(buildSitemap)) {
    targets.add(buildSitemap);
  }

  const buildRobots = path.join(__dirname, '..', '..', 'frontend', 'build', 'robots.txt');
  if (fs.existsSync(path.dirname(buildRobots))) {
    // robots only in public unless build exists
  }

  if (process.env.FRONTEND_BUILD_PATH) {
    const base = path.resolve(process.env.FRONTEND_BUILD_PATH);
    targets.add(path.join(base, 'sitemap.xml'));
  }

  return {
    publicDir,
    sitemapPaths: [...targets],
    robotsPath: path.join(publicDir, 'robots.txt')
  };
}

/**
 * Regenerate static sitemap.xml (+ robots.txt) after catalog/blog changes.
 * Also served dynamically at GET /sitemap.xml on the API host.
 */
async function regenerateSitemapAutopilot() {
  try {
    const siteUrl = sitemapSiteUrl();
    const xml = await buildSitemapXml(siteUrl);
    const robots = buildRobotsTxt(siteUrl);
    const xmlContent = `${xml}\n`;
    const robotsContent = `${robots.trim()}\n`;

    const { publicDir, sitemapPaths, robotsPath } = sitemapWriteTargets();
    fs.mkdirSync(publicDir, { recursive: true });
    fs.writeFileSync(robotsPath, robotsContent, 'utf8');

    for (const target of sitemapPaths) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, xmlContent, 'utf8');
    }

    const urlCount = (xml.match(/<url>/g) || []).length;
    const blogCount = (xml.match(/\/blog\//g) || []).length;
    console.log(
      `[SEO-SITEMAP] Autopilot updated sitemap (${urlCount} URLs, ${blogCount} blog posts) → ${siteUrl}/sitemap.xml`
    );

    return { ok: true, urlCount, blogCount, siteUrl, written: sitemapPaths };
  } catch (err) {
    console.error('[SEO-SITEMAP] Autopilot regeneration failed:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  regenerateSitemapAutopilot,
  sitemapSiteUrl
};
