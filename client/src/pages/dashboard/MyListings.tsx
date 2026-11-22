import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Eye, Heart, MessageCircle, MoreHorizontal, Pencil, CheckCircle2, Sparkles, Archive, Send, RotateCcw, Trash2, ExternalLink, Store, ImageOff } from 'lucide-react';
import { api } from '../../lib/api';
import { useFetch, usePageMeta } from '../../lib/hooks';
import { dateShort, money, timeAgo } from '../../lib/format';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { ConfirmDialog, EmptyState, ErrorState, Notice, PageHeader, Pagination, RowsSkeleton, StatusBadge, errMsg } from '../../components/ui';

const TABS = [
  ['', 'All'], ['published', 'Live'], ['pending_approval', 'In review'], ['changes_requested', 'Changes requested'], ['rejected', 'Rejected'],
  ['draft', 'Drafts'], ['sold', 'Sold'], ['expired', 'Expired'], ['archived', 'Archived'], ['suspended', 'Suspended'],
] as const;

interface Row { id: string; slug: string; title: string; price: number; currency: string; status: string; status_note: string | null; is_featured: boolean; featured_until: string | null; view_count: number; favorite_count: number; conversation_count: number; image: string | null; updated_at: string; expires_at: string | null }

function Actions({ l, onDone }: { l: Row; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | { title: string; body: string; action: () => Promise<void>; danger?: boolean; label: string }>(null);
  const run = (path: string, msg: string) => async () => {
    await api.post(`/api/my/listings/${l.id}/${path}`);
    toast(msg);
    onDone();
  };
  const item = 'w-full flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-stone-100 text-sm font-medium text-left';
  const editable = ['draft', 'rejected', 'changes_requested', 'pending_approval', 'published'].includes(l.status);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="size-9 grid place-items-center rounded-lg hover:bg-stone-100" aria-label="Listing actions" aria-expanded={open}><MoreHorizontal size={18} /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-56 card shadow-xl p-1.5 z-20" onClick={() => setOpen(false)}>
            {editable && <Link to={`/dashboard/listings/${l.id}/edit`} className={item}><Pencil size={16} /> Edit</Link>}
            <Link to={`/item/${l.slug}`} className={item}><ExternalLink size={16} /> {l.status === 'published' ? 'View live' : 'Preview'}</Link>
            {['draft', 'rejected', 'changes_requested'].includes(l.status) && <button className={item} onClick={() => run('submit', 'Submitted for review')().catch((e) => toast(errMsg(e), 'error'))}><Send size={16} /> Submit for review</button>}
            {l.status === 'published' && <button className={item} onClick={() => setConfirm({ title: 'Mark as sold?', body: 'The listing will be marked sold and no longer accept new messages.', action: run('sold', 'Marked as sold'), label: 'Mark sold' })}><CheckCircle2 size={16} /> Mark as sold</button>}
            {l.status === 'sold' && <button className={item} onClick={() => run('available', 'Listing is available again')().catch((e) => toast(errMsg(e), 'error'))}><RotateCcw size={16} /> Mark as available</button>}
            {l.status === 'published' && !l.is_featured && <button className={item} onClick={() => setConfirm({ title: 'Feature this listing?', body: 'Uses one featured boost from your plan. It will be highlighted for 7 days.', action: run('feature', 'Listing featured'), label: 'Feature' })}><Sparkles size={16} /> Feature (7 days)</button>}
            {l.status === 'expired' && <button className={item} onClick={() => run('renew', 'Renewal submitted for review')().catch((e) => toast(errMsg(e), 'error'))}><RotateCcw size={16} /> Renew</button>}
            {!['archived', 'suspended'].includes(l.status) && <button className={item} onClick={() => setConfirm({ title: 'Archive listing?', body: 'It will be hidden from the marketplace. You can’t undo this.', action: run('archive', 'Listing archived'), label: 'Archive' })}><Archive size={16} /> Archive</button>}
            {l.status !== 'suspended' && <button className={`${item} text-red-600`} onClick={() => setConfirm({ title: 'Delete listing?', body: 'This permanently removes it from your dashboard.', danger: true, label: 'Delete', action: async () => { await api.del(`/api/my/listings/${l.id}`); toast('Listing deleted'); onDone(); } })}><Trash2 size={16} /> Delete</button>}
          </div>
        </>
      )}
      {confirm && <ConfirmDialog open onClose={() => setConfirm(null)} onConfirm={confirm.action} title={confirm.title} body={confirm.body} danger={confirm.danger} confirmLabel={confirm.label} />}
    </div>
  );
}

export default function MyListings() {
  usePageMeta('My listings');
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? 1);
  const { data, error, loading, reload } = useFetch<{ items: Row[]; total: number; page: number; pages: number }>(`/api/my/listings?status=${status}&page=${page}`);

  return (
    <div>
      <PageHeader title="My listings" subtitle="Every new listing and every important edit is reviewed before it goes live."
        actions={user?.is_seller && <Link to="/dashboard/listings/new" className="btn btn-accent"><Plus size={16} /> New listing</Link>} />
      {!user?.is_seller && (
        <div className="mb-5"><Notice icon={Store} title="Your seller access is not active" action={<Link to="/dashboard/seller" className="btn btn-sm btn-primary">Seller plan</Link>}>You can view your past listings, but creating or editing listings needs an active seller plan.</Notice></div>
      )}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
        {TABS.map(([k, v]) => (
          <button key={k} onClick={() => setParams(k ? { status: k } : {})} className={`chip shrink-0 ${status === k ? 'chip-active' : ''}`}>{v}</button>
        ))}
      </div>
      {loading ? <RowsSkeleton /> : error ? <ErrorState error={error} retry={reload} /> : data!.items.length === 0 ? (
        <div className="card"><EmptyState icon={Store} title={status ? 'Nothing here' : 'No listings yet'} body={user?.is_seller ? 'Create your first listing — it goes live once approved.' : undefined}
          action={user?.is_seller && <Link to="/dashboard/listings/new" className="btn btn-primary"><Plus size={16} /> Create listing</Link>} /></div>
      ) : (
        <ul className="space-y-3">
          {data!.items.map((l) => (
            <li key={l.id} className="card p-3 sm:p-4 flex gap-3 sm:gap-4">
              <Link to={`/item/${l.slug}`} className="shrink-0">
                {l.image ? <img src={l.image} alt="" className="size-20 sm:size-24 rounded-xl object-cover" loading="lazy" /> : <div className="size-20 sm:size-24 rounded-xl bg-stone-100 grid place-items-center text-stone-400"><ImageOff size={22} /></div>}
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{l.title}</p>
                    <p className="font-extrabold">{money(l.price, l.currency)}</p>
                  </div>
                  <Actions l={l} onDone={reload} />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted">
                  <StatusBadge status={l.status} kind="listing" />
                  {l.is_featured && <span className="text-amber-700 font-semibold flex items-center gap-1"><Sparkles size={12} /> Featured</span>}
                  <span className="flex items-center gap-1"><Eye size={12} /> {l.view_count}</span>
                  <span className="flex items-center gap-1"><Heart size={12} /> {l.favorite_count}</span>
                  <span className="flex items-center gap-1"><MessageCircle size={12} /> {l.conversation_count}</span>
                  <span>{l.status === 'published' && l.expires_at ? `Expires ${dateShort(l.expires_at)}` : `Updated ${timeAgo(l.updated_at)}`}</span>
                </div>
                {l.status_note && ['rejected', 'changes_requested', 'suspended', 'approved', 'expired'].includes(l.status) && (
                  <p className="mt-2 text-sm rounded-lg bg-amber-50 text-amber-900 px-3 py-2"><b>Moderator note:</b> {l.status_note}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {data && <Pagination page={data.page} pages={data.pages} onPage={(p) => setParams({ ...(status ? { status } : {}), page: String(p) })} />}
    </div>
  );
}
