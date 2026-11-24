import { Router } from 'express';
import { z } from 'zod';
import { one, q } from '../db.js';
import { ah, notFound, parse, uuid } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { imageUpload, processImage, publicUrl, removeFile } from '../lib/storage.js';

const LIVE = `is_active AND image_path IS NOT NULL AND (starts_on IS NULL OR starts_on <= current_date) AND (ends_on IS NULL OR ends_on >= current_date)`;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const bannerSchema = z.object({
  title: z.string().trim().max(120).default(''),
  cta: z.string().trim().max(40).default(''),
  link_url: z.string().trim().max(500).default('').refine((v) => v === '' || v.startsWith('/') || /^https?:\/\//i.test(v), 'Link must start with https:// or /'),
  starts_on: date,
  ends_on: date,
  is_active: z.boolean().default(true),
});

const shape = (b: any) => ({
  id: b.id, title: b.title, cta: b.cta, link_url: b.link_url, image_url: publicUrl(b.image_path),
  is_active: b.is_active, sort_order: b.sort_order, starts_on: b.starts_on, ends_on: b.ends_on,
  views: b.views, clicks: b.clicks, live: !!b.live,
});

/* ---------- public: what the home page slider shows ---------- */
export const publicBanners = Router();

publicBanners.get('/', ah(async (_req, res) => {
  const rows = await q<any>(`SELECT *, true AS live FROM banners WHERE ${LIVE} ORDER BY sort_order, created_at LIMIT 8`);
  res.json({ items: rows.map((b) => ({ id: b.id, title: b.title, cta: b.cta, link_url: b.link_url, image_url: publicUrl(b.image_path) })) });
}));

publicBanners.post('/:id/view', ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  await q('UPDATE banners SET views = views + 1 WHERE id=$1', [id]);
  res.json({ ok: true });
}));

publicBanners.post('/:id/click', ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  await q('UPDATE banners SET clicks = clicks + 1 WHERE id=$1', [id]);
  res.json({ ok: true });
}));

/* ---------- admin (mounted behind requireAdmin) ---------- */
export const adminBanners = Router();

adminBanners.get('/', ah(async (_req, res) => {
  const rows = await q<any>(`SELECT *, (${LIVE}) AS live FROM banners ORDER BY sort_order, created_at`);
  res.json({ items: rows.map(shape) });
}));

adminBanners.post('/', ah(async (req, res) => {
  const b = parse(bannerSchema, req.body);
  const max = await one<{ m: number }>('SELECT COALESCE(max(sort_order),0)+1 AS m FROM banners');
  const row = await one<any>(
    `INSERT INTO banners (title, cta, link_url, starts_on, ends_on, is_active, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [b.title, b.cta, b.link_url, b.starts_on || null, b.ends_on || null, b.is_active, max?.m ?? 0],
  );
  await audit(req, 'banner.created', { type: 'banner', id: row.id });
  res.status(201).json(shape(row));
}));

adminBanners.put('/:id', ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const b = parse(bannerSchema, req.body);
  const row = await one<any>(
    `UPDATE banners SET title=$2, cta=$3, link_url=$4, starts_on=$5, ends_on=$6, is_active=$7 WHERE id=$1 RETURNING *`,
    [id, b.title, b.cta, b.link_url, b.starts_on || null, b.ends_on || null, b.is_active],
  );
  if (!row) throw notFound('Banner not found.');
  await audit(req, 'banner.updated', { type: 'banner', id });
  res.json(shape(row));
}));

adminBanners.post('/:id/move', ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const dir = req.body?.dir === 'up' ? -1 : 1;
  const rows = await q<{ id: string }>('SELECT id FROM banners ORDER BY sort_order, created_at');
  const i = rows.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0) throw notFound('Banner not found.');
  if (j >= 0 && j < rows.length) {
    [rows[i], rows[j]] = [rows[j]!, rows[i]!];
    for (let k = 0; k < rows.length; k++) await q('UPDATE banners SET sort_order=$2 WHERE id=$1', [rows[k]!.id, k]);
  }
  res.json({ ok: true });
}));

adminBanners.post('/:id/image', (req, res, next) => imageUpload(1).single('image')(req, res, next), ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  if (!req.file) throw notFound('No image received.');
  const old = await one<any>('SELECT image_path FROM banners WHERE id=$1', [id]);
  if (!old) throw notFound('Banner not found.');
  const img = await processImage(req.file.buffer, 'banners', { max: 1800 });
  await q('UPDATE banners SET image_path=$2 WHERE id=$1', [id, img.key]);
  await removeFile(old.image_path);
  await audit(req, 'banner.image_updated', { type: 'banner', id });
  res.json({ image_url: publicUrl(img.key) });
}));

adminBanners.delete('/:id', ah(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const row = await one<any>('DELETE FROM banners WHERE id=$1 RETURNING image_path', [id]);
  if (!row) throw notFound('Banner not found.');
  await removeFile(row.image_path);
  await audit(req, 'banner.deleted', { type: 'banner', id });
  res.json({ ok: true });
}));
