(function initChatbotImpl() {
  if (global.__nova_chatbot_router) {
    module.exports = global.__nova_chatbot_router;
    return;
  }

  const express = require('express');
  const mongoose = require('mongoose');
  const OpenAI = require('openai');

  const Order = require('../models/Order');
  const Product = require('../models/Product');
  const ChatSession = require('../models/ChatSession');
  const SupportTicket = require('../models/SupportTicket');
  const { hybridSearch } = require('../services/aiSearch');
  const policies = require('../config/policies');

  const router = express.Router();

  function ok(res, data, status = 200, extra = {}) {
    res.status(status).json({ success: true, data, ...extra });
  }

  function fail(res, status, message, errors) {
    const body = { success: false, message };
    if (errors && Object.keys(errors).length) body.errors = errors;
    res.status(status).json(body);
  }

  function getOpenAI() {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return null;
    return new OpenAI({ apiKey: key });
  }

  function normalizeHistory(history) {
    if (!Array.isArray(history)) return [];
    const out = [];
    for (const m of history) {
      if (!m || typeof m !== 'object') continue;
      const role = String(m.role || '').trim();
      const content = m.content != null ? String(m.content) : '';
      if (!['user', 'assistant', 'tool', 'system'].includes(role)) continue;
      if (!content.trim() && role !== 'tool') continue;
      out.push({ role, content });
      if (out.length >= 20) break;
    }
    return out;
  }

  function buildSystemPrompt() {
    return `
You are Nova, the friendly AI assistant for Nova Shop.

You help with: orders, products, shipping, returns, account issues.
You are: helpful, concise, professional, empathetic.

Store policies (ground truth):
- Shipping policy:
${policies.shippingPolicy}

- Return policy:
${policies.returnPolicy}

Rules:
- Never make up order details. If user asks about an order, call getOrderStatus(orderId).
- Never claim an item is in stock unless checkProductStock() confirms it.
- If you cannot help or user needs a human, ask for their email and use escalateToHuman(issue,email).
- Keep answers short unless user asks for detail.

Output format:
Return ONLY valid JSON with keys:
{ "reply": string, "suggestedActions": string[], "escalated": boolean }
`.trim();
  }

  async function getOrderStatus({ orderId, userId }) {
    const id = String(orderId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return { ok: false, error: 'Invalid order id format' };
    }

    const order = await Order.findById(id)
      .select('status isPaid paidAt trackingNumber createdAt totalPrice user')
      .lean();
    if (!order) return { ok: false, error: 'Order not found' };

    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      if (String(order.user) !== String(userId)) {
        return { ok: false, error: 'Order not found for this account' };
      }
    }

    return {
      ok: true,
      order: {
        id: String(order._id),
        status: order.status,
        isPaid: Boolean(order.isPaid),
        paidAt: order.paidAt,
        trackingNumber: order.trackingNumber || '',
        createdAt: order.createdAt,
        totalPrice: order.totalPrice
      }
    };
  }

  async function checkProductStock({ productName }) {
    const q = String(productName || '').trim();
    if (!q) return { ok: false, error: 'Missing productName' };

    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const rows = await Product.find({ isPublished: true, name: rx })
      .select('name slug stock price')
      .sort({ stock: -1 })
      .limit(5)
      .lean();

    return {
      ok: true,
      matches: rows.map((p) => ({
        name: p.name,
        slug: p.slug,
        stock: Number(p.stock) || 0,
        price: Number(p.price) || 0
      }))
    };
  }

  function getShippingPolicy() {
    return { ok: true, text: policies.shippingPolicy };
  }

  function getReturnPolicy() {
    return { ok: true, text: policies.returnPolicy };
  }

  async function searchProducts({ query }) {
    const q = String(query || '').trim();
    if (!q) return { ok: true, results: [] };
    const result = await hybridSearch({
      query: q,
      limit: 10,
      semanticWeight: 0.6,
      keywordWeight: 0.4
    });
    const ids = result.items.map((x) => x.productId).filter(Boolean);
    const rows = ids.length
      ? await Product.find({ _id: { $in: ids }, isPublished: true })
          .select('name slug price stock')
          .lean()
      : [];
    const byId = new Map(rows.map((r) => [String(r._id), r]));
    const ordered = ids.map((id) => byId.get(String(id))).filter(Boolean);
    return {
      ok: true,
      results: ordered.map((p) => ({
        name: p.name,
        slug: p.slug,
        price: Number(p.price) || 0,
        inStock: (Number(p.stock) || 0) > 0
      }))
    };
  }

  async function escalateToHuman({ issue, email, sessionId }) {
    const e = String(email || '').trim().toLowerCase();
    const i = String(issue || '').trim();
    const sid = String(sessionId || '').trim();
    if (!e || !/^\S+@\S+\.\S+$/.test(e)) return { ok: false, error: 'Valid email is required' };
    if (!i) return { ok: false, error: 'Issue is required' };
    if (!sid) return { ok: false, error: 'sessionId is required' };

    const session = await ChatSession.findOne({ sessionId: sid }).lean();
    const ticketId = `TCK-${Math.random().toString(36).slice(2, 8).toUpperCase()}-${Date.now()
      .toString(36)
      .slice(-4)
      .toUpperCase()}`;

    const ticket = await SupportTicket.create({
      ticketId,
      email: e,
      issue: i.slice(0, 2000),
      chatHistory: Array.isArray(session?.messages) ? session.messages.slice(-50) : [],
      status: 'open',
      assignedTo: ''
    });

    await ChatSession.findOneAndUpdate(
      { sessionId: sid },
      { $set: { escalatedToEmail: e, resolved: false } }
    );

    return { ok: true, ticketId: ticket.ticketId, id: String(ticket._id) };
  }

  function buildTools() {
    return [
      {
        type: 'function',
        function: {
          name: 'getOrderStatus',
          description: 'Fetch an order status and tracking number by orderId.',
          parameters: {
            type: 'object',
            properties: { orderId: { type: 'string' } },
            required: ['orderId']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'checkProductStock',
          description: 'Check product stock by approximate product name.',
          parameters: {
            type: 'object',
            properties: { productName: { type: 'string' } },
            required: ['productName']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'getShippingPolicy',
          description: 'Return the shipping policy text.',
          parameters: { type: 'object', properties: {} }
        }
      },
      {
        type: 'function',
        function: {
          name: 'getReturnPolicy',
          description: 'Return the return policy text.',
          parameters: { type: 'object', properties: {} }
        }
      },
      {
        type: 'function',
        function: {
          name: 'searchProducts',
          description: 'Search products using semantic + keyword hybrid search.',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'escalateToHuman',
          description: 'Create a support ticket for human follow-up.',
          parameters: {
            type: 'object',
            properties: {
              issue: { type: 'string' },
              email: { type: 'string' }
            },
            required: ['issue', 'email']
          }
        }
      }
    ];
  }

  async function runTool(name, args, ctx) {
    switch (name) {
      case 'getOrderStatus':
        return getOrderStatus({ orderId: args.orderId, userId: ctx.userId });
      case 'checkProductStock':
        return checkProductStock({ productName: args.productName });
      case 'getShippingPolicy':
        return getShippingPolicy();
      case 'getReturnPolicy':
        return getReturnPolicy();
      case 'searchProducts':
        return searchProducts({ query: args.query });
      case 'escalateToHuman':
        return escalateToHuman({ issue: args.issue, email: args.email, sessionId: ctx.sessionId });
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  }

  router.post('/message', async (req, res) => {
    try {
      const client = getOpenAI();
      if (!client) return fail(res, 503, 'OPENAI_API_KEY is not configured');

      const b = req.body || {};
      const sessionId = b.sessionId != null ? String(b.sessionId).trim().slice(0, 200) : '';
      const message = b.message != null ? String(b.message).trim().slice(0, 2000) : '';
      const userId = b.userId != null ? String(b.userId).trim() : '';

      const errors = {};
      if (!sessionId) errors.sessionId = 'Required';
      if (!message) errors.message = 'Required';
      if (Object.keys(errors).length) return fail(res, 400, 'Invalid request', errors);

      const existing = await ChatSession.findOne({ sessionId }).lean();
      if (!existing) {
        await ChatSession.create({
          sessionId,
          userId: userId && mongoose.Types.ObjectId.isValid(userId) ? userId : null,
          messages: []
        });
      } else if (!existing.userId && userId && mongoose.Types.ObjectId.isValid(userId)) {
        await ChatSession.findOneAndUpdate({ sessionId }, { $set: { userId } });
      }

      const historyFromReq = normalizeHistory(b.conversationHistory);
      const stored = existing?.messages
        ? existing.messages.slice(-20).map((m) => ({ role: m.role, content: m.content }))
        : [];
      const convo = (historyFromReq.length ? historyFromReq : stored).slice(-20);

      const messages = [
        { role: 'system', content: buildSystemPrompt() },
        ...convo,
        { role: 'user', content: message }
      ];

      await ChatSession.findOneAndUpdate(
        { sessionId },
        { $push: { messages: { role: 'user', content: message, timestamp: new Date() } } }
      );

      const tools = buildTools();
      const ctx = { sessionId, userId };

      let toolUsedEscalate = false;
      let finalText = '';
      let working = messages;

      for (let step = 0; step < 4; step += 1) {
        const r = await client.chat.completions.create({
          model: process.env.CHATBOT_MODEL || 'gpt-4o',
          temperature: 0.4,
          messages: working,
          tools
        });

        const choice = r.choices?.[0];
        const msg = choice?.message;
        const toolCalls = msg?.tool_calls || [];

        if (toolCalls.length) {
          working = [...working, { role: 'assistant', content: msg.content || '', tool_calls: toolCalls }];
          for (const tc of toolCalls) {
            const name = tc.function?.name;
            let args = {};
            try {
              args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
            } catch {
              args = {};
            }
            if (name === 'escalateToHuman') toolUsedEscalate = true;
            const result = await runTool(name, args, ctx);
            working = [...working, { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) }];
          }
          continue;
        }

        finalText = msg?.content || '';
        break;
      }

      let payload = null;
      try {
        payload = JSON.parse(finalText);
      } catch {
        payload = null;
      }

      const reply =
        payload && typeof payload.reply === 'string'
          ? payload.reply
          : String(finalText || 'Sorry — I had trouble answering that. Could you rephrase?').trim();
      const suggestedActions =
        payload && Array.isArray(payload.suggestedActions)
          ? payload.suggestedActions.map(String).filter(Boolean).slice(0, 6)
          : [];
      const escalated = Boolean(payload?.escalated) || toolUsedEscalate;

      await ChatSession.findOneAndUpdate(
        { sessionId },
        { $push: { messages: { role: 'assistant', content: reply, timestamp: new Date() } } }
      );

      return ok(res, { reply, suggestedActions, escalated });
    } catch (error) {
      console.error('Chatbot message error:', error);
      return fail(res, 500, error.message || 'Chatbot failed');
    }
  });

  global.__nova_chatbot_router = router;
  module.exports = router;
})();

