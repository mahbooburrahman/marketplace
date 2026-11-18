import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { z, ZodTypeAny } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) {
    super(message);
  }
}

export const bad = (msg: string, code = 'bad_request', details?: unknown) => new HttpError(400, msg, code, details);
export const forbidden = (msg = 'You do not have permission to do that.', code = 'forbidden') => new HttpError(403, msg, code);
export const notFound = (msg = 'Not found.') => new HttpError(404, msg, 'not_found');
export const conflict = (msg: string, code = 'conflict') => new HttpError(409, msg, code);

/** Wrap async route handlers so rejections reach the error middleware. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Validate and coerce input with zod; throws a 400 with field errors. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const issue of r.error.issues) fields[issue.path.join('.') || '_'] = issue.message;
    throw bad('Please check the highlighted fields.', 'validation_error', fields);
  }
  return r.data;
}

export const uuid = z.string().uuid();

/** Map Postgres guard-trigger exceptions to friendly API errors. */
const DB_GUARD_MESSAGES: Record<string, [number, string]> = {
  seller_not_authorized: [403, 'Your seller authorization is not active.'],
  listing_must_start_unpublished: [400, 'New listings must be submitted for review.'],
  publish_requires_admin_approval: [403, 'Listings can only be published by an administrator.'],
  content_change_requires_reapproval: [409, 'Changes to a published listing must be re-approved.'],
  listing_not_available: [404, 'This listing is not available.'],
  seller_mismatch: [400, 'Invalid conversation.'],
  buyer_not_approved: [403, 'Your account must be approved before you can contact sellers.'],
  seller_not_active: [403, 'This seller cannot receive messages right now.'],
  blocked: [403, 'Messaging is not possible between these accounts.'],
  not_a_participant: [403, 'You are not part of this conversation.'],
  sender_not_allowed: [403, 'Your account cannot send messages right now.'],
  activation_requires_verified_payment: [409, 'Seller privileges require a verified payment.'],
  payment_verification_requires_admin: [403, 'Only an administrator can verify payments.'],
};

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { message: err.message, code: err.code, details: err.details } });
  }
  if (err?.code === 'P0001' && DB_GUARD_MESSAGES[err.message]) {
    const [status, message] = DB_GUARD_MESSAGES[err.message];
    return res.status(status).json({ error: { message, code: err.message } });
  }
  if (err?.code === '23505') {
    return res.status(409).json({ error: { message: 'That already exists.', code: 'duplicate' } });
  }
  if (err?.type === 'entity.too.large' || err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: { message: 'The upload is too large.', code: 'too_large' } });
  }
  if (err?.code === 'LIMIT_FILE_COUNT' || err?.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: { message: 'Too many files.', code: 'too_many_files' } });
  }
  console.error(`[${req.method} ${req.originalUrl}]`, err);
  res.status(500).json({ error: { message: 'Something went wrong on our side. Please try again.', code: 'server_error' } });
}

export function pageParams(query: any, maxLimit = 48) {
  const page = Math.max(1, Math.min(10_000, Number(query.page) || 1));
  const limit = Math.max(1, Math.min(maxLimit, Number(query.limit) || 24));
  return { page, limit, offset: (page - 1) * limit };
}
