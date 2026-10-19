import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchTerm } from '../hooks/useSearchTerm';
import { useNavigate } from 'react-router-dom';
import type { Service } from '../types';
import { apiClient, getApiError } from '../services/api';
import { formatCurrency, useCurrency, type Currency } from '../services/currency';
import { addToTill } from '../services/till';
import { toLocalDateInput } from '../utils/format';
import { useIsAdmin } from '../hooks/useAuth';
import { useFeedback } from '../components/UI/Feedback';
import { Modal } from '../components/UI/Modal';
import { MoneyByCurrency } from '../components/UI/Money';
import { EmptyState, PageHeader } from '../components/UI/PageHeader';

type SalesRow = { type: 'service' | 'product'; name: string; quantity: number; amount: number; currency: Currency | null; staffName: string | null; saleId: string };
type SalesReport = { rows: SalesRow[]; totals: Record<Currency, { services: number; servicesQuantity: number }> };

const serviceDraft = { name: '', category: '', description: '', price: '', duration: '30', audience: 'unisex' as Service['audience'], womenPrice: '', menPrice: '' };
type ServiceForm = typeof serviceDraft;
const audienceLabels: Record<Service['audience'], string> = { women: 'Femmes', men: 'Hommes', unisex: 'Mixte' };
const serviceTemplates = [
  { name: 'Tresse', category: 'Tresses', price: '35', description: 'Prix estimatif, à adapter selon le style et la longueur.' },
  { name: 'Nattes', category: 'Tresses', price: '30', description: 'Prix estimatif, à adapter selon le style et la longueur.' },
  { name: 'Vanilles / twists', category: 'Tresses', price: '40', description: 'Prix estimatif, à adapter selon le style et la longueur.' },
  { name: 'Locks', category: 'Coiffure', price: '45', description: 'Entretien ou coiffage des locks.' },
  { name: 'Coiffure femme', category: 'Coiffure', price: '25', description: '' },
  { name: 'Coiffure homme', category: 'Coiffure', price: '18', description: '' },
  { name: 'Coupe femme', category: 'Coupe', price: '25', description: '' },
  { name: 'Coupe homme', category: 'Barbier', price: '18', description: '' },
  { name: 'Coupe enfant', category: 'Coupe', price: '12', description: '' },
  { name: 'Brushing', category: 'Coiffure', price: '20', description: '' },
  { name: 'Shampoing', category: 'Soins capillaires', price: '10', description: '' },
  { name: 'Soin capillaire', category: 'Soins capillaires', price: '22', description: '' },
  { name: 'Lissage', category: 'Coiffure', price: '45', description: 'Prix estimatif, à adapter selon la longueur.' },
  { name: 'Défrisage', category: 'Coiffure', price: '40', description: 'Prix estimatif, à adapter selon la longueur.' },
  { name: 'Coloration', category: 'Coloration', price: '35', description: 'Prix estimatif, hors supplément éventuel.' },
  { name: 'Mèches / balayage', category: 'Coloration', price: '55', description: 'Prix estimatif, à adapter selon la longueur.' },
  { name: 'Pose d’extensions', category: 'Extensions', price: '70', description: 'Prix estimatif, hors coût des extensions.' },
  { name: 'Chignon / coiffure événementielle', category: 'Coiffure événementielle', price: '50', description: '' },
  { name: 'Taille de barbe / rasage', category: 'Barbier', price: '15', description: '' },
  { name: 'Teinture barbe', category: 'Barbier', price: '18', description: '' },
  { name: 'Manucure', category: 'Onglerie', price: '20', description: '' },
  { name: 'Pédicure', category: 'Onglerie', price: '25', description: '' },
  { name: 'Soin du visage', category: 'Soins esthétiques', price: '35', description: '' },
  { name: 'Épilation', category: 'Soins esthétiques', price: '15', description: 'Prix estimatif, à adapter selon la zone.' },
  { name: 'Maquillage', category: 'Soins esthétiques', price: '35', description: '' },
];

const toServiceForm = (service: Service): ServiceForm => ({
  name: service.name, category: service.category, description: service.description ?? '',
  price: String(Number(service.price)), duration: String(service.duration), audience: service.audience,
  womenPrice: service.womenPrice == null ? '' : String(Number(service.womenPrice)),
  menPrice: service.menPrice == null ? '' : String(Number(service.menPrice)),
});

const monthStart = () => {
  const date = new Date();
  return toLocalDateInput(new Date(date.getFullYear(), date.getMonth(), 1));
};

export const PrestationsPage = () => {
  const currency = useCurrency();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const { notify } = useFeedback();
  const [services, setServices] = useState<Service[]>([]);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [startDate, setStartDate] = useState(monthStart);
  const [endDate, setEndDate] = useState(() => toLocalDateInput(new Date()));
  const [query, setQuery] = useSearchTerm();
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<{ id: string | 'new'; form: ServiceForm } | null>(null);
  const priceStep = currency === 'CDF' ? '1' : '0.01';

  const fetchAll = useCallback(async () => {
    const [serviceResponse, reportResponse] = await Promise.all([
      apiClient.get<Service[]>('/services'),
      apiClient.get<SalesReport>('/reports/sales', { startDate, endDate, type: 'service' }),
    ]);
    return { services: serviceResponse.data, report: reportResponse.data };
  }, [startDate, endDate]);

  const load = useCallback(async () => {
    try {
      const data = await fetchAll();
      setServices(data.services);
      setReport(data.report);
      setError('');
    } catch (requestError) {
      setError(getApiError(requestError, 'Impossible de charger les prestations.'));
    }
  }, [fetchAll]);

  useEffect(() => {
    let active = true;
    fetchAll()
      .then((data) => { if (active) { setServices(data.services); setReport(data.report); setError(''); } })
      .catch((requestError) => { if (active) setError(getApiError(requestError, 'Impossible de charger les prestations.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fetchAll]);

  // Per service (matched by name at the time of the sale): who performed it and what it brought, per currency.
  const activity = useMemo(() => {
    const byName = new Map<string, { count: number; revenue: Record<Currency, number>; staff: Map<string, number> }>();
    for (const row of report?.rows ?? []) {
      const entry = byName.get(row.name) ?? { count: 0, revenue: { USD: 0, CDF: 0 }, staff: new Map() };
      entry.count += row.quantity;
      if (row.currency) entry.revenue[row.currency] += row.amount;
      if (row.staffName) entry.staff.set(row.staffName, (entry.staff.get(row.staffName) ?? 0) + row.quantity);
      byName.set(row.name, entry);
    }
    return byName;
  }, [report]);

  const term = query.trim().toLowerCase();
  const visible = services.filter((service) => (showInactive || service.status === 'active') &&
    (!term || `${service.name} ${service.category}`.toLowerCase().includes(term)));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editor) return;
    const { id, form } = editor;
    setSaving(true);
    try {
      const payload = {
        name: form.name, category: form.category, description: form.description, audience: form.audience,
        price: Number(form.price), duration: Number(form.duration),
        womenPrice: form.womenPrice ? Number(form.womenPrice) : null,
        menPrice: form.menPrice ? Number(form.menPrice) : null,
      };
      if (id === 'new') {
        await apiClient.post('/services', payload);
        notify(`Prestation « ${form.name} » ajoutée.`);
      } else {
        await apiClient.patch(`/services/${id}`, payload);
        notify(`Prestation « ${form.name} » mise à jour. Les ventes et rendez-vous passés gardent leur prix.`);
      }
      setEditor(null);
      await load();
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible d’enregistrer la prestation. Vérifiez les prix.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (service: Service) => {
    const status = service.status === 'active' ? 'inactive' : 'active';
    try {
      await apiClient.patch(`/services/${service.id}`, { status });
      notify(status === 'active' ? `« ${service.name} » est de nouveau proposée.` : `« ${service.name} » est retirée de la caisse.`);
      await load();
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible de modifier cette prestation.'), 'error');
    }
  };

  const sendToTill = (service: Service, audience: 'women' | 'men') => {
    const price = Number(audience === 'women' ? service.womenPrice ?? service.price : service.menPrice ?? service.price);
    addToTill({ type: 'service', itemId: service.id, audience, name: `${service.name} · ${audience === 'women' ? 'Femmes' : 'Hommes'}`, basePrice: price, quantity: 1 }, currency);
    navigate('/caisse');
  };

  const setField = (key: keyof ServiceForm, value: string) =>
    setEditor((current) => current && { ...current, form: { ...current.form, [key]: value } });
  const applyTemplate = (name: string) => {
    const template = serviceTemplates.find((item) => item.name === name);
    if (!template || !editor) return;
    const lowered = template.name.toLowerCase();
    setEditor({ ...editor, form: { ...editor.form, ...template, audience: lowered.includes('homme') ? 'men' : lowered.includes('femme') ? 'women' : 'unisex', womenPrice: '', menPrice: '' } });
  };

  const totalServices = report ? (['USD', 'CDF'] as Currency[]).reduce<Partial<Record<Currency, number>>>((sum, value) => ({ ...sum, [value]: report.totals[value].services }), {}) : {};

  return (
    <section className="space-y-5">
      <PageHeader
        eyebrow="Catalogue"
        title="Prestations"
        subtitle={`${services.filter((service) => service.status === 'active').length} prestation(s) proposée(s) · tarifs en ${currency}`}
        actions={isAdmin && <button type="button" className="btn btn-primary" onClick={() => setEditor({ id: 'new', form: serviceDraft })}>Ajouter une prestation</button>}
      />
      <div className="toolbar">
        <input type="search" aria-label="Rechercher une prestation" placeholder="Rechercher un nom, une catégorie…" value={query} onChange={(event) => setQuery(event.target.value)} className="search-input" />
        <label className="field">Activité du<input type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} /></label>
        <label className="field">au<input type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} /></label>
        {isAdmin && <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />Afficher les prestations retirées</label>}
      </div>
      {report && <p className="text-sm text-gray-600">Revenus des prestations sur la période : <MoneyByCurrency values={totalServices} /> (hors produits de la boutique).</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto">
        {loading ? <p className="loading-line">Chargement des prestations…</p> : visible.length ? (
          <table className="data-table compact-table">
            <thead><tr><th>Prestation</th><th>Public</th><th className="num">Tarif femme</th><th className="num">Tarif homme</th><th>Réalisée par (période)</th><th className="num">Revenus (période)</th><th className="actions">Actions</th></tr></thead>
            <tbody>{visible.map((service) => {
              const stats = activity.get(service.name);
              return <tr key={service.id} className={service.status === 'active' ? undefined : 'is-cancelled'}>
                <td><span className="cell-title">{service.name}</span><span className="cell-sub">{service.category}{service.description ? ` · ${service.description}` : ''}{service.status !== 'active' && ' · retirée'}</span></td>
                <td>{audienceLabels[service.audience]}</td>
                <td className="num">{service.audience === 'men' ? '—' : formatCurrency(service.womenPrice ?? service.price, currency)}</td>
                <td className="num">{service.audience === 'women' ? '—' : formatCurrency(service.menPrice ?? service.price, currency)}</td>
                <td>{stats ? <span className="cell-sub">{[...stats.staff.entries()].map(([name, count]) => `${name} (${count})`).join(', ') || 'Non attribuée'}</span> : <span className="cell-sub">—</span>}</td>
                <td className="num">{stats ? <><MoneyByCurrency values={stats.revenue} /><span className="cell-sub">{stats.count} réalisée(s)</span></> : '—'}</td>
                <td className="actions"><span className="row-actions">
                  {service.status === 'active' && (service.audience === 'unisex'
                    ? <><button type="button" className="link-button" onClick={() => sendToTill(service, 'women')}>Caisse · F</button><button type="button" className="link-button" onClick={() => sendToTill(service, 'men')}>Caisse · H</button></>
                    : <button type="button" className="link-button" onClick={() => sendToTill(service, service.audience as 'women' | 'men')}>Ajouter à la caisse</button>)}
                  {isAdmin && <>
                    <button type="button" className="link-button" onClick={() => setEditor({ id: service.id, form: toServiceForm(service) })}>Modifier</button>
                    <button type="button" className={`link-button${service.status === 'active' ? ' is-danger' : ''}`} onClick={() => void toggle(service)}>{service.status === 'active' ? 'Retirer' : 'Rétablir'}</button>
                  </>}
                </span></td>
              </tr>;
            })}</tbody>
          </table>
        ) : <EmptyState title={term ? 'Aucune prestation ne correspond à la recherche.' : 'Aucune prestation enregistrée.'} hint={isAdmin ? 'Ajoutez les prestations du salon pour les proposer en caisse et en rendez-vous.' : undefined} />}
      </div>

      {editor && (
        <Modal
          title={editor.id === 'new' ? 'Nouvelle prestation' : 'Modifier la prestation'}
          description="Les tarifs femme et homme sont facultatifs : à défaut, le prix de base s’applique. Un changement de prix ne modifie pas les ventes ni les rendez-vous déjà enregistrés."
          onClose={() => setEditor(null)}
        >
          <form onSubmit={save} className="form-grid">
            {editor.id === 'new' && <label className="field field-wide">Modèle de prestation
              <select value="" onChange={(event) => applyTemplate(event.target.value)}>
                <option value="">Choisir un modèle (facultatif)</option>
                {serviceTemplates.map((template) => <option key={template.name} value={template.name}>{template.name}</option>)}
              </select>
            </label>}
            <label className="field">Nom<input required value={editor.form.name} onChange={(event) => setField('name', event.target.value)} /></label>
            <label className="field">Catégorie<input required value={editor.form.category} onChange={(event) => setField('category', event.target.value)} /></label>
            <label className="field">Prix de base ({currency})<input required type="number" min="0" step={priceStep} value={editor.form.price} onChange={(event) => setField('price', event.target.value)} /></label>
            <label className="field">Public cible
              <select value={editor.form.audience} onChange={(event) => setField('audience', event.target.value)}>
                <option value="women">Femmes</option><option value="men">Hommes</option><option value="unisex">Mixte</option>
              </select>
            </label>
            {editor.form.audience !== 'men' && <label className="field">Tarif femme (facultatif)<input type="number" min="0" step={priceStep} value={editor.form.womenPrice} onChange={(event) => setField('womenPrice', event.target.value)} /></label>}
            {editor.form.audience !== 'women' && <label className="field">Tarif homme (facultatif)<input type="number" min="0" step={priceStep} value={editor.form.menPrice} onChange={(event) => setField('menPrice', event.target.value)} /></label>}
            <label className="field field-wide">Description<textarea rows={2} value={editor.form.description} onChange={(event) => setField('description', event.target.value)} /></label>
            <div className="field-wide flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setEditor(null)}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
};
