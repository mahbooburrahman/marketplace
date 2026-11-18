import { Link, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { useFetch, usePageMeta } from '../lib/hooks';
import { EmptyState, ErrorState } from '../components/ui';

export function LegalPage() {
  const key = useLocation().pathname.slice(1);
  const { data, error, loading } = useFetch<{ title: string; body: string }>(`/api/pages/${key}`);
  usePageMeta(data?.title);
  return (
    <div className="container-page py-10 max-w-3xl">
      {loading ? <div className="skeleton h-64" /> : error ? <ErrorState error={error} /> : (
        <article className="card p-6 sm:p-10">
          <h1 className="text-3xl font-extrabold mb-6">{data!.title}</h1>
          <div className="whitespace-pre-line leading-relaxed text-ink-2">{data!.body}</div>
        </article>
      )}
    </div>
  );
}

export function NotFound() {
  usePageMeta('Page not found');
  return (
    <div className="container-page py-16">
      <EmptyState icon={Compass} title="Page not found" body="The page you're looking for doesn't exist or has moved."
        action={<Link to="/" className="btn btn-primary">Back to home</Link>} />
    </div>
  );
}
