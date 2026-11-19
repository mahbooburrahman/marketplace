import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Search, MapPin, Heart, MessageCircle, User, Home, Bell, Plus, LogOut, LayoutDashboard, Shield, ChevronDown, X, WifiOff, Store, LayoutGrid, Gift } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { Avatar, CategoryIcon } from './ui';
import { BrandLogo } from './BrandLogo';
import { useOnline } from '../lib/hooks';
import { useCity } from '../lib/geo';
import { api, qs } from '../lib/api';
import { money } from '../lib/format';

type Suggestion = { slug: string; title: string; price: number | string; currency: string; location: string | null; category: string; image: string | null };

function Logo() {
  const { settings } = useSettings();
  const site = settings?.site;
  return (
    <Link to="/" className="flex items-center gap-2 shrink-0" aria-label={`${site?.name ?? 'Marketplace'} home`}>
      {site?.logo_url ? (
        <img src={site.logo_url} alt={site.name} className="h-9 w-auto max-w-[160px] object-contain" />
      ) : (
        <BrandLogo markSize={30} textClass="text-[24px] hidden sm:block" />
      )}
    </Link>
  );
}

function SuggestBox({ q, near, onPick }: { q: string; near: string; onPick: () => void }) {
  const [items, setItems] = useState<Suggestion[]>([]);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setItems([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api.get<{ items: Suggestion[] }>(`/api/listings/suggest${qs({ q: term, near })}`, ctl.signal)
        .then((r) => setItems(r.items)).catch(() => { /* ignore */ });
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, near]);
  const term = q.trim();
  if (term.length < 2) return null;
  return (
    <div role="listbox" className="absolute left-0 right-0 top-full mt-2 z-50 rounded-2xl bg-white border border-line shadow-lg overflow-hidden">
      <Link to={`/search?q=${encodeURIComponent(term)}`} onClick={onPick} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-stone-50">
        <Search size={16} className="text-muted shrink-0" /> <span className="truncate">Search for “<b>{term}</b>”</span>
      </Link>
      {items.map((it) => (
        <Link key={it.slug} to={`/item/${it.slug}`} onClick={onPick} role="option" className="flex items-center gap-3 px-4 py-2 hover:bg-stone-50 border-t border-line/60">
          <span className="size-10 rounded-lg bg-stone-100 overflow-hidden shrink-0">
            {it.image && <img src={it.image} alt="" className="size-full object-cover" loading="lazy" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium truncate">{it.title}</span>
            <span className="block text-xs text-muted truncate">{it.category}{it.location ? ` · ${it.location}` : ''}</span>
          </span>
          <span className="text-sm font-semibold shrink-0">{money(it.price, it.currency)}</span>
        </Link>
      ))}
    </div>
  );
}

function SearchBar({ className = '', autoFocus }: { className?: string; autoFocus?: boolean; showLocation?: boolean }) {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { settings } = useSettings();
  const { near } = useCity(settings?.site.locations);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { setQ(params.get('q') ?? ''); }, [params]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, []);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setOpen(false);
    const sp = new URLSearchParams(location.pathname === '/search' ? params : undefined);
    q.trim() ? sp.set('q', q.trim()) : sp.delete('q');
    sp.delete('page');
    nav(`/search?${sp}`);
  };
  return (
    <div ref={box} className={`relative ${className}`}>
      <form onSubmit={submit} role="search" className="flex items-center h-12 rounded-full bg-stone-100 border border-transparent focus-within:bg-white focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/15 transition">
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} autoFocus={autoFocus} autoComplete="off"
          placeholder="Search for anything: phones, cars, furniture…" aria-label="Search listings"
          className="flex-1 min-w-0 bg-transparent pl-5 pr-2 outline-none text-[15px]" />
        <button type="submit" aria-label="Search" className="size-9 m-1.5 shrink-0 rounded-full bg-brand text-white grid place-items-center hover:bg-brand-dark active:scale-95 transition"><Search size={18} /></button>
      </form>
      {open && <SuggestBox q={q} near={near} onPick={() => setOpen(false)} />}
    </div>
  );
}

/** "Showing ads near: <city>" — the visitor's city is detected automatically and ads from it are listed first. */
function LocationPicker() {
  const { settings } = useSettings();
  const { city, setCity, detecting } = useCity(settings?.site.locations);
  return (
    <label className="hidden lg:flex items-center gap-2 shrink-0 cursor-pointer rounded-xl px-2 py-1 hover:bg-stone-100">
      <MapPin size={22} className="text-brand shrink-0" />
      <span className="leading-tight">
        <span className="block text-[11px] text-muted">{detecting ? 'Finding your city…' : 'Ads near'}</span>
        <span className="relative flex items-center text-[13px] font-semibold">
          <select value={city} onChange={(e) => setCity(e.target.value)} aria-label="Your city" className="appearance-none bg-transparent outline-none cursor-pointer pr-5 max-w-[150px] truncate">
            <option value="">All locations</option>
            {settings?.site.locations.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-0 text-muted" />
        </span>
      </span>
    </label>
  );
}

function CategoriesMenu() {
  const { categories } = useSettings();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const here = useLocation();
  useEffect(() => { setOpen(false); }, [here.pathname]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, []);
  return (
    <div className="relative shrink-0" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true" className="flex items-center gap-2 h-9 px-3 rounded-lg text-[13px] font-semibold hover:bg-stone-100">
        <LayoutGrid size={16} /> All Categories <ChevronDown size={14} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="animate-rise absolute left-0 top-full mt-2 w-[min(760px,92vw)] card shadow-xl p-3 z-50 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1">
          {categories.map((c) => (
            <Link key={c.id} to={`/category/${c.slug}`} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-brand-soft text-sm font-medium">
              <span className="size-8 shrink-0 rounded-full bg-brand-soft text-brand grid place-items-center"><CategoryIcon name={c.icon} size={16} /></span>
              <span className="truncate">{c.name}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  if (!user) return null;
  const item = 'flex items-center gap-2.5 px-3 py-2.5 rounded-lg hover:bg-stone-100 text-sm font-medium';
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 rounded-full p-1 pr-2 hover:bg-stone-100" aria-expanded={open} aria-haspopup="menu">
        <Avatar name={user.full_name} src={user.avatar_url} size={32} />
        <ChevronDown size={16} className="text-muted" />
      </button>
      {open && (
        <div role="menu" className="animate-rise absolute right-0 mt-2 w-60 card shadow-xl p-1.5 z-50" onClick={() => setOpen(false)}>
          <div className="px-3 py-2 border-b border-line mb-1">
            <p className="font-semibold truncate">{user.full_name}</p>
            <p className="text-xs text-muted truncate">{user.email}</p>
          </div>
          <Link to="/dashboard" className={item}><LayoutDashboard size={16} /> Dashboard</Link>
          <Link to="/dashboard/favorites" className={item}><Heart size={16} /> Favorites</Link>
          {user.is_seller && <Link to="/dashboard/listings" className={item}><Store size={16} /> My listings</Link>}
          {user.role === 'admin' && <Link to="/admin" className={item}><Shield size={16} /> Admin panel</Link>}
          <button className={`${item} w-full text-red-600`} onClick={async () => { await logout(); nav('/'); }}><LogOut size={16} /> Log out</button>
        </div>
      )}
    </div>
  );
}

function CountDot({ n }: { n: number }) {
  if (!n) return null;
  return <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold grid place-items-center ring-2 ring-white">{n > 99 ? '99+' : n}</span>;
}

function Header() {
  const { user, counts } = useAuth();
  const { categories } = useSettings();
  const [mobileSearch, setMobileSearch] = useState(false);
  const loc = useLocation();
  useEffect(() => { setMobileSearch(false); }, [loc.pathname, loc.search]);
  const iconBtn = 'relative size-10 grid place-items-center rounded-full hover:bg-stone-100 text-ink-2';
  const hideCats = /^\/(dashboard|admin|messages)/.test(loc.pathname);
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-line">
      <div className="container-page flex items-center gap-3 lg:gap-5 h-[68px] md:h-20">
        <Logo />
        <SearchBar showLocation={false} className="hidden md:flex flex-1 max-w-3xl mx-auto lg:mx-2" />
        <LocationPicker />
        <div className="ml-auto md:ml-0 flex items-center gap-1">
          <button className={`${iconBtn} md:hidden`} onClick={() => setMobileSearch((s) => !s)} aria-label="Search">{mobileSearch ? <X size={20} /> : <Search size={20} />}</button>
          {user ? (
            <>
              <Link to="/messages" className={`${iconBtn} hidden md:grid`} aria-label="Messages"><MessageCircle size={20} /><CountDot n={counts.unread_messages} /></Link>
              <Link to="/dashboard/notifications" className={iconBtn} aria-label="Notifications"><Bell size={20} /><CountDot n={counts.unread_notifications} /></Link>
              {user.is_seller && (
                <Link to="/dashboard/listings/new" className="btn btn-accent btn-sm hidden sm:inline-flex"><Plus size={16} /> Sell</Link>
              )}
              <div className="hidden md:block"><UserMenu /></div>
            </>
          ) : (
            <>
              <Link to="/login" className="flex items-center gap-1.5 px-3 h-10 rounded-full text-sm font-semibold hover:bg-stone-100"><User size={18} className="hidden sm:block" /> Sign in</Link>
              <Link to="/register" className="btn btn-primary btn-sm">Sign up</Link>
            </>
          )}
        </div>
      </div>
      {mobileSearch && <div className="md:hidden px-4 pb-3"><SearchBar autoFocus /></div>}
      {!hideCats && categories.length > 0 && (
        <>
          <div className="hidden md:block border-t border-line/70">
            <nav aria-label="Categories" className="container-page flex items-center gap-1 h-12">
              <CategoriesMenu />
              <span className="mx-1 h-5 w-px bg-line" aria-hidden />
              <div className="flex-1 min-w-0 flex items-center gap-1 overflow-hidden">
                {categories.slice(0, 8).map((c) => (
                  <NavLink key={c.id} to={`/category/${c.slug}`}
                    className={({ isActive }) => `shrink-0 px-3 h-9 grid place-items-center rounded-lg text-[13px] whitespace-nowrap transition ${isActive ? 'text-brand font-semibold' : 'font-medium text-ink-2 hover:text-brand'}`}>
                    {c.name}
                  </NavLink>
                ))}
              </div>
              <Link to="/search?featured=1" className="shrink-0 flex items-center gap-1.5 px-3 h-9 rounded-lg text-sm font-semibold text-brand hover:bg-brand-soft"><Gift size={18} /> Best deals</Link>
            </nav>
          </div>
          <nav aria-label="Categories" className="md:hidden container-page flex gap-1 overflow-x-auto no-scrollbar h-11 items-center border-t border-line/70">
            {categories.map((c) => (
              <NavLink key={c.id} to={`/category/${c.slug}`}
                className={({ isActive }) => `flex items-center gap-1.5 shrink-0 px-3 h-8 rounded-lg text-[13px] font-medium transition ${isActive ? 'bg-brand-soft text-brand-dark' : 'text-ink-2 hover:bg-stone-100'}`}>
                <CategoryIcon name={c.icon} size={15} /> {c.name}
              </NavLink>
            ))}
          </nav>
        </>
      )}
    </header>
  );
}

function BottomNav() {
  const { user, counts } = useAuth();
  const items = [
    { to: '/', icon: Home, label: 'Home', end: true },
    { to: '/search', icon: Search, label: 'Search' },
    { to: user ? '/dashboard/favorites' : '/login', icon: Heart, label: 'Favorites' },
    { to: user ? '/messages' : '/login', icon: MessageCircle, label: 'Messages', badge: counts.unread_messages },
    { to: user ? '/dashboard' : '/login', icon: User, label: 'Profile' },
  ];
  return (
    <nav aria-label="Primary" className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-line safe-bottom">
      <div className="grid grid-cols-5 h-16">
        {items.map(({ to, icon: I, label, end, badge }) => (
          <NavLink key={label} to={to} end={end}
            className={({ isActive }) => `relative flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${isActive ? 'text-brand' : 'text-muted'}`}>
            <span className="relative"><I size={22} />{!!badge && <CountDot n={badge} />}</span>
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function Footer() {
  const { settings, categories } = useSettings();
  const s = settings;
  return (
    <footer className="bg-ink text-stone-300 mt-16 pb-20 md:pb-0">
      <div className="container-page py-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <BrandLogo reversed markSize={32} textClass="text-[26px]" />
          <p className="mt-2 text-sm text-stone-400 max-w-xs">{s?.site.tagline}</p>
        </div>
        <div>
          <p className="text-white font-semibold mb-3">Categories</p>
          <ul className="space-y-2 text-sm">{categories.slice(0, 6).map((c) => <li key={c.id}><Link className="hover:text-white" to={`/category/${c.slug}`}>{c.name}</Link></li>)}</ul>
        </div>
        <div>
          <p className="text-white font-semibold mb-3">Marketplace</p>
          <ul className="space-y-2 text-sm">
            <li><Link className="hover:text-white" to="/search">Browse listings</Link></li>
            <li><Link className="hover:text-white" to="/dashboard/seller">Become a seller</Link></li>
            <li><Link className="hover:text-white" to="/dashboard/help">Help & safety</Link></li>
            <li><Link className="hover:text-white" to="/terms">Terms and conditions</Link></li>
            <li><Link className="hover:text-white" to="/privacy">Privacy policy</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-white font-semibold mb-3">Contact</p>
          <ul className="space-y-2 text-sm">
            {s?.contact.email && <li><a className="hover:text-white" href={`mailto:${s.contact.email}`}>{s.contact.email}</a></li>}
            {s?.contact.phone && <li><a className="hover:text-white" href={`tel:${s.contact.phone}`}>{s.contact.phone}</a></li>}
            {s?.contact.address && <li className="text-stone-400">{s.contact.address}</li>}
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="container-page py-5 text-xs text-stone-500">© {new Date().getFullYear()} {s?.site.name}. All rights reserved.</p>
      </div>
    </footer>
  );
}

function OfflineBar() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="bg-ink text-white text-sm py-2 px-4 flex items-center justify-center gap-2" role="status">
      <WifiOff size={16} /> You're offline. Some actions won't work until you reconnect.
    </div>
  );
}

export function Layout() {
  const loc = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  const isChat = loc.pathname.startsWith('/messages/');
  return (
    <div className="min-h-dvh flex flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 btn btn-primary">Skip to content</a>
      <OfflineBar />
      <div className={isChat ? 'hidden md:block' : ''}><Header /></div>
      <main id="main" className={`flex-1 ${isChat ? '' : 'pb-20 md:pb-0'}`}><Outlet /></main>
      {!isChat && <Footer />}
      {!isChat && <BottomNav />}
    </div>
  );
}

