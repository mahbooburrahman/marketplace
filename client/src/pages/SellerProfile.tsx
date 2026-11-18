import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { BadgeCheck, MapPin, CalendarDays, Flag } from 'lucide-react';
import { useFetch, usePageMeta } from '../lib/hooks';
import type { ListingCard as L } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { ListingGrid } from '../components/ListingCard';
import { ReportDialog } from '../components/ReportDialog';
import { Avatar, Button, EmptyState, ErrorState, GridSkeleton } from '../components/ui';

interface Data {
  seller: { id: string; name: string; avatar_url: string | null; location: string | null; bio: string | null; member_since: string; verified: boolean; status: string; active_listings: number; sold_listings: number };
  listings: L[];
  sold: L[];
}

export default function SellerProfile() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data, error, loading, reload } = useFetch<Data>(`/api/sellers/${id}`);
  const [tab, setTab] = useState<'active' | 'sold'>('active');
  const [report, setReport] = useState(false);
  usePageMeta(data ? `${data.seller.name} — seller` : 'Seller');

  if (loading) return <div className="container-page py-8"><div className="skeleton h-36 mb-6" /><GridSkeleton /></div>;
  if (error || !data) return <div className="container-page py-10"><ErrorState error={error} retry={reload} /></div>;
  const s = data.seller;
  const items = tab === 'active' ? data.listings : data.sold;

  return (
    <div className="container-page py-6">
      <div className="card p-5 sm:p-6 flex flex-col sm:flex-row gap-5 sm:items-center">
        <Avatar name={s.name} src={s.avatar_url} size={88} />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-extrabold flex items-center gap-2">{s.name}{s.verified && <BadgeCheck className="text-brand" size={22} aria-label="Verified seller" />}</h1>
          <p className="text-sm font-semibold text-brand-dark">{s.status}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            {s.location && <span className="flex items-center gap-1"><MapPin size={14} /> {s.location}</span>}
            <span className="flex items-center gap-1"><CalendarDays size={14} /> Member since {new Date(s.member_since).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })}</span>
          </div>
          {s.bio && <p className="mt-3 text-[15px] text-ink-2 max-w-2xl">{s.bio}</p>}
        </div>
        <div className="flex sm:flex-col gap-3 text-center">
          <div className="card px-5 py-3"><p className="text-2xl font-extrabold">{s.active_listings}</p><p className="text-xs text-muted">Active</p></div>
          <div className="card px-5 py-3"><p className="text-2xl font-extrabold">{s.sold_listings}</p><p className="text-xs text-muted">Sold</p></div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-8 mb-4">
        <div className="flex gap-2" role="tablist">
          <button role="tab" aria-selected={tab === 'active'} className={`chip ${tab === 'active' ? 'chip-active' : ''}`} onClick={() => setTab('active')}>Active listings</button>
          <button role="tab" aria-selected={tab === 'sold'} className={`chip ${tab === 'sold' ? 'chip-active' : ''}`} onClick={() => setTab('sold')}>Sold</button>
        </div>
        {user && user.id !== s.id && <Button variant="ghost" size="sm" onClick={() => setReport(true)}><Flag size={15} /> Report seller</Button>}
      </div>
      {items.length ? <ListingGrid items={items} /> : <div className="card"><EmptyState title={tab === 'active' ? 'No active listings' : 'Nothing sold yet'} /></div>}
      <ReportDialog open={report} onClose={() => setReport(false)} targetType="user" targetId={s.id} label="seller" />
    </div>
  );
}
