import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, ChevronRight } from 'lucide-react';
import { useFetch, usePageMeta } from '../lib/hooks';
import { ErrorState } from '../components/ui';
import { NotFound } from './Static';
import { GTA_CITIES, citySlug } from '../lib/geo';

interface GuideItem { slug: string; title: string; description: string; updated: string }
interface Guide extends GuideItem { sections: { h: string; p: string[] }[]; faq: { q: string; a: string }[] }

export function GuidesIndex() {
  usePageMeta('Buying & selling guides for the GTA', 'Free guides to buying and selling second-hand items in Toronto, Mississauga, Brampton and the GTA.');
  const { data, error, loading, reload } = useFetch<{ items: GuideItem[] }>('/api/content/guides');
  return (
    <div className="container-page py-8 max-w-4xl">
      <h1 className="text-3xl font-extrabold">Buying &amp; selling guides for the GTA</h1>
      <p className="text-muted mt-2">Practical tips for safe, local buying and selling in Toronto, Mississauga, Brampton and across the Greater Toronto Area.</p>
      {loading ? <div className="skeleton h-48 mt-6" /> : error ? <ErrorState error={error} retry={reload} /> : (
        <ul className="mt-6 grid sm:grid-cols-2 gap-3">
          {data!.items.map((g) => (
            <li key={g.slug}>
              <Link to={`/guides/${g.slug}`} className="card p-5 h-full flex flex-col gap-2 hover:border-brand/40 hover:shadow-md transition">
                <BookOpen size={22} className="text-brand" />
                <p className="font-bold leading-snug">{g.title}</p>
                <p className="text-sm text-muted">{g.description}</p>
                <span className="mt-auto text-sm font-semibold text-brand flex items-center gap-1">Read guide <ChevronRight size={16} /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GuideArticle() {
  const { slug } = useParams();
  const { data, error, loading } = useFetch<Guide>(`/api/content/guides/${slug}`);
  usePageMeta(data?.title, data?.description);
  if (loading) return <div className="container-page py-8 max-w-3xl"><div className="skeleton h-64" /></div>;
  if (error || !data) return <NotFound />;
  return (
    <div className="container-page py-8 max-w-3xl">
      <Link to="/guides" className="inline-flex items-center gap-2 text-sm font-semibold text-ink-2 hover:text-ink mb-4"><ArrowLeft size={16} /> All guides</Link>
      <article className="card p-5 sm:p-8">
        <h1 className="text-2xl sm:text-3xl font-extrabold leading-tight">{data.title}</h1>
        <p className="text-sm text-muted mt-1">Updated {new Date(data.updated).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
        <div className="mt-6 space-y-6">
          {data.sections.map((s) => (
            <section key={s.h}>
              <h2 className="text-xl font-bold mb-2">{s.h}</h2>
              {s.p.map((x, i) => <p key={i} className="leading-relaxed text-ink-2 mb-3">{x}</p>)}
            </section>
          ))}
        </div>
        <h2 className="text-xl font-bold mt-8 mb-3">Frequently asked questions</h2>
        <div className="divide-y divide-line border border-line rounded-xl">
          {data.faq.map((f) => (
            <details key={f.q} className="group p-4">
              <summary className="font-semibold cursor-pointer list-none flex justify-between gap-3">{f.q}<span className="text-muted group-open:rotate-45 transition text-xl leading-none">+</span></summary>
              <p className="mt-2 text-sm text-ink-2">{f.a}</p>
            </details>
          ))}
        </div>
        <div className="mt-8 rounded-xl bg-brand-soft p-4">
          <p className="font-bold">Ready to buy or sell?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {GTA_CITIES.slice(0, 8).map((c) => <Link key={c} to={`/city/${citySlug(c)}`} className="chip">{c}</Link>)}
          </div>
        </div>
      </article>
    </div>
  );
}
