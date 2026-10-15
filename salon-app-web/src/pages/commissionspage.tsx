import { useCallback, useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import type { Commission, Staff } from '../types';
import { apiClient, getApiError } from '../services/api';
import { formatCurrency, useCurrency } from '../services/currency';
import { formatDate } from '../utils/format';
import { useCan, useCurrentUser, useIsAdmin } from '../hooks/useAuth';
import { useFeedback } from '../components/UI/Feedback';
import { EmptyState, PageHeader, StatCard } from '../components/UI/PageHeader';

type CommissionTotals = { total: number; paid: number; remaining: number };
type PaymentIntent = { key: string; staffId: string; amount: number };

export const CommissionsPage = () => {
  const currency = useCurrency();
  const isAdmin = useIsAdmin();
  const canReadAll = useCan('readAnyStaffFinancials');
  const ownStaffId = useCurrentUser()?.staffId ?? null;
  const { notify, confirm } = useFeedback();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [staffId, setStaffId] = useState('');
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [totals, setTotals] = useState<CommissionTotals | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // Kept when a payment gets no answer (network failure), so that retrying it reuses the same
  // idempotency key and cannot pay twice.
  const pendingPayment = useRef<PaymentIntent | null>(null);

  useEffect(() => {
    apiClient.get<Staff[]>('/staff').then(({ data }) => {
      // Members are paid by commission unless a fixed salary is set explicitly.
      const visible = canReadAll
        ? data.filter((member) => member.payType !== 'fixed')
        : data.filter((member) => member.id === ownStaffId);
      setStaff(visible);
      if (visible[0]) setStaffId(visible[0].id);
    }).catch((requestError) => setError(getApiError(requestError, 'Impossible de charger le personnel.')));
  }, [canReadAll, ownStaffId]);

  const loadCommissions = useCallback(async (id: string) => {
    const [list, summary] = await Promise.all([
      apiClient.get<Commission[]>(`/commissions/staff/${id}`),
      apiClient.get<CommissionTotals>(`/commissions/staff/${id}/total`),
    ]);
    return { list: list.data, summary: summary.data };
  }, []);

  useEffect(() => {
    if (!staffId) return;
    let active = true;
    loadCommissions(staffId).then(({ list, summary }) => {
      if (active) { setCommissions(list); setTotals(summary); setError(''); }
    }).catch((requestError) => { if (active) setError(getApiError(requestError, 'Impossible de charger les commissions.')); });
    return () => { active = false; };
  }, [staffId, loadCommissions]);

  const selected = staff.find((member) => member.id === staffId);

  const refresh = async (id: string) => {
    const { list, summary } = await loadCommissions(id);
    setCommissions(list);
    setTotals(summary);
  };

  const payOutstanding = async () => {
    if (!staffId || !totals?.remaining || !selected) return;
    const amount = totals.remaining;
    const accepted = await confirm({
      title: 'Régler les commissions ?',
      message: `Marquer ${formatCurrency(amount, currency)} comme payés à ${selected.name}.`,
      confirmLabel: 'Confirmer le paiement',
    });
    if (!accepted) return;
    const previous = pendingPayment.current;
    const intent = previous && previous.staffId === staffId && previous.amount === amount
      ? previous
      : { key: crypto.randomUUID(), staffId, amount };
    pendingPayment.current = intent;
    setSaving(true);
    try {
      await apiClient.post('/commissions/pay', { staffId, amount }, { 'Idempotency-Key': intent.key });
      pendingPayment.current = null;
      notify(`Commissions de ${selected.name} réglées.`);
    } catch (requestError) {
      if (!isAxiosError(requestError) || requestError.response) pendingPayment.current = null;
      notify(getApiError(requestError, 'Impossible d’enregistrer le paiement.'), 'error');
    } finally {
      setSaving(false);
      await refresh(staffId).catch(() => undefined);
    }
  };

  if (!canReadAll && !ownStaffId) {
    return <section className="space-y-6">
      <PageHeader eyebrow="Rémunérations" title="Commissions" subtitle="Calculées automatiquement sur les prestations encaissées." />
      <EmptyState title="Votre accès n’est relié à aucune fiche de l’équipe." hint="L’administrateur peut le relier depuis Paramètres : vous verrez alors vos propres commissions." />
    </section>;
  }

  return <section className="space-y-6">
    <PageHeader
      eyebrow="Rémunérations"
      title="Commissions"
      subtitle={canReadAll ? 'Calculées automatiquement sur les prestations encaissées.' : 'Vos commissions, calculées sur les prestations encaissées.'}
      actions={canReadAll && <label className="field min-w-56">Membre de l’équipe
        <select value={staffId} onChange={(event) => setStaffId(event.target.value)}>
          {!staff.length && <option value="">Aucun membre à la commission</option>}
          {staff.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {Number(entry.commissionRate)} %</option>)}
        </select>
      </label>}
    />
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {totals && <div className="kpi-grid">
      <StatCard label="Commissions générées" value={formatCurrency(totals.total, currency)} />
      <StatCard label="Déjà payées" value={formatCurrency(totals.paid, currency)} tone="positive" />
      <StatCard label="Reste à payer" value={formatCurrency(totals.remaining, currency)} tone={totals.remaining > 0 ? 'warning' : undefined} />
    </div>}
    {isAdmin && <div className="flex justify-end"><button type="button" className="btn btn-primary" disabled={!totals?.remaining || saving} onClick={() => void payOutstanding()}>{saving ? 'Enregistrement…' : 'Régler le solde'}</button></div>}
    <div className="overflow-x-auto">
      {commissions.length ? <table className="data-table">
        <thead><tr><th>Date</th><th className="num">Prestation</th><th className="num">Commission</th><th className="num">Part salon</th><th>État</th></tr></thead>
        <tbody>{commissions.map((entry) => <tr key={entry.id}>
          <td>{formatDate(entry.date)}</td>
          <td className="num">{formatCurrency(entry.servicePrice, currency)}</td>
          <td className="num">{formatCurrency(entry.commissionAmount, currency)}</td>
          <td className="num">{formatCurrency(entry.patronneAmount, currency)}</td>
          <td><span className={`badge ${entry.paid ? 'badge-success' : 'badge-warning'}`}>{entry.paid ? 'Payée' : 'À payer'}</span></td>
        </tr>)}</tbody>
      </table> : <EmptyState title={staff.length ? 'Aucune commission pour ce membre.' : 'Aucun membre rémunéré à la commission.'} hint={staff.length ? 'Les commissions apparaissent quand une prestation lui est attribuée en caisse.' : undefined} />}
    </div>
  </section>;
};
