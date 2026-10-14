import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Appointment, DashboardOverview, Product } from '../types';
import { apiClient, getApiError } from '../services/api';
import { formatCurrencyExact, useExchangeRate } from '../services/currency';
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

export const DashboardPage = () => {
  const exchangeRate = useExchangeRate();
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
  const upcoming = appointments.filter((appointment) => !['cancelled', 'completed', 'no_show'].includes(appointment.status));

  return (
    <section className="space-y-8">
      <PageHeader
        eyebrow="Le salon en un regard"
        title={`${greeting()} !`}
        subtitle={<>L’essentiel de l’activité d’aujourd’hui.{exchangeRate === null ? <> <Link to="/settings" className="link-button">Configurez le taux USD/CDF</Link> pour afficher les deux devises.</> : <> Taux appliqué : 1 USD = {new Intl.NumberFormat('fr-FR').format(exchangeRate)} CDF.</>}</>}
        actions={<>
          <Link to="/appointments" className="btn btn-secondary">Rendez-vous</Link>
          <Link to="/caisse" className="btn btn-primary">Ouvrir la caisse</Link>
        </>}
      />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {!loading && overview && overview.unclassifiedSalesToday > 0 && <p role="status" className="text-sm text-amber-700">{overview.unclassifiedSalesToday} ancienne(s) vente(s) d’aujourd’hui n’a/ont pas de devise enregistrée et ne figure(nt) dans aucun des deux totaux.</p>}

      <div className="kpi-grid kpi-grid-4" aria-live="polite">
        <StatCard label="Encaissé aujourd’hui · USD" value={value((data) => formatCurrencyExact(data.revenueTodayUSD, 'USD'))} hint="Paiements reçus en dollars" />
        <StatCard label="Encaissé aujourd’hui · CDF" value={value((data) => formatCurrencyExact(data.revenueTodayCDF, 'CDF'))} hint="Paiements reçus en francs" />
        <StatCard label="Ventes du jour" value={value((data) => `${data.salesTodayUSDCount} USD · ${data.salesTodayCDFCount} CDF`)} hint={value((data) => data.unclassifiedSalesToday ? `${data.unclassifiedSalesToday} vente(s) historique(s) sans devise` : 'Nombre de ventes dans chaque devise')} />
        <StatCard label="Prestations réalisées" value={value((data) => data.servicesToday)} hint="Aujourd’hui" />
        <StatCard label="Produits vendus" value={value((data) => data.productsSoldToday)} hint="Aujourd’hui" />
        <StatCard label="Rendez-vous du jour" value={value((data) => data.appointmentsToday)} hint={`${upcoming.length} encore à venir`} />
        <StatCard label="Commissions à payer · USD" value={value((data) => formatCurrencyExact(data.unpaidCommissionsUSD, 'USD'))} hint="Ventes en dollars" tone={overview && overview.unpaidCommissionsUSD > 0 ? 'warning' : undefined} />
        <StatCard label="Commissions à payer · CDF" value={value((data) => formatCurrencyExact(data.unpaidCommissionsCDF, 'CDF'))} hint="Ventes en francs" tone={overview && overview.unpaidCommissionsCDF > 0 ? 'warning' : undefined} />
        <StatCard label="Clients" value={value((data) => data.clients)} hint="Dans le fichier client" />
        <StatCard label="Prestations au catalogue" value={value((data) => data.services)} />
        <StatCard label="Produits en alerte" value={loading ? <span className="kpi-skeleton" aria-label="Chargement" /> : lowStock.length} hint={`sur ${products.length} produit(s)`} tone={lowStock.length ? 'negative' : 'positive'} />
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
