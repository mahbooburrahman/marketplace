import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Store, Clock, CheckCircle2, XCircle, CreditCard, Landmark, Upload, Sparkles, AlertTriangle, MessageSquareText, Plus } from 'lucide-react';
import { api } from '../../lib/api';
import { useFetch, usePageMeta } from '../../lib/hooks';
import { dateShort, money } from '../../lib/format';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, ErrorState, Field, Input, Notice, PageHeader, RowsSkeleton, Select, Textarea, errMsg, fieldErrors } from '../../components/ui';

interface Plan { id: string; name: string; kind: string; description: string; price: number; currency: string; listing_limit: number; max_active_listings: number; duration_days: number; featured_allowed: boolean; featured_quota: number }
interface Status {
  is_seller: boolean;
  request: { id: string; status: string; message: string; admin_note: string | null; info_requested: string | null; info_response: string | null; created_at: string } | null;
  subscription: any;
  payment: { id: string; status: string; method: string; rejection_reason: string | null; reference_number: string | null } | null;
  plans: Plan[];
  active_listings: number;
  payment_options: { bank_transfer: boolean; bank_details: string | null; gateway: boolean };
}

function PlanCard({ p, selected, onSelect }: { p: Plan; selected?: boolean; onSelect?: () => void }) {
  const period = p.kind === 'single' ? 'one listing' : `${p.duration_days} days`;
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected}
      className={`text-left card p-4 transition w-full ${selected ? 'border-brand ring-4 ring-brand/15' : 'hover:border-stone-300'}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-bold">{p.name}</p>
        {p.featured_allowed && <Badge tone="amber"><Sparkles size={11} /> Featured</Badge>}
      </div>
      <p className="mt-1 text-2xl font-extrabold">{money(p.price, p.currency)}</p>
      <p className="text-xs text-muted">{period}</p>
      <ul className="mt-3 text-sm text-ink-2 space-y-1">
        <li>Up to {p.listing_limit} listing{p.listing_limit === 1 ? '' : 's'}</li>
        <li>{p.max_active_listings} live at a time</li>
        {p.featured_allowed && <li>{p.featured_quota} featured boost{p.featured_quota === 1 ? '' : 's'}</li>}
      </ul>
    </button>
  );
}

function RequestForm({ plans, onDone }: { plans: Plan[]; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ business_name: '', business_type: 'individual', message: '', preferred_plan_id: plans[1]?.id ?? plans[0]?.id ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await api.post('/api/seller/requests', { ...f, business_name: f.business_name || undefined, preferred_plan_id: f.preferred_plan_id || undefined });
      toast('Request sent — we’ll notify you once it’s reviewed');
      onDone();
    } catch (e) {
      setErrors(fieldErrors(e));
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-6">
      <div>
        <h2 className="font-bold text-lg mb-1">Choose a plan</h2>
        <p className="text-sm text-muted mb-3">The administrator confirms your plan and fee when approving your request.</p>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {plans.map((p) => <PlanCard key={p.id} p={p} selected={f.preferred_plan_id === p.id} onSelect={() => setF({ ...f, preferred_plan_id: p.id })} />)}
        </div>
      </div>
      <div className="card p-5 sm:p-6 space-y-4">
        <h2 className="font-bold text-lg">Tell us about yourself</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Business or shop name (optional)" error={errors.business_name}><Input value={f.business_name} onChange={(e) => setF({ ...f, business_name: e.target.value })} maxLength={100} /></Field>
          <Field label="Seller type">
            <Select value={f.business_type} onChange={(e) => setF({ ...f, business_type: e.target.value })}>
              <option value="individual">Individual</option><option value="shop">Shop</option><option value="company">Company</option><option value="other">Other</option>
            </Select>
          </Field>
        </div>
        <Field label="What will you sell?" required error={errors.message} hint="E.g. the kind of items, roughly how many, and whether they are new or used.">
          <Textarea rows={4} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} maxLength={1500} invalid={!!errors.message} />
        </Field>
        <div className="flex justify-end"><Button type="submit" loading={busy}><Store size={16} /> Request seller authorization</Button></div>
      </div>
    </form>
  );
}

function PaymentPanel({ s, onDone }: { s: Status; onDone: () => void }) {
  const toast = useToast();
  const sub = s.subscription;
  const [ref, setRef] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [gwBusy, setGwBusy] = useState(false);

  const submitManual = async (e: FormEvent) => {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (ref.trim().length < 3) local.reference_number = 'Enter the transaction reference.';
    if (!file) local.receipt = 'Upload your payment receipt.';
    if (Object.keys(local).length) return setErrors(local);
    setBusy(true);
    setErrors({});
    const fd = new FormData();
    fd.append('reference_number', ref.trim());
    fd.append('receipt', file!);
    try {
      await api.post(`/api/seller/subscriptions/${sub.id}/manual-payment`, fd);
      toast('Payment submitted for verification');
      onDone();
    } catch (e) {
      setErrors(fieldErrors(e));
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const payOnline = async () => {
    setGwBusy(true);
    try {
      const r = await api.post<{ url: string }>(`/api/seller/subscriptions/${sub.id}/checkout`);
      location.href = r.url;
    } catch (e) {
      toast(errMsg(e), 'error');
      setGwBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <Notice tone="brand" icon={CheckCircle2} title="Seller authorization approved — payment required">
        Your <b>{sub.plan_name}</b> plan costs <b>{money(sub.price, sub.currency)}</b>. Listing creation activates after your payment is verified.
        {sub.payment_due_at && <> Please pay by <b>{dateShort(sub.payment_due_at)}</b>.</>}
      </Notice>
      {s.payment?.status === 'rejected' && (
        <Notice tone="red" icon={XCircle} title="Your previous payment could not be verified">{s.payment.rejection_reason} — please submit it again.</Notice>
      )}
      <div className="grid lg:grid-cols-2 gap-4">
        {s.payment_options.bank_transfer && (
          <form onSubmit={submitManual} className="card p-5 space-y-4">
            <h3 className="font-bold flex items-center gap-2"><Landmark size={18} /> Bank transfer</h3>
            <pre className="whitespace-pre-wrap font-sans text-sm bg-stone-50 rounded-xl p-3 border border-line">{s.payment_options.bank_details}</pre>
            <p className="text-sm text-muted">Transfer exactly <b>{money(sub.price, sub.currency)}</b>, then enter the transaction reference and upload the receipt.</p>
            <Field label="Transaction reference" required error={errors.reference_number}><Input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={80} invalid={!!errors.reference_number} /></Field>
            <Field label="Payment receipt" required error={errors.receipt} hint="JPG, PNG, WebP or PDF up to 5 MB.">
              <label className={`flex items-center gap-3 rounded-xl border-2 border-dashed px-4 py-4 cursor-pointer hover:bg-stone-50 ${errors.receipt ? 'border-red-300' : 'border-line'}`}>
                <Upload size={20} className="text-muted" />
                <span className="text-sm truncate">{file ? file.name : 'Choose a file'}</span>
                <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
            </Field>
            <Button type="submit" loading={busy} className="w-full">Submit payment for verification</Button>
          </form>
        )}
        {s.payment_options.gateway && (
          <div className="card p-5 space-y-3 self-start">
            <h3 className="font-bold flex items-center gap-2"><CreditCard size={18} /> Pay online</h3>
            <p className="text-sm text-muted">Pay securely by card. Your seller access activates automatically once the payment provider confirms the payment.</p>
            <Button variant="accent" className="w-full" loading={gwBusy} onClick={payOnline}>Pay {money(sub.price, sub.currency)}</Button>
          </div>
        )}
        {!s.payment_options.bank_transfer && !s.payment_options.gateway && (
          <Notice title="Payments are temporarily unavailable">Please contact support to complete your payment.</Notice>
        )}
      </div>
    </div>
  );
}

function InfoResponse({ requestId, question, onDone }: { requestId: string; question: string; onDone: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await api.post(`/api/seller/requests/${requestId}/respond`, { response: text });
      toast('Thanks — your reply was sent to the administrator');
      onDone();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card p-5 space-y-3">
      <Notice tone="amber" icon={MessageSquareText} title="The administrator needs more information">{question}</Notice>
      <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Your reply…" maxLength={1500} aria-label="Your reply" />
      <div className="flex justify-end"><Button loading={busy} disabled={text.trim().length < 2} onClick={send}>Send reply</Button></div>
    </div>
  );
}

export default function Seller() {
  const { user, refresh } = useAuth();
  usePageMeta(user?.is_seller ? 'Seller plan' : 'Become a seller');
  const { data, error, loading, reload } = useFetch<Status>('/api/seller/status');
  const toast = useToast();
  const [showForm, setShowForm] = useState(false);
  const done = () => { reload(); refresh(); setShowForm(false); };

  if (loading) return <RowsSkeleton n={4} />;
  if (error || !data) return <ErrorState error={error} retry={reload} />;
  const { request: req, subscription: sub } = data;

  let body: React.ReactNode;
  if (!user?.email_verified) {
    body = <Notice title="Verify your email first" icon={AlertTriangle}>You need a verified email address before requesting seller access. <Link to="/dashboard/status" className="underline font-semibold">Resend verification</Link></Notice>;
  } else if (user.status === 'rejected' || user.status === 'suspended') {
    body = <Notice tone="red" title="Seller access isn't available for your account" icon={XCircle}>Please contact support.</Notice>;
  } else if (sub?.status === 'awaiting_payment') {
    body = <PaymentPanel s={data} onDone={done} />;
  } else if (sub?.status === 'payment_review') {
    body = <Notice tone="blue" icon={Clock} title="Your payment is being verified">We received your {data.payment?.method === 'gateway' ? 'online payment' : `bank transfer (ref. ${data.payment?.reference_number})`}. Seller privileges activate as soon as an administrator confirms it — usually within one business day.</Notice>;
  } else if (data.is_seller && sub?.status === 'active') {
    body = (
      <div className="space-y-5">
        <Notice tone="green" icon={CheckCircle2} title="Your seller account is active" action={<Link to="/dashboard/listings/new" className="btn btn-primary btn-sm"><Plus size={16} /> Create a listing</Link>}>
          {sub.plan_name} · active until <b>{dateShort(sub.expires_at)}</b>
        </Notice>
        <div className="grid sm:grid-cols-3 gap-3">
          {[['Listings used', `${sub.listings_used} / ${sub.listing_limit}`], ['Live right now', `${data.active_listings} / ${sub.max_active_listings}`], ['Featured boosts', sub.featured_allowed ? `${sub.featured_used} / ${sub.featured_quota}` : 'Not included']].map(([k, v]) => (
            <div key={k} className="card p-4"><p className="text-sm text-muted">{k}</p><p className="text-xl font-extrabold mt-0.5">{v}</p></div>
          ))}
        </div>
        {req?.status === 'pending' ? <Notice tone="blue" icon={Clock} title="Your renewal request is under review." /> : showForm ? (
          <RequestForm plans={data.plans} onDone={done} />
        ) : (
          <Button variant="outline" onClick={() => setShowForm(true)}>Request renewal or upgrade</Button>
        )}
      </div>
    );
  } else if (req?.status === 'pending') {
    body = (
      <Notice tone="blue" icon={Clock} title="Your seller authorization request is under review."
        action={<Button size="sm" variant="outline" onClick={async () => { try { await api.post(`/api/seller/requests/${req.id}/cancel`); toast('Request cancelled'); done(); } catch (e) { toast(errMsg(e), 'error'); } }}>Cancel request</Button>}>
        Submitted {dateShort(req.created_at)}. We'll notify you by email and in-app once an administrator reviews it.
      </Notice>
    );
  } else if (req?.status === 'info_requested') {
    body = <InfoResponse requestId={req.id} question={req.info_requested ?? ''} onDone={done} />;
  } else {
    body = (
      <div className="space-y-5">
        {req?.status === 'rejected' && <Notice tone="red" icon={XCircle} title="Your previous request was not approved">{req.admin_note}</Notice>}
        {(sub?.status === 'expired' || sub?.status === 'cancelled' || sub?.status === 'revoked') && (
          <Notice tone="amber" icon={AlertTriangle} title={sub.status === 'expired' ? 'Your seller plan has expired' : sub.status === 'revoked' ? 'Your seller privileges were revoked' : 'Your previous plan was cancelled'}>
            {sub.status === 'expired' ? 'Submit a renewal request to start listing again.' : sub.revoked_reason ?? 'You can submit a new request below.'}
          </Notice>
        )}
        <RequestForm plans={data.plans} onDone={done} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={data.is_seller ? 'Seller plan' : 'Become a seller'}
        subtitle={data.is_seller ? 'Manage your seller plan and limits.' : 'Only authorized sellers can post listings. Every request is reviewed by an administrator.'} />
      {!data.is_seller && !sub && !req && (
        <ol className="grid sm:grid-cols-4 gap-2 mb-6 text-sm">
          {['Request authorization', 'Admin reviews & assigns a plan', 'Pay the plan fee', 'Start posting listings'].map((t, i) => (
            <li key={t} className="rounded-xl bg-white border border-line p-3 flex items-center gap-2"><span className="size-6 rounded-full bg-brand-soft text-brand font-bold grid place-items-center text-xs">{i + 1}</span>{t}</li>
          ))}
        </ol>
      )}
      {body}
    </div>
  );
}
