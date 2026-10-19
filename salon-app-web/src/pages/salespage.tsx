import { useCallback, useEffect, useState } from 'react';
import type { Client, Sale, Staff } from '../types';
import { apiClient, getApiError } from '../services/api';
import { formatCurrency, type Currency } from '../services/currency';
import { formatDateTime, formatReceiptNumber, paymentMethodLabels, toLocalDateInput } from '../utils/format';
import { useCan } from '../hooks/useAuth';
import { Money } from '../components/UI/Money';
import { EmptyState, PageHeader } from '../components/UI/PageHeader';
import { ReceiptModal } from '../components/Sales/Receipt';
import { CancelSaleDialog, DebtPaymentDialog } from '../components/Sales/SaleDialogs';

type StatusFilter = 'completed' | 'refunded' | 'debts' | 'all';
const monthStart = () => {
  const date = new Date();
  return toLocalDateInput(new Date(date.getFullYear(), date.getMonth(), 1));
};

export const SalesPage = () => {
  const canCancel = useCan('cancelSales');
  const [sales, setSales] = useState<Sale[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [startDate, setStartDate] = useState(monthStart);
  const [endDate, setEndDate] = useState(() => toLocalDateInput(new Date()));
  const [status, setStatus] = useState<StatusFilter>('completed');
  const [currency, setCurrency] = useState<'' | Currency>('');
  const [staffId, setStaffId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Sale | null>(null);
  const [settling, setSettling] = useState<Sale | null>(null);

  const fetchSales = useCallback(async () => {
    const params: Record<string, string> = {};
    if (status === 'debts') params.withDebt = 'true';
    else {
      params.startDate = startDate;
      params.endDate = endDate;
      if (status !== 'all') params.status = status;
    }
    if (currency) params.currency = currency;
    if (staffId) params.staffId = staffId;
    const { data } = await apiClient.get<Sale[]>('/sales', params);
    return data;
  }, [startDate, endDate, status, currency, staffId]);

  const reload = useCallback(async () => {
    try {
      setSales(await fetchSales());
      setError('');
    } catch (requestError) {
      setError(getApiError(requestError, 'Impossible de charger les ventes.'));
    }
  }, [fetchSales]);

  useEffect(() => {
    let active = true;
    fetchSales()
      .then((data) => { if (active) { setSales(data); setError(''); } })
      .catch((requestError) => { if (active) setError(getApiError(requestError, 'Impossible de charger les ventes.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fetchSales]);

  useEffect(() => {
    Promise.all([apiClient.get<Client[]>('/clients', { includeArchived: 'true' }), apiClient.get<Staff[]>('/staff', { includeArchived: 'true' })])
      .then(([clientResponse, staffResponse]) => { setClients(clientResponse.data); setStaff(staffResponse.data); })
      .catch(() => undefined);
  }, []);

  const clientLabel = (sale: Sale) => sale.clientName ?? clients.find((client) => client.id === sale.clientId)?.name ?? 'Client de passage';
  const staffName = (sale: Sale) => staff.find((member) => member.id === sale.staffId)?.name ?? '—';
  // Totals per currency of the active sales shown (cancelled ones are not counted).
  const totals = (['USD', 'CDF'] as Currency[]).map((value) => {
    const active = sales.filter((sale) => sale.status !== 'refunded' && sale.currency === value);
    return {
      currency: value, count: active.length,
      total: active.reduce((sum, sale) => sum + Number(sale.totalAmount), 0),
      due: active.reduce((sum, sale) => sum + Number(sale.remainingAmount), 0),
    };
  }).filter((entry) => entry.count > 0);

  return (
    <section className="space-y-5">
      <PageHeader
        back="/caisse"
        eyebrow="Encaissement"
        title="Ventes"
        subtitle="Historique des ventes, reçus, dettes et annulations. Une vente annulée ne compte plus dans les totaux ; elle reste visible 7 jours dans « Annulées », puis disparaît."
      />
      <div className="tabs" role="tablist" aria-label="Ventes affichées">
        {([['completed', 'Actives'], ['debts', 'Avec dette'], ['refunded', 'Annulées'], ['all', 'Toutes']] as const).map(([value, label]) =>
          <button key={value} type="button" role="tab" aria-selected={status === value} className={`tab${status === value ? ' is-active' : ''}`} onClick={() => setStatus(value)}>{label}</button>)}
      </div>
      <div className="toolbar">
        {status !== 'debts' && <>
          <label className="field">Du<input type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} /></label>
          <label className="field">Au<input type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} /></label>
        </>}
        <label className="field">Devise
          <select value={currency} onChange={(event) => setCurrency(event.target.value as '' | Currency)}>
            <option value="">Toutes</option><option value="USD">USD</option><option value="CDF">CDF</option>
          </select>
        </label>
        <label className="field">Employé
          <select value={staffId} onChange={(event) => setStaffId(event.target.value)}>
            <option value="">Tous</option>
            {staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {totals.length > 0 && <p className="text-sm text-gray-600">
        {totals.map((entry) => `${entry.count} vente(s) · ${formatCurrency(entry.total, entry.currency)}${entry.due > 0 ? ` dont ${formatCurrency(entry.due, entry.currency)} restant dû` : ''}`).join('  ·  ')}
      </p>}
      <div className="overflow-x-auto">
        {loading ? <p className="loading-line">Chargement des ventes…</p> : sales.length ? (
          <table className="data-table compact-table">
            <thead><tr><th>Reçu</th><th>Date</th><th>Client</th><th>Réalisé par</th><th>Articles</th><th className="num">Total</th><th className="num">Reste</th><th>Statut</th><th className="actions">Actions</th></tr></thead>
            <tbody>{sales.map((sale) => {
              const saleCurrency = (sale.currency ?? 'USD') as Currency;
              const cancelled = sale.status === 'refunded';
              return <tr key={sale.id} className={cancelled ? 'is-cancelled' : undefined}>
                <td className="whitespace-nowrap">{formatReceiptNumber(sale.receiptNumber)}</td>
                <td className="whitespace-nowrap">{formatDateTime(sale.saleDate)}</td>
                <td>{clientLabel(sale)}</td>
                <td>{staffName(sale)}</td>
                <td><span className="cell-sub">{(sale.items ?? []).map((item) => `${item.quantity} × ${item.itemName ?? (item.type === 'service' ? 'Prestation' : 'Produit')}`).join(', ')}</span></td>
                <td className="num">{sale.currency ? <Money value={sale.totalAmount} currency={saleCurrency} /> : '—'}<span className="cell-sub">{paymentMethodLabels[sale.paymentMethod]}</span></td>
                <td className="num">{Number(sale.remainingAmount) > 0 ? <Money value={sale.remainingAmount} currency={saleCurrency} tone="expense" /> : '—'}</td>
                <td>{cancelled
                  ? <span className="badge badge-danger" title={sale.cancelReason ?? undefined}>Annulée{sale.cancelledAt ? ` le ${formatDateTime(sale.cancelledAt)}` : ''}</span>
                  : Number(sale.remainingAmount) > 0 ? <span className="badge badge-warning">Dette</span> : <span className="badge badge-success">Payée</span>}
                  {cancelled && sale.cancelReason && <span className="cell-sub">{sale.cancelReason}</span>}
                </td>
                <td className="actions"><span className="row-actions">
                  <button type="button" className="link-button" onClick={() => setReceiptId(sale.id)}>Reçu</button>
                  {!cancelled && Number(sale.remainingAmount) > 0 && sale.currency && <button type="button" className="link-button" onClick={() => setSettling(sale)}>Encaisser</button>}
                  {!cancelled && canCancel && <button type="button" className="link-button is-danger" onClick={() => setCancelling(sale)}>Annuler</button>}
                </span></td>
              </tr>;
            })}</tbody>
          </table>
        ) : <EmptyState title={status === 'debts' ? 'Aucune dette en cours.' : 'Aucune vente pour ces filtres.'} />}
      </div>

      {receiptId && <ReceiptModal saleId={receiptId} onClose={() => setReceiptId(null)} />}
      {cancelling && <CancelSaleDialog sale={cancelling} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); void reload(); }} />}
      {settling && <DebtPaymentDialog sale={settling} onClose={() => setSettling(null)} onDone={() => { setSettling(null); void reload(); }} />}
    </section>
  );
};
