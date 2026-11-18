import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

type Tone = 'success' | 'error' | 'info';
interface Toast { id: number; tone: Tone; message: string }

const Ctx = createContext<(message: string, tone?: Tone) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Tone = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3800);
  }, []);
  const icon = { success: CheckCircle2, error: AlertTriangle, info: Info };
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed z-[100] inset-x-0 bottom-20 md:bottom-6 flex flex-col items-center gap-2 px-4 pointer-events-none" aria-live="polite">
        {toasts.map((t) => {
          const I = icon[t.tone];
          return (
            <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'}
              className={`animate-rise pointer-events-auto flex items-start gap-3 max-w-md w-full rounded-xl px-4 py-3 shadow-lg text-sm font-medium text-white ${
                t.tone === 'error' ? 'bg-red-600' : t.tone === 'info' ? 'bg-ink' : 'bg-brand-dark'}`}>
              <I size={18} className="shrink-0 mt-0.5" />
              <span className="flex-1">{t.message}</span>
              <button aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}><X size={16} /></button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
