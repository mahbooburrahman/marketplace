import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { MailCheck, Eye, EyeOff, CheckCircle2, XCircle } from 'lucide-react';
import { BrandMark } from '../components/BrandLogo';
import { api } from '../lib/api';
import { usePageMeta } from '../lib/hooks';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useToast } from '../context/ToastContext';
import { Button, Checkbox, Field, Input, Notice, Spinner, errMsg, fieldErrors } from '../components/ui';

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const { settings } = useSettings();
  return (
    <div className="min-h-[calc(100dvh-8rem)] grid place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <span className="inline-grid mb-3"><BrandMark size={52} /></span>
          <h1 className="text-2xl font-extrabold">{title}</h1>
          {subtitle && <p className="text-muted mt-1">{subtitle}</p>}
        </div>
        <div className="card p-6 sm:p-7 shadow-sm">{children}</div>
        {footer && <div className="text-center text-sm text-muted mt-5">{footer}</div>}
        <p className="text-center text-xs text-muted mt-6">{settings?.site.name}</p>
      </div>
    </div>
  );
}

function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? 'text' : 'password'} className="pr-11" />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-1 top-1 size-9 grid place-items-center text-muted hover:text-ink">
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

/** Cloudflare Turnstile widget, rendered only when VITE_TURNSTILE_SITE_KEY is set. */
function Captcha({ onToken }: { onToken: (t: string) => void }) {
  const key = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!key || !ref.current) return;
    const render = () => (window as any).turnstile?.render(ref.current, { sitekey: key, callback: onToken });
    if ((window as any).turnstile) return void render();
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    s.async = true;
    s.onload = render;
    document.head.appendChild(s);
  }, [key, onToken]);
  return key ? <div ref={ref} className="my-2" /> : null;
}

export function Login() {
  usePageMeta('Log in');
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const next = params.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/api/auth/login', { email, password });
      await refresh();
      nav(safeNext, { replace: true });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Welcome back" subtitle="Log in to message sellers and manage your account."
      footer={<>New here? <Link to="/register" className="text-brand font-semibold">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <p className="rounded-xl bg-red-50 text-red-700 text-sm px-3 py-2.5" role="alert">{error}</p>}
        <Field label="Email" htmlFor="email"><Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password" htmlFor="password"><PasswordInput id="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm">
          <Link to="/resend-verification" className="text-muted hover:text-ink">Resend verification</Link>
          <Link to="/forgot-password" className="text-brand font-semibold">Forgot password?</Link>
        </div>
        <Button type="submit" loading={busy} className="w-full">Log in</Button>
      </form>
    </AuthShell>
  );
}

export function Register() {
  usePageMeta('Create account');
  const [f, setF] = useState({ full_name: '', email: '', phone: '', password: '', confirm_password: '', accept_terms: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [captcha, setCaptcha] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (f.password !== f.confirm_password) local.confirm_password = 'Passwords do not match.';
    if (!f.accept_terms) local.accept_terms = 'You must accept the terms and conditions.';
    if (Object.keys(local).length) return setErrors(local);
    setBusy(true);
    setErrors({});
    try {
      const r = await api.post('/api/auth/register', { ...f, captcha_token: captcha || undefined });
      setDone(r.message);
    } catch (e) {
      const fe = fieldErrors(e);
      setErrors(Object.keys(fe).length ? fe : { _: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthShell title="Check your inbox">
        <div className="text-center">
          <MailCheck size={44} className="mx-auto text-brand" />
          <p className="mt-3 text-ink-2">{done}</p>
          <p className="mt-2 text-sm text-muted">We sent it to <b>{f.email}</b>. The link expires in 24 hours.</p>
          <ol className="mt-5 text-left text-sm space-y-2 bg-brand-soft rounded-xl p-4">
            <li><b>1.</b> Verify your email</li>
            <li><b>2.</b> Log in — your account is active straight away</li>
            <li><b>3.</b> Message sellers. (Want to sell? Request seller approval later.)</li>
          </ol>
          <Link to="/resend-verification" className="btn btn-outline w-full mt-5">Didn't get it? Resend</Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create your account" subtitle="Join to save listings and contact sellers."
      footer={<>Already have an account? <Link to="/login" className="text-brand font-semibold">Log in</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {errors._ && <p className="rounded-xl bg-red-50 text-red-700 text-sm px-3 py-2.5" role="alert">{errors._}</p>}
        <Field label="Full name" required error={errors.full_name} htmlFor="full_name"><Input id="full_name" autoComplete="name" value={f.full_name} onChange={set('full_name')} invalid={!!errors.full_name} /></Field>
        <Field label="Email address" required error={errors.email} htmlFor="r-email"><Input id="r-email" type="email" autoComplete="email" value={f.email} onChange={set('email')} invalid={!!errors.email} /></Field>
        <Field label="Mobile number" required error={errors.phone} htmlFor="phone"><Input id="phone" type="tel" autoComplete="tel" placeholder="+1 416 555 0123" value={f.phone} onChange={set('phone')} invalid={!!errors.phone} /></Field>
        <Field label="Password" required error={errors.password} hint="At least 8 characters, with letters and numbers." htmlFor="r-pw">
          <PasswordInput id="r-pw" autoComplete="new-password" value={f.password} onChange={set('password')} invalid={!!errors.password} />
        </Field>
        <Field label="Confirm password" required error={errors.confirm_password} htmlFor="r-pw2">
          <PasswordInput id="r-pw2" autoComplete="new-password" value={f.confirm_password} onChange={set('confirm_password')} invalid={!!errors.confirm_password} />
        </Field>
        <div>
          <Checkbox checked={f.accept_terms} onChange={set('accept_terms')}
            label={<>I agree to the <Link to="/terms" target="_blank" className="text-brand font-semibold">Terms and Conditions</Link> and <Link to="/privacy" target="_blank" className="text-brand font-semibold">Privacy Policy</Link>.</>} />
          {errors.accept_terms && <p className="mt-1.5 text-[13px] text-red-600">{errors.accept_terms}</p>}
        </div>
        <Captcha onToken={setCaptcha} />
        <Button type="submit" loading={busy} className="w-full">Create account</Button>
      </form>
    </AuthShell>
  );
}

export function VerifyEmail() {
  usePageMeta('Verify email');
  const [params] = useSearchParams();
  const { refresh } = useAuth();
  const [state, setState] = useState<{ ok?: boolean; msg?: string }>({});
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const token = params.get('token');
    if (!token) return setState({ ok: false, msg: 'This link is missing its token.' });
    api.post('/api/auth/verify-email', { token })
      .then((r) => { setState({ ok: true, msg: r.message }); refresh(); })
      .catch((e) => setState({ ok: false, msg: errMsg(e) }));
  }, [params, refresh]);
  return (
    <AuthShell title="Email verification">
      <div className="text-center py-2">
        {state.ok === undefined ? <Spinner size={32} className="mx-auto text-brand" /> : state.ok ? (
          <>
            <CheckCircle2 size={44} className="mx-auto text-emerald-600" />
            <p className="mt-3 font-semibold">{state.msg}</p>
            <p className="mt-1 text-sm text-muted">You can now save listings and message sellers.</p>
            <Link to="/dashboard/status" className="btn btn-primary w-full mt-5">Go to my account</Link>
          </>
        ) : (
          <>
            <XCircle size={44} className="mx-auto text-red-500" />
            <p className="mt-3 font-semibold">{state.msg}</p>
            <Link to="/resend-verification" className="btn btn-outline w-full mt-5">Send a new link</Link>
          </>
        )}
      </div>
    </AuthShell>
  );
}

function EmailOnlyForm({ title, subtitle, endpoint, button }: { title: string; subtitle: string; endpoint: string; button: string }) {
  const { user } = useAuth();
  const [email, setEmail] = useState(user?.email ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await api.post(endpoint, { email });
      setMsg(r.message);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title={title} subtitle={subtitle} footer={<Link to="/login" className="text-brand font-semibold">Back to log in</Link>}>
      {msg ? <Notice tone="green" icon={MailCheck} title={msg} /> : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email" error={err} htmlFor="e"><Input id="e" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Button type="submit" loading={busy} className="w-full">{button}</Button>
        </form>
      )}
    </AuthShell>
  );
}

export const ForgotPassword = () => {
  usePageMeta('Forgot password');
  return <EmailOnlyForm title="Reset your password" subtitle="We'll email you a secure link to choose a new password." endpoint="/api/auth/forgot-password" button="Send reset link" />;
};
export const ResendVerification = () => {
  usePageMeta('Resend verification');
  return <EmailOnlyForm title="Resend verification email" subtitle="Enter the email you registered with." endpoint="/api/auth/resend-verification" button="Send verification link" />;
};

export function ResetPassword() {
  usePageMeta('Choose a new password');
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState({ password: '', confirm_password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (f.password !== f.confirm_password) return setErrors({ confirm_password: 'Passwords do not match.' });
    setBusy(true);
    try {
      const r = await api.post('/api/auth/reset-password', { token: params.get('token') ?? '', ...f });
      toast(r.message);
      nav('/login');
    } catch (e) {
      const fe = fieldErrors(e);
      setErrors(Object.keys(fe).length ? fe : { _: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={submit} className="space-y-4">
        {errors._ && <p className="rounded-xl bg-red-50 text-red-700 text-sm px-3 py-2.5" role="alert">{errors._} <Link to="/forgot-password" className="underline font-semibold">Request a new link</Link></p>}
        <Field label="New password" error={errors.password} hint="At least 8 characters, with letters and numbers." htmlFor="np"><PasswordInput id="np" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <Field label="Confirm new password" error={errors.confirm_password} htmlFor="np2"><PasswordInput id="np2" autoComplete="new-password" value={f.confirm_password} onChange={(e) => setF({ ...f, confirm_password: e.target.value })} /></Field>
        <Button type="submit" loading={busy} className="w-full">Update password</Button>
      </form>
    </AuthShell>
  );
}

export { PasswordInput };
