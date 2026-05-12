const BlogPost = require('../models/BlogPost');

const sample = [
  {
    title: 'The 60-Second Shoe Care Routine',
    slug: 'the-60-second-shoe-care-routine',
    category: 'Care',
    description:
      'Keep your sneakers fresh with a simple routine: gentle clean, smart drying, and storage that prevents odors.',
    tag: 'Quick Routine',
    featuredImage:
      'https://images.unsplash.com/photo-1528701800489-20be3c44c7a7?w=1200&auto=format&fit=crop&q=80',
    imageAlt: 'Clean shoes on a neutral background',
    destinationLabel: 'Shoe Care',
    destinationUrl: '/shop?category=home',
    readingMinutes: 4,
    dateISO: new Date('2026-03-18'),
    status: 'published',
    body:
      'A short routine you can do almost every day—designed to prevent buildup, odor, and premature wear.',
    sections: [
      {
        title: 'Why the routine works',
        content:
          'Small, consistent steps beat occasional deep cleaning. A quick wipe and controlled drying prevents grime from embedding into the materials.'
      },
      {
        title: 'Step 1: Gentle clean',
        content:
          'Use a soft brush or damp cloth to remove surface dust. Avoid aggressive scrubbing—let the cleaner do the work.'
      },
      {
        title: 'Step 2: Smart drying',
        content:
          'Let shoes dry at room temperature. Keep them ventilated and avoid direct heat that can damage adhesives and coatings.'
      },
      {
        title: 'Step 3: Odor-safe storage',
        content:
          'Store with breathable support. Use odor absorbers when needed to keep freshness between wears.'
      },
      {
        title: 'Next steps',
        content:
          'If your shoes look dull or feel stiff, use the right conditioner and protection spray. Small upgrades extend life.'
      }
    ]
  },
  {
    title: 'USB-C Buying Guide: What Matters Most',
    slug: 'usb-c-buying-guide-what-matters-most',
    category: 'Tech',
    description:
      'From wattage to cable quality, learn how to pick USB-C accessories that actually deliver reliable charging.',
    tag: 'Buying Guide',
    featuredImage:
      'https://images.unsplash.com/photo-1610891206177-4b8a0e4c7a4b?w=1200&auto=format&fit=crop&q=80',
    imageAlt: 'USB-C cables neatly arranged',
    destinationLabel: 'Chargers & Cables',
    destinationUrl: '/shop?category=electronics',
    readingMinutes: 7,
    dateISO: new Date('2026-02-27'),
    status: 'published',
    body:
      'Learn to choose the right USB-C charger and cable by matching power delivery, data needs, and real-world quality signals.',
    sections: [
      {
        title: 'Start with your device needs',
        content:
          'Check what your device supports (power delivery / charging profile). Buying a random wattage can lead to slow charging.'
      },
      {
        title: 'Wattage: match, don’t guess',
        content:
          'Higher wattage usually helps—if the device supports it. Focus on consistent charging speed rather than marketing numbers.'
      },
      {
        title: 'Cable quality matters',
        content:
          'Look for reliable construction and correct specifications. A good cable reduces heat and maintains stable output.'
      },
      {
        title: 'Data vs charging use cases',
        content:
          'If you need fast data transfer, confirm data capability. Charging-only cables can disappoint for file workflows.'
      },
      {
        title: 'Best practices for reliability',
        content:
          'Avoid bending tightly near the connector. Use compatible chargers and replace damaged cables early.'
      }
    ]
  }
];

async function ensureSampleBlogsIfDbEmpty() {
  const count = await BlogPost.estimatedDocumentCount();

  // If DB is empty -> insert sample fully.
  if (count === 0) {
    const created = await BlogPost.insertMany(sample, { ordered: false });
    return {
      seeded: true,
      added: created.length,
      total: created.length
    };
  }

  // DB already has data -> update existing posts to ensure new schema fields exist.
  const slugs = sample.map((s) => s.slug);
  const existingPosts = await BlogPost.find({ slug: { $in: slugs } }).lean();

  const existingBySlug = new Map(existingPosts.map((p) => [p.slug, p]));

  let updated = 0;
  for (const post of sample) {
    const found = existingBySlug.get(post.slug);

    const hasSections = Array.isArray(found?.sections) && found.sections.length > 0;
    const missingStatus = !found?.status;

    if (!hasSections || missingStatus) {
      await BlogPost.updateOne(
        { slug: post.slug },
        {
          $set: {
            body: post.body || '',
            sections: post.sections || [],
            status: post.status || 'published'
          }
        }
      );
      updated += 1;
    }
  }

  return { seeded: false, added: 0, total: count, updated };
}

module.exports = { ensureSampleBlogsIfDbEmpty };

