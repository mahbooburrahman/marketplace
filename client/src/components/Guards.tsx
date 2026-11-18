import { Component, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Spinner } from './ui';

function FullSpinner() {
  return <div className="py-32 grid place-items-center text-brand"><Spinner size={28} /></div>;
}

/** UI-level redirect only — the API enforces every permission independently. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <FullSpinner />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullSpinner />;
  if (!user) return <Navigate to="/login?next=/admin" replace />;
  if (user.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-[60vh] grid place-items-center px-6 text-center">
        <div>
          <AlertTriangle size={40} className="mx-auto text-amber-500" />
          <h1 className="mt-4 text-xl font-bold">Something went wrong</h1>
          <p className="mt-1 text-muted">An unexpected error occurred. Reloading usually fixes it.</p>
          <button className="btn btn-primary mt-5" onClick={() => location.reload()}>Reload page</button>
        </div>
      </div>
    );
  }
}
