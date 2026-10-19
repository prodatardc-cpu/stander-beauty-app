import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PeriodFigures } from '../types';
import { apiClient, getApiError } from '../services/api';
import type { Currency } from '../services/currency';
import { formatDate, toLocalDateInput } from '../utils/format';
import { MoneyByCurrency } from '../components/UI/Money';
import { EmptyState, PageHeader } from '../components/UI/PageHeader';

type DayFigures = PeriodFigures & { cashIn: number; cashOut: number; debtsCreated: number; debtsPaid: number };
type DayRow = { day: string; closedAt: string | null; unclassifiedSales: number; byCurrency: Record<Currency, DayFigures> };

const currencies: Currency[] = ['USD', 'CDF'];
const daysAgo = (count: number) => {
  const date = new Date();
  date.setDate(date.getDate() - count);
  return toLocalDateInput(date);
};
const dayTitle = (day: string) => new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${day}T00:00:00`));

// One row per day with activity: each closed day stays an independent archive, readable at any time.
export const HistoryPage = () => {
  const [from, setFrom] = useState(() => daysAgo(29));
  const [to, setTo] = useState(() => toLocalDateInput(new Date()));
  const [days, setDays] = useState<DayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDays = useCallback(async () => (await apiClient.get<{ days: DayRow[] }>('/history/days', { from, to })).data.days, [from, to]);

  useEffect(() => {
    let active = true;
    fetchDays()
      .then((data) => { if (active) { setDays(data); setError(''); } })
      .catch((requestError) => { if (active) setError(getApiError(requestError, 'Impossible de charger l’historique.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fetchDays]);

  const values = (row: DayRow, field: keyof DayFigures) =>
    Object.fromEntries(currencies.map((currency) => [currency, Number(row.byCurrency[currency][field] ?? 0)])) as Record<Currency, number>;

  return (
    <section className="space-y-5">
      <PageHeader eyebrow="Pilotage" title="Historique" subtitle="Chaque journée d’activité, consultable à tout moment avec le détail de ses opérations. Les montants restent dans leur devise ; les ventes annulées ne comptent dans aucun total et restent visibles 7 jours dans le détail de leur journée." />
      <div className="toolbar">
        <label className="field">Du<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="field">Au<input type="date" value={to} min={from} max={toLocalDateInput(new Date())} onChange={(event) => setTo(event.target.value)} /></label>
        <div className="tabs" role="group" aria-label="Période rapide">
          <button type="button" className="tab" onClick={() => { setFrom(daysAgo(6)); setTo(toLocalDateInput(new Date())); }}>7 jours</button>
          <button type="button" className="tab" onClick={() => { setFrom(daysAgo(29)); setTo(toLocalDateInput(new Date())); }}>30 jours</button>
          <button type="button" className="tab" onClick={() => { setFrom(daysAgo(89)); setTo(toLocalDateInput(new Date())); }}>90 jours</button>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto">
        {loading ? <p className="loading-line">Chargement de l’historique…</p> : days.length ? (
          <table className="data-table compact-table history-table">
            <thead><tr>
              <th>Journée</th><th className="num">Ventes</th><th className="num">dont prestations</th><th className="num">Encaissé</th>
              <th className="num">Dépenses</th><th className="num">Entrées / sorties</th><th className="num">Dettes créées / réglées</th>
              <th className="num">Rémunérations</th><th className="actions">Détail</th>
            </tr></thead>
            <tbody>{days.map((row) => <tr key={row.day}>
              <td className="whitespace-nowrap"><span className="cell-title">{dayTitle(row.day)}</span>{row.closedAt ? <span className="badge badge-success">Clôturée le {formatDate(row.closedAt)}</span> : <span className="cell-sub">Non clôturée</span>}</td>
              <td className="num"><MoneyByCurrency values={values(row, 'totalSales')} /></td>
              <td className="num"><MoneyByCurrency values={values(row, 'serviceRevenue')} /></td>
              <td className="num"><MoneyByCurrency values={values(row, 'amountReceived')} /></td>
              <td className="num"><MoneyByCurrency values={values(row, 'totalExpenses')} tone="expense" /></td>
              <td className="num"><MoneyByCurrency values={values(row, 'cashIn')} tone="profit" /><MoneyByCurrency values={values(row, 'cashOut')} tone="danger" /></td>
              <td className="num"><MoneyByCurrency values={values(row, 'debtsCreated')} tone="expense" /><MoneyByCurrency values={values(row, 'debtsPaid')} /></td>
              <td className="num"><MoneyByCurrency values={values(row, 'payroll')} /></td>
              <td className="actions"><Link to={`/historique/${row.day}`} className="btn btn-secondary btn-sm">Voir les détails</Link></td>
            </tr>)}</tbody>
          </table>
        ) : <EmptyState title="Aucune activité sur cette période." />}
      </div>
    </section>
  );
};
