import { useCallback, useEffect, useState } from 'react';
import type { Commission, Staff } from '../types';
import { apiClient, getApiError } from '../services/api';
import { formatCurrency, useCurrency } from '../services/currency';
import { formatDate } from '../utils/format';
import { useIsAdmin } from '../hooks/useAuth';
import { useFeedback } from '../components/UI/Feedback';
import { EmptyState, PageHeader, StatCard } from '../components/UI/PageHeader';

type CommissionTotals = { total: number; paid: number; remaining: number };

export const CommissionsPage = () => {
  const currency = useCurrency();
  const isAdmin = useIsAdmin();
  const { notify, confirm } = useFeedback();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [staffId, setStaffId] = useState('');
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [totals, setTotals] = useState<CommissionTotals | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient.get<Staff[]>('/staff').then(({ data }) => {
      const commissioned = data.filter((member) => member.payType === 'commission');
      setStaff(commissioned);
      if (commissioned[0]) setStaffId(commissioned[0].id);
    }).catch((requestError) => setError(getApiError(requestError, 'Impossible de charger le personnel.')));
  }, []);

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

  const payOutstanding = async () => {
    if (!staffId || !totals?.remaining || !selected) return;
    const accepted = await confirm({
      title: 'Régler les commissions ?',
      message: `Marquer ${formatCurrency(totals.remaining, currency)} comme payés à ${selected.name}.`,
      confirmLabel: 'Confirmer le paiement',
    });
    if (!accepted) return;
    setSaving(true);
    try {
      await apiClient.post('/commissions/pay', { staffId, amount: totals.remaining });
      const { list, summary } = await loadCommissions(staffId);
      setCommissions(list);
      setTotals(summary);
      notify(`Commissions de ${selected.name} réglées.`);
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible d’enregistrer le paiement.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return <section className="space-y-6">
    <PageHeader
      eyebrow="Rémunérations"
      title="Commissions"
      subtitle="Calculées automatiquement sur les prestations encaissées."
      actions={<label className="field min-w-56">Membre de l’équipe
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
