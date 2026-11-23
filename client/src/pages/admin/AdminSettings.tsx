import { useEffect, useState } from 'react';
import { Upload, Send, CheckCircle2, AlertTriangle, Megaphone } from 'lucide-react';
import { api } from '../../lib/api';
import { useFetch, usePageMeta } from '../../lib/hooks';
import { useToast } from '../../context/ToastContext';
import { useSettings } from '../../context/SettingsContext';
import { Button, Checkbox, ErrorState, Field, Input, Notice, PageHeader, RowsSkeleton, Select, Textarea, errMsg, fieldErrors } from '../../components/ui';

function Section({ title, sectionKey, value, children, onSaved }: { title: string; sectionKey: string; value: any; children: (v: any, set: (k: string, x: any) => void, errors: Record<string, string>) => React.ReactNode; onSaved: () => void }) {
  const toast = useToast();
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { setV(value); }, [value]);
  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      await api.put(`/api/admin/settings/${sectionKey}`, v);
      toast(`${title} saved`);
      onSaved();
    } catch (e) {
      setErrors(fieldErrors(e));
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="font-bold text-lg mb-4">{title}</h2>
      <div className="space-y-4">{children(v, (k, x) => setV((cur: any) => ({ ...cur, [k]: x })), errors)}</div>
      <div className="mt-5 flex justify-end"><Button loading={busy} onClick={save}>Save {title.toLowerCase()}</Button></div>
    </section>
  );
}

export default function AdminSettings() {
  usePageMeta('Settings');
  const toast = useToast();
  const { reload: reloadPublic } = useSettings();
  const { data, error, loading, reload } = useFetch<{ settings: any; environment: any }>('/api/admin/settings');
  const [testing, setTesting] = useState(false);
  if (loading) return <RowsSkeleton n={6} />;
  if (error || !data) return <ErrorState error={error} retry={reload} />;
  const s = data.settings;
  const env = data.environment;
  const saved = () => { reload(); reloadPublic(); };

  const upload = async (kind: 'logo' | 'favicon', file: File) => {
    const fd = new FormData();
    fd.append('image', file);
    try {
      await api.post(`/api/admin/settings/upload/${kind}`, fd);
      toast(`${kind === 'logo' ? 'Logo' : 'Favicon'} updated`);
      saved();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const envRow = (ok: boolean, label: string, hint: string) => (
    <li className="flex items-start gap-2 text-sm">{ok ? <CheckCircle2 size={18} className="text-emerald-600 shrink-0" /> : <AlertTriangle size={18} className="text-amber-500 shrink-0" />}<span><b>{label}</b> — {ok ? 'configured' : hint}</span></li>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Website settings" />
      <section className="card p-5">
        <h2 className="font-bold mb-3">Server configuration</h2>
        <ul className="space-y-2">
          {envRow(env.smtp_configured, 'Email (SMTP)', 'not set: emails are printed to the server log. Set SMTP_* in the server .env.')}
          {envRow(env.gateway_configured, 'Online payment gateway', 'not set: only manual bank transfer works. Set PAYMENT_GATEWAY and keys in .env.')}
          {envRow(env.captcha_configured, 'CAPTCHA', 'not set: registration has no CAPTCHA. Set TURNSTILE_SECRET_KEY and VITE_TURNSTILE_SITE_KEY.')}
        </ul>
        <p className="text-xs text-muted mt-3">Secret keys are configured on the server only and are never shown here.</p>
      </section>

      <Section title="Branding" sectionKey="site" value={s.site} onSaved={saved}>
        {(v, set, e) => (
          <>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Website name" error={e.name}><Input value={v.name} onChange={(x) => set('name', x.target.value)} /></Field>
              <Field label="Tagline" error={e.tagline}><Input value={v.tagline} onChange={(x) => set('tagline', x.target.value)} /></Field>
              <Field label="Primary colour" error={e.primary_color}><div className="flex gap-2"><input type="color" value={v.primary_color} onChange={(x) => set('primary_color', x.target.value)} className="h-11 w-14 rounded-lg border border-line" /><Input value={v.primary_color} onChange={(x) => set('primary_color', x.target.value)} /></div></Field>
              <Field label="Accent colour" error={e.accent_color}><div className="flex gap-2"><input type="color" value={v.accent_color} onChange={(x) => set('accent_color', x.target.value)} className="h-11 w-14 rounded-lg border border-line" /><Input value={v.accent_color} onChange={(x) => set('accent_color', x.target.value)} /></div></Field>
              <Field label="Default currency" error={e.default_currency}><Input maxLength={3} value={v.default_currency} onChange={(x) => set('default_currency', x.target.value.toUpperCase())} /></Field>
              <Field label="Default location"><Input value={v.default_location} onChange={(x) => set('default_location', x.target.value)} /></Field>
            </div>
            <Field label="Locations (one per line)" hint="Used for the location selector and filters.">
              <Textarea rows={5} value={(v.locations ?? []).join('\n')} onChange={(x) => set('locations', x.target.value.split('\n').map((l: string) => l.trim()).filter(Boolean))} />
            </Field>
            <div className="flex flex-wrap gap-4 items-center">
              {v.logo_url && <img src={v.logo_url} alt="Logo" className="h-10 bg-stone-100 rounded p-1" />}
              <label className="btn btn-outline btn-sm cursor-pointer"><Upload size={14} /> Upload logo<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(x) => x.target.files?.[0] && upload('logo', x.target.files[0])} /></label>
              {v.favicon_url && <img src={v.favicon_url} alt="Favicon" className="size-8 rounded" />}
              <label className="btn btn-outline btn-sm cursor-pointer"><Upload size={14} /> Upload favicon<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(x) => x.target.files?.[0] && upload('favicon', x.target.files[0])} /></label>
            </div>
          </>
        )}
      </Section>

      <Section title="Contact details" sectionKey="contact" value={s.contact} onSaved={saved}>
        {(v, set, e) => (
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Support email" error={e.email}><Input type="email" value={v.email} onChange={(x) => set('email', x.target.value)} /></Field>
            <Field label="Phone"><Input value={v.phone} onChange={(x) => set('phone', x.target.value)} /></Field>
            <Field label="WhatsApp"><Input value={v.whatsapp} onChange={(x) => set('whatsapp', x.target.value)} /></Field>
            <Field label="Address"><Input value={v.address} onChange={(x) => set('address', x.target.value)} /></Field>
          </div>
        )}
      </Section>

      <Section title="Payments" sectionKey="payments" value={s.payments} onSaved={saved}>
        {(v, set, e) => (
          <>
            <Checkbox checked={!!v.seller_plans_enabled} onChange={(x) => set('seller_plans_enabled', x.target.checked)} label="Charge sellers for paid plans (leave OFF to approve sellers for free while you grow traffic)" />
            <Checkbox checked={v.bank_transfer_enabled} onChange={(x) => set('bank_transfer_enabled', x.target.checked)} label="Accept manual bank transfer (receipt upload + admin verification)" />
            <Field label="Bank details shown to sellers" error={e.bank_details}><Textarea rows={4} value={v.bank_details} onChange={(x) => set('bank_details', x.target.value)} /></Field>
            <Checkbox checked={v.gateway_enabled} onChange={(x) => set('gateway_enabled', x.target.checked)} label={`Offer online payment${env.gateway_configured ? '' : ' (gateway not configured on the server yet)'}`} />
            <Field label="Payment window (days)" hint="Approved plans not paid within this time are cancelled." error={e.payment_window_days}><Input inputMode="numeric" value={v.payment_window_days} onChange={(x) => set('payment_window_days', x.target.value.replace(/\D/g, ''))} className="max-w-[140px]" /></Field>
          </>
        )}
      </Section>

      <Section title="Listing rules" sectionKey="listings" value={s.listings} onSaved={saved}>
        {(v, set, e) => (
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Listing lifetime (days)" error={e.lifetime_days}><Input inputMode="numeric" value={v.lifetime_days} onChange={(x) => set('lifetime_days', x.target.value.replace(/\D/g, ''))} /></Field>
            <Field label="Expiry reminder (days before)" error={e.expiry_reminder_days}><Input inputMode="numeric" value={v.expiry_reminder_days} onChange={(x) => set('expiry_reminder_days', x.target.value.replace(/\D/g, ''))} /></Field>
            <Field label="Max photos per listing" error={e.max_images}><Input inputMode="numeric" value={v.max_images} onChange={(x) => set('max_images', x.target.value.replace(/\D/g, ''))} /></Field>
            <div className="sm:col-span-3"><Checkbox checked={v.auto_expire} onChange={(x) => set('auto_expire', x.target.checked)} label="Automatically expire listings after their lifetime" /></div>
          </div>
        )}
      </Section>

      <Section title="Email & chat" sectionKey="email" value={s.email} onSaved={saved}>
        {(v, set) => (
          <>
            <Checkbox checked={v.enabled} onChange={(x) => set('enabled', x.target.checked)} label="Send email notifications" />
            <Checkbox checked={v.send_message_emails} onChange={(x) => set('send_message_emails', x.target.checked)} label="Email users about new chat messages when they are offline" />
            <Button variant="outline" size="sm" loading={testing} onClick={async () => { setTesting(true); try { const r = await api.post('/api/admin/settings/test-email'); toast(r.message); } catch (e) { toast(errMsg(e), 'error'); } finally { setTesting(false); } }}><Send size={14} /> Send test email to me</Button>
          </>
        )}
      </Section>

      <Section title="Chat limits" sectionKey="chat" value={s.chat} onSaved={saved}>
        {(v, set, e) => <Field label="Messages per user per minute" error={e.messages_per_minute}><Input inputMode="numeric" value={v.messages_per_minute} onChange={(x) => set('messages_per_minute', x.target.value.replace(/\D/g, ''))} className="max-w-[140px]" /></Field>}
      </Section>

      <Section title="Legal pages" sectionKey="legal" value={s.legal} onSaved={saved}>
        {(v, set) => (
          <>
            <Field label="Terms and conditions"><Textarea rows={10} value={v.terms} onChange={(x) => set('terms', x.target.value)} /></Field>
            <Field label="Privacy policy"><Textarea rows={10} value={v.privacy} onChange={(x) => set('privacy', x.target.value)} /></Field>
          </>
        )}
      </Section>
    </div>
  );
}

export function AdminAnnouncements() {
  usePageMeta('Announcements');
  const toast = useToast();
  const [f, setF] = useState({ title: '', body: '', audience: 'all', link: '' });
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/admin/announcements', { ...f, link: f.link || undefined });
      toast(`Sent to ${r.recipients} users`);
      setF({ title: '', body: '', audience: 'all', link: '' });
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHeader title="Announcements" subtitle="Send an in-app notification to approved members." />
      <div className="card p-5 sm:p-6 space-y-4 max-w-2xl">
        <Field label="Audience"><Select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}><option value="all">All approved members</option><option value="sellers">Active sellers</option><option value="buyers">Buyers (non-sellers)</option></Select></Field>
        <Field label="Title" required><Input value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Message" required><Textarea rows={4} value={f.body} maxLength={2000} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <Field label="Link (optional)" hint="An in-site path such as /search?category=vehicles"><Input value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} /></Field>
        <Notice tone="brand" icon={Megaphone} title="Announcements are sent immediately and can't be recalled." />
        <div className="flex justify-end"><Button loading={busy} disabled={f.title.length < 3 || f.body.length < 3} onClick={send}><Send size={16} /> Send announcement</Button></div>
      </div>
    </div>
  );
}
