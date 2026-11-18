import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import type { Category, PublicSettings } from '../lib/types';

interface SettingsState {
  settings: PublicSettings | null;
  categories: Category[];
  reload: () => void;
}

const Ctx = createContext<SettingsState>({ settings: null, categories: [], reload: () => {} });
export const useSettings = () => useContext(Ctx);
export const useSiteName = () => useContext(Ctx).settings?.site.name ?? 'Marketplace';

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);

  const reload = useCallback(() => {
    api.get<PublicSettings>('/api/settings').then(setSettings).catch(() => {});
    api.get<{ items: Category[] }>('/api/categories').then((r) => setCategories(r.items)).catch(() => {});
  }, []);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    root.style.setProperty('--brand', settings.site.primary_color);
    root.style.setProperty('--accent', settings.site.accent_color);
    if (settings.site.favicon_url) {
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = settings.site.favicon_url;
    }
  }, [settings]);

  return <Ctx.Provider value={{ settings, categories, reload }}>{children}</Ctx.Provider>;
}
