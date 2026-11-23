import { useState } from 'react';
import { CheckCircle2, XCircle, MessageSquareText, CalendarPlus, Ban, Plus, Pencil, Trash2, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { useFetch, usePageMeta } from '../../lib/hooks';
import { dateShort, dateTime, money } from '../../lib/format';
import { useToast } from '../../context/ToastContext';
import { useSettings } from '../../context/SettingsContext';
import { Badge, Button, Checkbox, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageHeader, RowsSkeleton, Select, StatusBadge, Textarea, errMsg, fieldErrors } from '../../components/ui';

export function AssignPlanDialog({ title, endpoint, onClose, onDone }: { title: string; endpoint: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data } = useFetch<{ items: any[] }>('/api/admin/plans');
  const plans = data?.items.filter((p) => p.is_active) ?? [];
  const plansOn = !!useSettings().settings?.payments.seller_plans_enabled;
  const [f, setF] = useState({ plan_id: '', custom_price: '', custom_listing_limit: '', custom_duration_days: '', waive_payment: false, note: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const plan = plans.find((p) => p.id === f.plan_id);
  const submit = async () => {
    if (plansOn && !f.plan_id) return setErr('Choose a plan.');
    setBusy(true);
    setErr('');
    try {
      const r = await api.post(endpoint, {
        plan_id: plansOn ? f.plan_id : undefined,
        custom_price: f.custom_price === '' ? undefined : Number(f.custom_price),
        custom_listing_limit: f.custom_listing_limit === '' ? undefined : Number(f.custom_listing_limit),
        custom_duration_days: f.custom_duration_days === '' ? undefined : Number(f.custom_duration_days),
        waive_payment: f.waive_payment || undefined,
        note: f.note || undefined,
      });
      toast(r.activated ? 'Seller privileges activated' : 'Approved — the user has been asked to pay');
      onDone();
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={title}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}><CheckCircle2 size={16} /> {!plansOn ? 'Approve seller' : f.waive_payment ? 'Approve & activate' : 'Approve & request payment'}</Button></>}>
      <div className="space-y-4">
        {!plansOn && <p className="rounded-xl bg-brand-soft text-brand-dark text-sm p-3">Paid seller plans are switched off, so this seller will be activated right away at no charge. You can turn plans on later in Settings → Payments.</p>}
        {plansOn && <Field label="Seller plan" required>
          <Select value={f.plan_id} onChange={(e) => setF({ ...f, plan_id: e.target.value })}>
            <option value="">Choose a plan…</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.price, p.currency)} · {p.listing_limit} listings · {p.duration_days} days</option>)}
          </Select>
        </Field>}
        {plansOn && plan && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Fee override" hint={`Default ${money(plan.price, plan.currency)}`}><Input inputMode="decimal" value={f.custom_price} onChange={(e) => setF({ ...f, custom_price: e.target.value.replace(/[^0-9.]/g, '') })} /></Field>
            <Field label="Listing limit" hint={`Default ${plan.listing_limit}`}><Input inputMode="numeric" value={f.custom_listing_limit} onChange={(e) => setF({ ...f, custom_listing_limit: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Duration (days)" hint={`Default ${plan.duration_days}`}><Input inputMode="numeric" value={f.custom_duration_days} onChange={(e) => setF({ ...f, custom_duration_days: e.target.value.replace(/\D/g, '') })} /></Field>
          </div>
        )}
        {plansOn && <Checkbox checked={f.waive_payment} onChange={(e) => setF({ ...f, waive_payment: e.target.checked })}
          label={<><b>Waive payment</b> — activate immediately without a payment. Recorded in the audit log as an admin waiver.</>} />}
        <Field label="Note to the seller (optional)"><Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={2000} /></Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
    </Modal>
  );
}

export default function AdminSellers() {
  usePageMeta('Sellers');
  const toast = useToast();
  const [tab, setTab] = useState<'requests' | 'subscriptions'>('requests');
  const [reqStatus, setReqStatus] = useState('');
  const [subStatus, setSubStatus] = useState('');
  const reqs = useFetch<{ items: any[] }>(tab === 'requests' ? `/api/admin/seller-requests?status=${reqStatus}` : null);
  const subs = useFetch<{ items: any[] }>(tab === 'subscriptions' ? `/api/admin/subscriptions?status=${subStatus}` : null);
  const [approve, setApprove] = useState<any>(null);
  const [dialog, setDialog] = useState<null | { kind: 'reject' | 'info' | 'revoke'; row: any }>(null);
  const [extend, setExtend] = useState<any>(null);
  const [extendDays, setExtendDays] = useState('30');
  const [extendListings, setExtendListings] = useState('0');

  return (
    <div>
      <PageHeader title="Sellers" subtitle="Review seller authorization requests, assign plans and manage subscriptions." />
      <div className="flex gap-2 mb-4">
        <button className={`chip ${tab === 'requests' ? 'chip-active' : ''}`} onClick={() => setTab('requests')}>Authorization requests</button>
        <button className={`chip ${tab === 'subscriptions' ? 'chip-active' : ''}`} onClick={() => setTab('subscriptions')}>Subscriptions</button>
      </div>

      {tab === 'requests' && (
        <>
          <Select value={reqStatus} onChange={(e) => setReqStatus(e.target.value)} className="w-full sm:w-56 mb-4">
            <option value="">Open (pending & info requested)</option>
            <option value="approved">Approved</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option>
          </Select>
          {reqs.loading ? <RowsSkeleton /> : reqs.error ? <ErrorState error={reqs.error} retry={reqs.reload} /> : reqs.data!.items.length === 0 ? (
            <div className="card"><EmptyState title="No requests" body="New seller authorization requests appear here." /></div>
          ) : (
            <div className="space-y-3">
              {reqs.data!.items.map((r) => (
                <div key={r.id} className="card p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-bold">{r.full_name} <span className="font-normal text-muted text-sm">· {r.email} · {r.phone}</span></p>
                      <p className="text-sm text-muted">{r.business_name ? `${r.business_name} · ` : ''}{r.business_type ?? 'individual'} · Account <StatusBadge status={r.user_status} /> · Requested {dateTime(r.created_at)}</p>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="mt-3 text-[15px] whitespace-pre-line bg-stone-50 rounded-xl p-3">{r.message}</p>
                  {r.info_requested && <p className="mt-2 text-sm"><b>You asked:</b> {r.info_requested}</p>}
                  {r.info_response && <p className="mt-1 text-sm"><b>They replied:</b> {r.info_response}</p>}
                  {r.admin_note && <p className="mt-2 text-sm text-muted"><b>Admin note:</b> {r.admin_note}{r.reviewed_by_name && ` — ${r.reviewed_by_name}`}</p>}
                  {['pending', 'info_requested'].includes(r.status) && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => setApprove(r)}><CheckCircle2 size={15} /> Approve & assign plan</Button>
                      <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'info', row: r })}><MessageSquareText size={15} /> Request info</Button>
                      <Button size="sm" variant="danger" onClick={() => setDialog({ kind: 'reject', row: r })}><XCircle size={15} /> Reject</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'subscriptions' && (
        <>
          <Select value={subStatus} onChange={(e) => setSubStatus(e.target.value)} className="w-full sm:w-56 mb-4">
            <option value="">All subscriptions</option>
            {['active', 'awaiting_payment', 'payment_review', 'expired', 'revoked', 'cancelled'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </Select>
          <div className="card overflow-x-auto">
            {subs.loading ? <div className="p-5"><RowsSkeleton /></div> : subs.error ? <ErrorState error={subs.error} retry={subs.reload} /> : (
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-left text-muted"><tr>
                  <th className="px-4 py-3">Seller</th><th className="px-4 py-3">Plan</th><th className="px-4 py-3">Usage</th><th className="px-4 py-3">Period</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" />
                </tr></thead>
                <tbody className="divide-y divide-line">
                  {subs.data!.items.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">No subscriptions.</td></tr>}
                  {subs.data!.items.map((s) => (
                    <tr key={s.id}>
                      <td className="px-4 py-3"><b>{s.full_name}</b><span className="block text-xs text-muted">{s.email}</span></td>
                      <td className="px-4 py-3">{s.plan_name}<span className="block text-xs text-muted">{money(s.price, s.currency)}</span></td>
                      <td className="px-4 py-3 whitespace-nowrap">{s.listings_used}/{s.listing_limit} listings{s.featured_allowed && <span className="block text-xs text-muted">{s.featured_used}/{s.featured_quota} featured</span>}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{s.starts_at ? `${dateShort(s.starts_at)} → ${dateShort(s.expires_at)}` : s.payment_due_at ? `Pay by ${dateShort(s.payment_due_at)}` : '—'}</td>
                      <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {['active', 'expired'].includes(s.status) && s.starts_at && <Button size="sm" variant="outline" onClick={() => setExtend(s)}><CalendarPlus size={14} /> Extend</Button>}
                        {['active', 'awaiting_payment', 'payment_review'].includes(s.status) && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setDialog({ kind: 'revoke', row: s })}><Ban size={14} /> Revoke</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {approve && <AssignPlanDialog title={`Approve ${approve.full_name} as a seller`} endpoint={`/api/admin/seller-requests/${approve.id}/approve`} onClose={() => setApprove(null)} onDone={reqs.reload} />}
      {dialog && (
        <ConfirmDialog open onClose={() => setDialog(null)} danger={dialog.kind !== 'info'}
          title={dialog.kind === 'reject' ? 'Reject seller request' : dialog.kind === 'info' ? 'Request more information' : 'Revoke seller privileges'}
          body={dialog.kind === 'revoke' ? 'Listing creation is disabled immediately and the seller’s live listings are suspended.' : undefined}
          noteLabel={dialog.kind === 'info' ? 'What do you need to know?' : 'Reason (shown to the seller)'} noteRequired
          confirmLabel={dialog.kind === 'reject' ? 'Reject' : dialog.kind === 'info' ? 'Send' : 'Revoke'}
          onConfirm={async (note) => {
            if (dialog.kind === 'revoke') {
              await api.post(`/api/admin/subscriptions/${dialog.row.id}/revoke`, { reason: note });
              subs.reload();
            } else {
              await api.post(`/api/admin/seller-requests/${dialog.row.id}/${dialog.kind === 'reject' ? 'reject' : 'request-info'}`, { note });
              reqs.reload();
            }
            toast('Done');
          }} />
      )}
      {extend && (
        <ConfirmDialog open onClose={() => setExtend(null)} title={`Extend ${extend.full_name}'s plan`} confirmLabel="Extend"
          onConfirm={async () => { await api.post(`/api/admin/subscriptions/${extend.id}/extend`, { days: Number(extendDays), extra_listings: Number(extendListings) }); toast('Subscription extended'); subs.reload(); }}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Extra days"><Input inputMode="numeric" value={extendDays} onChange={(e) => setExtendDays(e.target.value.replace(/\D/g, ''))} /></Field>
            <Field label="Extra listings"><Input inputMode="numeric" value={extendListings} onChange={(e) => setExtendListings(e.target.value.replace(/\D/g, ''))} /></Field>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}

const blankPlan = { name: '', kind: 'monthly', description: '', price: '', currency: 'CAD', listing_limit: '10', max_active_listings: '10', duration_days: '30', featured_allowed: false, featured_quota: '0', fixed_expiry_date: '', is_active: true, sort_order: '0' };

export function AdminPlans() {
  usePageMeta('Seller plans');
  const toast = useToast();
  const { settings } = useSettings();
  const { data, error, loading, reload } = useFetch<{ items: any[] }>('/api/admin/plans');
  const [edit, setEdit] = useState<null | { id?: string; f: typeof blankPlan }>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState<any>(null);

  const save = async () => {
    if (!edit) return;
    setBusy(true);
    setErrors({});
    const f = edit.f;
    const body = { ...f, price: Number(f.price), listing_limit: Number(f.listing_limit), max_active_listings: Number(f.max_active_listings), duration_days: Number(f.duration_days), featured_quota: Number(f.featured_quota), sort_order: Number(f.sort_order) };
    try {
      if (edit.id) await api.put(`/api/admin/plans/${edit.id}`, body);
      else await api.post('/api/admin/plans', body);
      toast('Plan saved');
      setEdit(null);
      reload();
    } catch (e) {
      setErrors(fieldErrors(e));
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof blankPlan, v: any) => setEdit((e) => e && { ...e, f: { ...e.f, [k]: v } });

  return (
    <div>
      <PageHeader title="Seller plans" subtitle="Configure listing fees and subscription plans. Changes don't affect plans already assigned."
        actions={<Button onClick={() => setEdit({ f: { ...blankPlan, currency: settings?.site.default_currency ?? 'CAD' } })}><Plus size={16} /> New plan</Button>} />
      {loading ? <RowsSkeleton /> : error ? <ErrorState error={error} retry={reload} /> : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {data!.items.map((p) => (
            <div key={p.id} className={`card p-5 ${p.is_active ? '' : 'opacity-60'}`}>
              <div className="flex justify-between items-start gap-2">
                <div><p className="font-bold">{p.name}</p><p className="text-xs text-muted capitalize">{p.kind} plan</p></div>
                <div className="flex gap-1">
                  {!p.is_active && <Badge>inactive</Badge>}
                  {p.featured_allowed && <Badge tone="amber"><Sparkles size={11} /> {p.featured_quota}</Badge>}
                </div>
              </div>
              <p className="mt-2 text-2xl font-extrabold">{money(p.price, p.currency)}</p>
              <p className="text-sm text-muted mt-1">{p.listing_limit} listings · {p.max_active_listings} live · {p.duration_days} days{p.fixed_expiry_date && ` · ends ${dateShort(p.fixed_expiry_date)}`}</p>
              <p className="text-xs text-muted mt-1">{p.active_subscribers} active subscriber{p.active_subscribers === 1 ? '' : 's'}</p>
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setEdit({ id: p.id, f: { ...blankPlan, ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v === null ? '' : typeof v === 'number' ? String(v) : v])) } as any })}><Pencil size={14} /> Edit</Button>
                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setDel(p)}><Trash2 size={14} /> Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? 'Edit plan' : 'New plan'} wide
          footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save plan</Button></>}>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Plan name" required error={errors.name}><Input value={edit.f.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Type">
              <Select value={edit.f.kind} onChange={(e) => set('kind', e.target.value)}>
                <option value="single">Single listing fee</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option><option value="custom">Custom</option>
              </Select>
            </Field>
            <Field label="Price" required error={errors.price}><Input inputMode="decimal" value={edit.f.price} onChange={(e) => set('price', e.target.value.replace(/[^0-9.]/g, ''))} /></Field>
            <Field label="Currency" error={errors.currency}><Input maxLength={3} value={edit.f.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} /></Field>
            <Field label="Total listing limit" error={errors.listing_limit}><Input inputMode="numeric" value={edit.f.listing_limit} onChange={(e) => set('listing_limit', e.target.value.replace(/\D/g, ''))} /></Field>
            <Field label="Max active listings" error={errors.max_active_listings}><Input inputMode="numeric" value={edit.f.max_active_listings} onChange={(e) => set('max_active_listings', e.target.value.replace(/\D/g, ''))} /></Field>
            <Field label="Duration (days)" error={errors.duration_days}><Input inputMode="numeric" value={edit.f.duration_days} onChange={(e) => set('duration_days', e.target.value.replace(/\D/g, ''))} /></Field>
            <Field label="Fixed expiry date (optional)" hint="Overrides duration for custom plans." error={errors.fixed_expiry_date}><Input type="date" value={edit.f.fixed_expiry_date} onChange={(e) => set('fixed_expiry_date', e.target.value)} /></Field>
            <Field label="Featured boosts included" error={errors.featured_quota}><Input inputMode="numeric" value={edit.f.featured_quota} onChange={(e) => set('featured_quota', e.target.value.replace(/\D/g, ''))} disabled={!edit.f.featured_allowed} /></Field>
            <Field label="Sort order"><Input inputMode="numeric" value={edit.f.sort_order} onChange={(e) => set('sort_order', e.target.value.replace(/[^0-9-]/g, ''))} /></Field>
            <Field label="Description" className="sm:col-span-2"><Textarea rows={2} value={edit.f.description} onChange={(e) => set('description', e.target.value)} /></Field>
            <Checkbox checked={edit.f.featured_allowed} onChange={(e) => set('featured_allowed', e.target.checked)} label="Includes featured listing privileges" />
            <Checkbox checked={edit.f.is_active} onChange={(e) => set('is_active', e.target.checked)} label="Active (offered to sellers)" />
          </div>
        </Modal>
      )}
      {del && <ConfirmDialog open onClose={() => setDel(null)} danger title={`Delete ${del.name}?`} body="It will no longer be offered. Existing subscriptions keep their terms." confirmLabel="Delete"
        onConfirm={async () => { await api.del(`/api/admin/plans/${del.id}`); toast('Plan deleted'); reload(); }} />}
    </div>
  );
}
