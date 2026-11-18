import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import type { Counts, Me } from '../lib/types';

interface AuthState {
  user: Me | null;
  counts: Counts;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  setCounts: React.Dispatch<React.SetStateAction<Counts>>;
}

const Ctx = createContext<AuthState>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [counts, setCounts] = useState<Counts>({ unread_notifications: 0, unread_messages: 0 });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await api.get<{ user: Me | null; counts?: Counts }>('/api/auth/me');
      setUser(r.user);
      if (r.counts) setCounts(r.counts);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => {});
    setUser(null);
    setCounts({ unread_notifications: 0, unread_messages: 0 });
  }, []);

  useEffect(() => {
    refresh();
    // Re-check when the tab regains focus (e.g. after verifying email in another tab).
    const onFocus = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [refresh]);

  return <Ctx.Provider value={{ user, counts, loading, refresh, logout, setCounts }}>{children}</Ctx.Provider>;
}
