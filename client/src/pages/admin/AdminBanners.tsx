import { useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useFetch, usePageMeta } from '../../lib/hooks';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, Checkbox, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageHeader, RowsSkeleton, errMsg } from '../../components/ui';

type Banner = { id: string; title: string; cta: string; link_url: string; image_url: string | null; is_active: boolean; starts_on: string | null; ends_on: string | null; views: number; clicks: number; live: boolean };
type Form = { id?: string; title: string; cta: string; link_url: string; starts_on: string; ends_on: string; is_active: boolean; image_url?: string | null };
const blank: Form = { title: '', cta: '', link_url: '', starts_on: '', ends_on: '', is_active: true };
const d = (v: string | null) => (v ? v.slice(0, 10) : '');

export default function AdminBanners() {
  usePageMeta('Banner ads');
  const toast = useToast();
  const { data, error, loading, reload } = useFetch<{ items: Banner[] }>('/api/admin/banners');
  const [form, setForm] = useState<Form | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [del, setDel] = useState<Banner | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => { setForm(null); setFile(null); };

  const save = async () => {
    if (!form) return;
    if (!form.id && !file) return toast('Please choose a banner image.', 'error');
    setBusy(true);
    try {
      const body = { title: form.title, cta: form.cta, link_url: form.link_url, starts_on: form.starts_on || null, ends_on: form.ends_on || null, is_active: form.is_active };
      const saved = form.id ? await api.put<Banner>(`/api/admin/banners/${form.id}`, body) : await api.post<Banner>('/api/admin/banners', body);
      if (file) {
        const fd = new FormData();
        fd.append('image', file);
        await api.post(`/api/admin/banners/${saved.id}/image`, fd);
      }
      toast('Banner saved', 'success');
      close();
      reload();
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };

  const move = async (b: Banner, dir: 'up' | 'down') => {
    try { await api.post(`/api/admin/banners/${b.id}/move`, { dir }); reload(); } catch (e) { toast(errMsg(e), 'error'); }
  };
  const remove = async () => {
    if (!del) return;
    try { await api.del(`/api/admin/banners/${del.id}`); toast('Banner deleted', 'success'); setDel(null); reload(); } catch (e) { toast(errMsg(e), 'error'); }
  };

  const items = data?.items ?? [];
  const preview = file ? URL.createObjectURL(file) : form?.image_url;

  return (
    <div>
      <PageHeader title="Banner ads" subtitle="Ads shown first in the home page slider. Best image size: 1600 × 760 px (landscape)." actions={<Button onClick={() => { setForm(blank); setFile(null); }}><Plus size={16} /> New banner</Button>} />
      {error ? <ErrorState error={error} retry={reload} /> : loading ? <RowsSkeleton /> : items.length === 0 ? (
        <EmptyState title="No banners yet" body="Add a banner to start selling ad space on your home page." />
      ) : (
        <ul className="space-y-3">
          {items.map((b, k) => (
            <li key={b.id} className="card p-3 sm:p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
              <img src={b.image_url ?? ''} alt="" className="w-full sm:w-44 aspect-[2/1] rounded-xl object-cover bg-stone-100 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold break-words">{b.title || <span className="text-muted">(no title)</span>}</p>
                <p className="text-xs text-muted break-all">{b.link_url || 'No link'}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                  {b.live ? <Badge tone="green">Live</Badge> : <Badge>{b.is_active ? 'Not in date range' : 'Off'}</Badge>}
                  <span className="text-muted">{d(b.starts_on) || 'any time'} → {d(b.ends_on) || 'no end'}</span>
                </div>
                <p className="mt-1 text-xs text-muted">{b.views.toLocaleString()} views · {b.clicks.toLocaleString()} clicks{b.views > 0 && ` · ${((b.clicks / b.views) * 100).toFixed(1)}% CTR`}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button size="sm" variant="ghost" onClick={() => move(b, 'up')} disabled={k === 0} aria-label="Move up"><ArrowUp size={16} /></Button>
                <Button size="sm" variant="ghost" onClick={() => move(b, 'down')} disabled={k === items.length - 1} aria-label="Move down"><ArrowDown size={16} /></Button>
                <Button size="sm" variant="ghost" onClick={() => { setForm({ id: b.id, title: b.title, cta: b.cta, link_url: b.link_url, starts_on: d(b.starts_on), ends_on: d(b.ends_on), is_active: b.is_active, image_url: b.image_url }); setFile(null); }} aria-label="Edit"><Pencil size={16} /></Button>
                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setDel(b)} aria-label="Delete"><Trash2 size={16} /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {form && (
        <Modal open onClose={close} title={form.id ? 'Edit banner' : 'New banner'} footer={<><Button variant="outline" onClick={close}>Cancel</Button><Button loading={busy} onClick={save}>Save banner</Button></>}>
          <div className="space-y-4">
            <Field label="Banner image" required hint="JPG, PNG or WebP. Landscape 1600 × 760 px works best.">
              <div className="space-y-2">
                {preview && <img src={preview} alt="" className="w-full aspect-[2/1] rounded-xl object-cover bg-stone-100" />}
                <label className="btn btn-outline btn-sm cursor-pointer w-fit"><ImagePlus size={16} /> {preview ? 'Change image' : 'Choose image'}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </label>
              </div>
            </Field>
            <Field label="Title (optional)" hint="Shown over the bottom of the image."><Input value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Button text (optional)"><Input value={form.cta} maxLength={40} placeholder="e.g. Shop now" onChange={(e) => setForm({ ...form, cta: e.target.value })} /></Field>
            <Field label="Link (optional)" hint="Advertiser website (https://…) or a page on your site (/category/furniture)."><Input value={form.link_url} placeholder="https://" onChange={(e) => setForm({ ...form, link_url: e.target.value })} /></Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Start date" hint="Blank = starts now."><Input type="date" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} /></Field>
              <Field label="End date" hint="Blank = runs until you turn it off."><Input type="date" value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} /></Field>
            </div>
            <Checkbox label="Active" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          </div>
        </Modal>
      )}
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={remove} danger title="Delete this banner?" body="The banner and its statistics will be removed permanently." confirmLabel="Delete banner" />
    </div>
  );
}
