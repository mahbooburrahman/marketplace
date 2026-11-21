import { useCallback, useEffect, useState } from 'react';

/** Approximate city centres, used to match the visitor's GPS position to the nearest site location. */
const COORDS: Record<string, [number, number]> = {
  Toronto: [43.6532, -79.3832], 'Montréal': [45.5019, -73.5674], Vancouver: [49.2827, -123.1207],
  Calgary: [51.0447, -114.0719], Edmonton: [53.5461, -113.4938], Ottawa: [45.4215, -75.6972],
  Winnipeg: [49.8951, -97.1384], 'Québec City': [46.8139, -71.208], Hamilton: [43.2557, -79.8711],
  'Kitchener-Waterloo': [43.4516, -80.4925], London: [42.9849, -81.2453], Halifax: [44.6488, -63.5752],
  Victoria: [48.4284, -123.3656], Saskatoon: [52.1332, -106.67], Regina: [50.4452, -104.6189],
  Mississauga: [43.589, -79.6441], Brampton: [43.7315, -79.7624], Surrey: [49.1913, -122.849],
  "St. John's": [47.5615, -52.7126], Fredericton: [45.9636, -66.6431], Charlottetown: [46.2382, -63.1311],
  Whitehorse: [60.7212, -135.0568],
};

/** URL slug of a location: "Kitchener-Waterloo, ON" -> "kitchener-waterloo". Same rule as the server (seo.ts). */
export const citySlug = (loc: string) =>
  loc.split(',')[0]!.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const KEY = 'mk_city';
const EVT = 'mk-city';
const MAX_KM = 120; // farther than this from every listed city → no city preference

const km = (a: [number, number], b: [number, number]) => {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

/** Stored value: a location like "Toronto, ON", "all" (visitor chose All locations), or '' (not decided yet). */
export const readCity = () => {
  try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; }
};
export function saveCity(v: string) {
  try { localStorage.setItem(KEY, v); } catch { /* ignore */ }
  window.dispatchEvent(new Event(EVT));
}

/** Pick the site location (e.g. "Mississauga, ON") closest to the coordinates. */
export function nearestLocation(lat: number, lng: number, locations: string[]) {
  let best = '';
  let bestKm = Infinity;
  for (const loc of locations) {
    const c = COORDS[loc.split(',')[0]!.trim()];
    if (!c) continue;
    const d = km([lat, lng], c);
    if (d < bestKm) { bestKm = d; best = loc; }
  }
  return bestKm <= MAX_KM ? best : '';
}

/**
 * The visitor's city. On the first visit the browser is asked for its position (once) and the closest
 * city becomes the default; the visitor can change it any time from the header.
 * `near` is what to send to the API ('' when no city preference).
 */
export function useCity(locations: string[] | undefined) {
  const [raw, setRaw] = useState(readCity());
  useEffect(() => {
    const sync = () => setRaw(readCity());
    window.addEventListener(EVT, sync);
    window.addEventListener('storage', sync);
    return () => { window.removeEventListener(EVT, sync); window.removeEventListener('storage', sync); };
  }, []);

  useEffect(() => {
    if (raw || !locations?.length || !('geolocation' in navigator)) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (p) => { if (!cancelled && !readCity()) saveCity(nearestLocation(p.coords.latitude, p.coords.longitude, locations) || 'all'); },
      () => { if (!cancelled && !readCity()) saveCity('all'); },
      { timeout: 8000, maximumAge: 3_600_000 },
    );
    return () => { cancelled = true; };
  }, [raw, locations]);

  const setCity = useCallback((v: string) => saveCity(v || 'all'), []);
  const city = raw === 'all' ? '' : raw;
  return { city, near: city, setCity, detecting: !raw };
}
