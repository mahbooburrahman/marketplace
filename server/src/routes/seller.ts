import { Router } from 'express';
import { z } from 'zod';
import { one, q, tx } from '../db.js';
import { config } from '../config.js';
import { ah, bad, forbidden, notFound, parse, uuid } from '../lib/http.js';
import { requireAuth, requireVerifiedEmail } from '../middleware/auth.js';
import { uploadLimiter, writeLimiter } from '../middleware/limits.js';
import { receiptUpload, saveReceipt, privatePath, removeFile } from '../lib/storage.js';
import { notify, notifyAdmins } from '../lib/notify.js';
import { audit } from '../lib/audit.js';
import { getSettings } from '../lib/settings.js';
import { getGateway } from '../lib/payments/index.js';
import { activateSubscription, currentSubscription, SYSTEM_USER_ID } from '../lib/subscriptions.js';

const r = Router();

/** POST /api/webhooks/payments/:provider — mounted separately (no auth, signature-verified) */
export const webhookRouter = Router();
webhookRouter.post(
  '/payments/:provider',
  ah(async (req, res) => {
    const gw = getGateway();
    if (!gw || gw.name !== req.params.provider) return res.status(404).json({ error: { message: 'Unknown provider' } });
    const result = await gw.parseWebhook(req as any);
    if (!result) return res.json({ received: true });
    const payment = await one<any>('SELECT * FROM payments WHERE provider=$1 AND provider_ref=$2', [gw.name, result.providerRef]);
    if (!payment) return res.json({ received: true });
    if (payment.status === 'verified') return res.json({ received: true }); // idempotent

    if (result.outcome === 'paid') {
      // Trust only the signed gateway event, and only if it matches the amount we charged.
      if (result.amount !== undefined && (Math.abs(result.amount - payment.amount) > 0.009 || result.currency !== payment.currency)) {
        await q(`UPDATE payments SET status='under_review', rejection_reason='Gateway amount mismatch — needs manual review' WHERE id=$1`, [payment.id]);
        await notifyAdmins('payment.review', 'Gateway payment needs review', `Amount mismatch on payment ${payment.id}`, '/admin/payments?status=under_review');
        return res.json({ received: true });
      }
      await tx(async (c) => {
        await q(`UPDATE payments SET status='verified', verified_by=$2, verified_at=now() WHERE id=$1`, [payment.id, SYSTEM_USER_ID], c);
        await activateSubscription(c, payment.subscription_id, SYSTEM_USER_ID);
      });
      await q(`INSERT INTO activity_logs (actor_id, action, target_type, target_id, meta) VALUES ($1,'payment.verified_by_gateway','payment',$2,$3)`,
        [SYSTEM_USER_ID, payment.id, JSON.stringify({ provider: gw.name })]);
      await notify({ userId: payment.user_id, type: 'payment.verified', title: 'Payment confirmed — you can now post listings',
        body: 'Your seller privileges are active.', link: '/dashboard/listings', email: { cta: 'Create a listing' } });
    } else {
      await q(`UPDATE payments SET status=$2::payment_status WHERE id=$1`, [payment.id, result.outcome === 'failed' ? 'failed' : 'expired']);
      await q(`UPDATE seller_subscriptions SET status='awaiting_payment' WHERE id=$1 AND status='payment_review'`, [payment.subscription_id]);
      await notify({ userId: payment.user_id, type: 'payment.failed', title: 'Payment was not completed',
        body: 'Your online payment did not go through. You can try again from your dashboard.', link: '/dashboard/seller', email: {} });
    }
    res.json({ received: true });
  }),
);

r.use(requireAuth);

/** GET /api/seller/status — everything the "Seller" dashboard tab needs */
r.get(
  '/status',
  ah(async (req, res) => {
    const uid = req.user!.id;
    const [request, subscription, plans, settings, activeCount] = await Promise.all([
      one(`SELECT id, business_name, business_type, message, status, admin_note, info_requested, info_response, created_at, reviewed_at
             FROM seller_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`, [uid]),
      currentSubscription(uid),
      q(`SELECT id, name, kind, description, price, currency, listing_limit, max_active_listings, duration_days, featured_allowed, featured_quota
           FROM seller_plans WHERE is_active AND deleted_at IS NULL ORDER BY sort_order, price`),
      getSettings(),
      one<{ n: number }>(`SELECT count(*)::int AS n FROM listings WHERE seller_id=$1 AND status IN ('published','pending_approval','approved') AND deleted_at IS NULL`, [uid]),
    ]);
    const payment = subscription
      ? await one(`SELECT id, amount, currency, method, status, reference_number, rejection_reason, created_at FROM payments
                    WHERE subscription_id=$1 ORDER BY created_at DESC LIMIT 1`, [subscription.id])
      : null;
    res.json({
      is_seller: req.user!.is_seller,
      request,
      subscription,
      payment,
      plans: settings.payments.seller_plans_enabled ? plans : [],
      plans_enabled: !!settings.payments.seller_plans_enabled,
      active_listings: activeCount?.n ?? 0,
      payment_options: {
        bank_transfer: settings.payments.bank_transfer_enabled,
        bank_details: settings.payments.bank_transfer_enabled ? settings.payments.bank_details : null,
        gateway: settings.payments.gateway_enabled && !!getGateway(),
      },
    });
  }),
);

/** POST /api/seller/requests — ask the admin for seller authorization */
r.post(
  '/requests',
  requireVerifiedEmail,
  writeLimiter,
  ah(async (req, res) => {
    const u = req.user!;
    if (!['pending_approval', 'approved'].includes(u.status)) throw forbidden('Your account cannot request seller access right now.');
    const body = parse(
      z.object({
        business_name: z.string().trim().max(100).optional(),
        business_type: z.enum(['individual', 'shop', 'company', 'other']).optional(),
        message: z.string().trim().min(10, 'Tell us a little about what you plan to sell (10+ characters).').max(1500),
        preferred_plan_id: uuid.optional(),
      }),
      req.body,
    );
    const open = await one(`SELECT id FROM seller_requests WHERE user_id=$1 AND status IN ('pending','info_requested')`, [u.id]);
    if (open) throw bad('You already have a request under review.', 'request_open');
    const pendingSub = await one(`SELECT id FROM seller_subscriptions WHERE user_id=$1 AND status IN ('awaiting_payment','payment_review')`, [u.id]);
    if (pendingSub) throw bad('You have an approved plan waiting for payment. Complete the payment first.', 'payment_pending');
    const plan = body.preferred_plan_id ? await one<{ name: string }>('SELECT name FROM seller_plans WHERE id=$1', [body.preferred_plan_id]) : null;
    const msg = plan ? `${body.message}\n\nPreferred plan: ${plan.name}` : body.message;
    const row = await one<any>(
      `INSERT INTO seller_requests (user_id, business_name, business_type, message) VALUES ($1,$2,$3,$4) RETURNING id, status, created_at`,
      [u.id, body.business_name ?? null, body.business_type ?? null, msg],
    );
    await audit(req, 'seller_request.created', { type: 'seller_request', id: row.id });
    await notifyAdmins('seller.request', 'New seller authorization request', `${u.full_name} wants to sell on the platform.`, '/admin/sellers');
    await notify({ userId: u.id, type: 'seller.request', title: 'Seller request received', body: 'Your seller authorization request is under review.', link: '/dashboard/seller' });
    res.status(201).json({ request: row });
  }),
);

/** POST /api/seller/requests/:id/respond — answer the admin's request for more information */
r.post(
  '/requests/:id/respond',
  writeLimiter,
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const { response } = parse(z.object({ response: z.string().trim().min(2).max(1500) }), req.body);
    const row = await one<any>(`UPDATE seller_requests SET info_response=$3, status='pending', updated_at=now()
                                 WHERE id=$1 AND user_id=$2 AND status='info_requested' RETURNING id`, [id, req.user!.id, response]);
    if (!row) throw notFound('Request not found.');
    await audit(req, 'seller_request.info_provided', { type: 'seller_request', id });
    await notifyAdmins('seller.request', 'Seller replied with more information', req.user!.full_name, '/admin/sellers');
    res.json({ ok: true });
  }),
);

r.post(
  '/requests/:id/cancel',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const row = await one(`UPDATE seller_requests SET status='cancelled', updated_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('pending','info_requested') RETURNING id`, [id, req.user!.id]);
    if (!row) throw notFound('Request not found.');
    await audit(req, 'seller_request.cancelled', { type: 'seller_request', id });
    res.json({ ok: true });
  }),
);

async function ownPayableSubscription(subId: string, userId: string) {
  const sub = await one<any>('SELECT * FROM seller_subscriptions WHERE id=$1 AND user_id=$2', [subId, userId]);
  if (!sub) throw notFound('Subscription not found.');
  if (sub.status !== 'awaiting_payment') throw bad(sub.status === 'payment_review' ? 'Your payment is already being reviewed.' : 'This plan does not need a payment.');
  if (sub.payment_due_at && new Date(sub.payment_due_at) < new Date()) throw bad('The payment window for this plan has closed. Please submit a new seller request.', 'payment_window_closed');
  return sub;
}

/** POST /api/seller/subscriptions/:id/manual-payment — bank transfer with reference and receipt */
r.post(
  '/subscriptions/:id/manual-payment',
  uploadLimiter,
  receiptUpload.single('receipt'),
  ah(async (req, res) => {
    const settings = await getSettings();
    if (!settings.payments.bank_transfer_enabled) throw bad('Bank transfer is not currently accepted.');
    const subId = parse(uuid, req.params.id);
    const body = parse(z.object({ reference_number: z.string().trim().min(3, 'Enter the transaction reference.').max(80) }), req.body);
    const sub = await ownPayableSubscription(subId, req.user!.id);
    if (!req.file) throw bad('Upload your payment receipt.', 'validation_error', { receipt: 'Upload your payment receipt.' });
    const saved = await saveReceipt(req.file);
    let paymentId: string;
    try {
      paymentId = await tx(async (c) => {
        const p = await one<any>(
          `INSERT INTO payments (user_id, subscription_id, amount, currency, method, provider, reference_number, status)
           VALUES ($1,$2,$3,$4,'bank_transfer','manual',$5,'under_review') RETURNING id`,
          [req.user!.id, sub.id, sub.price, sub.currency, body.reference_number], c,
        );
        await q('INSERT INTO payment_receipts (payment_id, file_path, original_name, mime, size_bytes) VALUES ($1,$2,$3,$4,$5)',
          [p.id, saved.key, req.file!.originalname.slice(0, 200), saved.mime, saved.size], c);
        // Note: this does NOT activate anything — an admin must verify the payment.
        await q(`UPDATE seller_subscriptions SET status='payment_review' WHERE id=$1`, [sub.id], c);
        return p.id;
      });
    } catch (e) {
      await removeFile(saved.key, 'private');
      throw e;
    }
    await audit(req, 'payment.submitted', { type: 'payment', id: paymentId }, { method: 'bank_transfer', reference: body.reference_number });
    await notifyAdmins('payment.review', 'Payment receipt awaiting verification', `${req.user!.full_name} — ${sub.currency} ${sub.price}`, '/admin/payments?status=under_review');
    await notify({ userId: req.user!.id, type: 'payment.submitted', title: 'Payment submitted', body: 'We are verifying your payment. Seller access activates once it is confirmed.', link: '/dashboard/payments' });
    res.status(201).json({ payment_id: paymentId, status: 'under_review' });
  }),
);

/** POST /api/seller/subscriptions/:id/checkout — start an online gateway payment */
r.post(
  '/subscriptions/:id/checkout',
  writeLimiter,
  ah(async (req, res) => {
    const settings = await getSettings();
    const gw = getGateway();
    if (!settings.payments.gateway_enabled || !gw) throw bad('Online payment is not available. Please use bank transfer.', 'gateway_unavailable');
    const subId = parse(uuid, req.params.id);
    const sub = await ownPayableSubscription(subId, req.user!.id);
    const payment = await one<any>(
      `INSERT INTO payments (user_id, subscription_id, amount, currency, method, provider, status) VALUES ($1,$2,$3,$4,'gateway',$5,'pending') RETURNING id`,
      [req.user!.id, sub.id, sub.price, sub.currency, gw.name],
    );
    const checkout = await gw.createCheckout({
      paymentId: payment.id,
      amount: sub.price,
      currency: sub.currency,
      description: `${settings.site.name} — ${sub.plan_name}`,
      customerEmail: req.user!.email,
      successUrl: `${config.appUrl}/dashboard/payments?checkout=success`,
      cancelUrl: `${config.appUrl}/dashboard/seller?checkout=cancelled`,
    });
    await q('UPDATE payments SET provider_ref=$2 WHERE id=$1', [payment.id, checkout.providerRef]);
    await audit(req, 'payment.checkout_started', { type: 'payment', id: payment.id }, { provider: gw.name });
    res.json({ url: checkout.url });
  }),
);

/** GET /api/seller/payments — payment history */
r.get(
  '/payments',
  ah(async (req, res) => {
    const rows = await q(
      `SELECT p.id, p.amount, p.currency, p.method, p.provider, p.reference_number, p.status, p.refund_status, p.refund_note,
              p.rejection_reason, p.created_at, p.verified_at, s.plan_name,
              (SELECT r.id FROM payment_receipts r WHERE r.payment_id=p.id ORDER BY uploaded_at DESC LIMIT 1) AS receipt_id
         FROM payments p JOIN seller_subscriptions s ON s.id=p.subscription_id
        WHERE p.user_id=$1 ORDER BY p.created_at DESC LIMIT 100`,
      [req.user!.id],
    );
    const subs = await q(`SELECT id, plan_name, status, price, currency, starts_at, expires_at, listings_used, listing_limit, created_at
                            FROM seller_subscriptions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`, [req.user!.id]);
    res.json({ payments: rows, subscriptions: subs });
  }),
);

/** POST /api/seller/payments/:id/refund-request */
r.post(
  '/payments/:id/refund-request',
  writeLimiter,
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(1000) }), req.body);
    const row = await one(`UPDATE payments SET refund_status='requested', refund_note=$3 WHERE id=$1 AND user_id=$2 AND status='verified' AND refund_status='none' RETURNING id`,
      [id, req.user!.id, reason]);
    if (!row) throw bad('A refund cannot be requested for this payment.');
    await audit(req, 'payment.refund_requested', { type: 'payment', id });
    await notifyAdmins('payment.refund', 'Refund requested', `${req.user!.full_name}: ${reason.slice(0, 120)}`, '/admin/payments');
    res.json({ ok: true });
  }),
);

/** GET /api/seller/receipts/:id — the uploader or an admin only */
r.get(
  '/receipts/:id',
  ah(async (req, res) => {
    const id = parse(uuid, req.params.id);
    const row = await one<any>(`SELECT r.file_path, r.mime, p.user_id FROM payment_receipts r JOIN payments p ON p.id=r.payment_id WHERE r.id=$1`, [id]);
    if (!row || (row.user_id !== req.user!.id && req.user!.role !== 'admin')) throw notFound();
    res.setHeader('Content-Type', row.mime);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(privatePath(row.file_path));
  }),
);

export default r;
