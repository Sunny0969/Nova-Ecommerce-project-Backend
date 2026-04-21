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

async function sendMail({ to, subject, text, html }) {
  const transport = getTransport();
  if (!transport) {
    console.warn('[email] EMAIL_* not configured — message not sent:', subject);
    return { skipped: true };
  }
  await transport.sendMail({
    from: `"Nova Shop" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text,
    html: html || text
  });
  return { sent: true };
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
  const subject = `Nova Shop — Order confirmation (${id.slice(-8)})`;
  const text = [
    `Hi ${user.name},`,
    '',
    `Thank you for your order. Order ID: ${id}`,
    `Total: ${formatStoreMoney(order.totalPrice)}`,
    `Status: ${order.status}`,
    '',
    'We will send another email when your order ships.'
  ].join('\n');

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
  sendOrderCancelledEmail,
  sendOrderShippedEmail,
  sendPaymentFailedEmail,
  sendFraudFlaggedAdminEmail,
  sendOrderHeldForFraudReviewEmail,
  sendMail
};
