const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const { optimizeImageToWebp } = require('./imageOptimize');

function ensureConfigured() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } =
    process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    return false;
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET
  });
  return true;
}

function uploadBufferToCloudinary(buffer, options = {}) {
  const folder = options.folder || 'nova-shop/categories';
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        format: 'webp'
      },
      (err, result) => {
        if (err) {
          reject(err);
          return;
        }
        resolve({
          url: result.secure_url,
          public_id: result.public_id
        });
      }
    );
    stream.end(buffer);
  });
}

/**
 * Upload a single image buffer to Cloudinary (Sharp → WebP compress first).
 * @param {Buffer} buffer
 * @param {{ folder?: string, skipOptimize?: boolean }} [options]
 * @returns {Promise<{ url: string, public_id: string }>}
 */
async function uploadImageBuffer(buffer, options = {}) {
  if (!ensureConfigured()) {
    return Promise.reject(
      new Error(
        'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.'
      )
    );
  }

  let payload = buffer;
  if (!options.skipOptimize) {
    try {
      const optimized = await optimizeImageToWebp(buffer);
      payload = optimized.buffer;
      if (optimized.optimized && process.env.NODE_ENV !== 'production') {
        console.log(
          `[image] optimized → webp ${Math.round(optimized.bytes / 1024)}KB` +
            (optimized.quality ? ` q=${optimized.quality}` : '')
        );
      }
    } catch (err) {
      console.warn('[image] optimize skipped:', err.message);
    }
  }

  return uploadBufferToCloudinary(payload, options);
}

async function deleteByPublicId(publicId) {
  if (!publicId || !ensureConfigured()) return;
  await cloudinary.uploader.destroy(publicId);
}

/**
 * Upload an image file from disk to Cloudinary.
 * @param {string} filePath
 * @param {{ folder?: string }} [options]
 */
async function uploadImageFile(filePath, options = {}) {
  if (!ensureConfigured()) {
    return Promise.reject(
      new Error(
        'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.'
      )
    );
  }

  const raw = await fs.promises.readFile(filePath);
  return uploadImageBuffer(raw, options);
}

module.exports = {
  ensureConfigured,
  uploadImageBuffer,
  uploadImageFile,
  deleteByPublicId
};
