import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2, X, ChevronLeft, ChevronRight, PackageOpen, CloudOff, RotateCw, Info, Tag, Cpu, Smartphone, Laptop, Refrigerator, Car, Home, Sofa,
  Shirt, Dumbbell, Wrench, Package, Tv, Camera, Gamepad2, Bike, Baby, BookOpen, Music, PawPrint, Briefcase, Building2, Gem, Watch, Hammer,
  Leaf, Plane, Utensils, Sparkles, type LucideIcon,
} from 'lucide-react';

const Icons = { PackageOpen, CloudOff, RotateCw, Info };

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  tag: Tag, cpu: Cpu, smartphone: Smartphone, laptop: Laptop, refrigerator: Refrigerator, car: Car, home: Home, sofa: Sofa, shirt: Shirt,
  dumbbell: Dumbbell, wrench: Wrench, package: Package, tv: Tv, camera: Camera, 'gamepad-2': Gamepad2, bike: Bike, baby: Baby, book: BookOpen,
  music: Music, pets: PawPrint, briefcase: Briefcase, building: Building2, gem: Gem, watch: Watch, hammer: Hammer, leaf: Leaf, plane: Plane,
  utensils: Utensils, sparkles: Sparkles,
};
import { LISTING_STATUS_OVERRIDE, STATUS, initials } from '../lib/format';
import { ApiError } from '../lib/api';

export function Spinner({ size = 18, className = '' }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={`animate-spin ${className}`} aria-hidden />;
}

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: 'primary' | 'outline' | 'ghost' | 'danger' | 'accent'; size?: 'sm' | 'md' }>(
  function Button({ loading, variant = 'primary', size = 'md', className = '', children, disabled, ...rest }, ref) {
    return (
      <button ref={ref} className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${className}`} disabled={disabled || loading} {...rest}>
        {loading && <Spinner size={16} />}
        {children}
      </button>
    );
  },
);

interface FieldProps { label?: string; error?: string; hint?: ReactNode; children: ReactNode; required?: boolean; className?: string; htmlFor?: string }
export function Field({ label, error, hint, children, required, className = '', htmlFor }: FieldProps) {
  return (
    <div className={className}>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label} {required && <span className="text-red-500" aria-hidden>*</span>}
        </label>
      )}
      {children}
      {error ? <p className="mt-1.5 text-[13px] text-red-600" role="alert">{error}</p> : hint ? <p className="mt-1.5 text-[13px] text-muted">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ invalid, className = '', ...p }, ref) {
  return <input ref={ref} className={`input ${invalid ? 'input-error' : ''} ${className}`} aria-invalid={invalid || undefined} {...p} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ invalid, className = '', ...p }, ref) {
  return <textarea ref={ref} className={`input ${invalid ? 'input-error' : ''} ${className}`} aria-invalid={invalid || undefined} {...p} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select({ invalid, className = '', children, ...p }, ref) {
  return <select ref={ref} className={`input ${invalid ? 'input-error' : ''} ${className}`} aria-invalid={invalid || undefined} {...p}>{children}</select>;
});

export function Checkbox({ label, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="flex items-start gap-2.5 text-sm text-ink-2 cursor-pointer select-none">
      <input type="checkbox" className="mt-0.5 size-4 rounded accent-[var(--brand)]" {...p} />
      <span>{label}</span>
    </label>
  );
}

const TONES: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/15',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/15',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/15',
  gray: 'bg-stone-100 text-stone-600 ring-stone-500/15',
  brand: 'bg-brand-soft text-brand-dark ring-brand/20',
};

export function Badge({ tone = 'gray', children, className = '' }: { tone?: string; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONES[tone]} ${className}`}>{children}</span>;
}

export function StatusBadge({ status, kind }: { status: string; kind?: 'listing' }) {
  const [label, tone] = (kind === 'listing' && LISTING_STATUS_OVERRIDE[status]) || STATUS[status] || [status.replace(/_/g, ' '), 'gray'];
  return <Badge tone={tone}>{label}</Badge>;
}

export function Avatar({ name, src, size = 40 }: { name?: string | null; src?: string | null; size?: number }) {
  return src ? (
    <img src={src} alt="" width={size} height={size} className="rounded-full object-cover bg-stone-200 shrink-0" style={{ width: size, height: size }} loading="lazy" />
  ) : (
    <span className="rounded-full bg-brand-tint text-brand-dark font-bold grid place-items-center shrink-0" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function CategoryIcon({ name, size = 20, className = '' }: { name: string; size?: number; className?: string }) {
  const I = CATEGORY_ICONS[name] ?? Tag;
  return <I size={size} className={className} />;
}

export function EmptyState({ icon: I = Icons.PackageOpen, title, body, action }: { icon?: React.ComponentType<{ size?: number | string; className?: string }>; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-14 px-6">
      <div className="size-16 rounded-2xl bg-brand-soft grid place-items-center mb-4">
        <I size={28} className="text-brand" />
      </div>
      <h3 className="text-lg font-bold">{title}</h3>
      {body && <p className="mt-1.5 text-muted max-w-sm text-[15px]">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof ApiError ? error.message : 'Something went wrong while loading this page.';
  return (
    <EmptyState icon={Icons.CloudOff} title="Couldn't load this" body={msg}
      action={retry && <Button variant="outline" onClick={retry}><Icons.RotateCw size={16} /> Try again</Button>} />
  );
}

export function CardSkeleton() {
  return (
    <div className="card overflow-hidden">
      <div className="skeleton aspect-[4/3] rounded-none" />
      <div className="p-3 space-y-2">
        <div className="skeleton h-5 w-1/2" />
        <div className="skeleton h-4 w-5/6" />
        <div className="skeleton h-3 w-1/3" />
      </div>
    </div>
  );
}

export function GridSkeleton({ n = 8 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
      {Array.from({ length: n }, (_, i) => <CardSkeleton key={i} />)}
    </div>
  );
}

export function RowsSkeleton({ n = 5 }: { n?: number }) {
  return <div className="space-y-3">{Array.from({ length: n }, (_, i) => <div key={i} className="skeleton h-16" />)}</div>;
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    setTimeout(() => ref.current?.querySelector<HTMLElement>('input,textarea,select,button')?.focus(), 30);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title}
        className={`animate-rise bg-white w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[92dvh] flex flex-col`}>
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 pt-4 pb-3 border-b border-line shrink-0">
          <h2 className="text-lg font-bold min-w-0 break-words">{title}</h2>
          <button onClick={onClose} className="btn-ghost rounded-full p-2 -mr-2" aria-label="Close"><X size={20} /></button>
        </div>
        <div className="px-4 sm:px-5 py-4 overflow-y-auto overscroll-contain min-h-0">{children}</div>
        {footer && <div className="px-4 sm:px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-line flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 shrink-0 [&_.btn]:w-full sm:[&_.btn]:w-auto">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmation dialog with an optional (or required) note field. */
export function ConfirmDialog({ open, onClose, onConfirm, title, body, confirmLabel = 'Confirm', danger, noteLabel, noteRequired, children }: {
  open: boolean; onClose: () => void; onConfirm: (note: string) => Promise<void> | void; title: string; body?: ReactNode;
  confirmLabel?: string; danger?: boolean; noteLabel?: string; noteRequired?: boolean; children?: ReactNode;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setNote(''); setErr(''); } }, [open]);
  const go = async () => {
    if (noteRequired && note.trim().length < 3) return setErr('Please add a short explanation.');
    setBusy(true);
    try {
      await onConfirm(note.trim());
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={go}>{confirmLabel}</Button></>}>
      {body && <div className="text-[15px] text-ink-2 mb-3">{body}</div>}
      {children}
      {noteLabel && (
        <Field label={noteLabel} required={noteRequired} error={err}>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </Field>
      )}
      {!noteLabel && err && <p className="text-sm text-red-600">{err}</p>}
    </Modal>
  );
}

export function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <nav className="flex items-center justify-center gap-2 mt-8" aria-label="Pagination">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={16} /> Prev</Button>
      <span className="text-sm text-muted px-2">Page {page} of {pages}</span>
      <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next <ChevronRight size={16} /></Button>
    </nav>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-5">
      <div>
        <h1 className="text-2xl font-extrabold">{title}</h1>
        {subtitle && <p className="text-muted mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function Notice({ tone = 'amber', icon: I = Icons.Info, title, children, action }: { tone?: 'amber' | 'green' | 'red' | 'blue' | 'brand'; icon?: React.ComponentType<{ size?: number | string; className?: string }>; title: string; children?: ReactNode; action?: ReactNode }) {
  const cls = { amber: 'bg-amber-50 border-amber-200 text-amber-900', green: 'bg-emerald-50 border-emerald-200 text-emerald-900', red: 'bg-red-50 border-red-200 text-red-900', blue: 'bg-sky-50 border-sky-200 text-sky-900', brand: 'bg-brand-soft border-brand-tint text-ink' }[tone];
  return (
    <div className={`rounded-2xl border p-4 flex gap-3 ${cls}`} role="status">
      <I size={20} className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold">{title}</p>
        {children && <div className="text-sm mt-1 opacity-90">{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

export function StatCard({ label, value, icon: I, tone = 'brand', to }: { label: string; value: ReactNode; icon: React.ComponentType<{ size?: number | string; className?: string }>; tone?: string; to?: string }) {
  const inner = (
    <div className="card p-4 flex items-center gap-3 h-full hover:border-stone-300 transition">
      <div className={`size-11 rounded-xl grid place-items-center ${tone === 'amber' ? 'bg-amber-50 text-amber-700' : tone === 'red' ? 'bg-red-50 text-red-600' : 'bg-brand-soft text-brand'}`}><I size={20} /></div>
      <div className="min-w-0">
        <p className="text-2xl font-extrabold leading-tight">{value}</p>
        <p className="text-[13px] text-muted truncate">{label}</p>
      </div>
    </div>
  );
  return to ? <Link to={to} className="block">{inner}</Link> : inner;
}

/** Map an ApiError's field details onto a form. */
export function fieldErrors(e: unknown): Record<string, string> {
  return e instanceof ApiError && e.details && typeof e.details === 'object' ? (e.details as Record<string, string>) : {};
}
export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
