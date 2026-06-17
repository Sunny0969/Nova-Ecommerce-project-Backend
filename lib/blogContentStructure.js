/**
 * Normalize AI blog HTML: section order, dedupe conclusion, FAQ at end, link quotas.
 */
const { stripDangerousHtml, getSiteOrigin, getSiteName } = require('./blogSeo');

const CONCLUSION_RE =
  /\b(conclusion|final thoughts|summary|wrapping up|key takeaways|closing thoughts)\b/i;
const FAQ_RE = /\b(faq|frequently asked questions|common questions)\b/i;

const REQUIRED_INTERNAL = 4;
const REQUIRED_EXTERNAL = 4;

/** Stable HTTPS sources — never javascript: or placeholder URLs. */
const TRUSTED_EXTERNAL_LINKS = [
  {
    href: 'https://www.fao.org/family-farming/overview/en/',
    text: 'FAO overview of family farming and food systems'
  },
  {
    href: 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet',
    text: 'WHO guidance on a balanced healthy diet'
  },
  {
    href: 'https://developers.google.com/search/docs/fundamentals/seo-starter-guide',
    text: 'Google Search Central SEO starter guide'
  },
  {
    href: 'https://www.pbs.gov.pk/',
    text: 'Pakistan Bureau of Statistics official data'
  }
];

function classifySectionTitle(title) {
  const t = String(title || '').trim();
  if (!t) return 'body';
  if (FAQ_RE.test(t)) return 'faq';
  if (CONCLUSION_RE.test(t)) return 'conclusion';
  return 'body';
}

/** Split HTML into intro (before first h2) + h2 sections. */
function splitHtmlSections(html) {
  const clean = String(html || '').trim();
  if (!clean) return { intro: '', sections: [] };

  const parts = clean.split(/(?=<h2[\s>])/i);
  let intro = '';
  const sections = [];

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i].trim();
    if (!part) continue;

    const match = part.match(/^<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (!match) {
      if (sections.length === 0) intro += part;
      else sections[sections.length - 1].html += part;
      continue;
    }

    const title = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    sections.push({
      title,
      html: part,
      kind: classifySectionTitle(title)
    });
  }

  return { intro, sections };
}

function mergeSectionHtml(blocks) {
  return blocks
    .map((b) => b.html)
    .filter(Boolean)
    .join('\n')
    .trim();
}

/** One conclusion (last wins), one FAQ block (merged), FAQ always last. */
function reorderBlogSections(intro, sections) {
  const body = [];
  const faqBlocks = [];
  const conclusionBlocks = [];

  for (const section of sections) {
    if (section.kind === 'faq') faqBlocks.push(section);
    else if (section.kind === 'conclusion') conclusionBlocks.push(section);
    else body.push(section);
  }

  const ordered = [...body];

  if (conclusionBlocks.length) {
    const lastConclusion = conclusionBlocks[conclusionBlocks.length - 1];
    ordered.push({
      title: lastConclusion.title || 'Conclusion',
      html: lastConclusion.html,
      kind: 'conclusion'
    });
  }

  if (faqBlocks.length) {
    const faqInner = faqBlocks
      .map((b) => b.html.replace(/^<h2[^>]*>[\s\S]*?<\/h2>/i, '').trim())
      .filter(Boolean)
      .join('\n');
    ordered.push({
      title: 'Frequently Asked Questions',
      html: `<h2>Frequently Asked Questions</h2>\n${faqInner}`,
      kind: 'faq'
    });
  }

  return {
    intro: intro.trim(),
    sections: ordered
  };
}

function parseAnchorTags(html) {
  const links = [];
  const re = /<a\b[^>]*\shref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    links.push({
      href: String(m[2] || '').trim(),
      text: String(m[3] || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    });
  }
  return links;
}

function isValidInternalHref(href) {
  const h = String(href || '').trim();
  if (!h || h === '#' || h.startsWith('//')) return false;
  if (/^(javascript|mailto|tel|data):/i.test(h)) return false;
  if (h.startsWith('/')) return h.length > 1;
  try {
    const origin = getSiteOrigin().replace(/\/+$/, '');
    const url = new URL(h, origin);
    return url.origin === origin && url.pathname.length > 1;
  } catch {
    return false;
  }
}

function isValidExternalHref(href) {
  const h = String(href || '').trim();
  if (!h || !/^https:\/\//i.test(h)) return false;
  if (/^(javascript|data):/i.test(h)) return false;
  try {
    const url = new URL(h);
    const origin = getSiteOrigin().replace(/\/+$/, '');
    if (url.origin === origin) return false;
    return Boolean(url.hostname && url.hostname.includes('.'));
  } catch {
    return false;
  }
}

function countLinksByType(html) {
  const links = parseAnchorTags(html);
  let internal = 0;
  let external = 0;
  for (const link of links) {
    if (isValidInternalHref(link.href)) internal += 1;
    else if (isValidExternalHref(link.href)) external += 1;
  }
  return { internal, external, links };
}

function anchorExists(html, href) {
  const normalized = String(href || '').trim();
  return parseAnchorTags(html).some((l) => l.href === normalized);
}

function buildInternalLinkCandidates(shopPath = '/shop', blogSlug = '') {
  const siteName = getSiteName();
  const candidates = [
    { href: '/shop', text: `${siteName} online store` },
    { href: '/blog', text: `${siteName} shopping guides & blog` },
    { href: '/brands', text: 'Shop trusted brands at Bazaar' },
    { href: '/faqs', text: 'Delivery, returns & order FAQs' }
  ];

  const shop = String(shopPath || '/shop').trim();
  if (shop.startsWith('/') && shop !== '/shop' && !candidates.some((c) => c.href === shop)) {
    candidates.unshift({
      href: shop,
      text: `Browse related products at ${siteName}`
    });
  }

  if (blogSlug) {
    candidates.push({
      href: `/blog/${blogSlug}`,
      text: 'More articles on Bazaar blog'
    });
  }

  return candidates;
}

function injectMissingLinks(html, { shopPath = '/shop', blogSlug = '' } = {}) {
  let out = String(html || '');
  const { internal, external } = countLinksByType(out);

  const internalNeed = Math.max(0, REQUIRED_INTERNAL - internal);
  const externalNeed = Math.max(0, REQUIRED_EXTERNAL - external);

  if (internalNeed === 0 && externalNeed === 0) return out;

  const internalCandidates = buildInternalLinkCandidates(shopPath, blogSlug);
  const internalLinks = [];
  for (const c of internalCandidates) {
    if (internalLinks.length >= internalNeed) break;
    if (!anchorExists(out, c.href) && !internalLinks.some((l) => l.href === c.href)) {
      internalLinks.push(c);
    }
  }

  const externalLinks = [];
  for (const c of TRUSTED_EXTERNAL_LINKS) {
    if (externalLinks.length >= externalNeed) break;
    if (!anchorExists(out, c.href) && !externalLinks.some((l) => l.href === c.href)) {
      externalLinks.push(c);
    }
  }

  if (!internalLinks.length && !externalLinks.length) return out;

  const parts = ['<h2>Helpful resources</h2>', '<ul>'];
  for (const link of internalLinks) {
    parts.push(`<li><a href="${link.href}">${link.text}</a></li>`);
  }
  for (const link of externalLinks) {
    parts.push(
      `<li><a href="${link.href}" target="_blank" rel="noopener noreferrer">${link.text}</a></li>`
    );
  }
  parts.push('</ul>');

  const resourcesBlock = `\n${parts.join('\n')}\n`;
  const faqMatch = out.match(/<h2[^>]*>[^<]*(?:faq|frequently asked)[^<]*<\/h2>/i);
  if (faqMatch && faqMatch.index != null) {
    const idx = faqMatch.index;
    return `${out.slice(0, idx).trim()}\n${resourcesBlock}\n${out.slice(idx).trim()}`;
  }

  return `${out.trim()}${resourcesBlock}`;
}

/**
 * Full normalize pipeline for blog HTML body.
 */
function normalizeBlogHtml(html, options = {}) {
  const { shopPath = '/shop', blogSlug = '' } = options;
  let clean = stripDangerousHtml(html);

  const { intro, sections } = splitHtmlSections(clean);
  const reordered = reorderBlogSections(intro, sections);

  const bodyParts = [];
  if (reordered.intro) bodyParts.push(reordered.intro);
  for (const section of reordered.sections) {
    bodyParts.push(section.html);
  }

  clean = bodyParts.join('\n\n').trim();
  clean = injectMissingLinks(clean, { shopPath, blogSlug });
  return clean;
}

function bodyHasFaqSection(html) {
  return FAQ_RE.test(String(html || ''));
}

/** Pull FAQ Q&A from HTML for JSON-LD / UI (h3 questions in FAQ section). */
function extractFaqItemsFromHtml(html) {
  const clean = String(html || '');
  const faqMatch = clean.match(/<h2[^>]*>[^<]*(?:faq|frequently asked)[^<]*<\/h2>([\s\S]*?)(?=<h2|$)/i);
  if (!faqMatch) return [];

  const block = faqMatch[1];
  const items = [];
  const h3Parts = block.split(/<h3[^>]*>/i).slice(1);

  for (let i = 0; i < h3Parts.length; i += 1) {
    const chunk = h3Parts[i];
    const end = chunk.indexOf('</h3>');
    if (end === -1) continue;
    const question = chunk
      .slice(0, end)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const answer = chunk
      .slice(end + 5)
      .replace(/<h3[\s\S]*$/i, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (question && answer) items.push({ question, answer });
  }

  if (items.length) return items.slice(0, 8);

  const liMatches = block.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [];
  for (const li of liMatches.slice(0, 6)) {
    const text = li.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length > 20) items.push({ question: text.slice(0, 120), answer: text });
  }

  return items;
}

function auditBlogLinkQuotas(html) {
  const { internal, external, links } = countLinksByType(html);
  const invalid = links.filter(
    (l) => !isValidInternalHref(l.href) && !isValidExternalHref(l.href)
  );

  if (invalid.length) {
    return {
      ok: false,
      message: `SEO Audit Failed: ${invalid.length} broken or invalid link(s) found. Use site paths (/shop) or https:// external URLs only.`
    };
  }

  if (internal < REQUIRED_INTERNAL) {
    return {
      ok: false,
      message: `SEO Audit Failed: Need at least ${REQUIRED_INTERNAL} valid internal links (found ${internal}). Include /shop, /blog, and category links.`
    };
  }

  if (external < REQUIRED_EXTERNAL) {
    return {
      ok: false,
      message: `SEO Audit Failed: Need at least ${REQUIRED_EXTERNAL} valid external https links (found ${external}). Add authoritative sources.`
    };
  }

  return { ok: true, internal, external };
}

function auditBlogSectionOrder(html) {
  const { sections } = splitHtmlSections(html);
  const faqIndexes = sections
    .map((s, i) => (s.kind === 'faq' ? i : -1))
    .filter((i) => i >= 0);
  const conclusionIndexes = sections
    .map((s, i) => (s.kind === 'conclusion' ? i : -1))
    .filter((i) => i >= 0);

  if (faqIndexes.length > 1) {
    return {
      ok: false,
      message:
        'SEO Audit Failed: Multiple FAQ sections detected. Keep one FAQ block at the end of the article.'
    };
  }

  if (conclusionIndexes.length > 1) {
    return {
      ok: false,
      message:
        'SEO Audit Failed: Duplicate conclusion sections detected. Merge into a single conclusion before FAQs.'
    };
  }

  if (faqIndexes.length && conclusionIndexes.length && faqIndexes[0] < conclusionIndexes[0]) {
    return {
      ok: false,
      message:
        'SEO Audit Failed: FAQ section must come after the conclusion — not in the middle of the article.'
    };
  }

  if (faqIndexes.length && faqIndexes[0] < sections.length - 1) {
    return {
      ok: false,
      message:
        'SEO Audit Failed: FAQ section must be the last major section in the article body.'
    };
  }

  return { ok: true };
}

module.exports = {
  REQUIRED_INTERNAL,
  REQUIRED_EXTERNAL,
  normalizeBlogHtml,
  countLinksByType,
  auditBlogLinkQuotas,
  auditBlogSectionOrder,
  bodyHasFaqSection,
  extractFaqItemsFromHtml,
  isValidInternalHref,
  isValidExternalHref
};
