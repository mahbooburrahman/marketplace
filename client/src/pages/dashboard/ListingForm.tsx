import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ImagePlus, X, ChevronLeft, ChevronRight, Info, Store, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api';
import { usePageMeta, useFetch } from '../../lib/hooks';
import { CONDITIONS } from '../../lib/format';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { useToast } from '../../context/ToastContext';
import { Button, Checkbox, ErrorState, Field, Input, Notice, PageHeader, RowsSkeleton, Select, StatusBadge, Textarea, errMsg, fieldErrors } from '../../components/ui';

type Img = { kind: 'existing'; id: string; url: string } | { kind: 'new'; key: string; file: File; url: string };

const empty = {
  title: '', category_id: '', subcategory_id: '', description: '', price: '', negotiable: false, condition: 'good',
  location: '', contact_phone: '', show_phone: false, availability: 'available', video_url: '',
};
const MODERATED: (keyof typeof empty)[] = ['title', 'description', 'price', 'category_id', 'subcategory_id', 'video_url'];

export default function ListingForm() {
  const { id } = useParams();
  const editing = !!id;
  usePageMeta(editing ? 'Edit listing' : 'New listing');
  const { user } = useAuth();
  const { categories, settings } = useSettings();
  const toast = useToast();
  const nav = useNavigate();
  const maxImages = settings?.listings.max_images ?? 10;

  const { data, error, loading, reload } = useFetch<any>(editing ? `/api/my/listings/${id}` : null);
  const [f, setF] = useState({ ...empty, location: user?.location ?? settings?.site.default_location ?? '', contact_phone: user?.phone ?? '' });
  const [original, setOriginal] = useState<typeof empty | null>(null);
  const [images, setImages] = useState<Img[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'' | 'draft' | 'submit'>('');

  useEffect(() => {
    if (!data) return;
    const l = data.listing;
    const v = {
      title: l.title, category_id: l.category_id, subcategory_id: l.subcategory_id ?? '', description: l.description, price: String(l.price),
      negotiable: l.negotiable, condition: l.condition, location: l.location, contact_phone: l.contact_phone ?? '', show_phone: l.show_phone,
      availability: l.availability, video_url: l.video_url ?? '',
    };
    setF(v);
    setOriginal(v);
    setImages(data.images.map((i: any) => ({ kind: 'existing', id: i.id, url: i.thumb })));
  }, [data]);

  // Revoke preview URLs on unmount
  useEffect(() => () => images.forEach((i) => i.kind === 'new' && URL.revokeObjectURL(i.url)), []); // eslint-disable-line

  const cat = categories.find((c) => c.id === f.category_id);
  const status: string | undefined = data?.listing.status;
  const willReReview = useMemo(() => {
    if (status !== 'published' || !original) return false;
    return removed.length > 0 || images.some((i) => i.kind === 'new') || MODERATED.some((k) => String(f[k]) !== String(original[k]));
  }, [status, original, f, images, removed]);

  if (!user?.is_seller) {
    return (
      <div>
        <PageHeader title="New listing" />
        <Notice icon={Store} title="You need an active seller authorization to create listings" action={<Link to="/dashboard/seller" className="btn btn-primary btn-sm">Request seller access</Link>}>
          Only administrator-approved sellers with a paid plan can post on the marketplace.
        </Notice>
      </div>
    );
  }
  if (editing && loading) return <RowsSkeleton n={6} />;
  if (editing && (error || !data)) return <ErrorState error={error} retry={reload} />;
  if (editing && ['suspended', 'archived', 'sold', 'expired'].includes(status!)) {
    return <Notice tone="red" icon={AlertTriangle} title={`This listing is ${status} and can't be edited.`} action={<Link to="/dashboard/listings" className="btn btn-outline btn-sm">Back to my listings</Link>} />;
  }

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const next: Img[] = [];
    for (const file of Array.from(files)) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { toast(`${file.name}: only JPG, PNG or WebP`, 'error'); continue; }
      if (file.size > 8 * 1024 * 1024) { toast(`${file.name} is larger than 8 MB`, 'error'); continue; }
      next.push({ kind: 'new', key: `${file.name}-${file.size}-${Math.random()}`, file, url: URL.createObjectURL(file) });
    }
    setImages((cur) => {
      const room = maxImages - cur.length;
      if (next.length > room) toast(`You can add up to ${maxImages} photos`, 'error');
      return [...cur, ...next.slice(0, Math.max(0, room))];
    });
  };
  const removeImg = (i: number) => {
    const img = images[i]!;
    if (img.kind === 'existing') setRemoved((r) => [...r, img.id]);
    else URL.revokeObjectURL(img.url);
    setImages((cur) => cur.filter((_, k) => k !== i));
  };
  const move = (i: number, d: number) => setImages((cur) => {
    const j = i + d;
    if (j < 0 || j >= cur.length) return cur;
    const a = [...cur];
    [a[i], a[j]] = [a[j]!, a[i]!];
    return a;
  });

  const save = async (action: 'draft' | 'submit', e?: FormEvent) => {
    e?.preventDefault();
    const local: Record<string, string> = {};
    if (f.title.trim().length < 3) local.title = 'Title must be at least 3 characters.';
    if (!f.category_id) local.category_id = 'Choose a category.';
    if (f.description.trim().length < 20) local.description = 'Please describe the item in at least 20 characters.';
    if (f.price === '' || Number(f.price) < 0) local.price = 'Enter a price.';
    if (!f.location.trim()) local.location = 'Enter a location.';
    if (action === 'submit' && images.length === 0) local.images = 'Add at least one photo.';
    if (Object.keys(local).length) {
      setErrors(local);
      document.querySelector('[aria-invalid="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setBusy(action);
    setErrors({});
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.append(k, String(v)));
    fd.append('action', action);
    images.forEach((img) => img.kind === 'new' && fd.append('images', img.file));
    if (editing) {
      fd.append('remove_image_ids', JSON.stringify(removed));
      fd.append('image_order', JSON.stringify(images.filter((i) => i.kind === 'existing').map((i) => (i as any).id)));
    }
    try {
      if (editing) {
        const r = await api.patch(`/api/my/listings/${id}`, fd);
        toast(r.requires_review ? 'Saved — your listing is now in review' : 'Changes saved');
      } else {
        await api.post('/api/my/listings', fd);
        toast(action === 'draft' ? 'Draft saved' : 'Submitted — your listing goes live once approved');
      }
      nav('/dashboard/listings');
    } catch (err) {
      setErrors(fieldErrors(err));
      toast(errMsg(err), 'error');
    } finally {
      setBusy('');
    }
  };

  const canDraft = !editing || ['draft'].includes(status!);
  const submitLabel = !editing ? 'Submit for review' : status === 'published' ? (willReReview ? 'Save & send for review' : 'Save changes') : status === 'pending_approval' ? 'Save changes' : 'Save & submit for review';

  return (
    <form onSubmit={(e) => save('submit', e)} noValidate>
      <PageHeader title={editing ? 'Edit listing' : 'Create a listing'} subtitle={editing && status ? <span className="inline-flex items-center gap-2">Status: <StatusBadge status={status} kind="listing" /></span> : 'Listings are reviewed by our team before they go live.'} />
      {editing && data.listing.status_note && ['rejected', 'changes_requested'].includes(status!) && (
        <div className="mb-5"><Notice tone="amber" icon={AlertTriangle} title={status === 'rejected' ? 'Your listing was rejected' : 'The moderator requested changes'}>{data.listing.status_note}</Notice></div>
      )}
      {willReReview && <div className="mb-5"><Notice tone="blue" icon={Info} title="This change needs re-approval">Changing the title, price, description, category, video or photos takes the listing offline until an administrator approves it again.</Notice></div>}

      <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
        <div className="space-y-5">
          <section className="card p-5 sm:p-6">
            <h2 className="font-bold text-lg mb-1">Photos</h2>
            <p className="text-sm text-muted mb-4">Up to {maxImages} photos. The first photo is the cover. JPG, PNG or WebP up to 8 MB each.</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2.5">
              {images.map((img, i) => (
                <div key={img.kind === 'existing' ? img.id : img.key} className="relative aspect-square rounded-xl overflow-hidden bg-stone-100 group">
                  <img src={img.url} alt={`Photo ${i + 1}`} className="size-full object-cover" />
                  {i === 0 && <span className="absolute left-1.5 top-1.5 rounded-md bg-ink/80 text-white text-[10px] font-bold px-1.5 py-0.5">Cover</span>}
                  <button type="button" onClick={() => removeImg(i)} className="absolute right-1.5 top-1.5 size-7 rounded-full bg-white/95 grid place-items-center shadow" aria-label={`Remove photo ${i + 1}`}><X size={14} /></button>
                  <div className="absolute inset-x-1.5 bottom-1.5 flex justify-between">
                    <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="size-7 rounded-full bg-white/95 grid place-items-center shadow disabled:opacity-0" aria-label="Move left"><ChevronLeft size={14} /></button>
                    <button type="button" disabled={i === images.length - 1} onClick={() => move(i, 1)} className="size-7 rounded-full bg-white/95 grid place-items-center shadow disabled:opacity-0" aria-label="Move right"><ChevronRight size={14} /></button>
                  </div>
                </div>
              ))}
              {images.length < maxImages && (
                <label className={`aspect-square rounded-xl border-2 border-dashed grid place-items-center cursor-pointer hover:bg-brand-soft hover:border-brand transition text-center ${errors.images ? 'border-red-300' : 'border-line'}`}
                  onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
                  <span className="text-muted text-xs font-semibold flex flex-col items-center gap-1"><ImagePlus size={24} /> Add photos</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" aria-invalid={!!errors.images} onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
                </label>
              )}
            </div>
            {errors.images && <p className="mt-2 text-[13px] text-red-600">{errors.images}</p>}
          </section>

          <section className="card p-5 sm:p-6 space-y-4">
            <h2 className="font-bold text-lg">Details</h2>
            <Field label="Title" required error={errors.title} hint={`${f.title.length}/120`}><Input value={f.title} onChange={(e) => set('title', e.target.value)} maxLength={120} invalid={!!errors.title} placeholder="e.g. iPhone 13, 128 GB, blue" /></Field>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Category" required error={errors.category_id}>
                <Select value={f.category_id} onChange={(e) => setF((x) => ({ ...x, category_id: e.target.value, subcategory_id: '' }))} invalid={!!errors.category_id}>
                  <option value="">Choose…</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Subcategory" error={errors.subcategory_id}>
                <Select value={f.subcategory_id} onChange={(e) => set('subcategory_id', e.target.value)} disabled={!cat?.subcategories.length}>
                  <option value="">{cat?.subcategories.length ? 'Choose…' : '—'}</option>
                  {cat?.subcategories.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Description" required error={errors.description} hint={`${f.description.length}/5000 — include condition, age, what's included and why you're selling.`}>
              <Textarea rows={7} value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={5000} invalid={!!errors.description} />
            </Field>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label={`Price (${settings?.site.default_currency ?? 'CAD'})`} required error={errors.price}>
                <Input inputMode="decimal" value={f.price} onChange={(e) => set('price', e.target.value.replace(/[^0-9.]/g, ''))} invalid={!!errors.price} />
              </Field>
              <Field label="Condition" required>
                <Select value={f.condition} onChange={(e) => set('condition', e.target.value)}>
                  {Object.entries(CONDITIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
            </div>
            <Checkbox checked={f.negotiable} onChange={(e) => set('negotiable', e.target.checked)} label="Price is negotiable" />
            <Field label="Video link (optional)" error={errors.video_url} hint="YouTube or Vimeo link.">
              <Input type="url" value={f.video_url} onChange={(e) => set('video_url', e.target.value)} placeholder="https://youtube.com/watch?v=…" invalid={!!errors.video_url} />
            </Field>
          </section>
        </div>

        <aside className="space-y-5 lg:sticky lg:top-24">
          <section className="card p-5 space-y-4">
            <h2 className="font-bold">Location & contact</h2>
            <Field label="Location" required error={errors.location}>
              <Input list="locations" value={f.location} onChange={(e) => set('location', e.target.value)} invalid={!!errors.location} />
              <datalist id="locations">{settings?.site.locations.map((l) => <option key={l} value={l} />)}</datalist>
            </Field>
            <Field label="Availability">
              <Select value={f.availability} onChange={(e) => set('availability', e.target.value)}>
                <option value="available">Available</option><option value="reserved">Reserved</option><option value="out_of_stock">Out of stock</option>
              </Select>
            </Field>
            <Field label="Contact phone" error={errors.contact_phone}><Input type="tel" value={f.contact_phone} onChange={(e) => set('contact_phone', e.target.value)} /></Field>
            <Checkbox checked={f.show_phone} onChange={(e) => set('show_phone', e.target.checked)} label="Show my phone number to approved buyers" />
          </section>
          <div className="card p-5 space-y-2">
            <Button type="submit" className="w-full" loading={busy === 'submit'} disabled={!!busy}>{submitLabel}</Button>
            {canDraft && <Button type="button" variant="outline" className="w-full" loading={busy === 'draft'} disabled={!!busy} onClick={() => save('draft')}>Save as draft</Button>}
            <Link to="/dashboard/listings" className="btn btn-ghost w-full">Cancel</Link>
          </div>
        </aside>
      </div>
    </form>
  );
}
