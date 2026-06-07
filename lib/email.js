const nodemailer = require('nodemailer');
const { formatStoreMoney } = require('../utils/formatMoney');

function getTransport() {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER) {
    return null;
  }
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT) || 587,
    secure: Number(process.env.EMAIL_PORT) === 465,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS || ''
    }
  });
}

const STORE_NAME = 'Souvenir Handicraft Shop';

async function sendMail({ to, subject, text, html }) {
  const transport = getTransport();
  if (!transport) {
    console.warn('[email] EMAIL_* not configured — message not sent:', subject);
    return { skipped: true };
  }
  await transport.sendMail({
    from: `"${STORE_NAME}" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text,
    html: html || text
  });
  return { sent: true };
}

function orderConfirmationRecipients(user, order) {
  const out = new Set();
  const account = user?.email && String(user.email).trim();
  if (account) out.add(account);
  const ship = order?.shippingAddress?.email && String(order.shippingAddress.email).trim();
  if (ship && /\S+@\S+\.\S+/.test(ship)) out.add(ship);
  return [...out];
}

function formatOrderLinesText(order) {
  const lines = Array.isArray(order.orderItems) ? order.orderItems : [];
  if (!lines.length) return '';
  return lines
    .map((line) => {
      const qty = Number(line.quantity) || 1;
      const price = Number(line.price) || 0;
      return `  • ${line.name} × ${qty} — ${formatStoreMoney(price * qty)}`;
    })
    .join('\n');
}

function formatMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return String(n);
  return x.toFixed(2);
}

/**
 * @param {{ name: string, email: string }} user
 * @param {import('mongoose').Document} order
 */
async function sendOrderConfirmationEmail(user, order) {
  const id = String(order._id);
  const shortId = id.slice(-8).toUpperCase();
  const recipients = orderConfirmationRecipients(user, order);
  if (!recipients.length) {
    console.warn('[email] No recipient for order confirmation', id);
    return { skipped: true };
  }

  const paymentLine = order.paymentMethod
    ? `Payment: ${order.paymentMethod}${order.isPaid ? ' (paid)' : ' (pending)'}`
    : '';
  const notesLine = order.notes ? `Note: ${order.notes}` : '';
  const itemsBlock = formatOrderLinesText(order);
  const addr = order.shippingAddress || {};
  const shipTo = [
    [addr.firstName, addr.lastName].filter(Boolean).join(' '),
    addr.street,
    [addr.city, addr.state, addr.zipCode].filter(Boolean).join(', '),
    addr.country,
    addr.phone ? `Phone: ${addr.phone}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  const subject = `${STORE_NAME} — Order #${shortId} confirmed`;
  const text = [
    `Hi ${user?.name || 'there'},`,
    '',
    `Thank you for your order at ${STORE_NAME}.`,
    `Order ID: ${id}`,
    `Total: ${formatStoreMoney(order.totalPrice)}`,
    paymentLine,
    notesLine,
    `Status: ${order.status || 'pending'}`,
    '',
    itemsBlock ? 'Items:\n' + itemsBlock : '',
    shipTo ? '\nShip to:\n' + shipTo : '',
    '',
    order.isPaid
      ? 'We will email you when your order ships.'
      : 'Payment is pending — follow the instructions shown at checkout. We will process your order after confirmation where required.'
  ]
    .filter(Boolean)
    .join('\n');

  const html = `<div style="font-family:sans-serif;line-height:1.5">${text
    .replace(/</g, '&lt;')
    .replace(/\n/g, '<br/>')}</div>`;

  const results = [];
  for (const to of recipients) {
    results.push(await sendMail({ to, subject, text, html }));
  }
  return results;
}

/**
 * Notify store admin of a new manual-payment order.
 */
async function sendNewOrderAdminEmail(order, user) {
  const adminEmail = process.env.ADMIN_EMAIL && String(process.env.ADMIN_EMAIL).trim();
  if (!adminEmail) return { skipped: true };

  const id = String(order._id);
  const shortId = id.slice(-8).toUpperCase();
  const customer =
    user?.email ||
    order.shippingAddress?.email ||
    order.paymentResult?.email_address ||
    'unknown';
  const subject = `${STORE_NAME} — New order #${shortId}`;
  const text = [
    'A new order was placed on the store.',
    '',
    `Order ID: ${id}`,
    `Customer: ${user?.name || '—'} <${customer}>`,
    `Total: ${formatStoreMoney(order.totalPrice)}`,
    `Payment: ${order.paymentMethod || '—'}${order.isPaid ? ' (paid)' : ' (unpaid)'}`,
    order.paymentProof?.transactionId
      ? `Transaction ID: ${order.paymentProof.transactionId}`
      : '',
    order.paymentProof?.imageUrl ? `Payment screenshot: ${order.paymentProof.imageUrl}` : '',
    order.notes ? `Notes: ${order.notes}` : '',
    `Status: ${order.status}`,
    '',
    formatOrderLinesText(order) ? 'Items:\n' + formatOrderLinesText(order) : '',
    '',
    'Open the admin panel to update status or mark bank transfer as received.'
  ]
    .filter(Boolean)
    .join('\n');

  return sendMail({
    to: adminEmail,
    subject,
    text,
    html: `<pre style="font-family:sans-serif;white-space:pre-wrap">${text.replace(/</g, '&lt;')}</pre>`
  });
}

/**
 * @param {{ name: string, email: string }} user
 * @param {import('mongoose').Document} order
 */
async function sendOrderCancelledEmail(user, order) {
  const id = String(order._id);
  const subject = `Nova Shop — Order cancelled (${id.slice(-8)})`;
  const text = [
    `Hi ${user.name},`,
    '',
    `Your order ${id} has been cancelled.`,
    order.cancelReason ? `Reason: ${order.cancelReason}` : '',
    '',
    'If payment was captured, a refund will be processed according to your bank.'
  ]
    .filter(Boolean)
    .join('\n');

  return sendMail({
    to: user.email,
    subject,
    text,
    html: `<p>${text.replace(/\n/g, '<br/>')}</p>`
  });
}

/**
 * @param {{ name: string, email: string }} user
 * @param {import('mongoose').Document} order
 */
async function sendOrderShippedEmail(user, order) {
  const id = String(order._id);
  const tn = (order.trackingNumber && String(order.trackingNumber).trim()) || '';
  const subject = `Nova Shop — Your order has shipped (${id.slice(-8)})`;
  const text = [
    `Hi ${user.name},`,
    '',
    `Your order ${id} has shipped.`,
    tn ? `Tracking number: ${tn}` : '',
    '',
    'Thank you for shopping with Nova Shop.'
  ]
    .filter(Boolean)
    .join('\n');

  return sendMail({
    to: user.email,
    subject,
    text,
    html: `<p>${text.replace(/\n/g, '<br/>')}</p>`
  });
}

/**
 * @param {{ name: string, email: string }} user
 * @param {{ id?: string }} paymentIntent — Stripe PaymentIntent-like object
 */
async function sendPaymentFailedEmail(user, paymentIntent) {
  const id = paymentIntent?.id || 'unknown';
  const subject = 'Nova Shop — Payment could not be processed';
  const text = [
    `Hi ${user.name},`,
    '',
    'Your payment was not completed. No charge was finalized on this attempt.',
    paymentIntent?.last_payment_error?.message
      ? `Reason: ${paymentIntent.last_payment_error.message}`
      : '',
    '',
    'You can return to your cart and try again, or use a different payment method.'
  ]
    .filter(Boolean)
    .join('\n');

  return sendMail({
    to: user.email,
    subject,
    text,
    html: `<p>${text.replace(/\n/g, '<br/>')}</p>`
  });
}

/**
 * @param {string} adminEmail
 * @param {{ orderId: string, riskScore: number, factors: object[], userEmail?: string }} payload
 */
async function sendFraudFlaggedAdminEmail(adminEmail, payload) {
  if (!adminEmail) return { skipped: true };
  const lines = [
    'A new order was placed but held for manual fraud review.',
    `Order ID: ${payload.orderId}`,
    `Risk score: ${payload.riskScore}`,
    payload.userEmail ? `Customer: ${payload.userEmail}` : '',
    '',
    'Factors:',
    ...(Array.isArray(payload.factors)
      ? payload.factors.map((f) => `- ${f.code}: ${f.detail || ''} (+${f.weight || 0})`)
      : [])
  ].filter(Boolean);
  const text = lines.join('\n');
  return sendMail({
    to: adminEmail,
    subject: `Nova Shop — Fraud review required (order …${String(payload.orderId).slice(-8)})`,
    text,
    html: `<pre style="font-family:sans-serif">${text.replace(/</g, '&lt;')}</pre>`
  });
}

/**
 * Customer notice when order is held (payment captured, fulfilment paused).
 */
async function sendOrderHeldForFraudReviewEmail(user, order) {
  const id = String(order._id);
  const subject = `Nova Shop — Order ${id.slice(-8)} is under review`;
  const text = [
    `Hi ${user.name},`,
    '',
    'Your payment was successful. Your order is temporarily on hold while we complete a quick security review.',
    'You will receive another email when it is released for processing — usually within one business day.',
    '',
    `Order reference: ${id}`
  ].join('\n');
  return sendMail({
    to: user.email,
    subject,
    text,
    html: `<p>${text.replace(/\n/g, '<br/>')}</p>`
  });
}

module.exports = {
  sendOrderConfirmationEmail,
  sendNewOrderAdminEmail,
  sendOrderCancelledEmail,
  sendOrderShippedEmail,
  sendPaymentFailedEmail,
  sendFraudFlaggedAdminEmail,
  sendOrderHeldForFraudReviewEmail,
  sendMail
};
