import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { escapeHtml } from './security.js';
import { getSettings } from './settings.js';

const transporter = config.mail.host
  ? nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
    })
  : null;

if (!transporter) {
  console.warn('[mail] SMTP_HOST not set — emails will be printed to the console instead of sent.');
}

/** In-memory outbox of the last emails, used by automated tests in development only. */
export const devOutbox: { to: string; subject: string; text: string; at: number }[] = [];

export interface MailInput {
  to: string;
  subject: string;
  heading: string;
  lines: string[];
  cta?: { label: string; url: string };
}

export async function sendMail(m: MailInput) {
  const settings = await getSettings();
  if (settings.email?.enabled === false) return;
  const site = settings.site?.name ?? 'Marketplace';
  const color = settings.site?.primary_color ?? '#0f766e';
  const text = [m.heading, '', ...m.lines, ...(m.cta ? ['', `${m.cta.label}: ${m.cta.url}`] : []), '', `— ${site}`].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:Segoe UI,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
  <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden">
  <tr><td style="background:${escapeHtml(color)};color:#fff;padding:18px 24px;font-size:18px;font-weight:700">${escapeHtml(site)}</td></tr>
  <tr><td style="padding:24px;color:#18181b;font-size:15px;line-height:1.6">
  <h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(m.heading)}</h1>
  ${m.lines.map((l) => `<p style="margin:0 0 10px">${escapeHtml(l)}</p>`).join('')}
  ${m.cta ? `<p style="margin:20px 0"><a href="${escapeHtml(m.cta.url)}" style="background:${escapeHtml(color)};color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">${escapeHtml(m.cta.label)}</a></p>` : ''}
  </td></tr></table></td></tr></table></body></html>`;

  if (!config.isProd) {
    devOutbox.push({ to: m.to, subject: m.subject, text, at: Date.now() });
    if (devOutbox.length > 200) devOutbox.shift();
  }
  if (!transporter) {
    console.log(`\n[mail] To: ${m.to}\n[mail] Subject: ${m.subject}\n${text}\n`);
    return;
  }
  try {
    await transporter.sendMail({ from: config.mail.from, to: m.to, subject: `${m.subject} — ${site}`, text, html });
  } catch (e) {
    // Never fail the user's action because the mail server is down; log for the operator.
    console.error('[mail] send failed:', (e as Error).message);
  }
}
