import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, XCircle, FileText, Undo2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useFetch, usePageMeta } from '../../lib/hooks';
import { dateTime, money } from '../../lib/format';
import { useToast } from '../../context/ToastContext';
import { Button, Checkbox, ConfirmDialog, EmptyState, ErrorState, Field, PageHeader, Pagination, RowsSkeleton, Select, StatusBadge } from '../../components/ui';

export default function AdminPayments() {
  usePageMeta('Payments');
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'under_review';
  const refunds = params.get('refunds') ?? '';
  const page = Number(params.get('page') ?? 1);
  const { data, error, loading, reload } = useFetch<any>(`/api/admin/payments?status=${status === 'all' ? '' : status}&refunds=${refunds}&page=${page}`);
  const [dialog, setDialog] = useState<null | { kind: 'verify' | 'reject' | 'refund'; p: any }>(null);
  const [refundStatus, setRefundStatus] = useState('refunded');
  const [revoke, setRevoke] = useState(false);

  const tabs = [['under_review', 'Awaiting verification'], ['pending', 'Pending (online)'], ['verified', 'Verified'], ['rejected', 'Rejected'], ['failed', 'Failed'], ['all', 'All']];
  return (
    <div>
      <PageHeader title="Payments" subtitle="Seller privileges activate only after you verify a payment (or a gateway confirms it)." />
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar mb-4">
        {tabs.map(([k, v]) => <button key={k} className={`chip shrink-0 ${status === k && !refunds ? 'chip-active' : ''}`} onClick={() => setParams({ status: k })}>{v}</button>)}
        <button className={`chip shrink-0 ${refunds ? 'chip-active' : ''}`} onClick={() => setParams({ status: 'all', refunds: '1' })}><Undo2 size={13} /> Refund requests</button>
      </div>
      {loading ? <RowsSkeleton /> : error ? <ErrorState error={error} retry={reload} /> : data.items.length === 0 ? (
        <div className="card"><EmptyState title="Nothing here" body={status === 'under_review' ? 'Payments waiting for verification appear here.' : undefined} /></div>
      ) : (
        <div className="space-y-3">
          {data.items.map((p: any) => (
            <div key={p.id} className="card p-4 sm:p-5">
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <p className="text-xl font-extrabold">{money(p.amount, p.currency)}</p>
                  <p className="text-sm"><b>{p.full_name}</b> <span className="text-muted">· {p.email}</span></p>
                  <p className="text-sm text-muted">{p.plan_name} · {p.method.replace('_', ' ')}{p.provider !== 'manual' && ` (${p.provider})`} · {dateTime(p.created_at)}</p>
                  {p.reference_number && <p className="text-sm mt-1">Reference: <code className="bg-stone-100 rounded px-1.5 py-0.5 font-semibold">{p.reference_number}</code></p>}
                  {p.provider_ref && <p className="text-xs text-muted mt-1">Gateway ref: {p.provider_ref}</p>}
                  {p.verified_by_name && <p className="text-xs text-muted mt-1">Verified by {p.verified_by_name} on {dateTime(p.verified_at)}</p>}
                  {p.rejection_reason && <p className="text-sm text-red-600 mt-1">{p.rejection_reason}</p>}
                  {p.refund_note && <p className="text-sm mt-1"><b>Refund note:</b> {p.refund_note}</p>}
                </div>
                <div className="text-right space-y-1">
                  <StatusBadge status={p.status} />
                  {p.refund_status !== 'none' && <div><StatusBadge status={p.refund_status} /></div>}
                </div>
              </div>
              {p.receipts.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {p.receipts.map((r: any) => (
                    <a key={r.id} href={r.url} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm"><FileText size={14} /> View receipt</a>
                  ))}
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {['under_review', 'pending'].includes(p.status) && (
                  <>
                    <Button size="sm" onClick={() => setDialog({ kind: 'verify', p })}><CheckCircle2 size={15} /> Verify payment</Button>
                    <Button size="sm" variant="danger" onClick={() => setDialog({ kind: 'reject', p })}><XCircle size={15} /> Reject</Button>
                  </>
                )}
                {p.status === 'verified' && p.method !== 'admin_waiver' && ['none', 'requested', 'processing'].includes(p.refund_status) && (
                  <Button size="sm" variant="outline" onClick={() => { setRefundStatus(p.refund_status === 'processing' ? 'refunded' : 'processing'); setRevoke(false); setDialog({ kind: 'refund', p }); }}><Undo2 size={15} /> Manage refund</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {data && <Pagination page={data.page} pages={data.pages} onPage={(pg) => setParams({ ...Object.fromEntries(params), page: String(pg) })} />}

      {dialog?.kind === 'verify' && (
        <ConfirmDialog open onClose={() => setDialog(null)} title="Verify this payment?" confirmLabel="Verify & activate"
          body={<>Confirm you have received <b>{money(dialog.p.amount, dialog.p.currency)}</b>{dialog.p.reference_number && <> with reference <b>{dialog.p.reference_number}</b></>}. Seller privileges activate immediately.</>}
          noteLabel="Internal note (optional)"
          onConfirm={async (note) => { await api.post(`/api/admin/payments/${dialog.p.id}/verify`, { note: note || undefined }); toast('Payment verified — seller activated'); reload(); }} />
      )}
      {dialog?.kind === 'reject' && (
        <ConfirmDialog open onClose={() => setDialog(null)} danger title="Reject this payment?" confirmLabel="Reject" noteLabel="Reason (shown to the seller)" noteRequired
          body="The seller will be asked to submit the payment again."
          onConfirm={async (reason) => { await api.post(`/api/admin/payments/${dialog.p.id}/reject`, { reason }); toast('Payment rejected'); reload(); }} />
      )}
      {dialog?.kind === 'refund' && (
        <ConfirmDialog open onClose={() => setDialog(null)} title="Manage refund" confirmLabel="Update refund" noteLabel="Note (shown to the seller)"
          body={<>Record the refund status for <b>{money(dialog.p.amount, dialog.p.currency)}</b>. Process the actual refund through your bank or payment provider.</>}
          onConfirm={async (note) => { await api.post(`/api/admin/payments/${dialog.p.id}/refund`, { refund_status: refundStatus, note: note || undefined, revoke_access: revoke }); toast('Refund updated'); reload(); }}>
          <Field label="Refund status" className="mb-3">
            <Select value={refundStatus} onChange={(e) => setRefundStatus(e.target.value)}>
              <option value="processing">Processing</option><option value="refunded">Refunded</option><option value="declined">Declined</option>
            </Select>
          </Field>
          <div className="mb-3"><Checkbox checked={revoke} onChange={(e) => setRevoke(e.target.checked)} label="Also revoke the seller plan paid by this payment" /></div>
        </ConfirmDialog>
      )}
    </div>
  );
}
