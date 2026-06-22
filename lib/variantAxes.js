/**
 * Product variant axes (color / shape / size): sanitize, legacy flat fields, image public_ids.
 */

const AXES = ['color', 'shape', 'size'];
const MAX_OPTIONS_PER_AXIS = 16;

function emptyAxis() {
  return { enabled: false, selectionMode: 'single', options: [] };
}

function sanitizeOptions(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .slice(0, MAX_OPTIONS_PER_AXIS)
    .map((o) => {
      const label = String(o?.label ?? '')
        .trim()
        .slice(0, 80);
      const url = o?.image?.url != null ? String(o.image.url).trim().slice(0, 2048) : '';
      const public_id = o?.image?.public_id != null ? String(o.image.public_id).trim().slice(0, 512) : '';
      const image =
        url && public_id
          ? { url, public_id }
          : url
            ? { url, public_id: '' }
            : public_id
              ? { url: '', public_id }
              : { url: '', public_id: '' };
      const out = { label, image };
      if (o?.stock != null && o.stock !== '') {
        const n = Number(o.stock);
        if (Number.isFinite(n) && n >= 0) out.stock = Math.floor(n);
      }
      return out;
    })
    .filter((o) => o.label.length > 0);
}

function sanitizeVariantAxes(raw) {
  const out = { color: emptyAxis(), shape: emptyAxis(), size: emptyAxis() };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of AXES) {
    const ax = raw[key];
    if (!ax || typeof ax !== 'object') continue;
    const opts = sanitizeOptions(ax.options);
    out[key] = {
      enabled: Boolean(ax.enabled) && opts.length > 0,
      selectionMode: ax.selectionMode === 'multiple' ? 'multiple' : 'single',
      options: opts
    };
    if (!out[key].enabled) {
      out[key] = emptyAxis();
    }
  }
  return out;
}

function parseVariantAxesFromBodyField(raw) {
  if (raw == null || raw === '') return sanitizeVariantAxes({});
  if (typeof raw === 'object' && !Array.isArray(raw)) return sanitizeVariantAxes(raw);
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw);
      return sanitizeVariantAxes(j);
    } catch {
      return sanitizeVariantAxes({});
    }
  }
  return sanitizeVariantAxes({});
}

/** Derive legacy string fields for listings / old clients. */
function variantAxesToLegacyFlat(axes) {
  const a = sanitizeVariantAxes(axes);
  const join = (key) => {
    const ax = a[key];
    if (!ax?.enabled || !ax.options?.length) return '';
    return ax.options
      .map((o) => o.label)
      .filter(Boolean)
      .join(', ')
      .slice(0, 120);
  };
  return {
    color: join('color'),
    texture: join('shape'),
    size: join('size')
  };
}

function collectVariantImagePublicIds(axes) {
  const ids = [];
  const a = axes && typeof axes === 'object' ? axes : {};
  for (const key of AXES) {
    const ax = a[key];
    if (!ax?.options?.length) continue;
    for (const o of ax.options) {
      const pid = o?.image?.public_id;
      if (pid && String(pid).trim()) ids.push(String(pid).trim());
    }
  }
  return ids;
}

function diffPublicIdsToRemove(oldAxes, newAxes) {
  const before = new Set(collectVariantImagePublicIds(oldAxes));
  const after = new Set(collectVariantImagePublicIds(newAxes));
  return [...before].filter((id) => !after.has(id));
}

/**
 * Apply multipart files variantOptionImage_{axis}_{index} → upload buffers into axes (mutates copy).
 * @param {object} axes - sanitized variant axes
 * @param {import('multer').File[]} files
 * @param {(buf: Buffer, opts: object) => Promise<{url:string,public_id:string}>} uploadImageBuffer
 */
async function mergeVariantOptionUploads(axes, files, uploadImageBuffer) {
  const next = JSON.parse(JSON.stringify(axes));
  const re = /^variantOptionImage_(color|shape|size)_(\d+)$/;
  const list = Array.isArray(files) ? files : [];
  for (const f of list) {
    const m = re.exec(f.fieldname || '');
    if (!m || !f.buffer) continue;
    const axis = m[1];
    const idx = parseInt(m[2], 10);
    if (!AXES.includes(axis) || !Number.isInteger(idx) || idx < 0) continue;
    const ax = next[axis];
    if (!ax?.enabled || !ax.options?.[idx]) continue;
    const img = await uploadImageBuffer(f.buffer, { folder: 'nova-shop/product-variants' });
    ax.options[idx].image = { url: img.url, public_id: img.public_id };
  }
  return sanitizeVariantAxes(next);
}

module.exports = {
  AXES,
  emptyAxis,
  sanitizeVariantAxes,
  parseVariantAxesFromBodyField,
  variantAxesToLegacyFlat,
  collectVariantImagePublicIds,
  diffPublicIdsToRemove,
  mergeVariantOptionUploads
};
