import { useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, User, Heart, MessageCircle, Bell, ShieldCheck, Store, CreditCard, LifeBuoy, List, CheckCircle2, Clock, AlertTriangle,
  Eye, Camera, Mail, Ban, CheckCheck, Plus, Lock, LogOut,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useFetch, usePageMeta } from '../../lib/hooks';
import { dateShort, dateTime, money, timeAgo } from '../../lib/format';
import type { ListingCard as L, Paged } from '../../lib/types';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { useToast } from '../../context/ToastContext';
import { ListingGrid } from '../../components/ListingCard';
import { PasswordInput } from '../Auth';
import {
  Avatar, Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, GridSkeleton, Input, Notice, PageHeader, Pagination, RowsSkeleton, StatCard, StatusBadge, Textarea,
  errMsg, fieldErrors,
} from '../../components/ui';

export function DashboardLayout() {
  const { user, counts, logout } = useAuth();
  const nav = useNavigate();
  const links = [
    { to: '/dashboard', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/dashboard/profile', label: 'My profile', icon: User },
    { to: '/dashboard/favorites', label: 'Favorites', icon: Heart },
    { to: '/messages', label: 'Conversations', icon: MessageCircle, badge: counts.unread_messages },
    { to: '/dashboard/notifications', label: 'Notifications', icon: Bell, badge: counts.unread_notifications },
    { to: '/dashboard/status', label: 'Account status', icon: ShieldCheck },
    ...(user?.is_seller ? [{ to: '/dashboard/listings', label: 'My listings', icon: List }] : []),
    { to: '/dashboard/seller', label: user?.is_seller ? 'Seller plan' : 'Become a seller', icon: Store },
    { to: '/dashboard/payments', label: 'Payment history', icon: CreditCard },
    { to: '/dashboard/help', label: 'Help & support', icon: LifeBuoy },
  ];
  const cls = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 h-10 rounded-xl text-sm font-semibold transition shrink-0 ${isActive ? 'bg-brand text-white' : 'text-ink-2 hover:bg-stone-100'}`;
  return (
    <div className="container-page py-5 md:py-8 grid md:grid-cols-[240px_1fr] gap-6">
      <aside className="md:sticky md:top-24 self-start">
        <div className="hidden md:flex items-center gap-3 mb-5 px-1">
          <Avatar name={user?.full_name} src={user?.avatar_url} size={44} />
          <div className="min-w-0">
            <p className="font-bold truncate">{user?.full_name}</p>
            <StatusBadge status={user?.status ?? 'approved'} />
          </div>
        </div>
        <nav aria-label="Dashboard" className="flex md:flex-col gap-1 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0">
          {links.map(({ to, label, icon: I, end, badge }) => (
            <NavLink key={to} to={to} end={end} className={cls}>
              <I size={18} /> <span className="flex-1">{label}</span>
              {!!badge && <span className="rounded-full bg-red-500 text-white text-[11px] px-1.5 min-w-5 text-center">{badge}</span>}
            </NavLink>
          ))}
          {user?.role === 'admin' && <NavLink to="/admin" className={cls}><ShieldCheck size={18} /> Admin panel</NavLink>}
          <button onClick={async () => { await logout(); nav('/'); }} className="md:hidden flex items-center gap-2 px-3 h-10 rounded-xl text-sm font-semibold text-red-600 shrink-0"><LogOut size={18} /> Log out</button>
        </nav>
      </aside>
      <div className="min-w-0"><Outlet /></div>
    </div>
  );
}

/** The user-facing explanation of the account state — shared by Overview and Account Status. */
export function AccountStatusNotice() {
  const { user } = useAuth();
  const toast = useToast();
  const [sending, setSending] = useState(false);
  if (!user) return null;
  const resend = async () => {
    setSending(true);
    try {
      const r = await api.post('/api/auth/resend-verification', { email: user.email });
      toast(r.message);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setSending(false);
    }
  };
  switch (user.status) {
    case 'email_unverified':
      return <Notice icon={Mail} title="Please verify your email address" action={<Button size="sm" variant="outline" loading={sending} onClick={resend}>Resend verification email</Button>}>
        We sent a verification link to <b>{user.email}</b>. Once you verify, your account is active and you can message sellers.</Notice>;
    case 'pending_approval':
      return <Notice icon={Clock} title="Your account is currently awaiting administrator approval.">You can browse and save listings now. Messaging sellers unlocks once an administrator approves your account — we'll email you.</Notice>;
    case 'approved':
      return <Notice tone="green" icon={CheckCircle2} title="Your account is active.">You can contact sellers on any live listing. To sell your own items, request seller approval from the Seller page.</Notice>;
    case 'rejected':
      return <Notice tone="red" icon={AlertTriangle} title="Your account was not approved for messaging">Contact support if you believe this is a mistake.</Notice>;
    case 'suspended':
      return <Notice tone="red" icon={Ban} title="Your account is suspended">You can't post, message or change your account while suspended. Contact support for help.</Notice>;
    default:
      return null;
  }
}

export function Overview() {
  usePageMeta('Dashboard');
  const { user } = useAuth();
  const { data, error, loading, reload } = useFetch<any>('/api/account/overview');
  if (loading) return <RowsSkeleton n={4} />;
  if (error || !data) return <ErrorState error={error} retry={reload} />;
  const c = data.counts;
  const sub = data.subscription;
  return (
    <div className="space-y-6">
      <PageHeader title={`Hi, ${user?.full_name.split(' ')[0]}`} subtitle={`Member since ${dateShort(data.member_since)}`}
        actions={user?.is_seller && <Link to="/dashboard/listings/new" className="btn btn-accent"><Plus size={16} /> New listing</Link>} />
      <AccountStatusNotice />
      {data.seller_request?.status === 'pending' && <Notice tone="blue" icon={Clock} title="Your seller authorization request is under review." />}
      {data.seller_request?.status === 'info_requested' && (
        <Notice tone="amber" title="The admin needs more information for your seller request" action={<Link to="/dashboard/seller" className="btn btn-sm btn-primary">Respond</Link>}>{data.seller_request.info_requested}</Notice>
      )}
      {sub?.status === 'awaiting_payment' && (
        <Notice tone="brand" icon={CreditCard} title={`Seller approved — complete payment for ${sub.plan_name}`} action={<Link to="/dashboard/seller" className="btn btn-sm btn-primary">Pay {money(sub.price, sub.currency)}</Link>}>
          Listing creation activates once your payment is verified.
        </Notice>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Saved listings" value={c.favorites} icon={Heart} to="/dashboard/favorites" />
        <StatCard label="Conversations" value={c.conversations} icon={MessageCircle} to="/messages" />
        <StatCard label="Unread notifications" value={c.unread_notifications} icon={Bell} tone={c.unread_notifications ? 'amber' : 'brand'} to="/dashboard/notifications" />
        {user?.is_seller || c.live_listings ? (
          <StatCard label="Live listings" value={c.live_listings} icon={Store} to="/dashboard/listings" />
        ) : (
          <StatCard label="Seller status" value={sub?.status === 'active' ? 'Active' : 'Not a seller'} icon={Store} to="/dashboard/seller" />
        )}
      </div>
      {(user?.is_seller || c.live_listings > 0) && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="In review" value={c.pending_listings} icon={Clock} tone="amber" to="/dashboard/listings?status=pending_approval" />
          <StatCard label="Need attention" value={c.needs_attention} icon={AlertTriangle} tone={c.needs_attention ? 'red' : 'brand'} to="/dashboard/listings?status=changes_requested" />
          <StatCard label="Total views" value={c.total_views} icon={Eye} />
        </div>
      )}
      {sub?.status === 'active' && (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-bold">{sub.plan_name}</p>
              <p className="text-sm text-muted">Active until {dateShort(sub.expires_at)}</p>
            </div>
            <Badge tone="green">Seller active</Badge>
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-sm mb-1"><span>Listings used</span><span className="font-semibold">{sub.listings_used} / {sub.listing_limit}</span></div>
            <div className="h-2 rounded-full bg-stone-100 overflow-hidden"><div className="h-full bg-brand" style={{ width: `${Math.min(100, (sub.listings_used / sub.listing_limit) * 100)}%` }} /></div>
          </div>
        </div>
      )}
      <div className="card">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="font-bold">Recent notifications</h2>
          <Link to="/dashboard/notifications" className="text-sm font-semibold text-brand">View all</Link>
        </div>
        {data.notifications.length === 0 ? <p className="p-5 text-sm text-muted">No notifications yet.</p> : (
          <ul>{data.notifications.map((n: any) => <NotificationRow key={n.id} n={n} />)}</ul>
        )}
      </div>
    </div>
  );
}

function NotificationRow({ n, onRead }: { n: any; onRead?: (id: string) => void }) {
  const nav = useNavigate();
  const open = () => {
    if (!n.read_at) {
      api.post(`/api/account/notifications/${n.id}/read`).catch(() => {});
      onRead?.(n.id);
    }
    if (n.link) nav(n.link);
  };
  return (
    <li>
      <button onClick={open} className={`w-full text-left flex gap-3 px-5 py-3.5 border-b border-line/70 last:border-0 hover:bg-stone-50 ${n.read_at ? '' : 'bg-brand-soft/60'}`}>
        <span className={`mt-1.5 size-2 rounded-full shrink-0 ${n.read_at ? 'bg-transparent' : 'bg-brand'}`} />
        <span className="min-w-0 flex-1">
          <span className={`block text-sm ${n.read_at ? 'font-medium' : 'font-bold'}`}>{n.title}</span>
          {n.body && <span className="block text-sm text-muted line-clamp-2">{n.body}</span>}
          <span className="block text-xs text-muted mt-0.5">{timeAgo(n.created_at)}</span>
        </span>
      </button>
    </li>
  );
}

export function Notifications() {
  usePageMeta('Notifications');
  const { refresh } = useAuth();
  const [page, setPage] = useState(1);
  const { data, error, loading, reload, setData } = useFetch<Paged<any>>(`/api/account/notifications?page=${page}`);
  const markAll = async () => {
    await api.post('/api/account/notifications/read-all');
    reload();
    refresh();
  };
  return (
    <div>
      <PageHeader title="Notifications" actions={<Button variant="outline" size="sm" onClick={markAll}><CheckCheck size={16} /> Mark all as read</Button>} />
      <div className="card overflow-hidden">
        {loading ? <div className="p-5"><RowsSkeleton /></div> : error ? <ErrorState error={error} retry={reload} /> : data!.items.length === 0 ? (
          <EmptyState icon={Bell} title="You're all caught up" body="Updates about your account, listings and messages appear here." />
        ) : (
          <ul>{data!.items.map((n) => <NotificationRow key={n.id} n={n} onRead={(id) => { setData((d) => d && { ...d, items: d.items.map((x) => (x.id === id ? { ...x, read_at: new Date().toISOString() } : x)) }); refresh(); }} />)}</ul>
        )}
      </div>
      {data && <Pagination page={data.page} pages={data.pages} onPage={setPage} />}
    </div>
  );
}

export function Favorites() {
  usePageMeta('Favorites');
  const { data, error, loading, reload } = useFetch<{ items: L[] }>('/api/account/favorites');
  return (
    <div>
      <PageHeader title="Favorites" subtitle="Listings you've saved." />
      {loading ? <GridSkeleton n={6} /> : error ? <ErrorState error={error} retry={reload} /> : data!.items.length === 0 ? (
        <div className="card"><EmptyState icon={Heart} title="No saved listings yet" body="Tap the heart on any listing to save it here." action={<Link to="/search" className="btn btn-primary">Browse listings</Link>} /></div>
      ) : <ListingGrid items={data!.items} />}
    </div>
  );
}

export function Profile() {
  usePageMeta('My profile');
  const { refresh, user } = useAuth();
  const toast = useToast();
  const { data, loading } = useFetch<{ profile: any }>('/api/account/profile');
  const [f, setF] = useState({ full_name: '', phone: '', location: '', bio: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [pw, setPw] = useState({ current_password: '', password: '', confirm_password: '' });
  const [pwErr, setPwErr] = useState<Record<string, string>>({});
  const [pwBusy, setPwBusy] = useState(false);
  const locked = user?.status === 'suspended';

  useEffect(() => {
    if (data) setF({ full_name: data.profile.full_name ?? '', phone: data.profile.phone ?? '', location: data.profile.location ?? '', bio: data.profile.bio ?? '' });
  }, [data]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await api.patch('/api/account/profile', f);
      await refresh();
      toast('Profile saved');
    } catch (e) {
      setErrors(fieldErrors(e));
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const upload = async (file: File) => {
    setAvatarBusy(true);
    const fd = new FormData();
    fd.append('avatar', file);
    try {
      await api.post('/api/account/avatar', fd);
      await refresh();
      toast('Photo updated');
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setAvatarBusy(false);
    }
  };
  const changePw = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.password !== pw.confirm_password) return setPwErr({ confirm_password: 'Passwords do not match.' });
    setPwBusy(true);
    setPwErr({});
    try {
      const r = await api.post('/api/auth/change-password', pw);
      toast(r.message);
      setPw({ current_password: '', password: '', confirm_password: '' });
    } catch (e) {
      const fe = fieldErrors(e);
      setPwErr(Object.keys(fe).length ? fe : { _: errMsg(e) });
    } finally {
      setPwBusy(false);
    }
  };

  if (loading) return <RowsSkeleton n={4} />;
  return (
    <div className="space-y-6">
      <PageHeader title="My profile" subtitle="This is what sellers and buyers see." />
      <form onSubmit={save} className="card p-5 sm:p-6 space-y-5">
        <div className="flex items-center gap-4">
          <Avatar name={user?.full_name} src={user?.avatar_url} size={72} />
          <label className={`btn btn-outline btn-sm cursor-pointer ${locked ? 'pointer-events-none opacity-50' : ''}`}>
            <Camera size={16} /> {avatarBusy ? 'Uploading…' : 'Change photo'}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={locked} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Full name" error={errors.full_name}><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} disabled={locked} /></Field>
          <Field label="Mobile number" error={errors.phone}><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} disabled={locked} /></Field>
          <Field label="Email" hint="Contact support to change your email."><Input value={user?.email ?? ''} disabled /></Field>
          <Field label="Location" error={errors.location}><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="e.g. Toronto, ON" disabled={locked} /></Field>
        </div>
        <Field label="About you" hint="Shown on your seller profile." error={errors.bio}><Textarea rows={3} maxLength={500} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} disabled={locked} /></Field>
        <div className="flex justify-end"><Button type="submit" loading={busy} disabled={locked}>Save changes</Button></div>
      </form>

      <form onSubmit={changePw} className="card p-5 sm:p-6 space-y-4">
        <h2 className="font-bold text-lg flex items-center gap-2"><Lock size={18} /> Change password</h2>
        {pwErr._ && <p className="text-sm text-red-600">{pwErr._}</p>}
        <Field label="Current password" error={pwErr.current_password}><PasswordInput autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="New password" error={pwErr.password}><PasswordInput autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /></Field>
          <Field label="Confirm new password" error={pwErr.confirm_password}><PasswordInput autoComplete="new-password" value={pw.confirm_password} onChange={(e) => setPw({ ...pw, confirm_password: e.target.value })} /></Field>
        </div>
        <div className="flex justify-end"><Button type="submit" variant="outline" loading={pwBusy} disabled={locked}>Update password</Button></div>
      </form>
    </div>
  );
}

export function AccountStatus() {
  usePageMeta('Account status');
  const { user } = useAuth();
  const { data: overview } = useFetch<any>('/api/account/overview');
  const { data: blocks, reload } = useFetch<{ items: { id: string; name: string; created_at: string }[] }>('/api/chat/blocks');
  const toast = useToast();
  const steps = [
    { label: 'Account created', done: true },
    { label: 'Email verified', done: !!user?.email_verified },
    { label: 'Approved by administrator', done: user?.status === 'approved' },
    { label: 'Seller authorization', done: !!user?.is_seller, optional: true },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Account status" />
      <AccountStatusNotice />
      {overview?.status_reason && <Notice tone="red" title="Note from the administrator">{overview.status_reason}</Notice>}
      <div className="card p-5 sm:p-6">
        <h2 className="font-bold mb-4">Your progress</h2>
        <ol className="space-y-4">
          {steps.map((s, i) => (
            <li key={s.label} className="flex items-center gap-3">
              <span className={`size-8 rounded-full grid place-items-center text-sm font-bold ${s.done ? 'bg-brand text-white' : 'bg-stone-100 text-muted'}`}>{s.done ? <CheckCircle2 size={18} /> : i + 1}</span>
              <span className={s.done ? 'font-semibold' : 'text-muted'}>{s.label}{s.optional && <span className="text-xs text-muted ml-1">(optional)</span>}</span>
            </li>
          ))}
        </ol>
        <dl className="grid sm:grid-cols-2 gap-3 mt-6 text-sm">
          <div className="rounded-xl bg-stone-50 p-3"><dt className="text-muted">Buyer messaging</dt><dd className="font-semibold">{user?.can_chat ? 'Enabled' : 'Not enabled'}</dd></div>
          <div className="rounded-xl bg-stone-50 p-3"><dt className="text-muted">Listing creation</dt><dd className="font-semibold">{user?.is_seller ? 'Enabled' : 'Not enabled'} {!user?.is_seller && <Link to="/dashboard/seller" className="text-brand ml-1">Request access</Link>}</dd></div>
        </dl>
      </div>
      <div className="card p-5 sm:p-6">
        <h2 className="font-bold mb-3">Blocked users</h2>
        {!blocks?.items.length ? <p className="text-sm text-muted">You haven't blocked anyone.</p> : (
          <ul className="divide-y divide-line">
            {blocks.items.map((b) => (
              <li key={b.id} className="flex items-center justify-between py-2.5">
                <span className="font-medium">{b.name} <span className="text-xs text-muted">· since {dateShort(b.created_at)}</span></span>
                <Button size="sm" variant="outline" onClick={async () => { await api.del(`/api/chat/blocks/${b.id}`); toast('Unblocked'); reload(); }}>Unblock</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function Payments() {
  usePageMeta('Payment history');
  const toast = useToast();
  const { data, error, loading, reload } = useFetch<{ payments: any[]; subscriptions: any[] }>('/api/seller/payments');
  const [refundId, setRefundId] = useState<string | null>(null);
  const requestRefund = async (reason: string) => {
    await api.post(`/api/seller/payments/${refundId}/refund-request`, { reason });
    toast('Refund requested');
    reload();
  };
  if (loading) return <RowsSkeleton />;
  if (error || !data) return <ErrorState error={error} retry={reload} />;
  return (
    <div className="space-y-6">
      <PageHeader title="Payment history" />
      {new URLSearchParams(location.search).get('checkout') === 'success' && (
        <Notice tone="green" icon={CheckCircle2} title="Payment received">We're confirming it with the payment provider. Your seller access activates automatically once confirmed.</Notice>
      )}
      <div className="card overflow-hidden">
        {data.payments.length === 0 ? <EmptyState icon={CreditCard} title="No payments yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-muted"><tr>
                <th className="px-4 py-3 font-semibold">Date</th><th className="px-4 py-3 font-semibold">Plan</th><th className="px-4 py-3 font-semibold">Amount</th>
                <th className="px-4 py-3 font-semibold">Method</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3" />
              </tr></thead>
              <tbody className="divide-y divide-line">
                {data.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 whitespace-nowrap">{dateTime(p.created_at)}</td>
                    <td className="px-4 py-3">{p.plan_name}</td>
                    <td className="px-4 py-3 font-semibold whitespace-nowrap">{money(p.amount, p.currency)}</td>
                    <td className="px-4 py-3 capitalize">{p.method.replace('_', ' ')}{p.reference_number && <span className="block text-xs text-muted">Ref: {p.reference_number}</span>}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={p.status} />
                      {p.refund_status !== 'none' && <div className="mt-1"><StatusBadge status={p.refund_status} /></div>}
                      {p.rejection_reason && <p className="text-xs text-red-600 mt-1">{p.rejection_reason}</p>}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {p.receipt_id && <a className="text-brand font-semibold mr-3" href={`/api/seller/receipts/${p.receipt_id}`} target="_blank" rel="noreferrer">Receipt</a>}
                      {p.status === 'verified' && p.refund_status === 'none' && p.method !== 'admin_waiver' && <button className="text-muted hover:text-ink" onClick={() => setRefundId(p.id)}>Request refund</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ConfirmDialog open={!!refundId} onClose={() => setRefundId(null)} onConfirm={requestRefund} title="Request a refund"
        body="An administrator will review your request. Refunds may end your seller access." noteLabel="Reason" noteRequired confirmLabel="Send request" />
      {data.subscriptions.length > 0 && (
        <div className="card p-5">
          <h2 className="font-bold mb-3">Seller plans</h2>
          <ul className="divide-y divide-line">
            {data.subscriptions.map((s) => (
              <li key={s.id} className="py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span><b>{s.plan_name}</b> · {money(s.price, s.currency)}<span className="block text-muted text-xs">{s.starts_at ? `${dateShort(s.starts_at)} → ${dateShort(s.expires_at)}` : `Assigned ${dateShort(s.created_at)}`} · {s.listings_used}/{s.listing_limit} listings used</span></span>
                <StatusBadge status={s.status} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function Help() {
  usePageMeta('Help & support');
  const faqs = [
    ['Why can’t I message sellers yet?', 'For everyone’s safety, every new account is reviewed by an administrator after email verification. You’ll get an email as soon as you’re approved.'],
    ['How do I become a seller?', 'Go to “Become a seller”, tell us what you plan to sell and submit the request. If approved, you’ll be assigned a plan; once your payment is verified you can post listings.'],
    ['Why isn’t my listing visible?', 'Every listing is reviewed before it goes live. Editing the title, price, description, category or photos of a live listing sends it back for review.'],
    ['How do I pay for a seller plan?', 'Use bank transfer and upload your receipt with the transaction reference, or pay online if available. Privileges activate only after the payment is verified.'],
    ['What happens when my plan expires?', 'Listing creation is disabled and your live listings are taken down until you renew. You’ll get a reminder before it expires.'],
    ['How do I report a problem?', 'Use “Report” on any listing, seller profile or conversation. Our moderators review every report.'],
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Help & support" />
      <div className="card divide-y divide-line">
        {faqs.map(([q, a]) => (
          <details key={q} className="group p-5">
            <summary className="font-semibold cursor-pointer list-none flex justify-between items-center">{q}<span className="text-muted group-open:rotate-45 transition text-xl leading-none">+</span></summary>
            <p className="mt-2 text-sm text-ink-2">{a}</p>
          </details>
        ))}
      </div>
      <ContactSupport />
    </div>
  );
}

function ContactSupport() {
  const { settings } = useSettings();
  return (
    <div className="card p-5">
      <h2 className="font-bold">Still need help?</h2>
      <p className="text-sm text-muted mt-1">Our support team is happy to help.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {settings?.contact.email && <a href={`mailto:${settings.contact.email}`} className="btn btn-outline btn-sm"><Mail size={16} /> {settings.contact.email}</a>}
        {settings?.contact.whatsapp && <a href={`https://wa.me/${settings.contact.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">WhatsApp</a>}
      </div>
    </div>
  );
}
