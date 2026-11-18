import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import sharp from 'sharp';
import { config } from '../config.js';
import { bad } from './http.js';

/**
 * Storage layout:
 *   publicDir/  — listing photos, avatars, category images (served at /uploads/*)
 *   privateDir/ — payment receipts and chat attachments (served only through
 *                 authorization-checked routes, never as static files)
 * To move to S3 / Supabase Storage, replace saveBuffer/readPrivate/remove below;
 * the rest of the app only deals in relative keys.
 */

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const imageUpload = (maxFiles: number) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.storage.maxImageMb * 1024 * 1024, files: maxFiles, fields: 40 },
    fileFilter: (_req, file, cb) => {
      if (!IMAGE_MIMES.has(file.mimetype)) return cb(bad('Only JPG, PNG or WebP images are allowed.', 'invalid_file_type'));
      cb(null, true);
    },
  });

export const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10 },
  fileFilter: (_req, file, cb) => {
    if (!IMAGE_MIMES.has(file.mimetype) && file.mimetype !== 'application/pdf') {
      return cb(bad('Receipts must be an image or a PDF.', 'invalid_file_type'));
    }
    cb(null, true);
  },
});

async function saveBuffer(base: string, key: string, buf: Buffer) {
  const full = path.join(base, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buf, { mode: 0o640 });
}

const newKey = (folder: string, ext: string) => `${folder}/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;

/**
 * Decode and re-encode an uploaded image. Decoding proves it is really an image
 * (a renamed script fails here), re-encoding strips EXIF/GPS metadata and any
 * embedded payload, and resizing keeps pages fast on slow connections.
 */
export async function processImage(
  buf: Buffer,
  folder: string,
  opts: { max?: number; thumb?: number; visibility?: 'public' | 'private' } = {},
) {
  const max = opts.max ?? 1600;
  let meta;
  try {
    meta = await sharp(buf, { limitInputPixels: 40_000_000 }).metadata();
  } catch {
    throw bad('That file is not a valid image.', 'invalid_image');
  }
  if (!meta.width || !meta.height) throw bad('That file is not a valid image.', 'invalid_image');
  const base = opts.visibility === 'private' ? config.storage.privateDir : config.storage.publicDir;
  // Decode fully before writing anything: a valid header with corrupt data fails here, not later.
  let main: { data: Buffer; info: { width: number; height: number; size: number } };
  let thumb: Buffer | null = null;
  try {
    main = await sharp(buf, { limitInputPixels: 40_000_000 }).rotate().resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
    if (opts.thumb) thumb = await sharp(buf).rotate().resize({ width: opts.thumb, height: opts.thumb, fit: 'cover' }).webp({ quality: 72 }).toBuffer();
  } catch {
    throw bad('That file is not a valid image.', 'invalid_image');
  }
  const key = newKey(folder, 'webp');
  await saveBuffer(base, key, main.data);
  let thumbKey = key;
  if (thumb) {
    thumbKey = key.replace('.webp', '_t.webp');
    await saveBuffer(base, thumbKey, thumb);
  }
  return { key, thumbKey, width: main.info.width, height: main.info.height, size: main.info.size };
}

/** Receipts: images are re-encoded; PDFs are checked by magic bytes and stored privately. */
export async function saveReceipt(file: Express.Multer.File) {
  if (file.mimetype === 'application/pdf') {
    if (file.buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw bad('That file is not a valid PDF.', 'invalid_file');
    const key = newKey('receipts', 'pdf');
    await saveBuffer(config.storage.privateDir, key, file.buffer);
    return { key, mime: 'application/pdf', size: file.size };
  }
  const img = await processImage(file.buffer, 'receipts', { max: 2000, visibility: 'private' });
  return { key: img.key, mime: 'image/webp', size: img.size };
}

/** Resolve a private key to an absolute path, refusing anything that escapes the storage root. */
export function privatePath(key: string) {
  const full = path.resolve(config.storage.privateDir, key);
  if (!full.startsWith(path.resolve(config.storage.privateDir) + path.sep)) throw bad('Invalid file.');
  return full;
}

export async function removeFile(key: string | null | undefined, visibility: 'public' | 'private' = 'public') {
  if (!key) return;
  const base = visibility === 'private' ? config.storage.privateDir : config.storage.publicDir;
  const full = path.resolve(base, key);
  if (!full.startsWith(path.resolve(base) + path.sep)) return;
  await fs.unlink(full).catch(() => {});
}

export const publicUrl = (key: string | null | undefined) => (key ? (/^https?:\/\//.test(key) ? key : `/uploads/${key}`) : null);
