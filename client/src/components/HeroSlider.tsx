import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, Flame, ImageOff, MapPin, Sparkles } from 'lucide-react';
import type { ListingCard as L, Category } from '../lib/types';
import { money } from '../lib/format';
import { api } from '../lib/api';
import { CategoryIcon } from './ui';

type PromoSlide = { kind: 'promo'; key: string; eyebrow: string; title: string; body: string; cta: string; to: string; art: string };
type ListingSlide = { kind: 'listing'; key: string; l: L };
export type Banner = { id: string; title: string; cta: string; link_url: string; image_url: string | null };
type BannerSlide = { kind: 'banner'; key: string; b: Banner };
type Slide = PromoSlide | ListingSlide | BannerSlide;

const seenBanners = new Set<string>();
const track = (id: string, what: 'view' | 'click') => { api.post(`/api/banners/${id}/${what}`).catch(() => {}); };

const FRAME = 'h-[300px] sm:h-[380px]';

function promoSlides(sellTo: string): PromoSlide[] {
  return [
    { kind: 'promo', key: 'sell', eyebrow: 'Sell on SaudaGo', title: 'Sell your stuff in minutes.', body: 'Reach buyers across Toronto and the GTA.', cta: 'Start selling', to: sellTo, art: '/hero/art-sell.svg' },
    { kind: 'promo', key: 'deals', eyebrow: 'Fresh listings', title: 'Great deals, close to home.', body: 'Browse new local listings every day.', cta: 'Browse listings', to: '/search?sort=newest', art: '/hero/art-deals.svg' },
    { kind: 'promo', key: 'safe', eyebrow: 'Buy with confidence', title: 'Safe deals with verified sellers.', body: 'Every ad is reviewed before it goes live.', cta: 'See listings', to: '/search', art: '/hero/art-safe.svg' },
  ];
}

function SlideView({ s, active }: { s: Slide; active: boolean }) {
  const tab = active ? 0 : -1;
  if (s.kind === 'banner') {
    const b = s.b;
    const external = /^https?:\/\//i.test(b.link_url);
    const inner = (
      <>
        <img src={b.image_url ?? ''} alt={b.title || 'Advertisement'} className="absolute inset-0 size-full object-cover" />
        <span className="absolute left-3 top-3 rounded-full bg-black/55 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5">Ad</span>
        {(b.title || b.cta) && (
          <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6 bg-gradient-to-t from-black/70 to-transparent flex items-end justify-between gap-3">
            <p className="text-lg sm:text-2xl font-extrabold leading-tight line-clamp-2 min-w-0">{b.title}</p>
            {b.cta && <span className="btn btn-accent shrink-0">{b.cta}</span>}
          </div>
        )}
      </>
    );
    const cls = 'absolute inset-0 block';
    if (!b.link_url) return <div className={cls}>{inner}</div>;
    return external
      ? <a href={b.link_url} target="_blank" rel="sponsored noopener noreferrer" tabIndex={tab} onClick={() => track(b.id, 'click')} className={cls}>{inner}</a>
      : <Link to={b.link_url} tabIndex={tab} onClick={() => track(b.id, 'click')} className={cls}>{inner}</Link>;
  }
  if (s.kind === 'listing') {
    const l = s.l;
    return (
      <div className="absolute inset-0">
        {l.image && (
          <img src={l.image} alt="" className="absolute right-0 top-0 h-full w-[62%] object-cover [mask-image:linear-gradient(to_right,transparent,#000_45%)] [-webkit-mask-image:linear-gradient(to_right,transparent,#000_45%)]" />
        )}
        <div className="relative z-10 h-full flex flex-col justify-center px-6 sm:px-12 max-w-[70%] sm:max-w-[56%]">
          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-accent text-ink px-3 py-1 text-xs font-bold"><Sparkles size={12} /> Featured ad</span>
          <h2 className="mt-3 text-xl sm:text-3xl font-extrabold leading-tight line-clamp-2">{l.title}</h2>
          <p className="mt-2 text-2xl sm:text-3xl font-extrabold text-accent">{money(l.price, l.currency)}</p>
          <p className="mt-1 text-sm text-white/80 flex items-center gap-1 min-w-0"><MapPin size={14} className="shrink-0" /><span className="truncate">{l.location} · {l.category.name}</span></p>
          <Link to={`/item/${l.slug}`} tabIndex={tab} className="btn bg-white text-ink hover:bg-stone-100 mt-4 w-fit">View ad <ArrowRight size={16} /></Link>
        </div>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 flex items-center">
      <div className="relative z-10 px-6 sm:px-12 max-w-[64%] sm:max-w-[56%]">
        <p className="text-[11px] sm:text-sm font-bold tracking-[0.18em] uppercase text-accent">{s.eyebrow}</p>
        <h2 className="mt-2 text-2xl sm:text-4xl font-extrabold leading-tight">{s.title}</h2>
        <p className="mt-2 text-sm sm:text-base text-white/80 line-clamp-2">{s.body}</p>
        <Link to={s.to} tabIndex={tab} className="btn btn-accent mt-5 sm:mt-6 w-fit">{s.cta}</Link>
      </div>
      <img src={s.art} alt="" className="absolute right-0 bottom-0 h-[88%] w-auto max-w-[48%] object-contain object-right-bottom" />
    </div>
  );
}

/** Home page slider: featured ads first, then a few SaudaGo promo slides. */
export function HeroSlider({ listings, banners = [], sellTo }: { listings: L[]; banners?: Banner[]; sellTo: string }) {
  const slides: Slide[] = [...banners.map((b): Slide => ({ kind: 'banner', key: `b-${b.id}`, b })), ...listings.map((l): Slide => ({ kind: 'listing', key: l.id, l })), ...promoSlides(sellTo)];
  const n = slides.length;
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchX = useRef<number | null>(null);
  const idx = i % n;
  const cur = slides[idx];
  useEffect(() => {
    if (cur?.kind === 'banner' && !seenBanners.has(cur.b.id)) { seenBanners.add(cur.b.id); track(cur.b.id, 'view'); }
  }, [cur]);

  useEffect(() => {
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (paused || n < 2 || reduced) return undefined;
    const t = window.setInterval(() => setI((x) => x + 1), 6000);
    return () => window.clearInterval(t);
  }, [paused, n]);

  const go = (k: number) => setI(((k % n) + n) % n);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured ads and offers"
      className={`relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand to-brand-dark text-white ${FRAME}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > 40) go(idx + (dx < 0 ? 1 : -1));
      }}
    >
      <div className="absolute -right-24 -top-24 size-80 rounded-full bg-white/5" aria-hidden />
      <div className="absolute right-32 -bottom-32 size-64 rounded-full bg-accent/15" aria-hidden />
      {slides.map((s, k) => (
        <div
          key={s.key}
          role="group"
          aria-roledescription="slide"
          aria-label={`${k + 1} of ${n}`}
          aria-hidden={k !== idx}
          className={`absolute inset-0 transition-opacity duration-500 ${k === idx ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none'}`}
        >
          <SlideView s={s} active={k === idx} />
        </div>
      ))}
      {n > 1 && (
        <>
          <button type="button" onClick={() => go(idx - 1)} aria-label="Previous slide" className="hidden sm:grid absolute left-3 top-1/2 -translate-y-1/2 z-20 size-10 place-items-center rounded-full bg-white/90 text-ink shadow hover:bg-white"><ChevronLeft size={20} /></button>
          <button type="button" onClick={() => go(idx + 1)} aria-label="Next slide" className="hidden sm:grid absolute right-3 top-1/2 -translate-y-1/2 z-20 size-10 place-items-center rounded-full bg-white/90 text-ink shadow hover:bg-white"><ChevronRight size={20} /></button>
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 rounded-full bg-black/25 px-2.5 py-1.5">
            {slides.map((s, k) => (
              <button key={s.key} type="button" onClick={() => go(k)} aria-label={`Go to slide ${k + 1}`} aria-current={k === idx} className={`h-2 rounded-full transition-all ${k === idx ? 'w-5 bg-white' : 'w-2 bg-white/60 hover:bg-white/80'}`} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** The box next to the slider: one hot listing, or a "start selling" prompt when there is none. */
export function HotCard({ item, loading, sellTo }: { item?: L; loading: boolean; sellTo: string }) {
  if (loading) return <div className={`rounded-3xl bg-stone-200 animate-pulse ${FRAME}`} aria-hidden />;
  if (!item) {
    return (
      <Link to={sellTo} className={`relative block overflow-hidden rounded-3xl bg-accent-soft border border-line ${FRAME}`}>
        <img src="/hero/art-sell.svg" alt="" className="absolute -right-6 -bottom-4 h-3/4 w-auto opacity-90" />
        <div className="relative z-10 p-6 max-w-[70%]">
          <p className="text-xs font-bold tracking-[0.18em] uppercase text-brand">Be the first</p>
          <p className="mt-2 text-2xl font-extrabold leading-tight">Post the first ad in your area.</p>
          <span className="btn btn-primary mt-5 w-fit">Start selling</span>
        </div>
      </Link>
    );
  }
  return (
    <Link to={`/item/${item.slug}`} className={`group relative block overflow-hidden rounded-3xl bg-brand-soft ${FRAME}`}>
      {item.image ? (
        <img src={item.image} alt="" className="absolute inset-0 size-full object-cover transition duration-500 group-hover:scale-105" />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-muted"><ImageOff size={40} /></div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" aria-hidden />
      <span className="absolute left-4 top-4 inline-flex items-center gap-1 rounded-full bg-red-500 px-3 py-1 text-xs font-bold text-white shadow"><Flame size={14} /> Hot right now</span>
      <div className="absolute inset-x-0 bottom-0 p-5 text-white">
        <p className="text-lg font-bold leading-snug line-clamp-2">{item.title}</p>
        <p className="mt-1 text-2xl font-extrabold text-accent">{money(item.price, item.currency)}</p>
        <p className="mt-0.5 text-sm text-white/80 flex items-center gap-1"><MapPin size={14} className="shrink-0" /><span className="truncate">{item.location}</span></p>
      </div>
    </Link>
  );
}

const TINTS = [
  'bg-emerald-50 text-emerald-700',
  'bg-amber-50 text-amber-700',
  'bg-sky-50 text-sky-700',
  'bg-rose-50 text-rose-700',
  'bg-violet-50 text-violet-700',
  'bg-orange-50 text-orange-700',
];

/** Square category tiles in a grid. Uses the category photo when the admin has uploaded one. */
export function CategoryCircles({ categories }: { categories: Category[] }) {
  const row = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const check = () => {
    const el = row.current;
    if (el) setEdge({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  };
  useEffect(() => {
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [categories.length]);
  if (!categories.length) return null;
  const move = (dir: 1 | -1) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.8, behavior: 'smooth' });
  return (
    <section className="mt-10" aria-labelledby="home-categories">
      <div className="flex items-end justify-between mb-4">
        <h2 id="home-categories" className="text-xl sm:text-2xl font-extrabold">Explore popular categories</h2>
        <Link to="/search" className="text-sm font-semibold text-brand hover:underline flex items-center gap-1">View all <ChevronRight size={16} /></Link>
      </div>
      <div className="relative">
        <div ref={row} onScroll={check} className="flex gap-3 overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-smooth -mx-4 px-4 sm:mx-0 sm:px-0 pb-1">
          {categories.map((c, k) => (
            <Link key={c.id} to={`/category/${c.slug}`} className="card group snap-start shrink-0 w-[112px] sm:w-[136px] p-2.5 flex flex-col gap-2 hover:border-brand/40 hover:shadow-md transition">
              <span className={`w-full aspect-square rounded-xl grid place-items-center overflow-hidden ${TINTS[k % TINTS.length]}`}>
                {c.image_url ? <img src={c.image_url} alt="" loading="lazy" className="size-full object-cover" /> : <CategoryIcon name={c.icon} size={36} />}
              </span>
              <span className="w-full text-center text-[12px] sm:text-[13px] font-semibold leading-tight line-clamp-2 break-words">{c.name}</span>
            </Link>
          ))}
        </div>
        {!edge.start && <button type="button" onClick={() => move(-1)} aria-label="Previous categories" className="hidden sm:grid absolute -left-3 top-1/2 -translate-y-1/2 size-10 rounded-full bg-white border border-line shadow place-items-center hover:bg-stone-50"><ChevronLeft size={20} /></button>}
        {!edge.end && <button type="button" onClick={() => move(1)} aria-label="Next categories" className="hidden sm:grid absolute -right-3 top-1/2 -translate-y-1/2 size-10 rounded-full bg-white border border-line shadow place-items-center hover:bg-stone-50"><ChevronRight size={20} /></button>}
      </div>
    </section>
  );
}
