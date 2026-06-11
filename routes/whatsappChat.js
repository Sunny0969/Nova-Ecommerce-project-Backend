const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  isConfigured,
  buildCustomerAlert,
  sendTextToAdmin,
  parseAdminReply
} = require('../services/whapiClient');
const { rememberSession, resolveSessionFromReply, emitAdminReply } = require('../lib/whatsappSocket');

const router = express.Router();

const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many messages. Please wait a moment.' }
});

/** GET — frontend can check if live relay is available */
router.get('/status', (req, res) => {
  res.json({
    success: true,
    data: {
      whapiConfigured: isConfigured(),
      liveRelay: isConfigured()
    }
  });
});

/** POST /api/chat/send-to-whatsapp */
router.post('/send-to-whatsapp', sendLimiter, async (req, res) => {
  const message = String(req.body?.message || '').trim();
  const sessionId = String(req.body?.sessionId || '').trim();
  const pageUrl = String(req.body?.pageUrl || '').trim();

  if (!message || message.length > 2000) {
    return res.status(400).json({ success: false, message: 'Invalid message' });
  }
  if (!sessionId.startsWith('sid_')) {
    return res.status(400).json({ success: false, message: 'Invalid session' });
  }

  if (!isConfigured()) {
    try {
      const { sendWebsiteChatAlertEmail } = require('../services/websiteChatNotify');
      await sendWebsiteChatAlertEmail({ sessionId, message, pageUrl });
      rememberSession(sessionId);
      return res.json({
        success: true,
        data: { delivered: 'email', liveRelay: false }
      });
    } catch (err) {
      console.error('[whatsapp-chat] email fallback failed:', err.message);
      return res.status(503).json({
        success: false,
        code: 'RELAY_UNAVAILABLE',
        message: 'Could not deliver your message. Use Direct WhatsApp below.'
      });
    }
  }

  try {
    rememberSession(sessionId);
    const body = buildCustomerAlert({ sessionId, message, pageUrl });
    await sendTextToAdmin(body);

    return res.json({ success: true, data: { delivered: true } });
  } catch (err) {
    console.error('[whatsapp-chat] send failed:', err.message);
    return res.status(err.status || 500).json({
      success: false,
      message: 'Could not forward to WhatsApp. Try again or use direct WhatsApp.'
    });
  }
});

/** POST /api/chat/whatsapp-webhook — Whapi incoming messages */
router.post('/whatsapp-webhook', express.json({ type: ['application/json', 'application/*+json'] }), (req, res) => {
  const io = req.app.get('io');
  const payload = req.body || {};

  const candidates = [];
  if (Array.isArray(payload.messages)) candidates.push(...payload.messages);
  else if (payload.message) candidates.push(payload.message);
  else candidates.push(payload);

  for (const msg of candidates) {
    if (!msg || typeof msg !== 'object') continue;

    const fromMe = msg.from_me === true || msg.fromMe === true;
    if (!fromMe) continue;

    const textBody =
      msg.text?.body ||
      msg.text?.message ||
      (typeof msg.text === 'string' ? msg.text : '') ||
      msg.body ||
      '';

    const direct = parseAdminReply(textBody);
    const resolved = direct || resolveSessionFromReply(textBody);
    if (!resolved?.sessionId || !resolved.text) continue;

    emitAdminReply(io, resolved.sessionId, resolved.text);
  }

  res.sendStatus(200);
});

module.exports = router;
