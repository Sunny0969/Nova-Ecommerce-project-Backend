/**
 * Normalize all blog posts (structure, links, FAQ placement).
 *
 * Run: npm run blogs:normalize
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { configureMongoDns, MONGOOSE_CONNECT_OPTS } = require('../lib/configureMongoDns');
configureMongoDns();

const mongoose = require('mongoose');
const BlogPost = require('../models/BlogPost');
const { normalizeBlogHtml } = require('../lib/blogContentStructure');
const { extractSectionsFromHtml, estimateReadingMinutes } = require('../lib/blogSeo');
const { resolveBlogShopDestination } = require('../lib/blogShopLink');
const { regenerateSitemapAutopilot } = require('../lib/regenerateSitemapAutopilot');

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI missing');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, MONGOOSE_CONNECT_OPTS);
  try {
    const posts = await BlogPost.find({}).lean();
    let updated = 0;

    for (const post of posts) {
      const shopDest = await resolveBlogShopDestination({
        blogCategory: post.category,
        tags: post.tags,
        primaryKeyword: post.primaryKeyword,
        currentLabel: post.destinationLabel,
        currentUrl: post.destinationUrl
      });

      const normalized = normalizeBlogHtml(String(post.body || ''), {
        shopPath: shopDest.destinationUrl || post.destinationUrl || '/shop',
        blogSlug: post.slug
      });

      if (normalized === String(post.body || '')) continue;

      const sections = extractSectionsFromHtml(normalized);
      await BlogPost.findByIdAndUpdate(post._id, {
        body: normalized,
        sections: sections.length ? sections : [],
        readingMinutes: estimateReadingMinutes(normalized)
      });
      updated += 1;
      console.log(`Normalized: ${post.slug}`);
    }

    const sitemap = await regenerateSitemapAutopilot();
    console.log(`\nDone — ${updated}/${posts.length} posts updated.`);
    if (sitemap.ok) console.log(`[sitemap] ${sitemap.urlCount} URLs, ${sitemap.blogCount} blog posts`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('blogs:normalize failed:', err.message);
  process.exit(1);
});
