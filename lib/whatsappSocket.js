/** Socket.io rooms for live WhatsApp chat relay */

const lastSessionByAdmin = new Map();

function chatRoom(sessionId) {
  return `chat:${sessionId}`;
}

function initWhatsAppSocket(io) {
  io.on('connection', (socket) => {
    socket.on('join_chat_session', (payload) => {
      const sessionId = String(payload?.sessionId || '').trim();
      if (!sessionId.startsWith('sid_')) return;
      socket.join(chatRoom(sessionId));
      socket.data.chatSessionId = sessionId;
    });

    socket.on('disconnect', () => {
      /* session room membership cleared automatically */
    });
  });
}

function rememberSession(sessionId) {
  if (sessionId) lastSessionByAdmin.set('default', sessionId);
}

function resolveSessionFromReply(body) {
  const { parseAdminReply } = require('../services/whapiClient');
  const parsed = parseAdminReply(body);
  if (parsed?.sessionId) return parsed;

  const fallback = lastSessionByAdmin.get('default');
  if (fallback && body && !body.includes('Session:')) {
    return { sessionId: fallback, text: String(body).trim() };
  }
  return null;
}

function emitAdminReply(io, sessionId, text) {
  if (!io || !sessionId || !text) return false;
  io.to(chatRoom(sessionId)).emit('admin_whatsapp_reply', { text, sessionId });
  return true;
}

module.exports = {
  initWhatsAppSocket,
  rememberSession,
  resolveSessionFromReply,
  emitAdminReply
};
