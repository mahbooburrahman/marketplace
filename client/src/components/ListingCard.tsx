import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Heart, MapPin, BadgeCheck, ImageOff, Sparkles, ChevronRight } from 'lucide-react';
import type { ListingCard as L } from '../lib/types';
import { CONDITIONS, money, timeAgo } from '../lib/format';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export function FavoriteButton({ listingId, initial, className = '', onChange }: { listingId: string; initial: boolean; className?: string; onChange?: (v: boolean) => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [fav, setFav] = useState(initial);
  const [busy, setBusy] = useState(false);
  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) return nav(`/login?next=${encodeURIComponent(location.pathname)}`);
    if (busy) return;
    setBusy(true);
    const next = !fav;
    setFav(next); // optimistic
    try {
      if (next) await api.post(`/api/account/favorites/${listingId}`);
      else await api.del(`/api/account/favorites/${listingId}`);
      onChange?.(next);
      toast(next ? 'Saved to favorites' : 'Removed from favorites', 'info');
    } catch {
      setFav(!next);
      toast('Could not update favorites', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button onClick={toggle} aria-pressed={fav} aria-label={fav ? 'Remove from favorites' : 'Save to favorites'}
      className={`grid place-items-center rounded-full transition active:scale-90 ${className}`}>
      <Heart size={18} className={fav ? 'fill-red-500 text-red-500' : 'text-ink'} />
    </button>
  );
}

/** Big "SOLD" stamp over a listing photo. */
export function SoldOverlay({ large }: { large?: boolean }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-black/25 pointer-events-none" aria-label="Sold">
      <span className={`-rotate-12 rounded-md border-2 border-white text-white font-black uppercase tracking-[0.2em] bg-ink/70 backdrop-blur-[1px] shadow-lg ${large ? 'text-3xl sm:text-5xl px-6 py-2' : 'text-base sm:text-xl px-3 py-1'}`}>Sold</span>
    </div>
  );
}

export function ListingCard({ l, onFavoriteChange, imageAction }: { l: L; onFavoriteChange?: (v: boolean) => void; imageAction?: React.ReactNode }) {
  return (
    <Link to={`/item/${l.slug}`} className="group card overflow-hidden flex flex-col hover:shadow-lg hover:shadow-stone-900/5 hover:-translate-y-0.5 transition duration-200">
      <div className="relative aspect-[4/3] bg-stone-100 overflow-hidden">
        {l.image ? (
          <img src={l.image} alt={l.title} loading="lazy" decoding="async" className={`size-full object-cover group-hover:scale-[1.03] transition duration-300 ${l.status === 'sold' ? 'grayscale opacity-60' : ''}`} />
        ) : (
          <div className="size-full grid place-items-center text-stone-400"><ImageOff size={28} /></div>
        )}
        {l.status === 'sold' && <SoldOverlay />}
        {imageAction && <div className="absolute bottom-2 right-2 z-10">{imageAction}</div>}
        <FavoriteButton listingId={l.id} initial={l.is_favorite} onChange={onFavoriteChange}
          className="absolute top-2 right-2 size-9 bg-white/90 backdrop-blur shadow-sm hover:bg-white" />
        <div className="absolute top-2 left-2 flex gap-1.5">
          {l.is_featured && (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent text-ink text-[11px] font-bold px-2 py-0.5 shadow-sm"><Sparkles size={12} /> Featured</span>
          )}
        </div>
      </div>
      <div className="p-3 flex flex-col gap-1 flex-1">
        <p className={`font-extrabold text-[17px] leading-tight ${l.status === 'sold' ? 'text-muted line-through decoration-2' : ''}`}>
          {money(l.price, l.currency)}
          {l.negotiable && <span className="ml-1.5 text-[11px] font-semibold text-muted align-middle">Negotiable</span>}
        </p>
        <h3 className="text-[14px] leading-snug text-ink-2 line-clamp-2 min-h-[2.5em]">{l.title}</h3>
        <div className="mt-auto pt-1 space-y-1 text-[12px] text-muted">
          <p className="flex items-center gap-1 truncate"><MapPin size={12} className="shrink-0" /> {l.location} · {timeAgo(l.published_at ?? l.created_at)}</p>
          <p className="flex items-center gap-1.5 truncate">
            <span className="rounded bg-stone-100 px-1.5 py-px font-medium text-ink-2">{CONDITIONS[l.condition] ?? l.condition}</span>
            <span className="truncate">{l.seller.name}</span>
            {l.seller.verified && <BadgeCheck size={14} className="text-brand shrink-0" aria-label="Verified seller" />}
          </p>
        </div>
      </div>
    </Link>
  );
}

export function ListingGrid({ items }: { items: L[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
      {items.map((l) => <ListingCard key={l.id} l={l} />)}
    </div>
  );
}

/** Horizontally scrolling strip on mobile, grid on desktop. */
export function ListingRail({ items }: { items: L[] }) {
  return (
    <div className="flex sm:grid sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 overflow-x-auto no-scrollbar snap-x -mx-4 px-4 sm:mx-0 sm:px-0 pb-1">
      {items.map((l) => (
        <div key={l.id} className="w-[46%] shrink-0 sm:w-auto snap-start"><ListingCard l={l} /></div>
      ))}
    </div>
  );
}

/** Compact product tile: soft grey image tile, heart, title, meta and price. */
export function ProductTile({ l }: { l: L }) {
  return (
    <Link to={`/item/${l.slug}`} className="group block min-w-0">
      <div className="relative aspect-square rounded-2xl bg-stone-100 overflow-hidden">
        {l.image ? (
          <img src={l.image} alt={l.title} loading="lazy" decoding="async" className={`size-full object-cover group-hover:scale-[1.04] transition duration-300 ${l.status === 'sold' ? 'grayscale opacity-60' : ''}`} />
        ) : (
          <div className="size-full grid place-items-center text-stone-400"><ImageOff size={28} /></div>
        )}
        <FavoriteButton listingId={l.id} initial={l.is_favorite} className="absolute top-2.5 right-2.5 size-8 bg-white/90 shadow-sm hover:bg-white" />
        {l.is_featured && <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-accent text-ink text-[10px] font-bold px-2 py-0.5"><Sparkles size={11} /> Featured</span>}
        {l.status === 'sold' && <SoldOverlay />}
      </div>
      <h3 className="mt-3 text-[15px] leading-snug text-ink line-clamp-2 min-h-[2.6em] group-hover:text-brand">{l.title}</h3>
      <p className="mt-1 flex items-center gap-1 text-[12px] text-muted truncate">
        <MapPin size={12} className="shrink-0" /> <span className="truncate">{l.location} · {timeAgo(l.published_at ?? l.created_at)}</span>
      </p>
      <p className="mt-1 flex items-center gap-1.5 text-[12px] text-muted truncate">
        <span className="truncate">{l.seller.name}</span>
        {l.seller.verified && <BadgeCheck size={14} className="text-brand shrink-0" aria-label="Verified seller" />}
      </p>
      <p className={`mt-1.5 font-extrabold text-[17px] leading-none ${l.status === 'sold' ? 'text-muted line-through decoration-2' : ''}`}>
        {money(l.price, l.currency)}
        {l.negotiable && <span className="ml-1.5 text-[11px] font-semibold text-muted">Negotiable</span>}
      </p>
    </Link>
  );
}

/** Titled product row: bold heading, "View All" link, 5 tiles on desktop, swipeable on phones. */
export function ProductRow({ title, to, items }: { title: string; to?: string; items: L[] }) {
  if (!items.length) return null;
  return (
    <section className="mt-12" aria-label={title}>
      <div className="flex items-end justify-between mb-5">
        <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight">{title}</h2>
        {to && <Link to={to} className="text-sm font-semibold text-brand hover:underline flex items-center gap-0.5">View All <ChevronRight size={16} /></Link>}
      </div>
      <div className="flex sm:grid sm:grid-cols-3 lg:grid-cols-5 gap-4 overflow-x-auto no-scrollbar snap-x -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 sm:[&>*:nth-child(n+7)]:hidden lg:[&>*:nth-child(n+6)]:hidden">
        {items.slice(0, 10).map((l) => (
          <div key={l.id} className="w-[44%] shrink-0 sm:w-auto snap-start"><ProductTile l={l} /></div>
        ))}
      </div>
    </section>
  );
}
