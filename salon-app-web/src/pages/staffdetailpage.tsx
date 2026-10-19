import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { StaffPayDetail } from '../types';
import { apiClient, getApiError } from '../services/api';
import { formatCurrency, useCurrency, type Currency } from '../services/currency';
import { formatDate, formatDateTime, formatReceiptNumber, paymentMethodLabels, periodLabel } from '../utils/format';
import { useCan } from '../hooks/useAuth';
import { Money } from '../components/UI/Money';
import { Avatar, EmptyState, PageHeader, StatCard } from '../components/UI/PageHeader';
import { PayDialog } from '../components/Team/PayDialog';
import { ReceiptModal } from '../components/Sales/Receipt';

const currencies: Currency[] = ['USD', 'CDF'];

export const StaffDetailPage = () => {
  const { id = '' } = useParams();
  const baseCurrency = useCurrency();
  const canPay = useCan('payCommissions');
  const canReadAll = useCan('readAnyStaffFinancials');
  const [detail, setDetail] = useState<StaffPayDetail | null>(null);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => (await apiClient.get<StaffPayDetail>(`/payroll/${id}`)).data, [id]);
  const reload = useCallback(async () => {
    try {
      setDetail(await fetchDetail());
      setError('');
    } catch (requestError) {
      setError(getApiError(requestError, 'Impossible de charger cette fiche.'));
    }
  }, [fetchDetail]);

  useEffect(() => {
    let active = true;
    fetchDetail()
      .then((data) => { if (active) { setDetail(data); setError(''); } })
      .catch((requestError) => { if (active) setError(getApiError(requestError, 'Impossible de charger cette fiche.')); });
    return () => { active = false; };
  }, [fetchDetail]);

  if (!detail) {
    return <section className="space-y-5">
      <PageHeader back={canReadAll ? '/remunerations' : '/dashboard'} eyebrow="Équipe" title="Fiche employé" />
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : <p className="loading-line">Chargement…</p>}
    </section>;
  }

  const fixed = detail.payType === 'fixed';
  // The base currency always; the other one as soon as there is something in it.
  const shown = currencies.filter((currency) => currency === baseCurrency ||
    detail.byCurrency[currency].total.eligibleRevenue !== 0 || detail.byCurrency[currency].total.advances !== 0 ||
    detail.byCurrency[currency].total.payments !== 0 || detail.byCurrency[currency].remaining !== 0);
  const completedServices = detail.services.filter((service) => service.status === 'completed');

  return (
    <section className="space-y-5">
      <PageHeader
        back={canReadAll ? '/remunerations' : '/dashboard'}
        eyebrow="Équipe"
        title={detail.name}
        subtitle={<span className="flex flex-wrap items-center gap-3">
          <Avatar name={detail.name} photoUrl={detail.photoUrl} size={32} />
          <span>{detail.position} · {fixed ? `Salaire fixe ${formatCurrency(detail.monthlySalary, baseCurrency)} / mois` : `Commission ${detail.commissionRate} % des prestations`}{detail.archivedAt ? ' · archivé(e)' : ''}</span>
        </span>}
        actions={canPay && <button type="button" className="btn btn-primary" onClick={() => setPaying(true)}>Payer la rémunération</button>}
      />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      {shown.map((currency) => {
        const pay = detail.byCurrency[currency];
        const money = (value: number) => formatCurrency(value, currency);
        return <section key={currency} className="panel">
          <div className="panel-header"><h2 className="section-title">{periodLabel(detail)} · {currency}</h2></div>
          <div className="kpi-grid kpi-grid-4 kpi-compact">
            <StatCard label="Prestations éligibles" value={money(pay.period.eligibleRevenue)} hint={`${pay.period.servicesCount} prestation(s) · chiffre d’affaires attribué`} />
            <StatCard label={fixed ? 'Salaire du mois' : `Rémunération acquise (${detail.commissionRate} %)`} value={money(pay.period.earned)} />
            <StatCard tone="expense" label="Avances reçues" value={money(pay.period.advances)} hint={`Paiements effectués : ${money(pay.period.payments)}`} />
            <StatCard tone={pay.remaining > 0 ? 'warning' : 'profit'} label="Solde restant à payer" value={money(pay.remaining)}
              hint={pay.carriedOver > 0 ? `dont ${money(pay.carriedOver)} des périodes précédentes` : pay.carriedOver < 0 ? `après ${money(-pay.carriedOver)} versés d’avance` : pay.remaining === 0 ? 'Tout est payé' : undefined} />
          </div>
          {!fixed && <p className="mt-3 text-sm text-gray-600">
            Depuis le début : {pay.total.servicesCount} prestation(s) · {money(pay.total.eligibleRevenue)} de prestations · {money(pay.total.earned)} acquis · {money(pay.total.advances)} d’avances · {money(pay.total.payments)} payés.
          </p>}
        </section>;
      })}

      <section className="space-y-3">
        <h2 className="section-title">Prestations réalisées</h2>
        <div className="overflow-x-auto">
          {detail.services.length ? <table className="data-table compact-table">
            <thead><tr><th>Date</th><th>Reçu</th><th>Prestation</th><th className="num">Montant</th>{!fixed && <th className="num">Commission</th>}<th>État</th></tr></thead>
            <tbody>{detail.services.map((service, index) => {
              const currency = (service.currency ?? baseCurrency) as Currency;
              return <tr key={`${service.saleId}-${index}`} className={service.status === 'refunded' ? 'is-cancelled' : undefined}>
                <td className="whitespace-nowrap">{formatDateTime(service.date)}</td>
                <td><button type="button" className="link-button" onClick={() => setReceiptId(service.saleId)}>{formatReceiptNumber(service.receiptNumber)}</button></td>
                <td>{service.quantity > 1 ? `${service.quantity} × ` : ''}{service.name}{service.audience ? ` · ${service.audience === 'women' ? 'Femmes' : 'Hommes'}` : ''}</td>
                <td className="num">{service.currency ? <Money value={service.amount} currency={currency} /> : '—'}</td>
                {!fixed && <td className="num">{service.commission !== null ? <Money value={service.commission} currency={currency} /> : '—'}</td>}
                <td>{service.status === 'refunded' ? <span className="badge badge-danger">Vente annulée</span> : <span className="badge badge-success">Comptée</span>}</td>
              </tr>;
            })}</tbody>
          </table> : <EmptyState title="Aucune prestation attribuée pour l’instant." hint="Une prestation apparaît ici dès qu’elle est encaissée en caisse avec ce membre dans « Réalisé par »." />}
        </div>
        {completedServices.length > 0 && <p className="text-xs text-gray-500">Les prestations des ventes annulées restent visibles mais ne comptent plus dans la rémunération.</p>}
      </section>

      <section className="space-y-3">
        <h2 className="section-title">Historique des rémunérations</h2>
        <div className="overflow-x-auto">
          {detail.payouts.length ? <table className="data-table compact-table">
            <thead><tr><th>Date</th><th>Type</th><th className="num">Montant</th><th>Mode</th><th>Note</th></tr></thead>
            <tbody>{detail.payouts.map((payout) => <tr key={payout.id}>
              <td className="whitespace-nowrap">{formatDateTime(payout.createdAt)}</td>
              <td><span className={`badge ${payout.kind === 'advance' ? 'badge-warning' : 'badge-success'}`}>{payout.kind === 'advance' ? 'Avance' : 'Paiement'}</span></td>
              <td className="num"><Money value={payout.amount} currency={payout.currency} /></td>
              <td>{paymentMethodLabels[payout.paymentMethod] ?? payout.paymentMethod}</td>
              <td><span className="cell-sub">{payout.note ?? '—'}</span></td>
            </tr>)}</tbody>
          </table> : <EmptyState title="Aucun versement enregistré." />}
        </div>
        <p className="text-xs text-gray-500">Période de rémunération : {detail.period.kind === 'weekly' ? 'hebdomadaire' : 'mensuelle'} (réglable dans Paramètres). Dernier calcul le {formatDate(new Date())}.</p>
      </section>

      {paying && <PayDialog pay={detail} onClose={() => setPaying(false)} onDone={() => { setPaying(false); void reload(); }} />}
      {receiptId && <ReceiptModal saleId={receiptId} onClose={() => setReceiptId(null)} />}
    </section>
  );
};
