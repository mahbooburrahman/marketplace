import type { Request } from 'express';
import { config } from '../../config.js';
import { stripeProvider } from './stripe.js';

/**
 * Payment provider contract. Manual bank transfer needs no provider (an admin verifies
 * the receipt). Online gateways implement this interface; add Moneris, Helcim,
 * Square, PayPal etc. by writing another provider and selecting it with PAYMENT_GATEWAY.
 */
export interface CheckoutInput {
  paymentId: string;
  amount: number;
  currency: string;
  description: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

export interface WebhookResult {
  providerRef: string;           // matches payments.provider_ref
  outcome: 'paid' | 'failed' | 'expired';
  amount?: number;
  currency?: string;
}

export interface PaymentProvider {
  name: string;
  isConfigured(): boolean;
  createCheckout(input: CheckoutInput): Promise<{ url: string; providerRef: string }>;
  /** Verify the webhook's signature and translate it. Return null for events we ignore. */
  parseWebhook(req: Request & { rawBody?: Buffer }): Promise<WebhookResult | null>;
}

export function getGateway(): PaymentProvider | null {
  if (config.payments.gateway === 'stripe' && stripeProvider.isConfigured()) return stripeProvider;
  return null;
}
