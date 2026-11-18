import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, XCircle, PenLine, PauseCircle, EyeOff, RotateCcw, Sparkles, Trash2, Search, Flag, Copy, ExternalLink, ImageOff, Pencil } from 'lucide-react';
import { api } from '../../lib/api';
import { useDebounced, useFetch, usePageMeta } from '../../lib/hooks';
import { CONDITIONS, REPORT_REASONS, dateTime, money, timeAgo } from '../../lib/format';
import { useToast } from '../../context/ToastContext';
import { useSettings } from '../../context/SettingsContext';
import { Gallery } from '../../components/Gallery';
import { Badge, Button, Checkbox, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Pagination, RowsSkeleton, Select, StatusBadge, Textarea, errMsg } from '../../components/ui';

type Mod = 'approve' | 'reject' | 'request_changes' | 'suspend' | 'unpublish' | 'restore';
const MODS: Record<Mod, { label: string; icon: any; from: string[]; danger?: boolean; note: boolean; variant: 'primary' | 'outline' | 'danger' }> = {
  approve: { label: 'Approve & publish', icon: CheckCircle2, from: ['pending_approval'], note: false, variant: 'primary' },
  request_changes: { label: 'Request changes', icon: PenLine, from: ['pending_approval', 'published'], note: true, variant: 'outline' },
  reject: { label: 'Reject', icon: XCircle, from: ['pending_approval', 'published', 'approved'], note: true, danger: true, variant: 'danger' },
  unpublish: { label: 'Unpublish', icon: EyeOff, from: ['published'], note: true, variant: 'outline' },
  suspend: { label: 'Suspend', icon: PauseCircle, from: ['published', 'pending_approval', 'approved', 'sold'], note: true, danger: true, variant: 'danger' },
  restore: { label: 'Restore & publish', icon: RotateCcw, from: ['suspended', 'approved'], note: false, variant: 'primary' },
};

function EditListingDialog({ l, onClose, onDone }: { l: any; onClose: () => void; onDone: () => void }) {
  const { categories } = useSettings();
  const toast = useToast();
  const [f, setF] = useState({ title: l.title, description: l.description, price: String(l.price), category_id: l.category_id, subcategory_id: l.subcategory_id ?? '', condition: l.condition, location: l.location, negotiable: l.negotiable });
  const [busy, setBusy] = useState(false);
  const cat = categories.find((c) => c.id === f.category_id);
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/api/admin/listings/${l.id}`, { ...f, price: Number(f.price), subcategory_id: f.subcategory_id || null });
      toast('Listing updated');
      onDone();
      onClose();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Edit listing" wide footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Title" className="sm:col-span-2"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Category"><Select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value, subcategory_id: '' })}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Subcategory"><Select value={f.subcategory_id} onChange={(e) => setF({ ...f, subcategory_id: e.target.value })}><option value="">—</option>{cat?.subcategories.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Price"><Input value={f.price} onChange={(e) => setF({ ...f, price: e.target.value.replace(/[^0-9.]/g, '') })} /></Field>
        <Field label="Condition"><Select value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })}>{Object.entries(CONDITIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Location"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        <div className="flex items-end pb-2"><Checkbox checked={f.negotiable} onChange={(e) => setF({ ...f, negotiable: e.target.checked })} label="Negotiable" /></div>
        <Field label="Description" className="sm:col-span-2"><Textarea rows={6} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function Review({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { data, error, loading, reload } = useFetch<any>(`/api/admin/listings/${id}`);
  const [mod, setMod] = useState<Mod | null>(null);
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const [feature, setFeature] = useState(false);
  const [days, setDays] = useState('7');
  const l = data?.listing;
  const done = () => { reload(); onChanged(); };
  const status: string = data?.history?.length !== undefined ? l?.status : '';

  return (
    <Modal open onClose={onClose} title="Review listing" wide>
      {loading ? <RowsSkeleton /> : error || !l ? <ErrorState error={error} retry={reload} /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={status} kind="listing" />
            {l.is_featured && <Badge tone="amber"><Sparkles size={11} /> Featured</Badge>}
            {data.reports.length > 0 && <Badge tone="red"><Flag size={11} /> {data.reports.length} report{data.reports.length > 1 ? 's' : ''}</Badge>}
            {data.duplicates.length > 0 && <Badge tone="violet"><Copy size={11} /> {data.duplicates.length} possible duplicate{data.duplicates.length > 1 ? 's' : ''}</Badge>}
            <Link to={`/item/${l.slug}`} target="_blank" className="ml-auto text-sm font-semibold text-brand flex items-center gap-1">Open page <ExternalLink size={14} /></Link>
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            <Gallery images={l.images} title={l.title} />
            <div className="space-y-2">
              <h3 className="text-xl font-extrabold break-words">{l.title}</h3>
              <p className="text-2xl font-extrabold text-brand-dark">{money(l.price, l.currency)} {l.negotiable && <span className="text-sm text-muted font-semibold">negotiable</span>}</p>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div><dt className="text-muted">Category</dt><dd className="font-semibold">{l.category.name}{l.subcategory ? ` · ${l.subcategory.name}` : ''}</dd></div>
                <div><dt className="text-muted">Condition</dt><dd className="font-semibold">{CONDITIONS[l.condition]}</dd></div>
                <div><dt className="text-muted">Location</dt><dd className="font-semibold">{l.location}</dd></div>
                <div><dt className="text-muted">Contact phone</dt><dd className="font-semibold">{l.contact_phone_private ?? '—'}</dd></div>
                <div><dt className="text-muted">Video</dt><dd className="font-semibold truncate">{l.video_url ? <a href={l.video_url} target="_blank" rel="noreferrer" className="text-brand">link</a> : '—'}</dd></div>
                <div><dt className="text-muted">Views</dt><dd className="font-semibold">{l.view_count}</dd></div>
              </dl>
              <div className="rounded-xl bg-stone-50 p-3 text-sm">
                <p className="font-semibold">{data.seller.full_name} {data.seller.active_seller ? <Badge tone="green">active seller</Badge> : <Badge tone="red">seller not active</Badge>}</p>
                <p className="text-muted">{data.seller.email} · {data.seller.phone} · account <StatusBadge status={data.seller.status} /></p>
              </div>
            </div>
          </div>
          <div>
            <h4 className="font-bold mb-1">Description</h4>
            <p className="whitespace-pre-line text-[15px] bg-stone-50 rounded-xl p-3 max-h-60 overflow-y-auto break-words">{l.description}</p>
          </div>

          <div className="flex flex-wrap gap-2 sticky bottom-0 bg-white py-2 border-t border-line">
            {(Object.keys(MODS) as Mod[]).filter((m) => MODS[m].from.includes(status)).map((m) => {
              const M = MODS[m];
              return <Button key={m} size="sm" variant={M.variant} onClick={() => setMod(m)}><M.icon size={15} /> {M.label}</Button>;
            })}
            {status === 'published' && <Button size="sm" variant="outline" onClick={() => (l.is_featured ? api.post(`/api/admin/listings/${id}/feature`, { featured: false }).then(() => { toast('Unfeatured'); done(); }) : setFeature(true))}><Sparkles size={15} /> {l.is_featured ? 'Unfeature' : 'Feature'}</Button>}
            <Button size="sm" variant="outline" onClick={() => setEdit(true)}><Pencil size={15} /> Edit</Button>
            <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setDel(true)}><Trash2 size={15} /> Delete</Button>
          </div>

          {data.reports.length > 0 && (
            <section>
              <h4 className="font-bold mb-2 text-red-700">Reports</h4>
              <ul className="text-sm divide-y divide-line">{data.reports.map((r: any) => (
                <li key={r.id} className="py-2 flex justify-between gap-3"><span><b>{REPORT_REASONS[r.reason]}</b> by {r.reporter_name} — {r.details ?? 'no details'} <span className="text-muted text-xs">{timeAgo(r.created_at)}</span></span><StatusBadge status={r.status} /></li>
              ))}</ul>
            </section>
          )}
          {data.duplicates.length > 0 && (
            <section>
              <h4 className="font-bold mb-2">Possible duplicates (identical content)</h4>
              <ul className="text-sm space-y-1">{data.duplicates.map((d: any) => <li key={d.id}><Link to={`/item/${d.slug}`} target="_blank" className="text-brand">{d.title}</Link> <StatusBadge status={d.status} kind="listing" /></li>)}</ul>
            </section>
          )}
          <section>
            <h4 className="font-bold mb-2">Moderation history</h4>
            <ul className="text-sm divide-y divide-line">{data.history.map((h: any, i: number) => (
              <li key={i} className="py-1.5 flex justify-between gap-3"><span><b className="capitalize">{h.action.replace('_', ' ')}</b>{h.actor_name && ` by ${h.actor_name}`}{h.note && <span className="text-muted"> — {h.note}</span>}</span><span className="text-muted text-xs whitespace-nowrap">{dateTime(h.created_at)}</span></li>
            ))}</ul>
          </section>
        </div>
      )}
      {mod && (
        <ConfirmDialog open onClose={() => setMod(null)} title={MODS[mod].label} danger={MODS[mod].danger} confirmLabel={MODS[mod].label}
          noteLabel={MODS[mod].note ? 'Note for the seller (required)' : 'Note (optional)'} noteRequired={MODS[mod].note}
          onConfirm={async (note) => { await api.post(`/api/admin/listings/${id}/moderate`, { action: mod, note: note || undefined }); toast('Listing updated'); done(); }} />
      )}
      {feature && (
        <ConfirmDialog open onClose={() => setFeature(false)} title="Feature listing" confirmLabel="Feature"
          onConfirm={async () => { await api.post(`/api/admin/listings/${id}/feature`, { featured: true, days: Number(days) }); toast('Listing featured'); done(); }}>
          <Field label="Days"><Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} /></Field>
        </ConfirmDialog>
      )}
      {del && <ConfirmDialog open onClose={() => setDel(false)} danger title="Delete listing?" noteLabel="Reason (sent to the seller)" confirmLabel="Delete"
        onConfirm={async (reason) => { await api.del(`/api/admin/listings/${id}`, { reason: reason || undefined }); toast('Listing deleted'); onChanged(); onClose(); }} />}
      {edit && l && <EditListingDialog l={l} onClose={() => setEdit(false)} onDone={done} />}
    </Modal>
  );
}

export default function AdminListings() {
  usePageMeta('Listings');
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'pending_approval';
  const reported = params.get('reported') ?? '';
  const seller = params.get('seller') ?? '';
  const page = Number(params.get('page') ?? 1);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [open, setOpen] = useState<string | null>(null);
  const url = `/api/admin/listings?status=${status === 'all' ? '' : status}&reported=${reported}&seller=${seller}&q=${encodeURIComponent(dq)}&page=${page}`;
  const { data, error, loading, reload } = useFetch<any>(url);
  const tabs = [['pending_approval', 'Awaiting review'], ['published', 'Live'], ['changes_requested', 'Changes requested'], ['rejected', 'Rejected'], ['suspended', 'Suspended'], ['approved', 'Unpublished'], ['all', 'All']];
  const setP = (patch: Record<string, string>) => setParams({ ...Object.fromEntries(params), ...patch, page: patch.page ?? '1' });

  return (
    <div>
      <PageHeader title="Listings" subtitle="No listing becomes public without your approval." />
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-3">
        {tabs.map(([k, v]) => <button key={k} className={`chip shrink-0 ${status === k && !reported ? 'chip-active' : ''}`} onClick={() => setP({ status: k, reported: '' })}>{v}</button>)}
        <button className={`chip shrink-0 ${reported ? 'chip-active' : ''}`} onClick={() => setP({ status: 'all', reported: '1' })}><Flag size={13} /> Reported</button>
      </div>
      <div className="relative max-w-md mb-4">
        <Search size={16} className="absolute left-3 top-3.5 text-muted" />
        <Input placeholder="Search by title" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
      </div>
      {seller && <p className="text-sm mb-3">Filtered to one seller. <button className="text-brand font-semibold" onClick={() => setP({ seller: '' })}>Clear</button></p>}
      {loading ? <RowsSkeleton /> : error ? <ErrorState error={error} retry={reload} /> : data.items.length === 0 ? (
        <div className="card"><EmptyState title={status === 'pending_approval' ? 'Review queue is empty' : 'No listings'} body={status === 'pending_approval' ? 'New and edited listings appear here for approval.' : undefined} /></div>
      ) : (
        <ul className="space-y-2.5">
          {data.items.map((l: any) => (
            <li key={l.id}>
              <button onClick={() => setOpen(l.id)} className="card w-full text-left p-3 flex gap-3 hover:border-brand/40 transition">
                {l.image ? <img src={l.image} alt="" className="size-20 rounded-xl object-cover shrink-0" loading="lazy" /> : <div className="size-20 rounded-xl bg-stone-100 grid place-items-center shrink-0 text-stone-400"><ImageOff /></div>}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold truncate">{l.title}</p>
                    <StatusBadge status={l.status} kind="listing" />
                  </div>
                  <p className="font-bold">{money(l.price, l.currency)}</p>
                  <p className="text-xs text-muted truncate">{l.category_name} · {l.location} · by {l.seller_name} · {l.status === 'pending_approval' ? `submitted ${timeAgo(l.submitted_at)}` : `created ${timeAgo(l.created_at)}`}</p>
                  <div className="flex gap-1.5 mt-1">
                    {l.open_reports > 0 && <Badge tone="red"><Flag size={11} /> {l.open_reports}</Badge>}
                    {l.possible_duplicates > 0 && <Badge tone="violet"><Copy size={11} /> duplicate?</Badge>}
                    {l.is_featured && <Badge tone="amber"><Sparkles size={11} /> featured</Badge>}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {data && <Pagination page={data.page} pages={data.pages} onPage={(p) => setP({ page: String(p) })} />}
      {open && <Review id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}
