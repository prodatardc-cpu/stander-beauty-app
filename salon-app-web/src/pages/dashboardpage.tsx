import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Appointment, DashboardOverview, Product } from '../types';
import { apiClient, getApiError } from '../services/api';
import { formatCurrency, useCurrency, useExchangeRate, type Currency } from '../services/currency';
import { Money } from '../components/UI/Money';
import { formatTime, isSameLocalDay } from '../utils/format';
import { EmptyState, PageHeader, StatCard } from '../components/UI/PageHeader';

const statusBadges: Record<Appointment['status'], { label: string; tone: string }> = {
  scheduled: { label: 'Planifié', tone: '' },
  confirmed: { label: 'Confirmé', tone: 'badge-accent' },
  completed: { label: 'Terminé', tone: 'badge-success' },
  cancelled: { label: 'Annulé', tone: 'badge-danger' },
  no_show: { label: 'Absent', tone: 'badge-warning' },
};

const greeting = () => {
  const hour = new Date().getHours();
  return hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir';
};

const currencies: Currency[] = ['USD', 'CDF'];

export const DashboardPage = () => {
  const exchangeRate = useExchangeRate();
  const baseCurrency = useCurrency();
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiClient.get<DashboardOverview>('/reports/overview'),
      apiClient.get<Appointment[]>('/appointments'),
      apiClient.get<Product[]>('/products'),
    ])
      .then(([overviewResponse, appointmentResponse, productResponse]) => {
        if (!active) return;
        setOverview(overviewResponse.data);
        setAppointments(appointmentResponse.data.filter((appointment) => isSameLocalDay(appointment.scheduledAt)));
        setProducts(productResponse.data);
      })
      .catch((requestError) => {
        if (active) setError(getApiError(requestError, 'Impossible de charger les indicateurs.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const value = (render: (data: DashboardOverview) => string | number) =>
    loading ? <span className="kpi-skeleton" aria-label="Chargement" /> : overview ? render(overview) : '—';
  const lowStock = products
    .filter((product) => product.status !== 'inactive' && product.quantityStock <= product.lowStockThreshold)
    .sort((a, b) => a.quantityStock - b.quantityStock);
  const soldOut = lowStock.filter((product) => product.quantityStock === 0);
  // The base currency always; the other one when it has activity today or open balances.
  const shown = currencies.filter((currency) => currency === baseCurrency || (overview && (overview.today[currency].transactionCount > 0 ||
    overview.today[currency].amountReceived !== 0 || overview.today[currency].totalExpenses !== 0 || overview.debts[currency].amount > 0 || overview.payrollDue[currency] > 0)));
  const upcoming = appointments.filter((appointment) => !['cancelled', 'completed', 'no_show'].includes(appointment.status));

  return (
    <section className="space-y-8">
      <PageHeader
        eyebrow="Le salon en un regard"
        title={`${greeting()} !`}
        subtitle={<>L’essentiel de l’activité d’aujourd’hui, chaque devise à part.{exchangeRate === null ? <> <Link to="/settings" className="link-button">Définissez le taux USD/CDF</Link> pour encaisser dans les deux devises.</> : <> Taux du salon : 1 USD = {new Intl.NumberFormat('fr-FR').format(exchangeRate)} CDF.</>}</>}
        actions={<>
          <Link to="/appointments" className="btn btn-secondary">Rendez-vous</Link>
          <Link to="/caisse" className="btn btn-primary">Ouvrir la caisse</Link>
        </>}
      />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!loading && overview && overview.unclassifiedSalesToday > 0 && <p role="status" className="text-sm text-amber-700">{overview.unclassifiedSalesToday} ancienne(s) vente(s) d’aujourd’hui n’a/ont pas de devise enregistrée et ne figure(nt) dans aucun des deux totaux.</p>}

      <section className="panel" aria-live="polite">
        <div className="panel-header"><h2 className="section-title">Rapport du jour</h2><Link to="/reports" className="link-button">Rapports détaillés</Link></div>
        {loading ? <p className="loading-line">Chargement…</p> : overview && <div className="overflow-x-auto">
          <table className="data-table compact-table figures-table">
            <thead><tr><th>Indicateur</th>{shown.map((currency) => <th key={currency} className="num">{currency}</th>)}</tr></thead>
            <tbody>
              <tr><td className="font-century">Prestations</td>{shown.map((currency) => <td key={currency} className="num"><Money value={overview.today[currency].serviceRevenue} currency={currency} /></td>)}</tr>
              <tr><td className="font-century">Produits vendus</td>{shown.map((currency) => <td key={currency} className="num"><Money value={overview.today[currency].productRevenue} currency={currency} /></td>)}</tr>
              <tr className="is-strong"><td className="font-century">Total du jour en caisse<span className="cell-sub">Encaissé − dépenses − rémunérations ± entrées/sorties</span></td>{shown.map((currency) => <td key={currency} className="num"><Money value={overview.today[currency].netBalance} currency={currency} /></td>)}</tr>
              <tr><td className="font-century">Dépenses</td>{shown.map((currency) => <td key={currency} className="num"><Money value={overview.today[currency].totalExpenses} currency={currency} tone="expense" /></td>)}</tr>
              <tr><td className="font-century">Bénéfice estimé<span className="cell-sub">Ventes − coût des produits − commissions − dépenses − salaires fixes versés</span></td>{shown.map((currency) => <td key={currency} className="num">{overview.today[currency].estimatedProfit === null ? <span className="cell-sub">non calculable</span> : <Money value={overview.today[currency].estimatedProfit ?? 0} currency={currency} tone="profit" />}</td>)}</tr>            </tbody>
          </table>
        </div>}
      </section>

      <div className="kpi-grid kpi-grid-4 kpi-compact">
        <StatCard tone="expense" label="Dettes des clients" value={value((data) => shown.map((currency) => formatCurrency(data.debts[currency].amount, currency)).join(' · '))} hint={value((data) => `${currencies.reduce((sum, currency) => sum + data.debts[currency].count, 0)} vente(s) non soldée(s)`)} />
        <StatCard tone="warning" label="Rémunérations dues" value={value((data) => shown.map((currency) => formatCurrency(data.payrollDue[currency], currency)).join(' · '))} hint="Reste à payer à l’équipe" />
        <StatCard tone={soldOut.length ? 'danger' : 'positive'} label="Produits épuisés" value={loading ? <span className="kpi-skeleton" aria-label="Chargement" /> : soldOut.length} hint={`${lowStock.length - soldOut.length} en stock bas`} />
        <StatCard label="Rendez-vous du jour" value={value((data) => data.appointmentsToday)} hint={`${upcoming.length} encore à venir · ${overview?.servicesToday ?? 0} prestation(s) réalisée(s)`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel">
          <div className="panel-header"><h2 className="section-title">Rendez-vous d’aujourd’hui</h2><Link to="/appointments" className="link-button">Tout voir</Link></div>
          {loading ? <p className="loading-line">Chargement…</p> : appointments.length ? (
            <div className="list-rows">
              {appointments.map((appointment) => (
                <div key={appointment.id} className="list-row">
                  <div className="flex items-center gap-4">
                    <span className="w-14 font-display text-xl font-semibold">{formatTime(appointment.scheduledAt)}</span>
                    <div>
                      <p className="cell-title">{appointment.Client?.name ?? 'Client'}</p>
                      <p className="cell-sub">{appointment.Service?.name ?? 'Prestation'} · {appointment.Staff?.name ?? '—'}</p>
                    </div>
                  </div>
                  <span className={`badge ${statusBadges[appointment.status].tone}`}>{statusBadges[appointment.status].label}</span>
                </div>
              ))}
            </div>
          ) : <EmptyState title="Aucun rendez-vous aujourd’hui." hint="Planifiez-en un depuis la page Rendez-vous." />}
        </section>

        <section className="panel">
          <div className="panel-header"><h2 className="section-title">Stock à surveiller</h2><Link to="/boutique" className="link-button">Boutique</Link></div>
          {loading ? <p className="loading-line">Chargement…</p> : lowStock.length ? (
            <div className="list-rows">
              {lowStock.map((product) => (
                <div key={product.id} className="list-row">
                  <div><p className="cell-title">{product.name}</p><p className="cell-sub">Seuil d’alerte : {product.lowStockThreshold}</p></div>
                  <span className={`badge ${product.quantityStock === 0 ? 'badge-danger' : 'badge-warning'}`}>{product.quantityStock === 0 ? 'Rupture' : `${product.quantityStock} restant(s)`}</span>
                </div>
              ))}
            </div>
          ) : <EmptyState title="Tous les produits sont bien approvisionnés." />}
        </section>
      </div>
    </section>
  );
};
