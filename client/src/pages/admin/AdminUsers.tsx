import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, CheckCircle2, XCircle, Ban, PauseCircle, RotateCcw, Store, ShieldCheck, Mail, Phone } from 'lucide-react';
import { api } from '../../lib/api';
import { useDebounced, useFetch, usePageMeta } from '../../lib/hooks';
import { dateShort, dateTime, money } from '../../lib/format';
import { useToast } from '../../context/ToastContext';
import { Avatar, Badge, Button, ConfirmDialog, ErrorState, Input, Modal, PageHeader, Pagination, RowsSkeleton, Select, StatusBadge, errMsg } from '../../components/ui';
import { AssignPlanDialog } from './AdminSellers';

type Action = 'approve' | 'reject' | 'suspend' | 'ban' | 'restore';
const ACTIONS: Record<Action, { label: string; icon: any; danger?: boolean; note?: boolean; body: string }> = {
  approve: { label: 'Approve', icon: CheckCircle2, body: 'The user will be able to contact sellers. They will be notified by email.' },
  reject: { label: 'Reject', icon: XCircle, danger: true, note: true, body: 'The user will not get messaging access.' },
  suspend: { label: 'Suspend', icon: PauseCircle, danger: true, note: true, body: 'The user can log in but cannot post, message or edit. Their listings are hidden.' },
  ban: { label: 'Ban', icon: Ban, danger: true, note: true, body: 'The user is signed out everywhere, cannot log in, and seller privileges are revoked.' },
  restore: { label: 'Restore', icon: RotateCcw, body: 'The account returns to approved (or unverified if the email was never verified).' },
};

function UserDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { data, error, loading, reload } = useFetch<any>(`/api/admin/users/${id}`);
  const [action, setAction] = useState<Action | null>(null);
  const [assign, setAssign] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const u = data?.user;
  const available: Action[] = !u ? [] : u.status === 'banned' || u.status === 'suspended' || u.status === 'rejected'
    ? ['restore', ...(u.status !== 'banned' ? (['ban'] as Action[]) : [])]
    : u.status === 'approved' ? ['suspend', 'ban'] : u.status === 'pending_approval' ? ['approve', 'reject', 'ban'] : ['ban'];
  const done = () => { reload(); onChanged(); };

  return (
    <Modal open onClose={onClose} title="User details" wide>
      {loading ? <RowsSkeleton /> : error || !u ? <ErrorState error={error} retry={reload} /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-4">
            <Avatar name={u.full_name} src={u.avatar_url} size={64} />
            <div className="flex-1 min-w-0">
              <p className="text-lg font-bold">{u.full_name} {u.role === 'admin' && <Badge tone="brand">Admin</Badge>}</p>
              <p className="text-sm text-muted flex items-center gap-1.5"><Mail size={14} /> {u.email} {u.email_verified_at ? <Badge tone="green">verified</Badge> : <Badge tone="amber">unverified</Badge>}</p>
              <p className="text-sm text-muted flex items-center gap-1.5"><Phone size={14} /> {u.phone || '—'} · {u.location || 'No location'}</p>
            </div>
            <div className="text-right space-y-1">
              <StatusBadge status={u.status} />
              {u.is_seller && <div><Badge tone="brand"><Store size={11} /> Active seller</Badge></div>}
            </div>
          </div>
          {u.status_reason && <p className="text-sm rounded-xl bg-red-50 text-red-800 p-3"><b>Reason on file:</b> {u.status_reason}</p>}
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="rounded-xl bg-stone-50 p-3"><dt className="text-muted">Joined</dt><dd className="font-semibold">{dateShort(u.created_at)}</dd></div>
            <div className="rounded-xl bg-stone-50 p-3"><dt className="text-muted">Last seen</dt><dd className="font-semibold">{dateTime(u.last_seen_at)}</dd></div>
            <div className="rounded-xl bg-stone-50 p-3"><dt className="text-muted">Approved</dt><dd className="font-semibold">{u.approved_at ? `${dateShort(u.approved_at)}${u.approved_by_name ? ` by ${u.approved_by_name}` : ''}` : '—'}</dd></div>
            <div className="rounded-xl bg-stone-50 p-3"><dt className="text-muted">Listings</dt><dd className="font-semibold">{data.listing_counts.map((c: any) => `${c.n} ${c.status.replace('_', ' ')}`).join(', ') || '0'}</dd></div>
          </dl>

          {u.role !== 'admin' && (
            <div className="flex flex-wrap gap-2">
              {available.map((a) => {
                const A = ACTIONS[a];
                return <Button key={a} size="sm" variant={A.danger ? 'danger' : 'primary'} onClick={() => setAction(a)}><A.icon size={15} /> {A.label}</Button>;
              })}
              {['approved', 'pending_approval'].includes(u.status) && u.email_verified_at && <Button size="sm" variant="outline" onClick={() => setAssign(true)}><Store size={15} /> Grant seller plan</Button>}
              <Link to={`/admin/listings?seller=${u.id}`} className="btn btn-outline btn-sm">View listings</Link>
            </div>
          )}
          <div className="flex flex-wrap gap-2 items-center text-sm">
            <span className="text-muted">Role:</span> <b>{u.role}</b>
            <Button size="sm" variant="ghost" onClick={() => setRoleOpen(true)}><ShieldCheck size={15} /> {u.role === 'admin' ? 'Remove admin role' : 'Make administrator'}</Button>
          </div>

          <section>
            <h3 className="font-bold mb-2">Permissions</h3>
            {data.permissions.length === 0 ? <p className="text-sm text-muted">No special permissions. Messaging access follows the account status.</p> : (
              <ul className="text-sm space-y-1">{data.permissions.map((p: any) => <li key={p.permission_code}><code className="bg-stone-100 rounded px-1.5">{p.permission_code}</code> {p.expires_at && <span className="text-muted">until {dateShort(p.expires_at)}</span>}</li>)}</ul>
            )}
          </section>
          {data.subscriptions.length > 0 && (
            <section>
              <h3 className="font-bold mb-2">Seller plans</h3>
              <ul className="text-sm divide-y divide-line">{data.subscriptions.map((s: any) => (
                <li key={s.id} className="py-2 flex justify-between gap-2"><span>{s.plan_name} · {money(s.price, s.currency)} · {s.listings_used}/{s.listing_limit} used {s.expires_at && `· until ${dateShort(s.expires_at)}`}</span><StatusBadge status={s.status} /></li>
              ))}</ul>
            </section>
          )}
          {data.payments.length > 0 && (
            <section>
              <h3 className="font-bold mb-2">Payments</h3>
              <ul className="text-sm divide-y divide-line">{data.payments.map((p: any) => (
                <li key={p.id} className="py-2 flex justify-between gap-2"><span>{dateShort(p.created_at)} · {money(p.amount, p.currency)} · {p.method.replace('_', ' ')}{p.reference_number && ` · ref ${p.reference_number}`}</span><StatusBadge status={p.status} /></li>
              ))}</ul>
            </section>
          )}
          {data.reports.length > 0 && (
            <section>
              <h3 className="font-bold mb-2 text-red-700">Reports against this user</h3>
              <ul className="text-sm divide-y divide-line">{data.reports.map((r: any) => <li key={r.id} className="py-2 flex justify-between"><span>{r.reason.replace('_', ' ')} — {r.details}</span><StatusBadge status={r.status} /></li>)}</ul>
            </section>
          )}
          <section>
            <h3 className="font-bold mb-2">Activity</h3>
            <ul className="text-xs divide-y divide-line max-h-64 overflow-y-auto">
              {data.activity.map((a: any, i: number) => (
                <li key={i} className="py-1.5 flex justify-between gap-3"><span><span className="font-mono">{a.action}</span>{a.actor_name && <span className="text-muted"> by {a.actor_name}</span>}</span><span className="text-muted whitespace-nowrap">{dateTime(a.created_at)}</span></li>
              ))}
            </ul>
          </section>
        </div>
      )}
      {action && u && (
        <ConfirmDialog open onClose={() => setAction(null)} title={`${ACTIONS[action].label} ${u.full_name}?`} body={ACTIONS[action].body} danger={ACTIONS[action].danger}
          confirmLabel={ACTIONS[action].label} noteLabel={ACTIONS[action].note ? 'Reason (shown to the user)' : undefined} noteRequired={ACTIONS[action].note}
          onConfirm={async (note) => { await api.post(`/api/admin/users/${u.id}/status`, { action, reason: note || undefined }); toast(`User ${action === 'ban' ? 'banned' : action + 'd'}`); done(); }} />
      )}
      {roleOpen && u && (
        <ConfirmDialog open onClose={() => setRoleOpen(false)} title={u.role === 'admin' ? 'Remove administrator role?' : 'Make this user an administrator?'}
          body={u.role === 'admin' ? 'They will lose access to the admin panel.' : 'Administrators have full control of the platform, including users, listings and payments.'} danger={u.role !== 'admin'}
          onConfirm={async () => { await api.post(`/api/admin/users/${u.id}/role`, { role: u.role === 'admin' ? 'user' : 'admin' }); toast('Role updated'); done(); }} />
      )}
      {assign && u && <AssignPlanDialog title={`Grant seller plan to ${u.full_name}`} endpoint={`/api/admin/users/${u.id}/grant-seller`} onClose={() => setAssign(false)} onDone={done} />}
    </Modal>
  );
}

export default function AdminUsers() {
  usePageMeta('Users');
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const status = params.get('status') ?? '';
  const sellers = params.get('sellers') ?? '';
  const page = Number(params.get('page') ?? 1);
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, loading, reload } = useFetch<any>(`/api/admin/users?status=${status}&sellers=${sellers}&q=${encodeURIComponent(dq)}&page=${page}`);
  const quickApprove = async (id: string) => {
    try {
      await api.post(`/api/admin/users/${id}/status`, { action: 'approve' });
      toast('User approved');
      reload();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };
  return (
    <div>
      <PageHeader title="Users" subtitle="Approve accounts for messaging, and moderate members." />
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={16} className="absolute left-3 top-3.5 text-muted" />
          <Input placeholder="Search name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <Select value={status} onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})} className="w-52">
          <option value="">All statuses</option>
          {['email_unverified', 'pending_approval', 'approved', 'rejected', 'suspended', 'banned'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </Select>
        <Button variant={sellers ? 'primary' : 'outline'} onClick={() => setParams(sellers ? {} : { sellers: '1' })}><Store size={16} /> Active sellers</Button>
      </div>
      <div className="card overflow-x-auto">
        {loading ? <div className="p-5"><RowsSkeleton /></div> : error ? <ErrorState error={error} retry={reload} /> : (
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-muted"><tr>
              <th className="px-4 py-3">User</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Joined</th><th className="px-4 py-3" />
            </tr></thead>
            <tbody className="divide-y divide-line">
              {data.items.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">No users found.</td></tr>}
              {data.items.map((u: any) => (
                <tr key={u.id} className="hover:bg-stone-50">
                  <td className="px-4 py-3">
                    <button onClick={() => setOpen(u.id)} className="text-left">
                      <span className="font-semibold hover:underline">{u.full_name}</span> {u.role === 'admin' && <Badge tone="brand">admin</Badge>} {u.is_seller && <Badge tone="brand">seller</Badge>}
                      <span className="block text-xs text-muted">{u.email}</span>
                    </button>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{u.phone}</td>
                  <td className="px-4 py-3"><StatusBadge status={u.status} /></td>
                  <td className="px-4 py-3 whitespace-nowrap">{dateShort(u.created_at)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {u.status === 'pending_approval' && <Button size="sm" onClick={() => quickApprove(u.id)}><CheckCircle2 size={14} /> Approve</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setOpen(u.id)}>Manage</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {data && <Pagination page={data.page} pages={data.pages} onPage={(p) => setParams({ ...Object.fromEntries(params), page: String(p) })} />}
      {open && <UserDetail id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}
