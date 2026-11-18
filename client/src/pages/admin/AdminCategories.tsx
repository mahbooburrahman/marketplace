import { useState } from 'react';
import { ArrowUp, ArrowDown, Plus, Pencil, Trash2, ImagePlus, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { useFetch, usePageMeta } from '../../lib/hooks';
import { useToast } from '../../context/ToastContext';
import { useSettings } from '../../context/SettingsContext';
import { Badge, Button, CATEGORY_ICONS, CategoryIcon, Checkbox, ConfirmDialog, ErrorState, Field, Input, Modal, PageHeader, RowsSkeleton, errMsg } from '../../components/ui';

export default function AdminCategories() {
  usePageMeta('Categories');
  const toast = useToast();
  const { reload: reloadPublic } = useSettings();
  const { data, error, loading, reload, setData } = useFetch<{ items: any[] }>('/api/admin/categories');
  const [edit, setEdit] = useState<null | { id?: string; name: string; slug: string; icon: string; is_active: boolean }>(null);
  const [sub, setSub] = useState<null | { id?: string; categoryId: string; name: string; slug: string }>(null);
  const [del, setDel] = useState<null | { kind: 'category' | 'subcategory'; id: string; name: string }>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => { reload(); reloadPublic(); };

  const move = async (i: number, d: number) => {
    const items = [...data!.items];
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    setData({ items });
    try {
      await api.post('/api/admin/categories/reorder', { ids: items.map((c) => c.id) });
      reloadPublic();
    } catch (e) {
      toast(errMsg(e), 'error');
      reload();
    }
  };
  const moveSub = async (cat: any, i: number, d: number) => {
    const subs = [...cat.subcategories];
    const j = i + d;
    if (j < 0 || j >= subs.length) return;
    [subs[i], subs[j]] = [subs[j], subs[i]];
    setData({ items: data!.items.map((c) => (c.id === cat.id ? { ...c, subcategories: subs } : c)) });
    await api.post(`/api/admin/categories/${cat.id}/subcategories/reorder`, { ids: subs.map((s: any) => s.id) }).catch(() => reload());
    reloadPublic();
  };
  const saveCat = async () => {
    if (!edit) return;
    setBusy(true);
    try {
      const body = { name: edit.name, slug: edit.slug || undefined, icon: edit.icon, is_active: edit.is_active };
      if (edit.id) await api.put(`/api/admin/categories/${edit.id}`, body);
      else await api.post('/api/admin/categories', body);
      toast('Category saved');
      setEdit(null);
      refresh();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const saveSub = async () => {
    if (!sub) return;
    setBusy(true);
    try {
      const body = { name: sub.name, slug: sub.slug || undefined };
      if (sub.id) await api.put(`/api/admin/subcategories/${sub.id}`, body);
      else await api.post(`/api/admin/categories/${sub.categoryId}/subcategories`, body);
      toast('Subcategory saved');
      setSub(null);
      refresh();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const uploadImage = async (id: string, file: File) => {
    const fd = new FormData();
    fd.append('image', file);
    try {
      await api.post(`/api/admin/categories/${id}/image`, fd);
      toast('Image updated');
      refresh();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  return (
    <div>
      <PageHeader title="Categories" subtitle="Create, edit, reorder and organise categories and subcategories."
        actions={<Button onClick={() => setEdit({ name: '', slug: '', icon: 'tag', is_active: true })}><Plus size={16} /> New category</Button>} />
      {loading ? <RowsSkeleton /> : error ? <ErrorState error={error} retry={reload} /> : (
        <ul className="space-y-2">
          {data!.items.map((c, i) => (
            <li key={c.id} className="card">
              <div className="flex items-center gap-3 p-3">
                <div className="flex flex-col">
                  <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 disabled:opacity-20" aria-label="Move up"><ArrowUp size={14} /></button>
                  <button onClick={() => move(i, 1)} disabled={i === data!.items.length - 1} className="p-1 disabled:opacity-20" aria-label="Move down"><ArrowDown size={14} /></button>
                </div>
                {c.image_url ? <img src={c.image_url} alt="" className="size-11 rounded-xl object-cover" /> : <span className="size-11 rounded-xl bg-brand-soft text-brand grid place-items-center"><CategoryIcon name={c.icon} /></span>}
                <button className="flex-1 min-w-0 text-left" onClick={() => setExpanded(expanded === c.id ? null : c.id)}>
                  <p className="font-semibold flex items-center gap-1.5">{expanded === c.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}{c.name} {!c.is_active && <Badge>hidden</Badge>}</p>
                  <p className="text-xs text-muted">/{c.slug} · {c.subcategories.length} subcategories · {c.listing_count} listings</p>
                </button>
                <label className="btn btn-ghost btn-sm cursor-pointer" aria-label="Upload image"><ImagePlus size={16} /><input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && uploadImage(c.id, e.target.files[0])} /></label>
                <Button size="sm" variant="ghost" onClick={() => setEdit({ id: c.id, name: c.name, slug: c.slug, icon: c.icon, is_active: c.is_active })} aria-label="Edit"><Pencil size={16} /></Button>
                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setDel({ kind: 'category', id: c.id, name: c.name })} aria-label="Delete"><Trash2 size={16} /></Button>
              </div>
              {expanded === c.id && (
                <div className="border-t border-line px-4 py-3 bg-stone-50/60 rounded-b-2xl">
                  <ul className="space-y-1">
                    {c.subcategories.map((s: any, k: number) => (
                      <li key={s.id} className="flex items-center gap-2 text-sm">
                        <button onClick={() => moveSub(c, k, -1)} disabled={k === 0} className="p-1 disabled:opacity-20" aria-label="Move up"><ArrowUp size={13} /></button>
                        <button onClick={() => moveSub(c, k, 1)} disabled={k === c.subcategories.length - 1} className="p-1 disabled:opacity-20" aria-label="Move down"><ArrowDown size={13} /></button>
                        <span className="flex-1">{s.name} <span className="text-xs text-muted">/{s.slug} · {s.listing_count}</span></span>
                        <button className="p-1.5 hover:bg-white rounded" onClick={() => setSub({ id: s.id, categoryId: c.id, name: s.name, slug: s.slug })} aria-label="Edit"><Pencil size={14} /></button>
                        <button className="p-1.5 hover:bg-white rounded text-red-600" onClick={() => setDel({ kind: 'subcategory', id: s.id, name: s.name })} aria-label="Delete"><Trash2 size={14} /></button>
                      </li>
                    ))}
                  </ul>
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setSub({ categoryId: c.id, name: '', slug: '' })}><Plus size={14} /> Add subcategory</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? 'Edit category' : 'New category'} footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={saveCat}>Save</Button></>}>
          <div className="space-y-4">
            <Field label="Name" required><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="URL slug" hint="Leave blank to generate from the name."><Input value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} /></Field>
            <Field label="Icon">
              <div className="grid grid-cols-8 gap-1.5">
                {Object.keys(CATEGORY_ICONS).map((k) => (
                  <button key={k} type="button" onClick={() => setEdit({ ...edit, icon: k })} aria-label={k} aria-pressed={edit.icon === k}
                    className={`aspect-square rounded-lg grid place-items-center ${edit.icon === k ? 'bg-brand text-white' : 'bg-stone-100 hover:bg-stone-200'}`}><CategoryIcon name={k} size={18} /></button>
                ))}
              </div>
            </Field>
            <Checkbox checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} label="Visible on the marketplace" />
          </div>
        </Modal>
      )}
      {sub && (
        <Modal open onClose={() => setSub(null)} title={sub.id ? 'Edit subcategory' : 'New subcategory'} footer={<><Button variant="outline" onClick={() => setSub(null)}>Cancel</Button><Button loading={busy} onClick={saveSub}>Save</Button></>}>
          <div className="space-y-4">
            <Field label="Name" required><Input value={sub.name} onChange={(e) => setSub({ ...sub, name: e.target.value })} /></Field>
            <Field label="URL slug" hint="Leave blank to generate from the name."><Input value={sub.slug} onChange={(e) => setSub({ ...sub, slug: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
      {del && <ConfirmDialog open onClose={() => setDel(null)} danger title={`Delete ${del.name}?`} confirmLabel="Delete"
        body={del.kind === 'category' ? 'Categories with live or pending listings cannot be deleted — hide them instead.' : 'Listings in this subcategory keep their main category.'}
        onConfirm={async () => { await api.del(`/api/admin/${del.kind === 'category' ? 'categories' : 'subcategories'}/${del.id}`); toast('Deleted'); refresh(); }} />}
    </div>
  );
}
