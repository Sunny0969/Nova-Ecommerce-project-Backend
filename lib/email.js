const nodemailer = require('nodemailer');
const { formatStoreMoney } = require('../utils/formatMoney');
const { publicSiteUrl } = require('./publicSiteUrl');

const STORE_NAME = 'Bazaar';

function isRailwayHost() {
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT ||
      process.env.RAILWAY_PUBLIC_DOMAIN ||
      process.env.RAILWAY_STATIC_URL
  );
}

function emailPassword() {
  return String(process.env.EMAIL_PASS || process.env.GMAIL_APP_PASSWORD || '').trim();
}

function resendApiKey() {
  return String(process.env.RESEND_API_KEY || '').trim();
}

function isSmtpConfigured() {
  return Boolean(process.env.EMAIL_HOST && process.env.EMAIL_USER && emailPassword());
}

function usesResend() {
  return Boolean(resendApiKey());
}

function isEmailConfigured() {
  return usesResend() || isSmtpConfigured();
}

function getEmailProvider() {
  if (usesResend()) return 'resend';
  if (isSmtpConfigured()) return 'smtp';
  return 'none';
}

function verifiedStoreFromAddress() {
  const local = String(process.env.EMAIL_FROM_LOCAL || 'orders').trim() || 'orders';
  const domain = String(process.env.STORE_EMAIL_DOMAIN || 'bazaar-pk.com').trim() || 'bazaar-pk.com';
  return `"${STORE_NAME}" <${local}@${domain}>`;
}

function isResendTestFromAddress(from) {
  return /onboarding@resend\.dev/i.test(String(from || ''));
}

function emailFromAddress() {
  const from = String(process.env.EMAIL_FROM || '').trim();
  const onProduction = isRailwayHost() || process.env.NODE_ENV === 'production';

  if (from && !isResendTestFromAddress(from)) {
    return from;
  }

  // Verified domain required for customer emails — never use onboarding@ on production.
  if (usesResend() && onProduction) {
    if (isResendTestFromAddress(from)) {
      console.warn(
        '[email] EMAIL_FROM is onboarding@resend.dev — using verified store sender instead:',
        verifiedStoreFromAddress()
      );
    }
    return verifiedStoreFromAddress();
  }

  if (from) return from;
  if (process.env.EMAIL_USER) {
    return `"${STORE_NAME}" <${String(process.env.EMAIL_USER).trim()}>`;
  }
  return `"${STORE_NAME}" <onboarding@resend.dev>`;
}

function buildSmtpOptions() {
  const host = String(process.env.EMAIL_HOST || 'smtp.gmail.com').trim();
  const onRailway = isRailwayHost();
  let port = Number(process.env.EMAIL_PORT) || 587;

  // Railway often blocks outbound 587; Gmail SSL on 465 is more reliable in production.
  if (onRailway && /gmail\.com/i.test(host) && port === 587) {
    port = 465;
  }

  const secure = port === 465 || String(process.env.EMAIL_SECURE || '').toLowerCase() === 'true';

  return {
    host,
    port,
    secure,
    requireTLS: !secure,
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 45_000,
    tls: { minVersion: 'TLSv1.2' },
    auth: {
      user: process.env.EMAIL_USER,
      pass: emailPassword()
    }
  };
}

function getTransport() {
  if (!isSmtpConfigured()) {
    return null;
  }
  return nodemailer.createTransport(buildSmtpOptions());
}

async function sendViaResend({ to, subject, text, html, idempotencyKey }) {
  const apiKey = resendApiKey();
  if (!apiKey) return null;

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
  if (idempotencyKey) {
    headers['Idempotency-Key'] = String(idempotencyKey).slice(0, 256);
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      from: emailFromAddress(),
      to: [to],
      subject,
      html: html || `<div>${escapeHtml(text).replace(/\n/g, '<br/>')}</div>`,
      text
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.message || body?.error || `Resend HTTP ${response.status}`;
    throw new Error(message);
  }
  return { sent: true, id: body?.id };
}

async function sendViaSmtp({ to, subject, text, html }, attempt = 1) {
  const transport = getTransport();
  if (!transport) {
    return { skipped: true, reason: 'smtp_not_configured' };
  }

  try {
    await transport.sendMail({
      from: emailFromAddress(),
      to,
      subject,
      text,
      html: html || text
    });
    return { sent: true };
  } catch (err) {
    const retryable = /timeout|ETIMEDOUT|ECONNECTION|ECONRESET|socket|closed/i.test(
      String(err?.message || err)
    );
    if (retryable && attempt < 2) {
      await sleep(1500 * attempt);
      return sendViaSmtp({ to, subject, text, html }, attempt + 1);
    }
    throw err;
  } finally {
    try {
      transport.close();
    } catch {
      /* ignore */
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call on server start — logs whether order emails can be sent.
 */
async function verifyEmailOnStartup() {
  const adminEmail = getAdminEmail();
  if (!adminEmail) {
    console.warn('[email] ADMIN_EMAIL is not set — admin order alerts will be skipped.');
  }

  if (!isEmailConfigured()) {
    console.warn(
      '[email] Order emails DISABLED — set RESEND_API_KEY + EMAIL_FROM on Railway, or EMAIL_HOST/USER/PASS locally'
    );
    return { ok: false, reason: 'not_configured' };
  }

  if (usesResend()) {
    console.log(
      `[email] Resend API ready — from ${emailFromAddress()} → admin ${adminEmail || '(no ADMIN_EMAIL)'}`
    );
    if (isRailwayHost()) {
      console.log('[email] Production email via HTTPS (Railway blocks Gmail SMTP ports)');
    }
    return { ok: true, provider: 'resend' };
  }

  if (isRailwayHost()) {
    console.error(
      '[email] Railway blocks Gmail SMTP — add RESEND_API_KEY and EMAIL_FROM in Railway Variables (see railway.env.example)'
    );
    return { ok: false, reason: 'railway_smtp_blocked' };
  }

  const transport = getTransport();
  try {
    await Promise.race([
      transport.verify(),
      sleep(12_000).then(() => {
        throw new Error('SMTP verify timeout');
      })
    ]);
    console.log(
      `[email] SMTP ready — customer confirmations + admin alerts to ${adminEmail || '(no ADMIN_EMAIL)'}`
    );
    return { ok: true };
  } catch (err) {
    console.error('[email] SMTP verification failed:', err.message);
    console.error(
      '[email] Fix EMAIL_PASS (use a Gmail App Password, not your login password) and restart the backend.'
    );
    return { ok: false, reason: err.message };
  } finally {
    try {
      transport?.close();
    } catch {
      /* ignore */
    }
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function primaryFrontendUrl() {
  return publicSiteUrl();
}

function getAdminEmail() {
  const admin = process.env.ADMIN_EMAIL && String(process.env.ADMIN_EMAIL).trim();
  if (admin) return admin;
  const fallback = process.env.EMAIL_USER && String(process.env.EMAIL_USER).trim();
  return fallback || '';
}

function deliveryLabel(option) {
  if (option === 'express') return 'Express (1–2 days)';
  if (option === 'nextday') return 'Next day';
  return 'Standard (3–5 days)';
}

function formatOrderDate(order) {
  const d = order.createdAt ? new Date(order.createdAt) : new Date();
  return d.toLocaleString('en-PK', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Karachi'
  });
}

function customerDisplayName(order, user, shippingOverride) {
  const addr = shippingOverride || order.shippingAddress || {};
  const fromShip = [addr.firstName, addr.lastName].filter(Boolean).join(' ').trim();
  if (fromShip) return fromShip;
  if (user?.name) return String(user.name).trim();
  return 'Customer';
}

function customerEmail(order, user, shippingOverride) {
  const addr = shippingOverride || order.shippingAddress || {};
  const ship = addr.email && String(addr.email).trim();
  if (ship && /\S+@\S+\.\S+/.test(ship)) return ship;
  const account = user?.email && String(user.email).trim();
  if (account && /\S+@\S+\.\S+/.test(account)) return account;
  const pay = order.paymentResult?.email_address && String(order.paymentResult.email_address).trim();
  if (pay && /\S+@\S+\.\S+/.test(pay)) return pay;
  return '';
}

function orderConfirmationRecipients(user, order, shippingOverride) {
  const checkoutEmail = customerEmail(order, user, shippingOverride);
  if (!checkoutEmail) return [];
  return [checkoutEmail];
}

function formatOrderLinesText(order) {
  const lines = Array.isArray(order.orderItems) ? order.orderItems : [];
  if (!lines.length) return '';
  return lines
    .map((line) => {
      const qty = Number(line.quantity) || 1;
      const price = Number(line.price) || 0;
      return `  • ${line.name} × ${qty} @ ${formatStoreMoney(price)} = ${formatStoreMoney(price * qty)}`;
    })
    .join('\n');
}

function buildOrderSummary(order, user, shippingOverride) {
  const id = String(order._id);
  const shortId = id.slice(-8).toUpperCase();
  const addr = shippingOverride || order.shippingAddress || {};
  const name = customerDisplayName(order, user, addr);
  const email = customerEmail(order, user, addr);
  const phone = addr.phone ? String(addr.phone).trim() : '';
  const shipBlock = [
    name,
    addr.street,
    [addr.city, addr.state, addr.zipCode].filter(Boolean).join(', '),
    addr.country,
    phone ? `Phone: ${phone}` : '',
    email ? `Email: ${email}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  const itemsPrice = Number(order.itemsPrice) || 0;
  const discount = Number(order.discountAmount) || 0;
  const shipping = Number(order.shippingPrice) || 0;
  const tax = Number(order.taxPrice) || 0;
  const total = Number(order.totalPrice) || 0;

  return {
    id,
    shortId,
    name,
    email,
    phone,
    shipBlock,
    orderDate: formatOrderDate(order),
    delivery: deliveryLabel(order.deliveryOption),
    paymentMethod: order.paymentMethod || '—',
    isPaid: Boolean(order.isPaid),
    paidLabel: order.isPaid ? 'Paid' : 'Payment pending',
    status: order.status || 'pending',
    itemsBlock: formatOrderLinesText(order),
    itemsPrice,
    discount,
    shipping,
    tax,
    total,
    notes: order.notes ? String(order.notes).trim() : '',
    stripeId: order.stripePaymentIntentId ? String(order.stripePaymentIntentId).trim() : '',
    txnId: order.paymentProof?.transactionId ? String(order.paymentProof.transactionId).trim() : '',
    proofUrl: order.paymentProof?.imageUrl ? String(order.paymentProof.imageUrl).trim() : ''
  };
}

function buildItemsTableHtml(order) {
  const lines = Array.isArray(order.orderItems) ? order.orderItems : [];
  if (!lines.length) {
    return '<p>No items recorded.</p>';
  }
  const rows = lines
    .map((line) => {
      const qty = Number(line.quantity) || 1;
      const price = Number(line.price) || 0;
      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;">${escapeHtml(line.name)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:center;">${qty}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right;">${escapeHtml(formatStoreMoney(price))}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right;">${escapeHtml(formatStoreMoney(price * qty))}</td>
      </tr>`;
    })
    .join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;">
    <thead>
      <tr style="background:#f7f7f7;">
        <th style="padding:8px 10px;text-align:left;">Product</th>
        <th style="padding:8px 10px;text-align:center;">Qty</th>
        <th style="padding:8px 10px;text-align:right;">Unit price</th>
        <th style="padding:8px 10px;text-align:right;">Line total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function buildTotalsHtml(summary) {
  const rows = [
    ['Subtotal', summary.itemsPrice],
    summary.discount > 0 ? ['Discount', -summary.discount] : null,
    ['Shipping', summary.shipping],
    summary.tax > 0 ? ['Tax', summary.tax] : null,
    ['Order total', summary.total]
  ].filter(Boolean);

  return rows
    .map(([label, amount], idx) => {
      const isTotal = idx === rows.length - 1;
      const style = isTotal
        ? 'font-weight:700;font-size:16px;color:#f97316;'
        : 'color:#444;';
      const display = amount < 0 && label === 'Discount'
        ? `−${formatStoreMoney(Math.abs(amount))}`
        : formatStoreMoney(amount);
      return `<tr>
        <td style="padding:6px 0;${style}">${escapeHtml(label)}</td>
        <td style="padding:6px 0;text-align:right;${style}">${escapeHtml(display)}</td>
      </tr>`;
    })
    .join('');
}

function buildOrderEmailHtml(order, user, { forAdmin = false, shippingOverride } = {}) {
  const s = buildOrderSummary(order, user, shippingOverride);
  const adminLink = `${primaryFrontendUrl()}/admin/orders/${s.id}`;
  const title = forAdmin ? 'New order received' : 'Order confirmed';
  const intro = forAdmin
    ? 'A customer placed a new order on your store. Full details are below.'
    : `Thank you for shopping with ${STORE_NAME}. We have received your order and will process it shortly.`;

  const extraAdmin = forAdmin
    ? `<p style="margin:16px 0;"><a href="${escapeHtml(adminLink)}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600;">View order in admin</a></p>`
    : '';

  const paymentExtra = [
    s.stripeId ? `Stripe payment ID: ${s.stripeId}` : '',
    s.txnId ? `Transaction ID: ${s.txnId}` : '',
    s.proofUrl ? `Payment proof: ${s.proofUrl}` : ''
  ]
    .filter(Boolean)
    .map((line) => `<p style="margin:4px 0;color:#555;font-size:13px;">${escapeHtml(line)}</p>`)
    .join('');

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;color:#111;">
  <div style="max-width:620px;margin:24px auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e8e8e8;">
    <div style="background:#111;color:#fff;padding:20px 24px;">
      <div style="font-size:22px;font-weight:700;">${escapeHtml(STORE_NAME)}</div>
      <div style="margin-top:6px;font-size:15px;opacity:0.9;">${escapeHtml(title)} — #${escapeHtml(s.shortId)}</div>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px;line-height:1.6;">Hi ${escapeHtml(forAdmin ? 'Admin' : s.name)},</p>
      <p style="margin:0 0 20px;line-height:1.6;color:#444;">${escapeHtml(intro)}</p>

      <table style="width:100%;margin-bottom:20px;font-size:14px;">
        <tr><td style="padding:4px 0;color:#666;width:140px;">Order ID</td><td style="padding:4px 0;"><strong>${escapeHtml(s.id)}</strong></td></tr>
        <tr><td style="padding:4px 0;color:#666;">Order date</td><td style="padding:4px 0;">${escapeHtml(s.orderDate)}</td></tr>
        <tr><td style="padding:4px 0;color:#666;">Status</td><td style="padding:4px 0;">${escapeHtml(s.status)}</td></tr>
        <tr><td style="padding:4px 0;color:#666;">Delivery</td><td style="padding:4px 0;">${escapeHtml(s.delivery)}</td></tr>
        <tr><td style="padding:4px 0;color:#666;">Payment</td><td style="padding:4px 0;">${escapeHtml(s.paymentMethod)} (${escapeHtml(s.paidLabel)})</td></tr>
        ${forAdmin ? `<tr><td style="padding:4px 0;color:#666;">Customer</td><td style="padding:4px 0;">${escapeHtml(s.name)} &lt;${escapeHtml(s.email)}&gt;</td></tr>` : ''}
        ${s.phone ? `<tr><td style="padding:4px 0;color:#666;">Phone</td><td style="padding:4px 0;">${escapeHtml(s.phone)}</td></tr>` : ''}
      </table>

      ${paymentExtra}

      <h3 style="margin:24px 0 10px;font-size:15px;">Items ordered</h3>
      ${buildItemsTableHtml(order)}

      <table style="width:100%;margin:18px 0 24px;">${buildTotalsHtml(s)}</table>

      <h3 style="margin:0 0 10px;font-size:15px;">Shipping address</h3>
      <p style="margin:0 0 16px;line-height:1.6;color:#444;white-space:pre-line;">${escapeHtml(s.shipBlock)}</p>

      ${s.notes ? `<h3 style="margin:0 0 10px;font-size:15px;">Order notes</h3><p style="margin:0 0 16px;line-height:1.6;color:#444;">${escapeHtml(s.notes)}</p>` : ''}

      ${extraAdmin}

      <p style="margin:24px 0 0;font-size:13px;color:#888;line-height:1.5;">
        ${forAdmin ? 'You are receiving this because you are the store admin.' : `Questions? Reply to this email or contact ${escapeHtml(STORE_NAME)} support.`}
      </p>
    </div>
  </div>
</body></html>`;
}

function buildOrderEmailText(order, user, { forAdmin = false, shippingOverride } = {}) {
  const s = buildOrderSummary(order, user, shippingOverride);
  const lines = [
    forAdmin ? 'NEW ORDER RECEIVED' : `${STORE_NAME} — ORDER CONFIRMED`,
    '',
    forAdmin ? 'A customer placed a new order.' : `Hi ${s.name}, thank you for your order.`,
    '',
    `Order ID: ${s.id}`,
    `Reference: #${s.shortId}`,
    `Order date: ${s.orderDate}`,
    `Status: ${s.status}`,
    `Delivery: ${s.delivery}`,
    `Payment: ${s.paymentMethod} (${s.paidLabel})`,
    forAdmin ? `Customer: ${s.name} <${s.email}>` : '',
    s.phone ? `Phone: ${s.phone}` : '',
    s.stripeId ? `Stripe payment ID: ${s.stripeId}` : '',
    s.txnId ? `Transaction ID: ${s.txnId}` : '',
    s.proofUrl ? `Payment proof: ${s.proofUrl}` : '',
    '',
    'Items:',
    s.itemsBlock,
    '',
    `Subtotal: ${formatStoreMoney(s.itemsPrice)}`,
    s.discount > 0 ? `Discount: −${formatStoreMoney(s.discount)}` : '',
    `Shipping: ${formatStoreMoney(s.shipping)}`,
    s.tax > 0 ? `Tax: ${formatStoreMoney(s.tax)}` : '',
    `Total: ${formatStoreMoney(s.total)}`,
    '',
    'Ship to:',
    s.shipBlock,
    s.notes ? `\nNotes: ${s.notes}` : '',
    forAdmin ? `\nAdmin: ${primaryFrontendUrl()}/admin/orders/${s.id}` : '',
    '',
    forAdmin
      ? 'Open the admin panel to update status or fulfil the order.'
      : order.isPaid
        ? 'We will email you when your order ships.'
        : 'Payment is pending — we will process your order after confirmation where required.'
  ].filter(Boolean);

  return lines.join('\n');
}

async function sendMail({ to, subject, text, html, idempotencyKey }) {
  if (!isEmailConfigured()) {
    console.warn('[email] Not configured — message not sent:', subject, '→', to);
    return { skipped: true, reason: 'not_configured' };
  }

  if (usesResend() || isRailwayHost()) {
    if (!usesResend()) {
      console.error('[email] Railway requires RESEND_API_KEY — Gmail SMTP is blocked on cloud hosts');
      return { skipped: true, reason: 'railway_smtp_blocked' };
    }
    try {
      await sendViaResend({ to, subject, text, html, idempotencyKey });
      console.log('[email] Sent via Resend:', subject, '→', to);
      return { sent: true };
    } catch (err) {
      console.error('[email] Resend failed:', subject, '→', to, '—', err.message);
      return { skipped: true, reason: err.message };
    }
  }

  try {
    await sendViaSmtp({ to, subject, text, html });
    console.log('[email] Sent via SMTP:', subject, '→', to);
    return { sent: true };
  } catch (err) {
    console.error('[email] Send failed:', subject, '→', to, '—', err.message);
    return { skipped: true, reason: err.message };
  }
}

function toPlainDoc(doc) {
  if (!doc) return null;
  if (typeof doc.toObject === 'function') {
    return doc.toObject({ virtuals: true, getters: true });
  }
  return { ...doc };
}

/**
 * Send customer confirmation + admin new-order alert for every completed order.
 */
async function sendOrderPlacedEmails(order, user, shippingOverride) {
  const customer = {
    name: customerDisplayName(order, user, shippingOverride),
    email: customerEmail(order, user, shippingOverride)
  };
  const [customerResult, adminResult] = await Promise.all([
    sendOrderConfirmationEmail(customer, order, shippingOverride),
    sendNewOrderAdminEmail(order, user, shippingOverride)
  ]);
  return { customerResult, adminResult };
}

/**
 * Schedule order emails after the HTTP response is sent (fast checkout + reliable delivery).
 * Delegates to the MongoDB-backed queue so each order sends at most once per recipient.
 */
function scheduleOrderPlacedEmails(order, user, shippingOverride, res) {
  const plainOrder = toPlainDoc(order);
  if (!plainOrder?._id) return;
  const { scheduleOrderEmailsFromResult } = require('../services/orderEmailDelivery');
  scheduleOrderEmailsFromResult({ populated: plainOrder, duplicate: false }, res);
}

/** Fire-and-forget for webhooks / jobs with no HTTP response object. */
function queueOrderPlacedEmails(order, user, shippingOverride) {
  scheduleOrderPlacedEmails(order, user, shippingOverride);
}

/**
 * @param {{ name: string, email: string }} user
 * @param {import('mongoose').Document} order
 */
async function sendOrderConfirmationEmail(user, order, shippingOverride) {
  const id = String(order._id);
  const shortId = id.slice(-8).toUpperCase();
  const recipients = orderConfirmationRecipients(user, order, shippingOverride);
  if (!recipients.length) {
    console.warn('[email] No checkout email for order confirmation', id);
    return { skipped: true };
  }

  const subject = `${STORE_NAME} — Order #${shortId} confirmed`;
  const text = buildOrderEmailText(order, user, { forAdmin: false, shippingOverride });
  const html = buildOrderEmailHtml(order, user, { forAdmin: false, shippingOverride });

  const results = [];
  for (const to of recipients) {
    results.push(
      await sendMail({
        to,
        subject,
        text,
        html,
        idempotencyKey: `bazaar-order-${id}-customer`
      })
    );
  }
  return results;
}

/**
 * Notify store admin of a new order with full A–Z details.
 */
async function sendNewOrderAdminEmail(order, user, shippingOverride) {
  const adminEmail = getAdminEmail();
  if (!adminEmail) {
    console.warn('[email] ADMIN_EMAIL not set — admin order alert skipped');
    return { skipped: true };
  }

  const shortId = String(order._id).slice(-8).toUpperCase();
  const subject = `${STORE_NAME} — New order #${shortId} received`;
  const text = buildOrderEmailText(order, user, { forAdmin: true, shippingOverride });
  const html = buildOrderEmailHtml(order, user, { forAdmin: true, shippingOverride });

  return sendMail({
    to: adminEmail,
    subject,
    text,
    html,
    idempotencyKey: `bazaar-order-${String(order._id)}-admin`
  });
}

function statusUpdateCopy(status, order) {
  const shortId = String(order._id).slice(-8).toUpperCase();
  const tn = order.trackingNumber && String(order.trackingNumber).trim();
  const cancelReason = order.cancelReason && String(order.cancelReason).trim();

  const byStatus = {
    pending: {
      subject: `${STORE_NAME} — Order #${shortId} received`,
      headline: 'We have received your order',
      message:
        'Thank you for shopping with us. Your order is in our queue and we will begin preparing your parcel shortly.'
    },
    processing: {
      subject: `${STORE_NAME} — Order #${shortId} — Your parcel is ready`,
      headline: 'Your parcel is ready!',
      message:
        'Good news — your order has been processed and your parcel is ready for dispatch. We will notify you as soon as it is handed to the courier.'
    },
    shipped: {
      subject: `${STORE_NAME} — Order #${shortId} is on the way`,
      headline: 'Your order is on the way',
      message: tn
        ? `Your parcel has been shipped. Please use tracking number ${tn} to follow your delivery.`
        : 'Your parcel has been shipped and is on its way to your delivery address.'
    },
    delivered: {
      subject: `${STORE_NAME} — Order #${shortId} delivered`,
      headline: 'Delivered successfully',
      message:
        'Your order has been delivered. We hope you enjoy your purchase — thank you for choosing Bazaar.'
    },
    cancelled: {
      subject: `${STORE_NAME} — Order #${shortId} cancelled`,
      headline: 'Order cancelled',
      message: cancelReason
        ? `Your order has been cancelled. Reason: ${cancelReason}. If payment was received, a refund will be processed according to our policy.`
        : 'Your order has been cancelled. If payment was received, a refund will be processed according to our policy.'
    },
    flagged: {
      subject: `${STORE_NAME} — Order #${shortId} under review`,
      headline: 'Order under review',
      message:
        'Your order is temporarily under review for verification. We will email you again once it is cleared for processing — usually within one business day.'
    },
    rejected: {
      subject: `${STORE_NAME} — Order #${shortId} could not be processed`,
      headline: 'Order could not be processed',
      message:
        'We were unable to fulfil this order. If any payment was captured, a refund will be issued in line with our refund policy.'
    }
  };

  return (
    byStatus[status] || {
      subject: `${STORE_NAME} — Order #${shortId} status updated`,
      headline: 'Order status updated',
      message: `Your order status is now: ${statusLabel(status)}.`
    }
  );
}

function statusLabel(status) {
  const labels = {
    pending: 'Pending',
    processing: 'Processing',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
    flagged: 'Under review',
    rejected: 'Rejected'
  };
  return labels[status] || String(status || 'updated');
}

function buildOrderStatusUpdateHtml(order, user, previousStatus) {
  const s = buildOrderSummary(order, user);
  const copy = statusUpdateCopy(order.status, order);
  const ordersUrl = `${primaryFrontendUrl()}/account/orders`;
  const tn = order.trackingNumber && String(order.trackingNumber).trim();

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;color:#111;">
  <div style="max-width:620px;margin:24px auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e8e8e8;">
    <div style="background:#111;color:#fff;padding:20px 24px;">
      <div style="font-size:22px;font-weight:700;">${escapeHtml(STORE_NAME)}</div>
      <div style="margin-top:6px;font-size:15px;opacity:0.9;">Order update — #${escapeHtml(s.shortId)}</div>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 8px;line-height:1.6;">Dear ${escapeHtml(s.name)},</p>
      <h2 style="margin:0 0 12px;font-size:20px;color:#ea580c;">${escapeHtml(copy.headline)}</h2>
      <p style="margin:0 0 20px;line-height:1.65;color:#444;">${escapeHtml(copy.message)}</p>

      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:16px 18px;margin-bottom:20px;">
        <table style="width:100%;font-size:14px;">
          <tr><td style="padding:4px 0;color:#666;width:130px;">Order reference</td><td style="padding:4px 0;"><strong>#${escapeHtml(s.shortId)}</strong></td></tr>
          <tr><td style="padding:4px 0;color:#666;">Previous status</td><td style="padding:4px 0;">${escapeHtml(statusLabel(previousStatus))}</td></tr>
          <tr><td style="padding:4px 0;color:#666;">Current status</td><td style="padding:4px 0;font-weight:700;color:#ea580c;">${escapeHtml(statusLabel(order.status))}</td></tr>
          <tr><td style="padding:4px 0;color:#666;">Order total</td><td style="padding:4px 0;">${escapeHtml(formatStoreMoney(s.total))}</td></tr>
          <tr><td style="padding:4px 0;color:#666;">Delivery</td><td style="padding:4px 0;">${escapeHtml(s.delivery)}</td></tr>
          ${tn ? `<tr><td style="padding:4px 0;color:#666;">Tracking</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(tn)}</td></tr>` : ''}
        </table>
      </div>

      <h3 style="margin:0 0 10px;font-size:15px;">Items in your order</h3>
      ${buildItemsTableHtml(order)}

      <p style="margin:20px 0;">
        <a href="${escapeHtml(ordersUrl)}" style="display:inline-block;background:#ea580c;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;">View my orders</a>
      </p>

      <p style="margin:0;font-size:13px;color:#888;line-height:1.5;">
        Questions about your delivery? Reply to this email or contact ${escapeHtml(STORE_NAME)} customer support.
      </p>
    </div>
  </div>
</body></html>`;
}

function buildOrderStatusUpdateText(order, user, previousStatus) {
  const s = buildOrderSummary(order, user);
  const copy = statusUpdateCopy(order.status, order);
  const tn = order.trackingNumber && String(order.trackingNumber).trim();
  return [
    `Dear ${s.name},`,
    '',
    copy.headline.toUpperCase(),
    '',
    copy.message,
    '',
    `Order reference: #${s.shortId}`,
    `Previous status: ${statusLabel(previousStatus)}`,
    `Current status: ${statusLabel(order.status)}`,
    `Order total: ${formatStoreMoney(s.total)}`,
    `Delivery: ${s.delivery}`,
    tn ? `Tracking number: ${tn}` : '',
    '',
    'Items:',
    s.itemsBlock,
    '',
    `View your orders: ${primaryFrontendUrl()}/account/orders`,
    '',
    `Thank you for shopping with ${STORE_NAME}.`
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Professional customer email when admin updates order status.
 * @param {{ name: string, email: string }} user
 * @param {import('mongoose').Document|object} order
 * @param {string} previousStatus
 */
async function sendOrderStatusUpdateEmail(user, order, previousStatus) {
  const id = String(order._id);
  const to = customerEmail(order, user) || user?.email;
  if (!to) {
    console.warn('[email] No customer email for status update', id);
    return { skipped: true, reason: 'no_email' };
  }

  const copy = statusUpdateCopy(order.status, order);
  const recipient = {
    name: customerDisplayName(order, user),
    email: to
  };

  return sendMail({
    to,
    subject: copy.subject,
    text: buildOrderStatusUpdateText(order, recipient, previousStatus),
    html: buildOrderStatusUpdateHtml(order, recipient, previousStatus),
    idempotencyKey: `bazaar-order-${id}-status-${previousStatus}-to-${order.status}`
  });
}

/**
 * @param {{ name: string, email: string }} user
 * @param {import('mongoose').Document} order
 */
async function sendOrderCancelledEmail(user, order) {
  const id = String(order._id);
  const subject = `${STORE_NAME} — Order cancelled (${id.slice(-8)})`;
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

  const to = customerEmail(order, user) || user.email;
  if (!to) return { skipped: true };

  return sendMail({
    to,
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
  const subject = `${STORE_NAME} — Your order has shipped (${id.slice(-8)})`;
  const text = [
    `Hi ${user.name},`,
    '',
    `Your order ${id} has shipped.`,
    tn ? `Tracking number: ${tn}` : '',
    '',
    `Thank you for shopping with ${STORE_NAME}.`
  ]
    .filter(Boolean)
    .join('\n');

  const to = customerEmail(order, user) || user.email;
  if (!to) return { skipped: true };

  return sendMail({
    to,
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
  const subject = `${STORE_NAME} — Payment could not be processed`;
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

  if (!user?.email) return { skipped: true };

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
    subject: `${STORE_NAME} — Fraud review required (order …${String(payload.orderId).slice(-8)})`,
    text,
    html: `<pre style="font-family:sans-serif">${text.replace(/</g, '&lt;')}</pre>`
  });
}

/**
 * Customer notice when order is held (payment captured, fulfilment paused).
 */
async function sendOrderHeldForFraudReviewEmail(user, order) {
  const id = String(order._id);
  const subject = `${STORE_NAME} — Order ${id.slice(-8)} is under review`;
  const text = [
    `Hi ${user.name},`,
    '',
    'Your payment was successful. Your order is temporarily on hold while we complete a quick security review.',
    'You will receive another email when it is released for processing — usually within one business day.',
    '',
    `Order reference: ${id}`
  ].join('\n');

  const to = customerEmail(order, user) || user?.email;
  if (!to) return { skipped: true };

  return sendMail({
    to,
    subject,
    text,
    html: `<p>${text.replace(/\n/g, '<br/>')}</p>`
  });
}

module.exports = {
  sendOrderPlacedEmails,
  scheduleOrderPlacedEmails,
  queueOrderPlacedEmails,
  sendOrderConfirmationEmail,
  sendNewOrderAdminEmail,
  customerEmail,
  customerDisplayName,
  sendOrderCancelledEmail,
  sendOrderStatusUpdateEmail,
  sendOrderShippedEmail,
  sendPaymentFailedEmail,
  sendFraudFlaggedAdminEmail,
  sendOrderHeldForFraudReviewEmail,
  sendMail,
  verifyEmailOnStartup,
  isEmailConfigured,
  getEmailProvider,
  emailFromAddress,
  getAdminEmail,
  toPlainDoc
};
