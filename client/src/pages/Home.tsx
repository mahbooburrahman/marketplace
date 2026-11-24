import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BadgeCheck, ShieldCheck, MessageCircle, Sparkles, Clock, Eye } from 'lucide-react';
import { api } from '../lib/api';
import { useFetch, usePageMeta } from '../lib/hooks';
import { recentlyViewed } from '../lib/format';
import type { ListingCard as L } from '../lib/types';
import { useSettings } from '../context/SettingsContext';
import { useCity, GTA_CITIES, citySlug } from '../lib/geo';
import { useAuth } from '../context/AuthContext';
import { ListingRail, ProductRow } from '../components/ListingCard';
import { Avatar, EmptyState, ErrorState, GridSkeleton } from '../components/ui';
import { HeroSlider, HotCard, CategoryCircles, type Banner } from '../components/HeroSlider';

interface HomeData {
  featured: L[];
  recent: L[];
  recommended: L[];
  popular_categories: { id: string; name: string; slug: string; icon: string; listing_count: number; image_url: string | null }[];
  seller_highlights: { id: string; name: string; avatar_url: string | null; location: string | null; active_listings: number; created_at: string }[];
}

function Section({ title, icon: I, to, children }: { title: string; icon?: React.ComponentType<{ size?: number | string; className?: string }>; to?: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-extrabold flex items-center gap-2">{I && <I size={20} className="text-brand" />}{title}</h2>
        {to && <Link to={to} className="text-sm font-semibold text-brand hover:underline flex items-center gap-1">See all <ArrowRight size={14} /></Link>}
      </div>
      {children}
    </section>
  );
}

export default function Home() {
  const { settings, categories } = useSettings();
  const { user } = useAuth();
  const { near } = useCity(settings?.site.locations);
  usePageMeta('Buy & Sell in the GTA — Toronto, Mississauga, Brampton', 'Free local classifieds for the Greater Toronto Area: buy and sell electronics, furniture, household items and more in Toronto, Mississauga, Brampton, Markham and Vaughan.');
  const { data, error, loading, reload } = useFetch<HomeData>(`/api/listings/home${near ? `?near=${encodeURIComponent(near)}` : ''}`);
  const [recent, setRecent] = useState<L[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);

  useEffect(() => {
    api.get<{ items: Banner[] }>('/api/banners').then((r) => setBanners(r.items)).catch(() => {});
  }, []);

  useEffect(() => {
    const ids = recentlyViewed.get();
    if (ids.length) api.get<{ items: L[] }>(`/api/listings/by-ids?ids=${ids.join(',')}`).then((r) => setRecent(r.items)).catch(() => {});
  }, []);

  const featuredSlides = data?.featured.slice(0, 4) ?? [];
  const hot = data ? ([...data.recommended, ...data.recent].find((x) => !featuredSlides.some((f) => f.id === x.id)) ?? data.recommended[0] ?? data.recent[0]) : undefined;
  const sellTo = user ? '/dashboard/seller' : '/register';

  return (
    <div>
      <div className="container-page">
        <h1 className="sr-only">{settings?.site.tagline ?? 'Buy and sell locally, safely.'}</h1>

        {/* Slider + hot item */}
        <section aria-label="Highlights" className="mt-4 sm:mt-6 grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 min-w-0"><HeroSlider listings={featuredSlides} banners={banners} sellTo={sellTo} /></div>
          <HotCard item={hot} loading={loading} sellTo={sellTo} />
        </section>

        <CategoryCircles categories={categories} />

        {loading && <div className="mt-10"><GridSkeleton n={8} /></div>}
        {!!error && <ErrorState error={error} retry={reload} />}

        {data && (
          <>
            <ProductRow title="Featured picks" to="/search?featured=1" items={data.featured} />

            {data.recent.length ? <ProductRow title="Just listed near you" to="/search?sort=newest" items={data.recent} /> : (
              <Section title="Recently added" icon={Clock}><div className="card"><EmptyState title="No listings yet" body="Listings appear here as soon as our team approves them." /></div></Section>
            )}

            <ProductRow title={user ? 'Recommended for you' : 'Popular right now'} items={data.recommended} />

            {recent.length > 0 && <Section title="Recently viewed" icon={Eye}><ListingRail items={recent} /></Section>}
          </>
        )}

        <section className="mt-14" aria-labelledby="home-gta">
          <h2 id="home-gta" className="text-xl sm:text-2xl font-extrabold mb-3">Buy &amp; sell across the Greater Toronto Area</h2>
          <p className="text-sm text-muted mb-4 max-w-2xl">Find local deals near you — from Toronto and Mississauga to Brampton, Markham, Vaughan and Oakville.</p>
          <div className="flex flex-wrap gap-2">
            {GTA_CITIES.map((c) => <Link key={c} to={`/city/${citySlug(c)}`} className="chip">{c}</Link>)}
            <Link to="/guides" className="chip chip-active">Buying &amp; selling guides</Link>
          </div>
        </section>

        {/* Trust strip */}
        <section className="mt-14 grid sm:grid-cols-3 gap-3">
          {[
            [ShieldCheck, 'Moderated listings', 'Nothing goes live until an administrator approves it.'],
            [BadgeCheck, 'Authorized sellers', 'Only verified, approved sellers can post.'],
            [MessageCircle, 'Private messaging', 'Chat safely inside the platform — no need to share your number.'],
          ].map(([I, t, b]: any) => (
            <div key={t} className="card p-5 flex gap-3">
              <I size={22} className="text-brand shrink-0" />
              <div><p className="font-bold">{t}</p><p className="text-sm text-muted mt-0.5">{b}</p></div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
