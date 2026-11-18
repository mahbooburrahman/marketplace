import { useState } from 'react';
import { api } from '../lib/api';
import { REPORT_REASONS } from '../lib/format';
import { useToast } from '../context/ToastContext';
import { Button, Field, Modal, Select, Textarea, errMsg } from './ui';

export function ReportDialog({ open, onClose, targetType, targetId, label }: { open: boolean; onClose: () => void; targetType: 'listing' | 'user' | 'conversation'; targetId: string; label: string }) {
  const toast = useToast();
  const [reason, setReason] = useState(targetType === 'conversation' ? 'harassment' : 'fake_product');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/account/reports', { target_type: targetType, target_id: targetId, reason, details: details.trim() || undefined });
      toast(r.message ?? 'Report sent');
      onClose();
      setDetails('');
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Report ${label}`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} onClick={submit}>Send report</Button></>}>
      <p className="text-sm text-muted mb-4">Reports are confidential. Our moderators review every report and take action where needed.</p>
      <Field label="What's wrong?" className="mb-3">
        <Select value={reason} onChange={(e) => setReason(e.target.value)}>
          {Object.entries(REPORT_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </Field>
      <Field label="Details (optional)" hint="Add anything that helps us investigate.">
        <Textarea rows={4} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} />
      </Field>
    </Modal>
  );
}
