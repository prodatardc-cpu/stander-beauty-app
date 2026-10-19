import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import type { JournalEntry, PeriodFigures } from '../types';
import { apiClient, getApiError } from '../services/api';
import type { Currency } from '../services/currency';
import { formatDateTime, formatReceiptNumber, formatTime, paymentMethodLabels } from '../utils/format';
import { useCan } from '../hooks/useAuth';
import { useFeedback } from '../components/UI/Feedback';
import { Money } from '../components/UI/Money';
import { EmptyState, PageHeader, StatCard } from '../components/UI/PageHeader';
import { ReceiptModal } from '../components/Sales/Receipt';

type DaySale = {
  id: string; receiptNumber: number; date: string; status: 'completed' | 'refunded'; currency: Currency | null;
  totalAmount: number; amountPaid: number; remainingAmount: number; paymentMethod: keyof typeof paymentMethodLabels;
  client: string; staffName: string | null; createdBy: string | null; cancelledAt: string | null; cancelledBy: string | null; cancelReason: string | null;
  items: { type: 'service' | 'product'; name: string; audience: 'women' | 'men' | null; quantity: number; unitPrice: number; subtotal: number }[];
};
type DayDetail = {
  day: string;
  closedAt: string | null;
  byCurrency: Record<Currency, PeriodFigures>;
  unclassifiedSales: number;
  sales: DaySale[];
  services: { saleId: string; receiptNumber: number; date: string; name: string; audience: string | null; quantity: number; amount: number; currency: Currency | null; staffName: string | null }[];
  products: { saleId: string; receiptNumber: number; date: string; name: string; quantity: number; amount: number; currency: Currency | null }[];
  cancellations: DaySale[];
  debts: {
    created: DaySale[];
    payments: { id: string; date: string; amount: number; currency: Currency; paymentMethod: keyof typeof paymentMethodLabels; receiptNumber: number | null; client: string | null; remainingAmount: number | null; recordedBy: string | null }[];
  };
  expenses: { id: string; date: string; description: string; category: string; amount: number; currency: Currency; paymentMethod: keyof typeof paymentMethodLabels; createdBy: string | null; cancelledAt: string | null; cancelledBy: string | null; cancelReason: string | null }[];
  payouts: { id: string; date: string; staffId: string; staffName: string | null; kind: 'advance' | 'payment'; amount: number; currency: Currency; paymentMethod: keyof typeof paymentMethodLabels; note: string | null; paidBy: string | null }[];
  journal: JournalEntry[];
  cashCounts: { id: string; currency: Currency; expectedAmount: number; countedAmount: number; difference: number; note: string | null; countedBy: string | null; date: string }[];
};

const currencies: Currency[] = ['USD', 'CDF'];
const amount = (value: number, currency: Currency | null, tone?: 'profit' | 'expense' | 'danger' | 'muted') => currency ? <Money value={value} currency={currency} tone={tone} /> : '—';

const Block = ({ title, count, children }: { title: string; count: number; children: ReactNode }) => (
  <section className="space-y-2">
    <h2 className="section-title">{title} <span className="text-sm font-normal text-gray-500">({count})</span></h2>
    <div className="overflow-x-auto">{count ? children : <EmptyState title="Rien ce jour-là." />}</div>
  </section>
);

// Every operation of one day, with who did what. Past days are read as recorded: cancellations and
// corrections appear as their own dated lines, nothing is overwritten.
export const HistoryDayPage = () => {
  const { day = '' } = useParams();
  const canClose = useCan('closeDay');
  const { notify, confirm } = useFeedback();
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [error, setError] = useState('');
  const [receiptId, setReceiptId] = useState<string | null>(null);

  const fetchDay = useCallback(async () => (await apiClient.get<DayDetail>(`/history/days/${day}`)).data, [day]);

  useEffect(() => {
    let active = true;
    fetchDay()
      .then((data) => { if (active) { setDetail(data); setError(''); } })
      .catch((requestError) => { if (active) setError(getApiError(requestError, 'Impossible de charger cette journée.')); });
    return () => { active = false; };
  }, [fetchDay]);

  const title = day ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full' }).format(new Date(`${day}T00:00:00`)) : 'Journée';

  const closeDay = async () => {
    if (!await confirm({ title: 'Clôturer cette journée ?', message: 'Ses totaux seront figés dans les archives. Les opérations restent consultables ici.', confirmLabel: 'Clôturer' })) return;
    try {
      await apiClient.post('/reports/close-day', { date: day });
      notify('Journée clôturée et archivée.');
      setDetail(await fetchDay());
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible de clôturer cette journée.'), 'error');
    }
  };

  return (
    <section className="space-y-6">
      <PageHeader
        back="/historique"
        eyebrow="Historique"
        title={title}
        subtitle={detail ? (detail.closedAt ? `Journée clôturée le ${formatDateTime(detail.closedAt)}.` : 'Journée non clôturée.') : undefined}
        actions={detail && !detail.closedAt && canClose && <button type="button" className="btn btn-primary" onClick={() => void closeDay()}>Clôturer la journée</button>}
      />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!detail ? !error && <p className="loading-line">Chargement…</p> : <>
        {detail.unclassifiedSales > 0 && <p role="status" className="text-sm text-amber-700">{detail.unclassifiedSales} ancienne(s) vente(s) sans devise enregistrée ne figurent dans aucun total.</p>}
        {currencies.filter((currency) => currency === 'USD' || detail.byCurrency[currency].transactionCount > 0 || detail.byCurrency[currency].amountReceived !== 0 || detail.byCurrency[currency].totalExpenses !== 0 || (detail.byCurrency[currency].payroll ?? 0) !== 0).map((currency) => {
          const figures = detail.byCurrency[currency];
          return <div key={currency} className="kpi-grid kpi-grid-4 kpi-compact" aria-label={`Totaux en ${currency}`}>
            <StatCard label={`Ventes · ${currency}`} value={<Money value={figures.totalSales} currency={currency} />} hint={<>Prestations <Money value={figures.serviceRevenue} currency={currency} /> · produits <Money value={figures.productRevenue} currency={currency} /></>} />
            <StatCard label="Encaissé" value={<Money value={figures.amountReceived} currency={currency} />} hint="Ventes annulées exclues" />
            <StatCard tone="expense" label="Dépenses" value={<Money value={figures.totalExpenses} currency={currency} />} hint={figures.payroll ? <>Rémunérations <Money value={figures.payroll} currency={currency} /></> : undefined} />
            <StatCard tone={figures.netBalance >= 0 ? 'profit' : 'danger'} label="Solde de caisse" value={<Money value={figures.netBalance} currency={currency} />} hint="Encaissé − dépenses − rémunérations ± entrées/sorties" />
          </div>;
        })}

        <Block title="Ventes" count={detail.sales.length}>
          <table className="data-table compact-table">
            <thead><tr><th>Heure</th><th>Reçu</th><th>Client</th><th>Articles</th><th>Réalisé par</th><th className="num">Total</th><th className="num">Payé</th><th>Statut</th><th>Saisi par</th></tr></thead>
            <tbody>{detail.sales.map((sale) => <tr key={sale.id} className={sale.status === 'refunded' ? 'is-cancelled' : undefined}>
              <td>{formatTime(sale.date)}</td>
              <td><button type="button" className="link-button" onClick={() => setReceiptId(sale.id)}>{formatReceiptNumber(sale.receiptNumber)}</button></td>
              <td>{sale.client}</td>
              <td><span className="cell-sub">{sale.items.map((item) => `${item.quantity} × ${item.name}`).join(', ')}</span></td>
              <td>{sale.staffName ?? '—'}</td>
              <td className="num">{amount(sale.totalAmount, sale.currency)}</td>
              <td className="num">{amount(sale.amountPaid, sale.currency)}<span className="cell-sub">{paymentMethodLabels[sale.paymentMethod]}</span></td>
              <td>{sale.status === 'refunded' ? <span className="badge badge-danger">Annulée</span> : sale.remainingAmount > 0 ? <span className="badge badge-warning">Dette</span> : <span className="badge badge-success">Payée</span>}</td>
              <td><span className="cell-sub">{sale.createdBy ?? '—'}</span></td>
            </tr>)}</tbody>
          </table>
        </Block>

        <div className="grid gap-6 xl:grid-cols-2">
          <Block title="Prestations réalisées" count={detail.services.length}>
            <table className="data-table compact-table">
              <thead><tr><th>Heure</th><th>Prestation</th><th>Travailleur</th><th className="num">Montant</th></tr></thead>
              <tbody>{detail.services.map((service, index) => <tr key={`${service.saleId}-${index}`}>
                <td>{formatTime(service.date)}</td>
                <td>{service.quantity > 1 ? `${service.quantity} × ` : ''}{service.name}</td>
                <td>{service.staffName ?? 'Non attribuée'}</td>
                <td className="num">{amount(service.amount, service.currency)}</td>
              </tr>)}</tbody>
            </table>
          </Block>
          <Block title="Produits vendus" count={detail.products.length}>
            <table className="data-table compact-table">
              <thead><tr><th>Heure</th><th>Produit</th><th className="num">Qté</th><th className="num">Montant</th></tr></thead>
              <tbody>{detail.products.map((product, index) => <tr key={`${product.saleId}-${index}`}>
                <td>{formatTime(product.date)}</td><td>{product.name}</td><td className="num">{product.quantity}</td><td className="num">{amount(product.amount, product.currency)}</td>
              </tr>)}</tbody>
            </table>
          </Block>
        </div>

        <Block title="Mouvements de caisse" count={detail.journal.length}>
          <table className="data-table compact-table">
            <thead><tr><th>Heure</th><th>Opération</th><th>Mode</th><th className="num">Entrée</th><th className="num">Sortie</th><th>Par</th></tr></thead>
            <tbody>{detail.journal.map((entry) => <tr key={entry.id}>
              <td>{formatTime(entry.at)}</td>
              <td>{entry.label}{entry.receiptNumber ? ` · ${formatReceiptNumber(entry.receiptNumber)}` : ''}</td>
              <td>{paymentMethodLabels[entry.paymentMethod] ?? entry.paymentMethod}</td>
              <td className="num">{entry.direction === 'in' ? amount(entry.amount, entry.currency, 'profit') : ''}</td>
              <td className="num">{entry.direction === 'out' ? amount(entry.amount, entry.currency, entry.type === 'expense' ? 'expense' : 'danger') : ''}</td>
              <td><span className="cell-sub">{entry.userEmail ?? '—'}</span></td>
            </tr>)}</tbody>
          </table>
        </Block>

        <div className="grid gap-6 xl:grid-cols-2">
          <Block title="Dépenses" count={detail.expenses.length}>
            <table className="data-table compact-table">
              <thead><tr><th>Heure</th><th>Libellé</th><th className="num">Montant</th><th>Par</th></tr></thead>
              <tbody>{detail.expenses.map((expense) => <tr key={expense.id} className={expense.cancelledAt ? 'is-cancelled' : undefined}>
                <td>{formatTime(expense.date)}</td>
                <td><span className="cell-title">{expense.description}</span><span className="cell-sub">{expense.category}{expense.cancelledAt ? ` · annulée le ${formatDateTime(expense.cancelledAt)}${expense.cancelledBy ? ` par ${expense.cancelledBy}` : ''}${expense.cancelReason ? ` (${expense.cancelReason})` : ''}` : ''}</span></td>
                <td className="num">{amount(expense.amount, expense.currency, expense.cancelledAt ? 'muted' : 'expense')}</td>
                <td><span className="cell-sub">{expense.createdBy ?? '—'}</span></td>
              </tr>)}</tbody>
            </table>
          </Block>
          <Block title="Rémunérations et avances" count={detail.payouts.length}>
            <table className="data-table compact-table">
              <thead><tr><th>Heure</th><th>Employé</th><th>Type</th><th className="num">Montant</th><th>Par</th></tr></thead>
              <tbody>{detail.payouts.map((payout) => <tr key={payout.id}>
                <td>{formatTime(payout.date)}</td><td>{payout.staffName ?? '—'}</td><td>{payout.kind === 'advance' ? 'Avance' : 'Paiement'}{payout.note ? <span className="cell-sub">{payout.note}</span> : null}</td>
                <td className="num">{amount(payout.amount, payout.currency)}</td><td><span className="cell-sub">{payout.paidBy ?? '—'}</span></td>
              </tr>)}</tbody>
            </table>
          </Block>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <Block title="Dettes créées" count={detail.debts.created.length}>
            <table className="data-table compact-table">
              <thead><tr><th>Reçu</th><th>Client</th><th className="num">Total</th><th className="num">Reste dû</th></tr></thead>
              <tbody>{detail.debts.created.map((sale) => <tr key={sale.id}>
                <td>{formatReceiptNumber(sale.receiptNumber)}</td><td>{sale.client}</td><td className="num">{amount(sale.totalAmount, sale.currency)}</td><td className="num">{amount(sale.remainingAmount, sale.currency, 'expense')}</td>
              </tr>)}</tbody>
            </table>
          </Block>
          <Block title="Dettes réglées" count={detail.debts.payments.length}>
            <table className="data-table compact-table">
              <thead><tr><th>Heure</th><th>Reçu</th><th>Client</th><th className="num">Réglé</th><th className="num">Reste</th></tr></thead>
              <tbody>{detail.debts.payments.map((payment) => <tr key={payment.id}>
                <td>{formatTime(payment.date)}</td><td>{payment.receiptNumber ? formatReceiptNumber(payment.receiptNumber) : '—'}</td><td>{payment.client ?? '—'}</td>
                <td className="num">{amount(payment.amount, payment.currency, 'profit')}</td><td className="num">{payment.remainingAmount !== null ? amount(payment.remainingAmount, payment.currency) : '—'}</td>
              </tr>)}</tbody>
            </table>
          </Block>
        </div>

        <Block title="Ventes annulées (visibles 7 jours après l’annulation)" count={detail.cancellations.length}>
          <table className="data-table compact-table">
            <thead><tr><th>Annulée le</th><th>Reçu</th><th>Client</th><th>Articles</th><th className="num">Montant</th><th>Motif</th><th>Par</th></tr></thead>
            <tbody>{detail.cancellations.map((sale) => <tr key={sale.id}>
              <td className="whitespace-nowrap">{sale.cancelledAt ? formatDateTime(sale.cancelledAt) : '—'}</td><td>{formatReceiptNumber(sale.receiptNumber)}</td><td>{sale.client}</td>
              <td><span className="cell-sub">{sale.items.map((item) => `${item.quantity} × ${item.name}`).join(', ')}</span></td>
              <td className="num">{amount(sale.totalAmount, sale.currency, 'muted')}</td>
              <td><span className="cell-sub">{sale.cancelReason ?? '—'}</span></td><td><span className="cell-sub">{sale.cancelledBy ?? '—'}</span></td>
            </tr>)}</tbody>
          </table>
          <p className="mt-2 text-xs text-gray-500">Une vente annulée ne compte dans aucun total (ni encaissement, ni caisse, ni chiffre d’affaires).</p>
        </Block>

        <Block title="Comptages de caisse" count={detail.cashCounts.length}>
          <table className="data-table compact-table">
            <thead><tr><th>Heure</th><th className="num">Attendu</th><th className="num">Compté</th><th className="num">Écart</th><th>Par</th></tr></thead>
            <tbody>{detail.cashCounts.map((count) => <tr key={count.id}>
              <td>{formatTime(count.date)}</td><td className="num">{amount(count.expectedAmount, count.currency)}</td><td className="num">{amount(count.countedAmount, count.currency)}</td>
              <td className="num">{amount(count.difference, count.currency, count.difference === 0 ? 'profit' : 'danger')}</td><td><span className="cell-sub">{count.countedBy ?? '—'}{count.note ? ` · ${count.note}` : ''}</span></td>
            </tr>)}</tbody>
          </table>
        </Block>
      </>}
      {receiptId && <ReceiptModal saleId={receiptId} onClose={() => setReceiptId(null)} />}
    </section>
  );
};
