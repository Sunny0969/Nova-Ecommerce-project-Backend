const { sendMail, getAdminEmail, isEmailConfigured } = require('../lib/email');

function supportPhoneDigits() {
  const raw = String(
    process.env.WHATSAPP_SUPPORT_PHONE || process.env.WHAPI_ADMIN_CHAT_ID || '923483510584'
  ).trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('92')) return digits;
  if (digits.startsWith('0')) return `92${digits.slice(1)}`;
  return digits || '923483510584';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * When Whapi is not configured, notify store admin by email so chat is not lost.
 */
async function sendWebsiteChatAlertEmail({ sessionId, message, pageUrl }) {
  if (!isEmailConfigured()) {
    const err = new Error('Email is not configured');
    err.code = 'EMAIL_NOT_CONFIGURED';
    throw err;
  }

  const admin = getAdminEmail();
  if (!admin) {
    const err = new Error('Admin email is not configured');
    err.code = 'EMAIL_NOT_CONFIGURED';
    throw err;
  }

  const phone = supportPhoneDigits();
  const waReplyHint = `(${sessionId}) your reply here`;
  const subject = `[Bazaar Chat] Customer message — ${sessionId}`;
  const text = [
    'New website chat message',
    '',
    `Session: ${sessionId}`,
    pageUrl ? `Page: ${pageUrl}` : null,
    '',
    'Message:',
    message,
    '',
    `Customer WhatsApp: +${phone}`,
    'When Whapi is connected, reply on WhatsApp with:',
    waReplyHint
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <h2>Bazaar — website chat message</h2>
    <p><strong>Session:</strong> ${escapeHtml(sessionId)}</p>
    ${pageUrl ? `<p><strong>Page:</strong> <a href="${escapeHtml(pageUrl)}">${escapeHtml(pageUrl)}</a></p>` : ''}
    <p><strong>Message:</strong></p>
    <blockquote style="border-left:4px solid #25D366;padding:8px 12px;margin:12px 0;background:#f6f6f6;">
      ${escapeHtml(message).replace(/\n/g, '<br/>')}
    </blockquote>
    <p>Customer WhatsApp: <strong>+${escapeHtml(phone)}</strong></p>
    <p style="color:#666;font-size:13px;">Whapi reply format: <code>${escapeHtml(waReplyHint)}</code></p>
  `;

  await sendMail({ to: admin, subject, text, html });
  return true;
}

module.exports = {
  sendWebsiteChatAlertEmail,
  supportPhoneDigits
};
