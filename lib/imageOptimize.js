const sharp = require('sharp');

const SKIP_FORMATS = new Set(['svg', 'gif']);

function readIntEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Compress & convert uploads to WebP before Cloudinary storage.
 * Targets ~50–120 KB for typical product photos (configurable via env).
 *
 * @param {Buffer} inputBuffer
 * @param {{ maxWidth?: number, maxBytes?: number, quality?: number }} [opts]
 * @returns {Promise<{ buffer: Buffer, optimized: boolean, format: string, bytes: number }>}
 */
async function optimizeImageToWebp(inputBuffer, opts = {}) {
  if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length === 0) {
    throw new Error('Invalid image buffer');
  }

  const maxWidth = opts.maxWidth ?? readIntEnv('IMAGE_MAX_WIDTH', 1400);
  const maxBytes = opts.maxBytes ?? readIntEnv('IMAGE_MAX_BYTES', 120000);
  let quality = opts.quality ?? readIntEnv('IMAGE_WEBP_QUALITY', 82);
  const minQuality = readIntEnv('IMAGE_WEBP_MIN_QUALITY', 52);

  if (process.env.IMAGE_OPTIMIZE === 'false') {
    return { buffer: inputBuffer, optimized: false, format: 'original', bytes: inputBuffer.length };
  }

  let meta;
  try {
    meta = await sharp(inputBuffer).metadata();
  } catch {
    return { buffer: inputBuffer, optimized: false, format: 'unknown', bytes: inputBuffer.length };
  }

  if (!meta.width || SKIP_FORMATS.has(String(meta.format || '').toLowerCase())) {
    return {
      buffer: inputBuffer,
      optimized: false,
      format: meta.format || 'unknown',
      bytes: inputBuffer.length
    };
  }

  if (inputBuffer.length <= maxBytes && meta.width <= maxWidth && meta.format === 'webp') {
    return { buffer: inputBuffer, optimized: false, format: 'webp', bytes: inputBuffer.length };
  }

  let best = null;

  while (quality >= minQuality) {
    const buffer = await sharp(inputBuffer)
      .rotate()
      .resize({
        width: maxWidth,
        height: maxWidth,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality, effort: 4, smartSubsample: true })
      .toBuffer();

    best = buffer;
    if (buffer.length <= maxBytes) {
      return { buffer, optimized: true, format: 'webp', bytes: buffer.length, quality };
    }
    quality -= 10;
  }

  const buffer =
    best ||
    (await sharp(inputBuffer)
      .rotate()
      .resize({ width: maxWidth, height: maxWidth, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: minQuality, effort: 4 })
      .toBuffer());

  return {
    buffer,
    optimized: true,
    format: 'webp',
    bytes: buffer.length,
    quality: Math.max(minQuality, quality)
  };
}

module.exports = { optimizeImageToWebp };
