const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant', 'tool', 'system'], required: true },
    content: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now }
  },
  { _id: false }
);

const chatSessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true, trim: true, maxlength: 200 },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    messages: { type: [messageSchema], default: () => [] },
    resolved: { type: Boolean, default: false, index: true },
    escalatedToEmail: { type: String, trim: true, lowercase: true, default: '' }
  },
  { timestamps: true }
);

chatSessionSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('ChatSession', chatSessionSchema);

