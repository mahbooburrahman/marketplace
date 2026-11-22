import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MapPin, Clock, Tag, BadgeCheck, MessageCircle, Flag, Share2, Phone, Eye, ShieldCheck, Lock, ArrowLeft, Pencil, CheckCircle2, RotateCcw } from 'lucide-react';
import { api } from '../lib/api';
import { useFetch, usePageMeta } from '../lib/hooks';
import { CONDITIONS, dateShort, money, recentlyViewed, timeAgo } from '../lib/format';
import type { ListingCard as L, ListingDetail as D } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Gallery } from '../components/Gallery';
import { FavoriteButton, ListingRail } from '../components/ListingCard';
import { ReportDialog } from '../components/ReportDialog';
import { Avatar, Button, ConfirmDialog, ErrorState, Notice, StatusBadge, Textarea, errMsg } from '../components/ui';

function videoEmbed(url: string | null) {
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
}

/** Seller-only: switch the listing between sold and available. */
function OwnerActions({ l, onChanged }: { l: D; onChanged: () => void }) {
  const toast = useToast();
  const [ask, setAsk] = useState(false);
  const sold = l.status === 'sold';
  const run = async () => {
    await api.post(`/api/my/listings/${l.id}/${sold ? 'available' : 'sold'}`);
    toast(sold ? 'Listing is available again' : 'Marked as sold');
    onChanged();
  };
  return (
    <div className="space-y-2">
      <Link to={`/dashboard/listings/${l.id}/edit`} className="btn btn-outline w-full"><Pencil size={16} /> Edit your listing</Link>
      {(l.status === 'published' || sold) && (
        <Button className="w-full" variant={sold ? 'primary' : 'outline'} onClick={() => setAsk(true)}>
          {sold ? <><RotateCcw size={16} /> Mark as available</> : <><CheckCircle2 size={16} /> Mark as sold</>}
        </Button>
      )}
      <ConfirmDialog open={ask} onClose={() => setAsk(false)} onConfirm={run}
        title={sold ? 'Mark as available?' : 'Mark as sold?'}
        body={sold ? 'Your listing will go live again and buyers can message you.' : 'Buyers will see this item as sold and can no longer message you about it.'}
        confirmLabel={sold ? 'Mark available' : 'Mark sold'} />
    </div>
  );
}

function ContactBox({ l, onChanged }: { l: D; onChanged: () => void }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [msg, setMsg] = useState(`Hi, is "${l.title}" still available?`);
  const [busy, setBusy] = useState(false);

  if (l.is_owner) {
    return <OwnerActions l={l} onChanged={onChanged} />;
  }
  if (l.status !== 'published') return null;
  if (!user) {
    return (
      <div className="space-y-2">
        <Link to={`/login?next=/item/${l.slug}`} className="btn btn-primary w-full"><MessageCircle size={18} /> Log in to contact seller</Link>
        <p className="text-xs text-muted text-center">New here? <Link to="/register" className="text-brand font-semibold">Create a free account</Link></p>
      </div>
    );
  }
  if (!user.email_verified) {
    return <Notice title="Verify your email to contact sellers" icon={Lock}>Check your inbox for the verification link, or <Link className="underline font-semibold" to="/dashboard/status">resend it</Link>.</Notice>;
  }
  if (!user.can_chat) {
    return <Notice title="Messaging not yet enabled" icon={Lock}>Messaging is switched off for your account right now. Please contact support if you think this is a mistake.</Notice>;
  }
  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ conversation_id: string }>('/api/chat/conversations', { listing_id: l.id, message: msg.trim() || undefined });
      nav(`/messages/${r.conversation_id}`);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <label htmlFor="contact-msg" className="text-sm font-semibold">Send seller a message</label>
      <Textarea id="contact-msg" rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={4000} />
      <Button className="w-full" loading={busy} onClick={send}><MessageCircle size={18} /> Contact seller</Button>
    </div>
  );
}

export default function ListingDetail() {
  const { slug } = useParams();
  const toast = useToast();
  const { user } = useAuth();
  const nav = useNavigate();
  const { data, error, loading, reload } = useFetch<{ listing: D; similar: L[] }>(`/api/listings/${slug}`);
  const l = data?.listing;
  const [report, setReport] = useState(false);
  const [showPhone, setShowPhone] = useState(false);
  usePageMeta(l?.title, l ? `${money(l.price, l.currency)} · ${l.location} · ${l.description.slice(0, 120)}` : undefined);

  useEffect(() => {
    if (l?.status === 'published') recentlyViewed.push(l.id);
  }, [l?.id, l?.status]);

  if (loading) {
    return (
      <div className="container-page py-6 grid lg:grid-cols-[1fr_380px] gap-6">
        <div className="skeleton aspect-[4/3] rounded-2xl" />
        <div className="space-y-3"><div className="skeleton h-8 w-2/3" /><div className="skeleton h-6 w-1/3" /><div className="skeleton h-40" /></div>
      </div>
    );
  }
  if (error || !l) return <div className="container-page py-10"><ErrorState error={error} retry={reload} /></div>;

  const embed = videoEmbed(l.video_url);
  const share = async () => {
    const url = location.href;
    try {
      if (navigator.share) await navigator.share({ title: l.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast('Link copied');
      }
    } catch { /* cancelled */ }
  };

  return (
    <div className="pb-24 lg:pb-0">
      <div className="container-page pt-4 lg:pt-6">
        <button onClick={() => (history.length > 1 ? nav(-1) : nav('/'))} className="lg:hidden mb-3 flex items-center gap-1 text-sm font-semibold text-ink-2"><ArrowLeft size={16} /> Back</button>
        <nav aria-label="Breadcrumb" className="hidden lg:block text-sm text-muted mb-4">
          <Link to="/" className="hover:text-ink">Home</Link> / <Link to={`/category/${l.category.slug}`} className="hover:text-ink">{l.category.name}</Link>
          {l.subcategory && <> / <Link to={`/category/${l.category.slug}?subcategory=${l.subcategory.slug}`} className="hover:text-ink">{l.subcategory.name}</Link></>}
        </nav>
        {l.status === 'sold' && (
          <div className="mb-4 rounded-2xl bg-ink text-white px-5 py-4 flex items-center gap-4" role="status">
            <span className="size-11 shrink-0 rounded-full bg-white/15 grid place-items-center"><CheckCircle2 size={24} /></span>
            <div className="min-w-0">
              <p className="text-lg sm:text-xl font-extrabold leading-tight">{l.is_owner ? 'You marked this item as sold' : 'This item has been sold'}</p>
              <p className="text-sm text-white/75">{l.is_owner ? 'Buyers can see it but can’t message you. Use “Mark as available” if it’s still for sale.' : 'The seller has already sold it. Have a look at similar listings below.'}</p>
            </div>
          </div>
        )}
        {(l.is_owner || user?.role === 'admin') && l.status !== 'published' && l.status !== 'sold' && (
          <div className="mb-4"><Notice title={`Preview — this listing is not public (${l.status.replace(/_/g, ' ')})`}>{l.status_note && <>Note from moderator: {l.status_note}</>}</Notice></div>
        )}
      </div>

      <div className="lg:container-page grid lg:grid-cols-2 lg:gap-10 gap-6 items-start">
        <div className="min-w-0">
          <Gallery images={l.images} title={l.title} sold={l.status === 'sold'} />
          <div className="px-4 lg:px-0 mt-5 space-y-6">
            <div className="lg:hidden"><PriceBlock l={l} onShare={share} /></div>
            <section className="card p-5">
              <h2 className="font-bold text-lg mb-3">Details</h2>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-4 text-sm">
                <div><dt className="text-muted">Condition</dt><dd className="font-semibold">{CONDITIONS[l.condition]}</dd></div>
                <div><dt className="text-muted">Category</dt><dd className="font-semibold">{l.category.name}{l.subcategory ? ` · ${l.subcategory.name}` : ''}</dd></div>
                <div><dt className="text-muted">Availability</dt><dd className={`font-semibold capitalize ${l.status === 'sold' ? 'text-red-600' : ''}`}>{l.status === 'sold' ? 'Sold' : l.availability.replace('_', ' ')}</dd></div>
                <div><dt className="text-muted">Location</dt><dd className="font-semibold">{l.location}</dd></div>
                <div><dt className="text-muted">Posted</dt><dd className="font-semibold">{dateShort(l.published_at)}</dd></div>
                <div><dt className="text-muted">Views</dt><dd className="font-semibold">{l.view_count}</dd></div>
              </dl>
              <h2 className="font-bold text-lg mt-6 mb-2">Description</h2>
              <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-2 break-words">{l.description}</p>
              {embed && (
                <div className="mt-5 aspect-video rounded-xl overflow-hidden bg-black">
                  <iframe src={embed} title="Listing video" className="size-full" allow="encrypted-media; picture-in-picture" allowFullScreen loading="lazy" />
                </div>
              )}
            </section>
            <div className="flex flex-wrap gap-2">
              {user && !l.is_owner && l.status === 'published' && (
                <Button variant="ghost" size="sm" onClick={() => setReport(true)}><Flag size={15} /> Report listing</Button>
              )}
              {!user && <Link to={`/login?next=/item/${l.slug}`} className="btn btn-ghost btn-sm"><Flag size={15} /> Report listing</Link>}
            </div>
          </div>
        </div>

        <aside className="px-4 lg:px-0 space-y-4 lg:sticky lg:top-32">
          <div className="hidden lg:block card p-5"><PriceBlock l={l} onShare={share} /></div>
          <div id="contact-box" className="card p-5 space-y-4 scroll-mt-24">
            {l.contact_phone && user?.can_chat && l.status !== 'sold' && (
              showPhone
                ? <a href={`tel:${l.contact_phone}`} className="btn btn-outline w-full"><Phone size={16} /> {l.contact_phone}</a>
                : <Button variant="outline" className="w-full" onClick={() => setShowPhone(true)}><Phone size={16} /> Show phone number</Button>
            )}
            {l.status === 'sold' && !l.is_owner ? (
              <div className="text-center space-y-3 py-1">
                <span className="mx-auto size-12 rounded-full bg-stone-100 text-ink grid place-items-center"><CheckCircle2 size={26} /></span>
                <p className="font-extrabold text-lg">This item has been sold</p>
                <p className="text-sm text-muted">The seller has already sold this item, so messaging is closed.</p>
                <Link to={`/category/${l.category.slug}`} className="btn btn-primary w-full">See similar {l.category.name.toLowerCase()}</Link>
              </div>
            ) : (
              <ContactBox l={l} onChanged={reload} />
            )}
          </div>
          <div className="card p-5">
            <Link to={`/seller/${l.seller.id}`} className="flex items-center gap-3 group">
                <Avatar name={l.seller.name} src={l.seller.avatar_url} size={52} />
                <div className="min-w-0">
                  <p className="font-bold flex items-center gap-1 group-hover:underline truncate">{l.seller.name}{l.seller.verified && <BadgeCheck size={16} className="text-brand shrink-0" />}</p>
                  <p className="text-xs text-muted">{l.seller.verified ? 'Verified seller' : 'Seller'} · Member since {new Date(l.seller.member_since).getFullYear()}</p>
                  <p className="text-xs text-muted">{l.seller.active_listings} active · {l.seller.sold_listings} sold</p>
                </div>
              </Link>
          </div>
          <div className="rounded-2xl bg-brand-soft p-4 text-sm flex gap-3">
            <ShieldCheck size={20} className="text-brand shrink-0" />
            <p className="text-ink-2"><b>Stay safe:</b> meet in public places, inspect items before paying, and never send money in advance to someone you haven't met.</p>
          </div>
        </aside>
      </div>

      {data!.similar.length > 0 && (
        <section className="container-page mt-12">
          <h2 className="text-xl font-extrabold mb-4">Similar listings</h2>
          <ListingRail items={data!.similar} />
        </section>
      )}

      {/* Mobile sticky action bar */}
      {!l.is_owner && l.status === 'published' && (
        <div className="lg:hidden fixed bottom-16 inset-x-0 z-30 bg-white border-t border-line p-3 flex gap-2">
          <FavoriteButton listingId={l.id} initial={l.is_favorite} className="size-11 border border-line rounded-xl shrink-0" />
          <Button className="flex-1" onClick={() => {
            document.getElementById('contact-box')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => document.getElementById('contact-msg')?.focus(), 400);
          }}>
            <MessageCircle size={18} /> Contact seller
          </Button>
        </div>
      )}

      <ReportDialog open={report} onClose={() => setReport(false)} targetType="listing" targetId={l.id} label="listing" />
    </div>
  );
}

function PriceBlock({ l, onShare }: { l: D; onShare: () => void }) {
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-extrabold leading-tight break-words">{l.title}</h1>
        <div className="flex gap-1 shrink-0">
          <button onClick={onShare} aria-label="Share" className="size-10 rounded-full hover:bg-stone-100 grid place-items-center"><Share2 size={18} /></button>
          {!l.is_owner && <FavoriteButton listingId={l.id} initial={l.is_favorite} className="size-10 hover:bg-stone-100" />}
        </div>
      </div>
      <p className={`mt-2 text-3xl font-extrabold ${l.status === 'sold' ? 'text-muted line-through decoration-2' : 'text-brand-dark'}`}>{money(l.price, l.currency)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
        {l.negotiable && <span className="inline-flex items-center gap-1 font-semibold text-ink-2"><Tag size={14} /> Negotiable</span>}
        {l.status !== 'published' && <StatusBadge status={l.status} kind="listing" />}
        <span className="inline-flex items-center gap-1"><MapPin size={14} /> {l.location}</span>
        <span className="inline-flex items-center gap-1"><Clock size={14} /> {timeAgo(l.published_at ?? l.created_at)}</span>
        <span className="inline-flex items-center gap-1"><Eye size={14} /> {l.view_count}</span>
      </div>
    </div>
  );
}
