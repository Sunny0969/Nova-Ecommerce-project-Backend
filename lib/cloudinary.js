const cloudinary = require('cloudinary').v2;

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

/**
 * Upload a single image buffer to Cloudinary.
 * @param {Buffer} buffer
 * @param {{ folder?: string }} [options]
 * @returns {Promise<{ url: string, public_id: string }>}
 */
function uploadImageBuffer(buffer, options = {}) {
  const folder = options.folder || 'nova-shop/categories';
  if (!ensureConfigured()) {
    return Promise.reject(
      new Error(
        'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.'
      )
    );
  }
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'image' },
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

async function deleteByPublicId(publicId) {
  if (!publicId || !ensureConfigured()) return;
  await cloudinary.uploader.destroy(publicId);
}

module.exports = {
  ensureConfigured,
  uploadImageBuffer,
  deleteByPublicId
};
