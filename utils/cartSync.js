const mongoose = require('mongoose');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const { resolveProductByIdOrSlug } = require('./productResolve');

/**
 * Guest session lines may use legacy `{ productId }` only; normalize to API shape with `product` _id.
 */
async function normalizeSessionCartForClient(sessionRows) {
  if (!sessionRows?.length) return [];
  const out = [];
  for (const line of sessionRows) {
    const ref = line.product != null ? line.product : line.productId;
    if (ref == null || ref === '') continue;
    const p = await resolveProductByIdOrSlug(ref);
    if (!p) continue;
    const qty = Math.floor(Number(line.quantity));
    if (!Number.isInteger(qty) || qty < 1) continue;
    const img =
      (p.images && p.images[0] && p.images[0].url) || line.imageUrl || '';
    out.push({
      product: String(p._id),
      productSlug: p.slug,
      quantity: qty,
      name: line.name || p.name,
      price: line.price != null ? line.price : p.price,
      emoji: line.emoji || '📦',
      imageUrl: img
    });
  }
  return out;
}

async function getOrCreateUserCart(userId) {
  let cart = await Cart.findOne({ user: userId });
  if (!cart) {
    cart = await Cart.create({ user: userId, items: [] });
  }
  return cart;
}

async function hydrateCartItems(items) {
  if (!items?.length) return [];
  const ids = items.map((i) => i.product).filter(Boolean);
  const products = await Product.find({ _id: { $in: ids } }).lean();
  const byId = Object.fromEntries(products.map((p) => [String(p._id), p]));
  const result = [];
  for (const line of items) {
    const p = byId[String(line.product)];
    if (!p) continue;
    const img =
      (p.images && p.images[0] && p.images[0].url) || '';
    result.push({
      product: String(p._id),
      productSlug: p.slug,
      quantity: line.quantity,
      name: p.name,
      price:
        line.price != null && line.price >= 0 ? line.price : p.price,
      emoji: '📦',
      imageUrl: img
    });
  }
  return result;
}

function normalizeQuantity(raw, fallback = 1) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

/**
 * Merges guest session cart lines into the user's persisted Cart, then caller should clear session cart.
 */
async function mergeSessionCartIntoUserCart(userId, sessionRows) {
  if (!sessionRows?.length) return;

  const cart = await getOrCreateUserCart(userId);
  const map = new Map(cart.items.map((i) => [String(i.product), i.quantity]));

  for (const row of sessionRows) {
    if (!row) continue;
    const ref = row.product != null ? row.product : row.productId;
    if (ref == null || ref === '') continue;
    const prod = await resolveProductByIdOrSlug(ref);
    if (!prod) continue;
    const id = String(prod._id);
    const add = normalizeQuantity(row.quantity, 1);
    map.set(id, (map.get(id) || 0) + add);
  }

  cart.items = Array.from(map.entries()).map(([idStr, quantity]) => ({
    product: new mongoose.Types.ObjectId(idStr),
    quantity,
    price: null
  }));
  await cart.save();
}

module.exports = {
  getOrCreateUserCart,
  hydrateCartItems,
  mergeSessionCartIntoUserCart,
  normalizeQuantity,
  normalizeSessionCartForClient
};
