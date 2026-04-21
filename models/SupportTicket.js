const mongoose = require('mongoose');

const ticketMessageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant', 'tool', 'system'], required: true },
    content: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now }
  },
  { _id: false }
);

const supportTicketSchema = new mongoose.Schema(
  {
    ticketId: { type: String, required: true, unique: true, index: true },
    email: { type: String, trim: true, lowercase: true, required: true, maxlength: 200 },
    issue: { type: String, trim: true, required: true, maxlength: 2000 },
    chatHistory: { type: [ticketMessageSchema], default: () => [] },
    status: {
      type: String,
      enum: ['open', 'pending', 'resolved', 'closed'],
      default: 'open',
      index: true
    },
    assignedTo: { type: String, trim: true, default: '' }
  },
  { timestamps: true }
);

supportTicketSchema.index({ createdAt: -1 });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);

