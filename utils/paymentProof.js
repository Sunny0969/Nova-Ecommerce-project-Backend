/**
 * Normalize bank-transfer proof on orders (DB field + legacy notes).
 */

function extractTransactionIdFromNotes(notes) {
  if (!notes) return '';
  const m = String(notes).match(/Transaction\s*ID\s*:\s*([A-Za-z0-9_-]+)/i);
  return m?.[1] ? String(m[1]).trim().slice(0, 120) : '';
}

function isBankTransferOrder(order) {
  if (!order) return false;
  const id = order.paymentResult?.id || '';
  return (
    id === 'bank_transfer' ||
    /easypaisa|bank transfer/i.test(String(order.paymentMethod || ''))
  );
}

/**
 * Merge paymentProof from notes when the structured field is empty.
 * @param {object} order — plain object or mongoose doc
 * @returns {object} order (mutated if mongoose doc)
 */
function hydratePaymentProof(order) {
  if (!order || !isBankTransferOrder(order)) return order;

  const current = order.paymentProof || {};
  const txn = String(current.transactionId || '').trim();
  const imageUrl = String(current.imageUrl || '').trim();

  if (txn || imageUrl) return order;

  const fromNotes = extractTransactionIdFromNotes(order.notes);
  if (!fromNotes) return order;

  const next = {
    transactionId: fromNotes,
    imageUrl: '',
    imagePublicId: '',
    submittedAt: current.submittedAt || order.createdAt || new Date()
  };

  if (typeof order.set === 'function') {
    order.set('paymentProof', next);
  } else {
    order.paymentProof = next;
  }

  return order;
}

/**
 * @param {import('mongoose').Document} orderDoc
 */
async function persistHydratedPaymentProof(orderDoc) {
  const before = String(orderDoc.paymentProof?.transactionId || '').trim();
  hydratePaymentProof(orderDoc);
  const after = String(orderDoc.paymentProof?.transactionId || '').trim();
  if (!after || after === before) return false;
  await orderDoc.save();
  return true;
}

function paymentProofForResponse(order) {
  if (!order) return { transactionId: '', imageUrl: '', imagePublicId: '', submittedAt: null, hasProof: false };
  const o = order.toObject ? order.toObject() : { ...order };
  hydratePaymentProof(o);
  const p = o.paymentProof || {};
  const transactionId = String(p.transactionId || '').trim();
  const imageUrl = String(p.imageUrl || '').trim();
  return {
    transactionId,
    imageUrl,
    imagePublicId: String(p.imagePublicId || '').trim(),
    submittedAt: p.submittedAt || null,
    hasProof: Boolean(transactionId || imageUrl)
  };
}

module.exports = {
  extractTransactionIdFromNotes,
  isBankTransferOrder,
  hydratePaymentProof,
  persistHydratedPaymentProof,
  paymentProofForResponse
};
