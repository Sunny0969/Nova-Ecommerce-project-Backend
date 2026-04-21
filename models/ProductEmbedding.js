const mongoose = require('mongoose');

/**
 * Stores OpenAI embeddings for semantic search.
 * We keep this separate from Product to avoid bloating product documents.
 */
const productEmbeddingSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      unique: true,
      index: true
    },
    /** 1536-dim vector from text-embedding-3-small */
    embedding: {
      type: [Number],
      required: true,
      validate: {
        validator: (v) => Array.isArray(v) && v.length === 1536,
        message: 'embedding must be an array of 1536 numbers'
      }
    },
    /** For debugging/maintenance */
    model: {
      type: String,
      default: 'text-embedding-3-small'
    }
  },
  { timestamps: true }
);

productEmbeddingSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('ProductEmbedding', productEmbeddingSchema);

