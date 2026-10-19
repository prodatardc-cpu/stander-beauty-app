import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import type { StaffPay } from '../types';
import { apiClient, getApiError } from '../services/api';
import { formatCurrency, useCurrency, type Currency } from '../services/currency';
import { periodLabel } from '../utils/format';
import { useCan, useCurrentUser } from '../hooks/useAuth';
import { MoneyByCurrency } from '../components/UI/Money';
import { Avatar, EmptyState, PageHeader } from '../components/UI/PageHeader';
import { PayDialog } from '../components/Team/PayDialog';

const currencies: Currency[] = ['USD', 'CDF'];
const pick = (member: StaffPay, read: (amounts: StaffPay['byCurrency'][Currency]) => number) =>
  Object.fromEntries(currencies.map((currency) => [currency, read(member.byCurrency[currency])])) as Record<Currency, number>;

// Team remuneration: what each member earned this period, was advanced, was paid and is still owed.
export const CommissionsPage = () => {
  const canReadAll = useCan('readAnyStaffFinancials');
  const canPay = useCan('payCommissions');
  const ownStaffId = useCurrentUser()?.staffId ?? null;
  const baseCurrency = useCurrency();
  const [team, setTeam] = useState<StaffPay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [paying, setPaying] = useState<StaffPay | null>(null);

  const fetchTeam = useCallback(async () => (await apiClient.get<StaffPay[]>('/payroll')).data, []);
  const reload = useCallback(async () => {
    try {
      setTeam(await fetchTeam());
      setError('');
    } catch (requestError) {
      setError(getApiError(requestError, 'Impossible de charger les rémunérations.'));
    }
  }, [fetchTeam]);

  useEffect(() => {
    if (!canReadAll) return;
    let active = true;
    fetchTeam()
      .then((data) => { if (active) { setTeam(data); setError(''); } })
      .catch((requestError) => { if (active) setError(getApiError(requestError, 'Impossible de charger les rémunérations.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canReadAll, fetchTeam]);

  // A team or till account sees its own page.
  if (!canReadAll) {
    if (ownStaffId) return <Navigate to={`/staff/${ownStaffId}`} replace />;
    return <section className="space-y-6">
      <PageHeader eyebrow="Équipe" title="Rémunérations" />
      <EmptyState title="Votre accès n’est relié à aucune fiche de l’équipe." hint="L’administrateur peut le relier depuis Paramètres : vous verrez alors vos prestations et votre rémunération." />
    </section>;
  }

  const visible = team.filter((member) => showArchived || !member.archivedAt);
  const totalDue = Object.fromEntries(currencies.map((currency) => [currency, visible.reduce((sum, member) => sum + Math.max(0, member.byCurrency[currency].remaining), 0)])) as Record<Currency, number>;

  return (
    <section className="space-y-5">
      <PageHeader
        eyebrow="Équipe"
        title="Rémunérations"
        subtitle={<>Commissions et salaires par membre, dans la devise de chaque prestation. Reste à payer : {currencies.map((currency) => formatCurrency(totalDue[currency], currency)).join(' · ')}.</>}
      />
      <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />Afficher les membres archivés</label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto">
        {loading ? <p className="loading-line">Chargement…</p> : visible.length ? (
          <table className="data-table compact-table">
            <thead><tr><th>Membre</th><th>Rémunération</th><th className="num">Prestations (période)</th><th className="num">Acquis (période)</th><th className="num">Avances</th><th className="num">Payé</th><th className="num">Reste à payer</th><th className="actions">Actions</th></tr></thead>
            <tbody>{visible.map((member) => <tr key={member.staffId}>
              <td><span className="flex items-center gap-3"><Avatar name={member.name} photoUrl={member.photoUrl} size={32} /><span><Link to={`/staff/${member.staffId}`} className="cell-title link-button">{member.name}</Link><span className="cell-sub">{periodLabel(member)}</span></span></span></td>
              <td>{member.payType === 'fixed' ? `Salaire fixe · ${formatCurrency(member.monthlySalary, baseCurrency)}` : `Commission · ${member.commissionRate} %`}</td>
              <td className="num"><MoneyByCurrency values={pick(member, (amounts) => amounts.period.eligibleRevenue)} /></td>
              <td className="num"><MoneyByCurrency values={pick(member, (amounts) => amounts.period.earned)} /></td>
              <td className="num"><MoneyByCurrency values={pick(member, (amounts) => amounts.period.advances)} tone="expense" /></td>
              <td className="num"><MoneyByCurrency values={pick(member, (amounts) => amounts.period.payments)} /></td>
              <td className="num"><MoneyByCurrency values={pick(member, (amounts) => amounts.remaining)} tone={currencies.some((currency) => member.byCurrency[currency].remaining > 0) ? 'expense' : 'profit'} /></td>
              <td className="actions"><span className="row-actions">
                <Link to={`/staff/${member.staffId}`} className="link-button">Fiche</Link>
                {canPay && !member.archivedAt && <button type="button" className="link-button" onClick={() => setPaying(member)}>Payer</button>}
              </span></td>
            </tr>)}</tbody>
          </table>
        ) : <EmptyState title="Aucun membre dans l’équipe." />}
      </div>
      {paying && <PayDialog pay={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); void reload(); }} />}
    </section>
  );
};
