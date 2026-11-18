import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, CheckCircle2, XCircle, Search as SearchIcon, PauseCircle, Ban, MessageCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { useFetch, usePageMeta } from '../../lib/hooks';
import { REPORT_REASONS, clock, dateTime } from '../../lib/format';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Modal, PageHeader, RowsSkeleton, Select, StatusBadge } from '../../components/ui';

function ConversationViewer({ reportId, onClose }: { reportId: string; onClose: () => void }) {
  const { data, error, loading } = useFetch<any>(`/api/admin/reports/${reportId}/conversation`);
  return (
    <Modal open onClose={onClose} title="Reported conversation" wide>
      <p className="text-xs text-muted mb-3">You can see this conversation only because it was reported. This view has been recorded in the activity log.</p>
      {loading ? <RowsSkeleton /> : error ? <ErrorState error={error} /> : (
        <>
          <p className="text-sm mb-3"><b>{data.conversation.buyer_name}</b> (buyer) ↔ <b>{data.conversation.seller_name}</b> (seller) about “{data.conversation.listing_title}”</p>
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto bg-canvas rounded-xl p-3">
            {data.messages.map((m: any) => {
              const seller = m.sender_id === data.conversation.seller_id;
              return (
                <div key={m.id} className={`flex ${seller ? 'justify-end' : ''}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${seller ? 'bg-brand-tint' : 'bg-white border border-line'}`}>
                    <p className="text-[10px] font-bold text-muted">{seller ? data.conversation.seller_name : data.conversation.buyer_name} · {new Date(m.created_at).toLocaleDateString()} {clock(m.created_at)}</p>
                    {m.attachments.map((a: any) => <a key={a.id} href={a.url} target="_blank" rel="noreferrer"><img src={a.url} alt="" className="rounded-lg max-h-48 my-1" /></a>)}
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  </div>
                </div>
              );
            })}
            {data.messages.length === 0 && <p className="text-center text-sm text-muted">No messages.</p>}
          </div>
        </>
      )}
    </Modal>
  );
}

export default function AdminReports() {
  usePageMeta('Reports');
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const { data, error, loading, reload } = useFetch<{ items: any[] }>(`/api/admin/reports?status=${status}&type=${type}`);
  const [viewConv, setViewConv] = useState<string | null>(null);
  const [resolve, setResolve] = useState<null | { r: any; status: 'resolved' | 'dismissed' | 'investigating' }>(null);
  const [mod, setMod] = useState<null | { userId: string; action: 'suspend' | 'ban'; name: string }>(null);

  return (
    <div>
      <PageHeader title="Reports" subtitle="Investigate reported listings, sellers and conversations, and handle disputes." />
      <div className="flex flex-wrap gap-2 mb-4">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-56">
          <option value="">Open & investigating</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option>
        </Select>
        <Select value={type} onChange={(e) => setType(e.target.value)} className="w-44">
          <option value="">All types</option><option value="listing">Listings</option><option value="user">Users</option><option value="conversation">Conversations</option>
        </Select>
      </div>
      {loading ? <RowsSkeleton /> : error ? <ErrorState error={error} retry={reload} /> : data!.items.length === 0 ? (
        <div className="card"><EmptyState title="No reports" body="Reports from users appear here." /></div>
      ) : (
        <div className="space-y-3">
          {data!.items.map((r) => (
            <div key={r.id} className="card p-4 sm:p-5">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <p className="font-bold flex items-center gap-2"><Badge tone="red">{REPORT_REASONS[r.reason]}</Badge> <span className="capitalize">{r.target_type}</span>: {r.target_label ?? <span className="text-muted">(removed)</span>}</p>
                  <p className="text-sm text-muted mt-1">Reported by {r.reporter_name} · {dateTime(r.created_at)}</p>
                </div>
                <StatusBadge status={r.status} />
              </div>
              {r.details && <p className="mt-2 text-[15px] bg-stone-50 rounded-xl p-3 whitespace-pre-line">{r.details}</p>}
              {r.resolution_note && <p className="mt-2 text-sm"><b>Resolution:</b> {r.resolution_note}{r.resolved_by_name && ` — ${r.resolved_by_name}`}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {r.target_type === 'listing' && <Link to={`/admin/listings?status=all&reported=1`} className="btn btn-outline btn-sm"><Eye size={14} /> Review listing</Link>}
                {r.target_type === 'conversation' && <Button size="sm" variant="outline" onClick={() => setViewConv(r.id)}><MessageCircle size={14} /> Read conversation</Button>}
                {r.target_user_id && r.status !== 'resolved' && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setMod({ userId: r.target_user_id, action: 'suspend', name: r.target_label })}><PauseCircle size={14} /> Suspend user</Button>
                    <Button size="sm" variant="outline" className="text-red-600" onClick={() => setMod({ userId: r.target_user_id, action: 'ban', name: r.target_label })}><Ban size={14} /> Ban user</Button>
                  </>
                )}
                {['open', 'investigating'].includes(r.status) && (
                  <>
                    {r.status === 'open' && <Button size="sm" variant="ghost" onClick={() => setResolve({ r, status: 'investigating' })}><SearchIcon size={14} /> Mark investigating</Button>}
                    <Button size="sm" onClick={() => setResolve({ r, status: 'resolved' })}><CheckCircle2 size={14} /> Resolve</Button>
                    <Button size="sm" variant="ghost" onClick={() => setResolve({ r, status: 'dismissed' })}><XCircle size={14} /> Dismiss</Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {viewConv && <ConversationViewer reportId={viewConv} onClose={() => setViewConv(null)} />}
      {resolve && (
        <ConfirmDialog open onClose={() => setResolve(null)} title={resolve.status === 'investigating' ? 'Mark as investigating' : resolve.status === 'resolved' ? 'Resolve report' : 'Dismiss report'}
          noteLabel="Resolution note (internal)" noteRequired={resolve.status !== 'investigating'} confirmLabel="Save"
          onConfirm={async (note) => { await api.post(`/api/admin/reports/${resolve.r.id}/status`, { status: resolve.status, note: note || undefined }); toast('Report updated'); reload(); }} />
      )}
      {mod && (
        <ConfirmDialog open onClose={() => setMod(null)} danger title={`${mod.action === 'ban' ? 'Ban' : 'Suspend'} this user?`} confirmLabel={mod.action === 'ban' ? 'Ban' : 'Suspend'}
          body={mod.action === 'ban' ? 'They will be signed out and blocked from the platform. Seller privileges are revoked.' : 'They can log in but cannot post or message, and their listings are hidden.'}
          noteLabel="Reason (shown to the user)" noteRequired
          onConfirm={async (reason) => { await api.post(`/api/admin/users/${mod.userId}/status`, { action: mod.action, reason }); toast('User updated'); reload(); }} />
      )}
    </div>
  );
}
