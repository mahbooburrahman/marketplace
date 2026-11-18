import crypto from 'node:crypto';
import { config } from '../../config.js';
import { HttpError } from '../http.js';
import type { PaymentProvider } from './index.js';

// Currencies Stripe expects in whole units rather than cents.
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'PYG', 'UGX', 'XAF', 'XOF']);

/**
 * Stripe Checkout via the REST API (no SDK needed).
 * Requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET; the webhook endpoint is
 * POST /api/webhooks/payments/stripe listening for checkout.session.* events.
 */
export const stripeProvider: PaymentProvider = {
  name: 'stripe',
  isConfigured: () => !!config.payments.stripeSecretKey && !!config.payments.stripeWebhookSecret,

  async createCheckout(i) {
    const unit = ZERO_DECIMAL.has(i.currency.toUpperCase()) ? Math.round(i.amount) : Math.round(i.amount * 100);
    const body = new URLSearchParams({
      mode: 'payment',
      success_url: i.successUrl,
      cancel_url: i.cancelUrl,
      customer_email: i.customerEmail,
      client_reference_id: i.paymentId,
      'metadata[payment_id]': i.paymentId,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': i.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(unit),
      'line_items[0][price_data][product_data][name]': i.description,
    });
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.payments.stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data: any = await r.json();
    if (!r.ok) throw new HttpError(502, `Payment gateway error: ${data?.error?.message ?? r.status}`, 'gateway_error');
    return { url: data.url, providerRef: data.id };
  },

  async parseWebhook(req) {
    const sig = String(req.headers['stripe-signature'] ?? '');
    const raw = req.rawBody;
    if (!raw || !sig) throw new HttpError(400, 'Missing signature', 'bad_signature');
    const parts = Object.fromEntries(sig.split(',').map((kv) => kv.split('=') as [string, string]));
    const t = parts.t;
    const expected = crypto.createHmac('sha256', config.payments.stripeWebhookSecret).update(`${t}.${raw.toString('utf8')}`).digest('hex');
    const given = sig.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
    const ok = given.some((g) => g.length === expected.length && crypto.timingSafeEqual(Buffer.from(g), Buffer.from(expected)));
    if (!ok || Math.abs(Date.now() / 1000 - Number(t)) > 300) throw new HttpError(400, 'Invalid signature', 'bad_signature');

    const event = JSON.parse(raw.toString('utf8'));
    const s = event.data?.object;
    const amount = s?.amount_total != null
      ? (ZERO_DECIMAL.has(String(s.currency).toUpperCase()) ? s.amount_total : s.amount_total / 100)
      : undefined;
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        if (s.payment_status !== 'paid') return null;
        return { providerRef: s.id, outcome: 'paid', amount, currency: String(s.currency).toUpperCase() };
      case 'checkout.session.async_payment_failed':
        return { providerRef: s.id, outcome: 'failed' };
      case 'checkout.session.expired':
        return { providerRef: s.id, outcome: 'expired' };
      default:
        return null;
    }
  },
};
