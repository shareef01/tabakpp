/**
 * TABAK++ High-Fidelity AppSec Utilities
 * Enforcing strict sanitization and validation for full-stack data integrity.
 */

/**
 * Sanitizes user-generated strings to prevent XSS and injection patterns.
 * @param {string} str
 * @param {number} [maxLength=100]
 */
export const sanitizeInput = (str, maxLength = 100) => {
  if (typeof str !== 'string') return '';
  return str
    .replace(/\p{Cc}/gu, '') // strip control characters (C0/C1 + DEL)
    .replace(/[<>]/g, '')
    .trim()
    .substring(0, maxLength);
};

export const sanitizeString = sanitizeInput;
export const sanitizeDisplayName = (str) => sanitizeInput(str, 100);
/** Tracker names — Firestore rules + Android InputSanitizer cap at 80. */
export const sanitizeTrackerName = (str) => sanitizeInput(str, 80);

/** Only render Firestore/Auth avatars that cannot smuggle script URLs. */
export const isSafeAvatarUrl = (url) => {
  if (typeof url !== 'string' || !url) return false;
  if (url.startsWith('data:image/jpeg;base64,')
    || url.startsWith('data:image/jpg;base64,')
    || url.startsWith('data:image/png;base64,')
    || url.startsWith('data:image/webp;base64,')) {
    return url.length <= 90000;
  }
  try {
    const u = new URL(url);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
};

const looksLikeImage = (file) => {
  const type = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  return (
    type.startsWith('image/') ||
    !type ||
    /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(name)
  );
};

const encodeCanvas = (canvas, quality, maxChars) => {
  let q = quality;
  let dataUrl = canvas.toDataURL('image/jpeg', q);
  while (dataUrl.length > maxChars && q > 0.35) {
    q -= 0.1;
    dataUrl = canvas.toDataURL('image/jpeg', q);
  }
  if (dataUrl.length > maxChars) throw new Error('AVATAR_TOO_LARGE');
  return dataUrl;
};

const drawScaled = (source, maxSide) => {
  const sw = source.width || source.videoWidth || 0;
  const sh = source.height || source.videoHeight || 0;
  if (!sw || !sh) throw new Error('DECODE_FAILED');
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('CANVAS_FAILED');
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
};

const decodeViaBitmap = async (file) => {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    return await createImageBitmap(file);
  } catch {
    return null;
  }
};

const decodeViaImageElement = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('READ_FAILED'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('DECODE_FAILED'));
      img.onload = () => resolve(img);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

const isHeicLike = (file) => {
  const type = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  return type.includes('heic') || type.includes('heif') || /\.(heic|heif)$/i.test(name);
};

const decodeViaHeic2Any = async (file) => {
  try {
    const mod = await import('heic2any');
    const heic2any = mod.default || mod;
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    if (!blob) return null;
    return await decodeViaBitmap(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }))
      || await decodeViaImageElement(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
  } catch {
    return null;
  }
};

/**
 * Resize + JPEG-compress an image file to a data URL suitable for Firestore avatar.
 * Caps output length to stay under the firestore.rules avatar.size() <= 90000 bound.
 * Prefers createImageBitmap, then Image(), then lazy heic2any for HEIC/HEIF.
 * @param {File} file
 * @param {{ maxSide?: number, quality?: number, maxChars?: number }} [opts]
 * @returns {Promise<string>} data URL
 */
export const compressAvatarFile = async (file, opts = {}) => {
  const maxSide = opts.maxSide ?? 256;
  const quality = opts.quality ?? 0.72;
  const maxChars = opts.maxChars ?? 90000;

  if (!file || !looksLikeImage(file)) {
    throw new Error('INVALID_IMAGE');
  }

  const encodeSource = (source) => {
    const canvas = drawScaled(source, maxSide);
    return encodeCanvas(canvas, quality, maxChars);
  };

  let bitmap = await decodeViaBitmap(file);
  try {
    if (bitmap) return encodeSource(bitmap);
  } finally {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
  }

  try {
    const img = await decodeViaImageElement(file);
    return encodeSource(img);
  } catch (err) {
    if (!isHeicLike(file) && err?.message !== 'DECODE_FAILED') throw err;
  }

  const heicSource = await decodeViaHeic2Any(file);
  if (heicSource) {
    try {
      return encodeSource(heicSource);
    } finally {
      if (typeof heicSource.close === 'function') heicSource.close();
    }
  }

  throw new Error('DECODE_FAILED');
};
