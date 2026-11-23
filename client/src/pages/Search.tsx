import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { SlidersHorizontal, X, SearchX } from 'lucide-react';
import { qs } from '../lib/api';
import { useFetch, usePageMeta } from '../lib/hooks';
import type { ListingCard as L, Paged } from '../lib/types';
import { useSettings } from '../context/SettingsContext';
import { useCity, locationForSlug } from '../lib/geo';
import { SeoSection } from '../components/SeoSection';
import { ListingGrid } from '../components/ListingCard';
import { Button, EmptyState, ErrorState, GridSkeleton, Pagination, Select } from '../components/ui';

const SORTS = [
  ['relevance', 'Most relevant'],
  ['newest', 'Newest first'],
  ['price_asc', 'Lowest price'],
  ['price_desc', 'Highest price'],
] as const;

export default function Search() {
  const { slug, city: cityParam } = useParams();
  const [params, setParams] = useSearchParams();
  const { categories, settings } = useSettings();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const category = slug ?? params.get('category') ?? '';
  const cat = categories.find((c) => c.slug === category);
  const q = params.get('q') ?? '';
  // /city/toronto[/phones]: a shareable, Google-friendly page for one city.
  const cityLoc = locationForSlug(cityParam, settings?.site.locations);
  usePageMeta(
    cityLoc ? `${cat ? `${cat.name} for sale` : 'Buy & sell'} in ${cityLoc}, Canada` : cat ? `${cat.name} for sale` : q ? `“${q}”` : 'Browse listings',
    cat ? `Browse ${cat.name.toLowerCase()} for sale${cityLoc ? ` in ${cityLoc}` : ''}.` : cityLoc ? `Buy and sell locally in ${cityLoc}.` : undefined,
  );

  const { near } = useCity(settings?.site.locations);
  const filters = {
    q,
    category,
    subcategory: params.get('subcategory') ?? '',
    location: params.get('location') ?? cityLoc,
    sort: params.get('sort') ?? (q ? 'relevance' : 'newest'),
    featured: params.get('featured') ?? '',
    page: params.get('page') ?? '1',
  };
  const url = `/api/listings${qs({ ...filters, near: filters.location ? '' : near, limit: 24 })}`;
  const { data, error, loading, reload } = useFetch<Paged<L>>(url);

  const set = (patch: Record<string, string | string[] | null>) => {
    const sp = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      sp.delete(k);
      if (Array.isArray(v)) v.forEach((x) => sp.append(k, x));
      else if (v) sp.set(k, v);
    }
    if (!('page' in patch)) sp.delete('page');
    setParams(sp, { replace: false });
  };

  const activeCount = useMemo(
    () => [filters.subcategory, filters.location, filters.featured].filter(Boolean).length + (slug ? 0 : filters.category ? 1 : 0),
    [filters, slug],
  );

  const panel = (
    <div className="space-y-5">
      {!slug && (
        <div>
          <p className="label">Category</p>
          <Select value={filters.category} onChange={(e) => set({ category: e.target.value, subcategory: null })}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
          </Select>
        </div>
      )}
      {cat && cat.subcategories.length > 0 && (
        <div>
          <p className="label">Subcategory</p>
          <div className="flex flex-wrap gap-2">
            <button className={`chip ${!filters.subcategory ? 'chip-active' : ''}`} onClick={() => set({ subcategory: null })}>All</button>
            {cat.subcategories.map((s) => (
              <button key={s.id} className={`chip ${filters.subcategory === s.slug ? 'chip-active' : ''}`} onClick={() => set({ subcategory: s.slug })}>{s.name}</button>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="label">Location</p>
        <Select value={filters.location} onChange={(e) => set({ location: e.target.value })}>
          <option value="">All locations</option>
          {settings?.site.locations.map((l) => <option key={l} value={l}>{l}</option>)}
        </Select>
      </div>
      {activeCount > 0 && (
        <Button variant="ghost" size="sm" onClick={() => setParams(new URLSearchParams(q ? { q } : {}))}><X size={14} /> Clear filters</Button>
      )}
    </div>
  );

  return (
    <div className="container-page py-6">
      <nav aria-label="Breadcrumb" className="text-sm text-muted mb-2">
        <Link to="/" className="hover:text-ink">Home</Link> <span aria-hidden>/</span> {cat ? <span className="text-ink">{cat.name}</span> : <span className="text-ink">Search</span>}
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold">{cat ? cat.name : q ? `Results for “${q}”` : filters.featured ? 'Featured listings' : 'All listings'}</h1>
          {data && <p className="text-muted mt-1 text-sm">{data.total.toLocaleString()} listing{data.total === 1 ? '' : 's'}{filters.location ? ` in ${filters.location}` : ''}</p>}
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Button variant="outline" className="lg:hidden flex-1" onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal size={16} /> Filters {activeCount > 0 && <span className="rounded-full bg-brand text-white text-[11px] px-1.5">{activeCount}</span>}
          </Button>
          <Select value={filters.sort} onChange={(e) => set({ sort: e.target.value })} aria-label="Sort by" className="flex-1 sm:w-48">
            {SORTS.filter(([k]) => k !== 'relevance' || q).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
      </div>

      <div className="grid lg:grid-cols-[260px_1fr] gap-6">
        <aside className="hidden lg:block"><div className="card p-5 sticky top-32">{panel}</div></aside>
        <div>
          {loading ? <GridSkeleton n={12} /> : error ? <ErrorState error={error} retry={reload} /> : data && data.items.length === 0 ? (
            <div className="card"><EmptyState icon={SearchX} title="No listings match" body="Try removing a filter or searching for something broader." /></div>
          ) : data ? (
            <>
              <ListingGrid items={data.items} />
              <Pagination page={data.page} pages={data.pages} onPage={(p) => { set({ page: String(p) }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
            </>
          ) : null}
        </div>
      </div>

      {(cityParam || slug) && !q && <SeoSection city={cityLoc ? cityParam : undefined} category={slug ?? undefined} />}

      {filtersOpen && (
        <div className="fixed inset-0 z-[80] lg:hidden bg-black/40" onClick={() => setFiltersOpen(false)}>
          <div className="animate-rise absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto bg-white rounded-t-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Filters">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Filters</h2>
              <button onClick={() => setFiltersOpen(false)} aria-label="Close filters" className="p-2"><X size={20} /></button>
            </div>
            {panel}
            <Button className="w-full mt-6" onClick={() => setFiltersOpen(false)}>Show {data?.total ?? ''} results</Button>
          </div>
        </div>
      )}
    </div>
  );
}
