import { Link } from 'react-router-dom';
import { useFetch } from '../lib/hooks';

interface Content {
  heading: string;
  intro: string[];
  areas: string[];
  tips: { title: string; items: string[] }[];
  faq: { q: string; a: string }[];
  nearby: { name: string; slug: string }[];
  categories?: { name: string; slug: string }[];
}

/** Helpful local copy under the listings of a city or category page. The same text is in the server-rendered HTML for Google. */
export function SeoSection({ city, category }: { city?: string; category?: string }) {
  const url = city ? `/api/content/city/${city}${category ? `?category=${encodeURIComponent(category)}` : ''}` : category ? `/api/content/category/${category}` : null;
  const { data } = useFetch<Content>(url);
  if (!data) return null;
  const base = category ? (n: string) => `/city/${n}/${category}` : (n: string) => `/city/${n}`;
  return (
    <section className="mt-12 card p-5 sm:p-8 space-y-6" aria-label="About this page">
      <div className="space-y-3">
        <h2 className="text-xl sm:text-2xl font-extrabold">{data.heading}</h2>
        {data.intro.map((p, i) => <p key={i} className="text-[15px] leading-relaxed text-ink-2">{p}</p>)}
      </div>
      {city && !category && data.categories && data.categories.length > 0 && (
        <div>
          <h3 className="font-bold mb-2">Browse by category</h3>
          <div className="flex flex-wrap gap-2">{data.categories.map((c) => <Link key={c.slug} to={`/city/${city}/${c.slug}`} className="chip">{c.name}</Link>)}</div>
        </div>
      )}
      {data.areas.length > 0 && (
        <p className="text-sm text-muted"><b className="text-ink-2">Areas covered:</b> {data.areas.join(' · ')}</p>
      )}
      <div className="grid md:grid-cols-2 gap-6">
        {data.tips.map((t) => (
          <div key={t.title}>
            <h3 className="font-bold mb-2">{t.title}</h3>
            <ul className="list-disc pl-5 space-y-1 text-sm text-ink-2">{t.items.map((i) => <li key={i}>{i}</li>)}</ul>
          </div>
        ))}
      </div>
      <div>
        <h3 className="font-bold mb-2">Frequently asked questions</h3>
        <div className="divide-y divide-line border border-line rounded-xl">
          {data.faq.map((f) => (
            <details key={f.q} className="group p-4">
              <summary className="font-semibold cursor-pointer list-none flex justify-between gap-3">{f.q}<span className="text-muted group-open:rotate-45 transition text-xl leading-none">+</span></summary>
              <p className="mt-2 text-sm text-ink-2">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
      <div>
        <h3 className="font-bold mb-2">{category ? 'Find it in your city' : 'Nearby areas'}</h3>
        <div className="flex flex-wrap gap-2">{data.nearby.map((n) => <Link key={n.slug} to={base(n.slug)} className="chip">{n.name}</Link>)}</div>
      </div>
    </section>
  );
}
