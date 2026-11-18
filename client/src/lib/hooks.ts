import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { useSiteName } from '../context/SettingsContext';

/** Fetch JSON with loading/error state; refetches when `url` changes. Pass null to skip. */
export function useFetch<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(!!url);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) {
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api
      .get<T>(url, ctrl.signal)
      .then((d) => setData(d))
      .catch((e) => e.name !== 'AbortError' && setError(e))
      .finally(() => !ctrl.signal.aborted && setLoading(false));
    return () => ctrl.abort();
  }, [url, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

/** Set the document title and description for client-side navigation (server sets them on first load). */
export function usePageMeta(title?: string, description?: string) {
  const site = useSiteName();
  useEffect(() => {
    document.title = title ? `${title} | ${site}` : site;
    if (description) {
      let m = document.querySelector<HTMLMetaElement>('meta[name="description"]');
      if (!m) {
        m = document.createElement('meta');
        m.name = 'description';
        document.head.appendChild(m);
      }
      m.content = description;
    }
  }, [title, description, site]);
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** Calls `onVisible` when the sentinel scrolls into view (infinite scroll). */
export function useInfinite(onVisible: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onVisible);
  cb.current = onVisible;
  useEffect(() => {
    if (!enabled || !ref.current) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && cb.current(), { rootMargin: '400px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [enabled]);
  return ref;
}
