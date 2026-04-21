const OpenAI = require('openai');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Category = require('../models/Category');
const ProductEmbedding = require('../models/ProductEmbedding');

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMS = 1536;

function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

function normalizeText(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function buildProductEmbeddingInput(productDoc) {
  const p = productDoc?.toObject ? productDoc.toObject() : productDoc;
  const catId = p?.category?._id ? p.category._id : p?.category;
  let catName = '';
  if (catId && mongoose.Types.ObjectId.isValid(catId)) {
    const cat = await Category.findById(catId).select('name slug').lean();
    catName = cat?.name || cat?.slug || '';
  } else if (typeof p?.category === 'object') {
    catName = p?.category?.name || p?.category?.slug || '';
  }
  const tags = Array.isArray(p?.tags) ? p.tags.map((t) => String(t)).join(', ') : '';

  const parts = [
    p?.name,
    p?.shortDescription,
    p?.description,
    catName ? `Category: ${catName}` : '',
    tags ? `Tags: ${tags}` : ''
  ]
    .map(normalizeText)
    .filter(Boolean);

  return parts.join('\n');
}

async function createEmbedding(input) {
  const client = getOpenAI();
  if (!client) {
    const err = new Error('OPENAI_API_KEY is not set');
    err.code = 'NO_OPENAI';
    throw err;
  }
  const text = normalizeText(input);
  if (!text) {
    const err = new Error('Empty embedding input');
    err.code = 'EMPTY_INPUT';
    throw err;
  }
  const r = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text
  });
  const emb = r?.data?.[0]?.embedding;
  if (!Array.isArray(emb) || emb.length !== EMBEDDING_DIMS) {
    const err = new Error('Unexpected embedding response');
    err.code = 'BAD_EMBEDDING';
    throw err;
  }
  return emb;
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

function norm(a) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * a[i];
  return Math.sqrt(s) || 1;
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  return dot(a, b) / (norm(a) * norm(b));
}

async function upsertProductEmbedding(productId) {
  const pid = String(productId);
  if (!mongoose.Types.ObjectId.isValid(pid)) return { skipped: true };

  const product = await Product.findById(pid).lean();
  if (!product) return { skipped: true };

  const input = await buildProductEmbeddingInput(product);
  const embedding = await createEmbedding(input);

  await ProductEmbedding.findOneAndUpdate(
    { productId: product._id },
    { $set: { embedding, model: EMBEDDING_MODEL } },
    { upsert: true, new: true }
  );

  return { updated: true };
}

/**
 * Non-blocking queue. Call this after product create/update.
 */
function queueProductEmbeddingUpdate(productId) {
  setImmediate(() => {
    upsertProductEmbedding(productId).catch((e) => {
      console.warn('[aiSearch] embedding update failed:', e.message);
    });
  });
}

async function semanticSearch({ query, limit = 10 }) {
  const q = normalizeText(query);
  if (!q) return [];

  const queryEmbedding = await createEmbedding(q);

  // Keep it simple: scan all embeddings. Good enough for small catalogs.
  // (For scale: move to a vector DB or MongoDB Atlas vector search.)
  const rows = await ProductEmbedding.find({})
    .select('productId embedding')
    .lean();

  const scored = rows
    .map((r) => ({
      productId: String(r.productId),
      score: cosineSimilarity(queryEmbedding, r.embedding)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(50, limit * 5)));

  return scored.slice(0, limit);
}

async function keywordSearch({ query, limit = 25 }) {
  const q = normalizeText(query);
  if (!q) return [];

  // Use MongoDB text index on Product
  const rows = await Product.find(
    { isPublished: true, $text: { $search: q } },
    { score: { $meta: 'textScore' } }
  )
    .sort({ score: { $meta: 'textScore' } })
    .limit(Math.max(1, Math.min(100, limit)))
    .lean();

  // Normalize scores to 0..1
  const max = Math.max(0, ...rows.map((r) => Number(r.score) || 0)) || 1;
  return rows.map((r) => ({
    productId: String(r._id),
    score: (Number(r.score) || 0) / max
  }));
}

/**
 * Hybrid: 60% semantic + 40% keyword.
 * Returns ranked productIds + component scores.
 */
async function hybridSearch({ query, limit = 10, semanticWeight = 0.6, keywordWeight = 0.4 }) {
  const q = normalizeText(query);
  if (!q) return { items: [], semantic: [], keyword: [] };

  const [semantic, keyword] = await Promise.all([
    semanticSearch({ query: q, limit: 25 }),
    keywordSearch({ query: q, limit: 50 })
  ]);

  const semMap = new Map(semantic.map((x) => [x.productId, x.score])); // 0..1-ish
  const keyMap = new Map(keyword.map((x) => [x.productId, x.score])); // 0..1

  const allIds = new Set([...semMap.keys(), ...keyMap.keys()]);
  const merged = [];
  for (const id of allIds) {
    const sem = semMap.get(id) || 0;
    const key = keyMap.get(id) || 0;
    const combined = sem * semanticWeight + key * keywordWeight;
    merged.push({ productId: id, score: combined, semantic: sem, keyword: key });
  }

  merged.sort((a, b) => b.score - a.score);
  return { items: merged.slice(0, limit), semantic, keyword };
}

/**
 * Optional query rewrite suggestions (AI).
 */
async function suggestQueries({ query, max = 3 }) {
  const client = getOpenAI();
  const q = normalizeText(query);
  if (!client || !q) return [];

  const r = await client.chat.completions.create({
    model: process.env.OPENAI_SUGGEST_MODEL || 'gpt-4o-mini',
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content:
          'You rewrite ecommerce search queries into short, high-signal variants. Return ONLY a JSON array of strings.'
      },
      {
        role: 'user',
        content: `Query: ${q}\nReturn 3 rewritten queries (max 10 words each).`
      }
    ]
  });

  const text = r?.choices?.[0]?.message?.content || '';
  try {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((s) => normalizeText(s))
      .filter(Boolean)
      .slice(0, Math.max(1, Math.min(5, max)));
  } catch {
    return [];
  }
}

module.exports = {
  queueProductEmbeddingUpdate,
  upsertProductEmbedding,
  hybridSearch,
  suggestQueries
};

