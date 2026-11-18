import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard, Users, Store, List, CreditCard, FolderTree, Flag, Settings, History, ArrowLeft, UserCheck, Clock, BadgeCheck, Wallet,
  CheckCircle2, XCircle, MessageCircle, Ban, Megaphone, Layers,
} from 'lucide-react';
import { useFetch, usePageMeta } from '../../lib/hooks';
import { dateTime, money } from '../../lib/format';
import { useSocketEvent } from '../../context/SocketContext';
import { useSiteName } from '../../context/SettingsContext';
import { ErrorState, PageHeader, Pagination, RowsSkeleton, Select, StatCard, Input, Badge } from '../../components/ui';

export function AdminLayout() {
  const site = useSiteName();
  const { data, reload } = useFetch<any>('/api/admin/overview');
  useSocketEvent('admin:queue', () => reload());
  const s = data?.stats;
  const links = [
    { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/admin/users', label: 'Users', icon: Users, badge: s?.pending_users },
    { to: '/admin/sellers', label: 'Sellers', icon: Store, badge: s?.seller_requests },
    { to: '/admin/listings', label: 'Listings', icon: List, badge: s?.pending_listings },
    { to: '/admin/payments', label: 'Payments', icon: CreditCard, badge: s?.pending_payments },
    { to: '/admin/plans', label: 'Seller plans', icon: Layers },
    { to: '/admin/categories', label: 'Categories', icon: FolderTree },
    { to: '/admin/reports', label: 'Reports', icon: Flag, badge: s?.open_reports },
    { to: '/admin/announcements', label: 'Announcements', icon: Megaphone },
    { to: '/admin/settings', label: 'Settings', icon: Settings },
    { to: '/admin/activity', label: 'Activity log', icon: History },
  ];
  const cls = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 h-10 rounded-xl text-sm font-semibold transition shrink-0 ${isActive ? 'bg-white text-ink shadow-sm' : 'text-stone-300 hover:bg-white/10 hover:text-white'}`;
  return (
    <div className="min-h-[calc(100dvh-4rem)] md:grid md:grid-cols-[240px_1fr]">
      <aside className="bg-ink md:min-h-full p-3 md:p-4">
        <div className="hidden md:block px-2 mb-4">
          <p className="text-white font-extrabold">{site}</p>
          <p className="text-xs text-stone-400">Administration</p>
        </div>
        <nav aria-label="Admin" className="flex md:flex-col gap-1 overflow-x-auto no-scrollbar">
          {links.map(({ to, label, icon: I, end, badge }) => (
            <NavLink key={to} to={to} end={end} className={cls}>
              <I size={18} /><span className="flex-1">{label}</span>
              {!!badge && <span className="rounded-full bg-accent text-ink text-[11px] font-bold px-1.5 min-w-5 text-center">{badge}</span>}
            </NavLink>
          ))}
          <Link to="/" className="flex items-center gap-3 px-3 h-10 rounded-xl text-sm font-semibold text-stone-400 hover:text-white shrink-0 md:mt-4"><ArrowLeft size={18} /> Back to site</Link>
        </nav>
      </aside>
      <div className="min-w-0 p-4 sm:p-6 lg:p-8 bg-canvas"><Outlet context={{ reloadCounts: reload }} /></div>
    </div>
  );
}

function RevenueBars({ rows }: { rows: { month: string; currency: string; total: number }[] }) {
  if (!rows.length) return <p className="text-sm text-muted">No verified revenue yet.</p>;
  const max = Math.max(...rows.map((r) => Number(r.total)));
  return (
    <div className="flex items-end gap-2 h-40" role="img" aria-label="Monthly revenue chart">
      {rows.map((r) => (
        <div key={r.month + r.currency} className="flex-1 flex flex-col items-center gap-1 min-w-0">
          <span className="text-[10px] text-muted">{Math.round(Number(r.total) / 1000)}k</span>
          <div className="w-full rounded-t-md bg-brand" style={{ height: `${Math.max(4, (Number(r.total) / max) * 120)}px` }} title={`${r.month}: ${money(r.total, r.currency)}`} />
          <span className="text-[10px] text-muted">{r.month.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

export function AdminOverview() {
  usePageMeta('Admin');
  const { data, error, loading, reload } = useFetch<any>('/api/admin/overview');
  if (loading) return <RowsSkeleton n={6} />;
  if (error || !data) return <ErrorState error={error} retry={reload} />;
  const s = data.stats;
  return (
    <div className="space-y-6">
      <PageHeader title="Overview" subtitle="Everything that needs your attention, at a glance." />
      <div>
        <h2 className="text-sm font-bold text-muted uppercase tracking-wide mb-2">Needs action</h2>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatCard label="Pending user approvals" value={s.pending_users} icon={UserCheck} tone={s.pending_users ? 'amber' : 'brand'} to="/admin/users?status=pending_approval" />
          <StatCard label="Seller requests" value={s.seller_requests} icon={Store} tone={s.seller_requests ? 'amber' : 'brand'} to="/admin/sellers" />
          <StatCard label="Pending payments" value={s.pending_payments} icon={Wallet} tone={s.pending_payments ? 'amber' : 'brand'} to="/admin/payments?status=under_review" />
          <StatCard label="Listings to review" value={s.pending_listings} icon={Clock} tone={s.pending_listings ? 'amber' : 'brand'} to="/admin/listings?status=pending_approval" />
          <StatCard label="Reported listings" value={s.reported_listings} icon={Flag} tone={s.reported_listings ? 'red' : 'brand'} to="/admin/reports" />
        </div>
      </div>
      <div>
        <h2 className="text-sm font-bold text-muted uppercase tracking-wide mb-2">Platform</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Registered users" value={s.total_users} icon={Users} to="/admin/users" />
          <StatCard label="Verified emails" value={s.verified_users} icon={BadgeCheck} />
          <StatCard label="Approved users" value={s.approved_users} icon={CheckCircle2} to="/admin/users?status=approved" />
          <StatCard label="Suspended / banned" value={s.suspended_users} icon={Ban} to="/admin/users?status=suspended" />
          <StatCard label="Active sellers" value={s.active_sellers} icon={Store} to="/admin/users?sellers=1" />
          <StatCard label="Published listings" value={s.published_listings} icon={List} to="/admin/listings?status=published" />
          <StatCard label="Rejected listings" value={s.rejected_listings} icon={XCircle} to="/admin/listings?status=rejected" />
          <StatCard label="Active conversations (30d)" value={s.active_conversations} icon={MessageCircle} />
        </div>
      </div>
      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-4">
        <div className="card p-5">
          <div className="flex justify-between items-baseline mb-4">
            <h2 className="font-bold">Revenue</h2>
            <p className="text-2xl font-extrabold">{money(s.total_revenue)}</p>
          </div>
          <RevenueBars rows={data.revenue} />
        </div>
        <div className="card">
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <h2 className="font-bold">Recent activity</h2>
            <Link to="/admin/activity" className="text-sm font-semibold text-brand">View log</Link>
          </div>
          <ul className="divide-y divide-line">
            {data.activity.map((a: any) => (
              <li key={a.id} className="px-5 py-2.5 text-sm">
                <span className="font-semibold">{a.actor_name ?? 'System'}</span> <span className="text-muted">{a.action.replace(/[._]/g, ' ')}</span>
                <span className="block text-xs text-muted">{dateTime(a.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function AdminActivity() {
  usePageMeta('Activity log');
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [adminOnly, setAdminOnly] = useState('1');
  const { data, error, loading, reload } = useFetch<any>(`/api/admin/activity?page=${page}&action=${encodeURIComponent(action)}&admin=${adminOnly}`);
  return (
    <div>
      <PageHeader title="Activity log" subtitle="An append-only record of every important action. Entries cannot be edited or deleted." />
      <div className="flex flex-wrap gap-2 mb-4">
        <Input placeholder="Filter by action, e.g. listing. or payment.verified" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="max-w-sm" />
        <Select value={adminOnly} onChange={(e) => { setAdminOnly(e.target.value); setPage(1); }} className="w-56">
          <option value="1">Admin & system actions</option><option value="0">All actions</option>
        </Select>
      </div>
      <div className="card overflow-x-auto">
        {loading ? <div className="p-5"><RowsSkeleton /></div> : error ? <ErrorState error={error} retry={reload} /> : (
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-muted"><tr>
              <th className="px-4 py-3">When</th><th className="px-4 py-3">Who</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Target</th><th className="px-4 py-3">Details</th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {data.items.map((a: any) => (
                <tr key={a.id} className="align-top">
                  <td className="px-4 py-2.5 whitespace-nowrap">{dateTime(a.created_at)}</td>
                  <td className="px-4 py-2.5">{a.actor_name ?? (a.actor_role === 'system' ? 'System' : '—')}{a.actor_role === 'admin' && <Badge tone="brand" className="ml-1">admin</Badge>}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{a.action}</td>
                  <td className="px-4 py-2.5 text-xs">{a.target_type && <>{a.target_type} <span className="text-muted font-mono">{String(a.target_id).slice(0, 8)}</span></>}</td>
                  <td className="px-4 py-2.5 text-xs text-muted max-w-sm break-words">{Object.keys(a.meta ?? {}).length ? JSON.stringify(a.meta) : ''}{a.ip && <span className="block">IP {a.ip}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {data && <Pagination page={data.page} pages={data.pages} onPage={setPage} />}
    </div>
  );
}
