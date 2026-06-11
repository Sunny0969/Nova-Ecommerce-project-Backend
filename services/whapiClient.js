/**
 * Whapi.cloud — forward website chat to your WhatsApp.
 * Env: WHAPI_API_TOKEN, WHAPI_ADMIN_CHAT_ID (e.g. 923001234567@c.us)
 */

const WHAPI_BASE = String(process.env.WHAPI_API_BASE || 'https://gate.whapi.cloud').replace(/\/$/, '');

function isConfigured() {
  return Boolean(
    String(process.env.WHAPI_API_TOKEN || '').trim() &&
      String(process.env.WHAPI_ADMIN_CHAT_ID || '').trim()
  );
}

function adminChatId() {
  const raw = String(
    process.env.WHAPI_ADMIN_CHAT_ID || process.env.WHATSAPP_SUPPORT_PHONE || '923483510584'
  ).trim();
  if (!raw) return '';
  if (raw.includes('@')) return raw;
  const digits = raw.replace(/\D/g, '');
  return digits ? `${digits}@c.us` : '';
}

function buildCustomerAlert({ sessionId, message, pageUrl }) {
  const lines = [
    '🛒 *Bazaar PK — Website Chat*',
    `Session: \`${sessionId}\``,
    pageUrl ? `Page: ${pageUrl}` : null,
    '—',
    message,
    '',
    '_Reply on WhatsApp with:_',
    '`(' + sessionId + ') your reply here`'
  ].filter(Boolean);
  return lines.join('\n');
}

async function sendTextToAdmin(body) {
  const token = String(process.env.WHAPI_API_TOKEN || '').trim();
  const to = adminChatId();
  if (!token || !to) {
    const err = new Error('WhatsApp API is not configured');
    err.code = 'WHAPI_NOT_CONFIGURED';
    throw err;
  }

  const res = await fetch(`${WHAPI_BASE}/messages/text`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ to, body })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Whapi error ${res.status}: ${text.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  return res.json().catch(() => ({}));
}

/**
 * Parse admin reply: "(sid_xxx) Hello customer"
 * @returns {{ sessionId: string, text: string } | null}
 */
function parseAdminReply(rawBody) {
  const body = String(rawBody || '').trim();
  if (!body) return null;

  const tagged = body.match(/^\((sid_[^)]+)\)\s*([\s\S]*)$/i);
  if (tagged) {
    return { sessionId: tagged[1].trim(), text: tagged[2].trim() || '…' };
  }

  const sessionLine = body.match(/Session:\s*`?(sid_[^\s`]+)`?/i);
  if (sessionLine && body.length > 20) {
    return null;
  }

  return null;
}

module.exports = {
  isConfigured,
  buildCustomerAlert,
  sendTextToAdmin,
  parseAdminReply
};
