import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Product, Sale, Service, StockMovement } from '../types';
import { formatDateTime } from '../utils/format';
import { apiClient, getApiError } from '../services/api';
import { formatCurrency, useCurrency } from '../services/currency';
import { useIsAdmin } from '../hooks/useAuth';
import { useFeedback } from '../components/UI/Feedback';
import { Modal } from '../components/UI/Modal';
import { EmptyState, PageHeader } from '../components/UI/PageHeader';

type CatalogTab = 'products' | 'services';
const productDraft = { name: '', sku: '', category: '', priceBuy: '', priceSell: '', quantityStock: '0', lowStockThreshold: '5', imageUrl: '' };
const serviceDraft = { name: '', category: '', description: '', price: '', audience: 'unisex' as Service['audience'], womenPrice: '', menPrice: '' };
const defaultServiceDuration = 30;
const productTemplates = [
  { name: 'Shampoing hydratant', sku: 'LUNA-SHAM-001', category: 'Soins capillaires', priceBuy: '7', priceSell: '12', quantityStock: '10' },
  { name: 'Après-shampoing', sku: 'LUNA-COND-001', category: 'Soins capillaires', priceBuy: '7', priceSell: '12', quantityStock: '10' },
  { name: 'Masque capillaire', sku: 'LUNA-MASK-001', category: 'Soins capillaires', priceBuy: '10', priceSell: '18', quantityStock: '8' },
  { name: 'Huile capillaire', sku: 'LUNA-OIL-001', category: 'Soins capillaires', priceBuy: '6', priceSell: '12', quantityStock: '10' },
  { name: 'Mèches pour tresses', sku: 'LUNA-BRAID-001', category: 'Mèches pour tresses', priceBuy: '12', priceSell: '22', quantityStock: '8' },
  { name: 'Crème visage', sku: 'LUNA-FACE-001', category: 'Produits de beauté', priceBuy: '8', priceSell: '15', quantityStock: '8' },
  { name: 'Crème coiffante', sku: 'LUNA-CREAM-001', category: 'Coiffants', priceBuy: '7', priceSell: '14', quantityStock: '10' },
  { name: 'Gel coiffant', sku: 'LUNA-GEL-001', category: 'Coiffants', priceBuy: '4', priceSell: '9', quantityStock: '12' },
  { name: 'Mousse coiffante', sku: 'LUNA-MOUSSE-001', category: 'Coiffants', priceBuy: '5', priceSell: '11', quantityStock: '8' },
  { name: 'Soin sans rinçage', sku: 'LUNA-LEAVEIN-001', category: 'Soins capillaires', priceBuy: '8', priceSell: '15', quantityStock: '8' },
  { name: 'Edge control', sku: 'LUNA-EDGE-001', category: 'Coiffants', priceBuy: '4', priceSell: '9', quantityStock: '10' },
  { name: 'Coloration capillaire', sku: 'LUNA-COLOR-001', category: 'Coloration', priceBuy: '6', priceSell: '12', quantityStock: '10' },
  { name: 'Extensions capillaires', sku: 'LUNA-EXT-001', category: 'Extensions', priceBuy: '20', priceSell: '35', quantityStock: '5' },
  { name: 'Bonnet en satin', sku: 'LUNA-BONNET-001', category: 'Accessoires', priceBuy: '3', priceSell: '8', quantityStock: '10' },
  { name: 'Peigne', sku: 'LUNA-COMB-001', category: 'Accessoires', priceBuy: '1', priceSell: '4', quantityStock: '15' },
  { name: 'Brosse à cheveux', sku: 'LUNA-BRUSH-001', category: 'Accessoires', priceBuy: '3', priceSell: '8', quantityStock: '10' },
  { name: 'Huile à barbe', sku: 'LUNA-BEARD-001', category: 'Barbier', priceBuy: '5', priceSell: '11', quantityStock: '6' },
  { name: 'Lames de rasoir', sku: 'LUNA-BLADE-001', category: 'Barbier', priceBuy: '2', priceSell: '6', quantityStock: '20' },
];
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
  { name: 'Nettoyage des cheveux', category: 'Soins capillaires', price: '12', description: '' },
  { name: 'Soin capillaire', category: 'Soins capillaires', price: '22', description: '' },
  { name: 'Lissage', category: 'Coiffure', price: '45', description: 'Prix estimatif, à adapter selon la longueur.' },
  { name: 'Défrisage', category: 'Coiffure', price: '40', description: 'Prix estimatif, à adapter selon la longueur.' },
  { name: 'Coloration', category: 'Coloration', price: '35', description: 'Prix estimatif, hors supplément éventuel.' },
  { name: 'Mèches / balayage', category: 'Coloration', price: '55', description: 'Prix estimatif, à adapter selon la longueur.' },
  { name: 'Pose d’extensions', category: 'Extensions', price: '70', description: 'Prix estimatif, hors coût des extensions.' },
  { name: 'Chignon / coiffure événementielle', category: 'Coiffure événementielle', price: '50', description: '' },
  { name: 'Taille de barbe / rasage', category: 'Barbier', price: '15', description: '' },
  { name: 'Teinture', category: 'Coloration', price: '30', description: 'Prix estimatif, à adapter selon la prestation.' },
  { name: 'Teinture barbe', category: 'Barbier', price: '18', description: '' },
  { name: 'Manucure', category: 'Onglerie', price: '20', description: '' },
  { name: 'Pédicure', category: 'Onglerie', price: '25', description: '' },
  { name: 'Soin du visage', category: 'Soins esthétiques', price: '35', description: '' },
  { name: 'Épilation', category: 'Soins esthétiques', price: '15', description: 'Prix estimatif, à adapter selon la zone.' },
  { name: 'Maquillage', category: 'Soins esthétiques', price: '35', description: '' },
];
const audienceLabels: Record<Service['audience'], string> = { women: 'Femmes', men: 'Hommes', unisex: 'Mixte' };
type ProductForm = typeof productDraft;
type ServiceForm = typeof serviceDraft;

const toProductForm = (product: Product): ProductForm => ({
  name: product.name, sku: product.sku, category: product.category,
  priceBuy: String(Number(product.priceBuy)), priceSell: String(Number(product.priceSell)),
  quantityStock: String(product.quantityStock), lowStockThreshold: String(product.lowStockThreshold ?? 5),
  imageUrl: product.imageUrl ?? '',
});

type StockFilter = 'all' | 'low' | 'out' | 'inactive';
const movementLabels: Record<StockMovement['reason'], string> = {
  initial: 'Stock initial', reception: 'Réception', sale: 'Vente', sale_cancel: 'Vente annulée', adjustment: 'Ajustement d’inventaire',
};
const isLowStock = (product: Product) => product.quantityStock <= product.lowStockThreshold;

const toServiceForm = (service: Service): ServiceForm => ({
  name: service.name, category: service.category, description: service.description ?? '',
  price: String(Number(service.price)), audience: service.audience,
  womenPrice: service.womenPrice == null ? '' : String(Number(service.womenPrice)),
  menPrice: service.menPrice == null ? '' : String(Number(service.menPrice)),
});

export const BoutiquePage = () => {
  const currency = useCurrency();
  const isAdmin = useIsAdmin();
  const { notify, confirm } = useFeedback();
  const [tab, setTab] = useState<CatalogTab>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  // null = closed, 'new' = creation, otherwise the edited record id
  const [productEditor, setProductEditor] = useState<{ id: string | 'new'; form: ProductForm } | null>(null);
  const [serviceEditor, setServiceEditor] = useState<{ id: string | 'new'; form: ServiceForm } | null>(null);
  const [stockTarget, setStockTarget] = useState<Product | null>(null);
  const [stockQuantity, setStockQuantity] = useState('');
  const [stockNote, setStockNote] = useState('');
  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const [history, setHistory] = useState<{ product: Product; movements: StockMovement[] | null } | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');

  const priceStep = currency === 'CDF' ? '1' : '0.01';

  const fetchCatalog = useCallback(async () => {
    const [productResponse, serviceResponse, salesResponse] = await Promise.all([
      apiClient.get<Product[]>('/products'),
      apiClient.get<Service[]>('/services'),
      apiClient.get<Sale[]>('/sales'),
    ]);
    return () => {
      setProducts(productResponse.data);
      setServices(serviceResponse.data);
      setSales(salesResponse.data);
      setError('');
    };
  }, []);

  const loadCatalog = useCallback(async () => {
    try {
      (await fetchCatalog())();
    } catch (requestError) {
      setError(getApiError(requestError, 'Impossible de charger le catalogue.'));
    }
  }, [fetchCatalog]);

  useEffect(() => {
    let active = true;
    fetchCatalog()
      .then((apply) => { if (active) apply(); })
      .catch((requestError) => { if (active) setError(getApiError(requestError, 'Impossible de charger le catalogue.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fetchCatalog]);

  const soldByProduct = useMemo(() => {
    const totals = new Map<string, number>();
    for (const sale of sales) {
      for (const item of sale.items ?? []) {
        if (item.type === 'product') totals.set(item.itemId, (totals.get(item.itemId) ?? 0) + Number(item.quantity));
      }
    }
    return totals;
  }, [sales]);

  const term = query.trim().toLowerCase();
  const categories = [...new Set(products.map((product) => product.category))].sort((a, b) => a.localeCompare(b, 'fr'));
  const visibleProducts = products.filter((product) =>
    (!term || `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(term)) &&
    (!categoryFilter || product.category === categoryFilter) &&
    (stockFilter === 'all' ? product.status !== 'inactive'
      : stockFilter === 'inactive' ? product.status === 'inactive'
      : product.status !== 'inactive' && (stockFilter === 'out' ? product.quantityStock === 0 : isLowStock(product) && product.quantityStock > 0)));
  const visibleServices = services.filter((service) => !term || `${service.name} ${service.category}`.toLowerCase().includes(term));
  const activeProducts = products.filter((product) => product.status !== 'inactive');
  const outOfStock = activeProducts.filter((product) => product.quantityStock === 0);
  const lowStock = activeProducts.filter((product) => isLowStock(product) && product.quantityStock > 0);
  const stockValue = products.reduce((sum, product) => sum + Number(product.priceBuy) * product.quantityStock, 0);

  const saveProduct = async (event: FormEvent) => {
    event.preventDefault();
    if (!productEditor) return;
    const { id, form } = productEditor;
    setSaving(true);
    try {
      const payload = {
        name: form.name, sku: form.sku, category: form.category,
        priceBuy: Number(form.priceBuy), priceSell: Number(form.priceSell),
        lowStockThreshold: Number(form.lowStockThreshold),
        imageUrl: form.imageUrl.trim(),
      };
      if (id === 'new') {
        await apiClient.post('/products', { ...payload, quantityStock: Number(form.quantityStock) });
        notify(`Produit « ${form.name} » ajouté.`);
      } else {
        await apiClient.patch(`/products/${id}`, payload);
        notify(`Produit « ${form.name} » mis à jour.`);
      }
      setProductEditor(null);
      await loadCatalog();
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible d’enregistrer le produit. Vérifiez le SKU et les prix.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveService = async (event: FormEvent) => {
    event.preventDefault();
    if (!serviceEditor) return;
    const { id, form } = serviceEditor;
    setSaving(true);
    try {
      const payload = {
        name: form.name, category: form.category, description: form.description, audience: form.audience,
        price: Number(form.price),
        womenPrice: form.womenPrice ? Number(form.womenPrice) : null,
        menPrice: form.menPrice ? Number(form.menPrice) : null,
      };
      if (id === 'new') {
        await apiClient.post('/services', { ...payload, duration: defaultServiceDuration });
        notify(`Prestation « ${form.name} » ajoutée.`);
      } else {
        await apiClient.patch(`/services/${id}`, payload);
        notify(`Prestation « ${form.name} » mise à jour.`);
      }
      setServiceEditor(null);
      await loadCatalog();
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible d’enregistrer la prestation. Vérifiez les prix.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleService = async (service: Service) => {
    const status = service.status === 'active' ? 'inactive' : 'active';
    try {
      await apiClient.patch(`/services/${service.id}`, { status });
      notify(status === 'active' ? `« ${service.name} » est de nouveau proposée.` : `« ${service.name} » est retirée de la caisse.`);
      await loadCatalog();
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible de modifier cette prestation.'), 'error');
    }
  };

  const receiveStock = async (event: FormEvent) => {
    event.preventDefault();
    if (!stockTarget) return;
    const received = Number(stockQuantity);
    if (!Number.isInteger(received) || received <= 0) {
      notify('Saisissez une quantité entière supérieure à zéro.', 'error');
      return;
    }
    setSaving(true);
    try {
      await apiClient.post(`/products/${stockTarget.id}/stock`, { quantity: received, note: stockNote });
      notify(`${received} × ${stockTarget.name} ajouté(s) au stock.`);
      setStockTarget(null);
      await loadCatalog();
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible d’enregistrer cette entrée en stock.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const adjustStock = async (event: FormEvent) => {
    event.preventDefault();
    if (!adjustTarget) return;
    const counted = Number(stockQuantity);
    if (!Number.isInteger(counted) || counted < 0) {
      notify('Saisissez la quantité réellement comptée (entier positif ou zéro).', 'error');
      return;
    }
    setSaving(true);
    try {
      await apiClient.post(`/products/${adjustTarget.id}/adjust`, { quantity: counted, note: stockNote });
      notify(`Stock de ${adjustTarget.name} corrigé à ${counted}.`);
      setAdjustTarget(null);
      await loadCatalog();
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible d’ajuster ce stock.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const showHistory = async (product: Product) => {
    setHistory({ product, movements: null });
    try {
      const { data } = await apiClient.get<StockMovement[]>(`/products/${product.id}/movements`);
      setHistory({ product, movements: data });
    } catch (requestError) {
      setHistory(null);
      notify(getApiError(requestError, 'Impossible de charger l’historique du stock.'), 'error');
    }
  };

  const toggleProduct = async (product: Product) => {
    const status = product.status === 'inactive' ? 'active' : 'inactive';
    try {
      await apiClient.patch(`/products/${product.id}`, { status });
      notify(status === 'active' ? `« ${product.name} » est de nouveau en vente.` : `« ${product.name} » est retiré de la caisse. Son historique est conservé.`);
      await loadCatalog();
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible de modifier ce produit.'), 'error');
    }
  };

  const deleteProduct = async (product: Product) => {
    if ((soldByProduct.get(product.id) ?? 0) > 0) {
      notify('Ce produit figure dans des ventes : désactivez-le plutôt que de le supprimer.', 'error');
      return;
    }
    const accepted = await confirm({ title: `Supprimer « ${product.name} » ?`, message: 'Ce produit n’a jamais été vendu. Il sera retiré du catalogue avec son historique de stock.', confirmLabel: 'Supprimer', danger: true });
    if (!accepted) return;
    try {
      const { data } = await apiClient.delete<{ deactivated?: boolean }>(`/products/${product.id}`);
      notify(data.deactivated
        ? `« ${product.name} » a été désactivé pour conserver son historique de stock.`
        : `« ${product.name} » a été supprimé.`);
      await loadCatalog();
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible de supprimer ce produit.'), 'error');
    }
  };

  const applyProductTemplate = (name: string) => {
    const template = productTemplates.find((item) => item.name === name);
    if (!template || !productEditor) return;
    let sku = template.sku;
    let suffix = 2;
    while (products.some((product) => product.sku.toLowerCase() === sku.toLowerCase())) sku = `${template.sku}-${String(suffix++).padStart(2, '0')}`;
    setProductEditor({ ...productEditor, form: { ...template, sku, lowStockThreshold: productEditor.form.lowStockThreshold, imageUrl: '' } });
  };

  const applyServiceTemplate = (name: string) => {
    const template = serviceTemplates.find((item) => item.name === name);
    if (!template || !serviceEditor) return;
    const lowered = template.name.toLowerCase();
    setServiceEditor({ ...serviceEditor, form: { ...template, audience: lowered.includes('homme') ? 'men' : lowered.includes('femme') ? 'women' : 'unisex', womenPrice: '', menPrice: '' } });
  };

  const setProductField = (key: keyof ProductForm, value: string) =>
    setProductEditor((current) => current && { ...current, form: { ...current.form, [key]: value } });
  const setServiceField = (key: keyof ServiceForm, value: string) =>
    setServiceEditor((current) => current && { ...current, form: { ...current.form, [key]: value } });

  return (
    <section className="space-y-6">
      <PageHeader
        eyebrow="Catalogue"
        title="Boutique et prestations"
        subtitle={`${products.length} produit(s) · ${services.filter((service) => service.status === 'active').length} prestation(s) active(s) · valeur du stock ${formatCurrency(stockValue, currency)}`}
        actions={isAdmin && (tab === 'products'
          ? <button type="button" className="btn btn-primary" onClick={() => setProductEditor({ id: 'new', form: productDraft })}>Ajouter un produit</button>
          : <button type="button" className="btn btn-primary" onClick={() => setServiceEditor({ id: 'new', form: serviceDraft })}>Ajouter une prestation</button>)}
      />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="tabs" role="tablist" aria-label="Catalogue">
          <button type="button" role="tab" aria-selected={tab === 'products'} className={`tab${tab === 'products' ? ' is-active' : ''}`} onClick={() => setTab('products')}>Produits ({products.length})</button>
          <button type="button" role="tab" aria-selected={tab === 'services'} className={`tab${tab === 'services' ? ' is-active' : ''}`} onClick={() => setTab('services')}>Prestations ({services.length})</button>
        </div>
        <input type="search" aria-label="Rechercher dans le catalogue" placeholder="Rechercher un nom, un SKU, une catégorie…" value={query} onChange={(event) => setQuery(event.target.value)} className="search-input px-3 py-2 text-sm" />
      </div>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {tab === 'products' && outOfStock.length > 0 && (
        <div role="alert" className="text-sm text-red-700">
          <p className="font-semibold">Rupture de stock : intervention nécessaire</p>
          <p className="mt-1">{outOfStock.map((product) => product.name).join(' · ')}</p>
        </div>
      )}
      {tab === 'products' && lowStock.length > 0 && (
        <p role="status" className="border-l-4 border-orange-700 bg-orange-50 px-4 py-3 text-sm text-gray-900">
          <span className="font-semibold">Stock bas à réapprovisionner : </span>
          {lowStock.map((product) => `${product.name} (${product.quantityStock} restant${product.quantityStock > 1 ? 's' : ''}, seuil ${product.lowStockThreshold})`).join(' · ')}
        </p>
      )}
      {tab === 'products' && products.length > 0 && (
        <div className="toolbar">
          <select aria-label="Filtrer par catégorie" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="">Toutes les catégories</option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <select aria-label="Filtrer par état du stock" value={stockFilter} onChange={(event) => setStockFilter(event.target.value as StockFilter)}>
            <option value="all">Produits en vente</option>
            <option value="low">Stock bas ({lowStock.length})</option>
            <option value="out">Épuisés ({outOfStock.length})</option>
            <option value="inactive">Désactivés ({products.length - activeProducts.length})</option>
          </select>
        </div>
      )}

      <div className="overflow-x-auto">
        {loading ? <p className="loading-line">Chargement du catalogue…</p> : tab === 'products' ? (
          visibleProducts.length ? <table className="data-table">
            <thead><tr><th>Produit</th><th>Catégorie</th><th className="num">Prix d’achat</th><th className="num">Prix de vente</th><th className="num">Marge</th><th className="num">Entrées</th><th className="num">Vendus</th><th className="num">En stock</th><th className="actions">Actions</th></tr></thead>
            <tbody>{visibleProducts.map((product) => {
              const margin = Number(product.priceSell) - Number(product.priceBuy);
              const isLow = product.quantityStock <= product.lowStockThreshold;
              return <tr key={product.id}>
                <td>
                  <span className="flex items-center gap-3">
                    {product.imageUrl ? <img src={product.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded object-cover" loading="lazy" /> : <span aria-hidden="true" className="avatar avatar-initials" style={{ width: 40, height: 40, borderRadius: 4, fontSize: 13 }}>{product.name.slice(0, 2).toUpperCase()}</span>}
                    <span><span className="cell-title">{product.name}</span><span className="cell-sub">{product.sku}{product.status === 'inactive' && ' · désactivé'}</span></span>
                  </span>
                </td>
                <td>{product.category}</td>
                <td className="num">{formatCurrency(product.priceBuy, currency)}</td>
                <td className="num">{formatCurrency(product.priceSell, currency)}</td>
                <td className="num">{formatCurrency(margin, currency)}</td>
                <td className="num">{product.quantityReceived}</td>
                <td className="num">{soldByProduct.get(product.id) ?? 0}</td>
                <td className="num"><span className={`badge ${product.quantityStock === 0 ? 'badge-danger' : isLow ? 'badge-warning' : 'badge-success'}`} title={`Seuil d’alerte : ${product.lowStockThreshold}`}>{product.quantityStock === 0 ? 'Épuisé' : product.quantityStock}</span></td>
                <td className="actions"><span className="row-actions">
                  {product.status !== 'inactive' && <button type="button" className="link-button" onClick={() => { setStockTarget(product); setStockQuantity(''); setStockNote(''); }}>Réception</button>}
                  <button type="button" className="link-button" onClick={() => void showHistory(product)}>Historique</button>
                  {isAdmin && <>
                    <button type="button" className="link-button" onClick={() => { setAdjustTarget(product); setStockQuantity(String(product.quantityStock)); setStockNote(''); }}>Inventaire</button>
                    <button type="button" className="link-button" onClick={() => setProductEditor({ id: product.id, form: toProductForm(product) })}>Modifier</button>
                    <button type="button" className={`link-button${product.status === 'inactive' ? '' : ' is-danger'}`} onClick={() => void toggleProduct(product)}>{product.status === 'inactive' ? 'Réactiver' : 'Désactiver'}</button>
                    {!(soldByProduct.get(product.id) ?? 0) && <button type="button" className="link-button is-danger" onClick={() => void deleteProduct(product)}>Supprimer</button>}
                  </>}
                </span></td>
              </tr>;
            })}</tbody>
          </table> : <EmptyState title={term || categoryFilter || stockFilter !== 'all' ? 'Aucun produit ne correspond à ces filtres.' : 'Aucun produit enregistré.'} hint={isAdmin && !term ? 'Ajoutez vos premiers produits pour les vendre en caisse.' : undefined} />
        ) : (
          visibleServices.length ? <table className="data-table">
            <thead><tr><th>Prestation</th><th>Public</th><th>Catégorie</th><th className="num">Tarif femme</th><th className="num">Tarif homme</th><th>État</th>{isAdmin && <th className="actions">Actions</th>}</tr></thead>
            <tbody>{visibleServices.map((service) => <tr key={service.id}>
              <td><span className="cell-title">{service.name}</span>{service.description && <span className="cell-sub">{service.description}</span>}</td>
              <td>{audienceLabels[service.audience]}</td>
              <td>{service.category}</td>
              <td className="num">{service.audience === 'men' ? '—' : formatCurrency(service.womenPrice ?? service.price, currency)}</td>
              <td className="num">{service.audience === 'women' ? '—' : formatCurrency(service.menPrice ?? service.price, currency)}</td>
              <td><span className={`badge ${service.status === 'active' ? 'badge-success' : ''}`}>{service.status === 'active' ? 'Active' : 'Inactive'}</span></td>
              {isAdmin && <td className="actions"><span className="row-actions">
                <button type="button" className="link-button" onClick={() => setServiceEditor({ id: service.id, form: toServiceForm(service) })}>Modifier</button>
                <button type="button" className={`link-button${service.status === 'active' ? ' is-danger' : ''}`} onClick={() => void toggleService(service)}>{service.status === 'active' ? 'Désactiver' : 'Réactiver'}</button>
              </span></td>}
            </tr>)}</tbody>
          </table> : <EmptyState title={term ? 'Aucune prestation ne correspond à la recherche.' : 'Aucune prestation enregistrée.'} />
        )}
      </div>

      {productEditor && (
        <Modal
          title={productEditor.id === 'new' ? 'Nouveau produit' : 'Modifier le produit'}
          description={productEditor.id === 'new' ? 'Partez d’un modèle ou saisissez votre propre produit.' : 'Le stock se modifie via « Réception » ou les ventes.'}
          onClose={() => setProductEditor(null)}
        >
          <form onSubmit={saveProduct} className="form-grid">
            {productEditor.id === 'new' && <label className="field field-wide">Modèle de produit
              <select value="" onChange={(event) => applyProductTemplate(event.target.value)}>
                <option value="">Choisir un modèle (facultatif)</option>
                {productTemplates.map((template) => <option key={template.sku} value={template.name}>{template.name}</option>)}
              </select>
            </label>}
            <label className="field">Nom<input required value={productEditor.form.name} onChange={(event) => setProductField('name', event.target.value)} /></label>
            <label className="field">SKU<input required value={productEditor.form.sku} onChange={(event) => setProductField('sku', event.target.value)} /></label>
            <label className="field">Catégorie<input required value={productEditor.form.category} onChange={(event) => setProductField('category', event.target.value)} /></label>
            <label className="field">Prix d’achat ({currency})<input required type="number" min="0" step={priceStep} value={productEditor.form.priceBuy} onChange={(event) => setProductField('priceBuy', event.target.value)} /></label>
            <label className="field">Prix de vente ({currency})<input required type="number" min="0" step={priceStep} value={productEditor.form.priceSell} onChange={(event) => setProductField('priceSell', event.target.value)} /></label>
            {productEditor.id === 'new' && <label className="field">Stock initial<input required type="number" min="0" step="1" value={productEditor.form.quantityStock} onChange={(event) => setProductField('quantityStock', event.target.value)} /></label>}
            <label className="field">Seuil d’alerte stock bas<input required type="number" min="0" step="1" value={productEditor.form.lowStockThreshold} onChange={(event) => setProductField('lowStockThreshold', event.target.value)} /><span className="field-hint">Une alerte s’affiche quand le stock atteint ce niveau.</span></label>
            <label className="field field-wide">Image (adresse web, facultatif)<input type="url" placeholder="https://…" value={productEditor.form.imageUrl} onChange={(event) => setProductField('imageUrl', event.target.value)} /></label>
            <div className="field-wide flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setProductEditor(null)}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
            </div>
          </form>
        </Modal>
      )}

      {serviceEditor && (
        <Modal
          title={serviceEditor.id === 'new' ? 'Nouvelle prestation' : 'Modifier la prestation'}
          description="Les tarifs femme et homme sont facultatifs : à défaut, le prix de base s’applique."
          onClose={() => setServiceEditor(null)}
        >
          <form onSubmit={saveService} className="form-grid">
            {serviceEditor.id === 'new' && <label className="field field-wide">Modèle de prestation
              <select value="" onChange={(event) => applyServiceTemplate(event.target.value)}>
                <option value="">Choisir un modèle (facultatif)</option>
                {serviceTemplates.map((template) => <option key={template.name} value={template.name}>{template.name}</option>)}
              </select>
            </label>}
            <label className="field">Nom<input required value={serviceEditor.form.name} onChange={(event) => setServiceField('name', event.target.value)} /></label>
            <label className="field">Catégorie<input required value={serviceEditor.form.category} onChange={(event) => setServiceField('category', event.target.value)} /></label>
            <label className="field">Prix de base ({currency})<input required type="number" min="0" step={priceStep} value={serviceEditor.form.price} onChange={(event) => setServiceField('price', event.target.value)} /></label>
            <label className="field">Public cible
              <select value={serviceEditor.form.audience} onChange={(event) => setServiceField('audience', event.target.value)}>
                <option value="women">Femmes</option><option value="men">Hommes</option><option value="unisex">Mixte</option>
              </select>
            </label>
            {serviceEditor.form.audience !== 'men' && <label className="field">Tarif femme (facultatif)<input type="number" min="0" step={priceStep} value={serviceEditor.form.womenPrice} onChange={(event) => setServiceField('womenPrice', event.target.value)} /></label>}
            {serviceEditor.form.audience !== 'women' && <label className="field">Tarif homme (facultatif)<input type="number" min="0" step={priceStep} value={serviceEditor.form.menPrice} onChange={(event) => setServiceField('menPrice', event.target.value)} /></label>}
            <label className="field field-wide">Description<textarea rows={2} value={serviceEditor.form.description} onChange={(event) => setServiceField('description', event.target.value)} /></label>
            <div className="field-wide flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setServiceEditor(null)}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
            </div>
          </form>
        </Modal>
      )}

      {stockTarget && (
        <Modal size="sm" title="Réception de stock" description={`${stockTarget.name} · ${stockTarget.quantityStock} en stock actuellement`} onClose={() => setStockTarget(null)}>
          <form onSubmit={receiveStock} className="grid gap-4">
            <label className="field">Quantité reçue<input required type="number" min="1" step="1" value={stockQuantity} onChange={(event) => setStockQuantity(event.target.value)} /></label>
            <label className="field">Référence (facultatif)<input placeholder="N° de bon de livraison, fournisseur…" value={stockNote} onChange={(event) => setStockNote(event.target.value)} /></label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setStockTarget(null)}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Enregistrement…' : 'Ajouter au stock'}</button>
            </div>
          </form>
        </Modal>
      )}
      {adjustTarget && (
        <Modal size="sm" title="Inventaire" description={`${adjustTarget.name} · ${adjustTarget.quantityStock} en stock selon le système`} onClose={() => setAdjustTarget(null)}>
          <form onSubmit={adjustStock} className="grid gap-4">
            <label className="field">Quantité réellement comptée<input required type="number" min="0" step="1" value={stockQuantity} onChange={(event) => setStockQuantity(event.target.value)} /></label>
            <label className="field">Motif<input required placeholder="Ex. inventaire mensuel, casse, produit offert…" value={stockNote} onChange={(event) => setStockNote(event.target.value)} /></label>
            {stockQuantity !== '' && Number(stockQuantity) !== adjustTarget.quantityStock && <p className="field-hint">Écart enregistré : {Number(stockQuantity) - adjustTarget.quantityStock > 0 ? '+' : ''}{Number(stockQuantity) - adjustTarget.quantityStock}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setAdjustTarget(null)}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Enregistrement…' : 'Corriger le stock'}</button>
            </div>
          </form>
        </Modal>
      )}

      {history && (
        <Modal size="lg" title={`Mouvements de stock · ${history.product.name}`} description={`${history.product.quantityStock} en stock · seuil d’alerte ${history.product.lowStockThreshold}`} onClose={() => setHistory(null)}>
          {history.movements === null ? <p className="loading-line">Chargement…</p> : history.movements.length ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Date</th><th>Opération</th><th className="num">Quantité</th><th className="num">Stock après</th><th>Détail</th></tr></thead>
                <tbody>{history.movements.map((movement) => <tr key={movement.id}>
                  <td className="whitespace-nowrap">{formatDateTime(movement.createdAt)}</td>
                  <td>{movementLabels[movement.reason]}</td>
                  <td className="num"><span className={movement.type === 'in' ? 'text-green-700' : 'text-red-700'}>{movement.type === 'in' ? '+' : '−'}{movement.quantity}</span></td>
                  <td className="num">{movement.stockAfter}</td>
                  <td><span className="cell-sub">{[movement.note, movement.userEmail].filter(Boolean).join(' · ') || '—'}</span></td>
                </tr>)}</tbody>
              </table>
            </div>
          ) : <EmptyState title="Aucun mouvement enregistré pour ce produit." hint="Les mouvements sont suivis depuis la mise à jour du logiciel." />}
        </Modal>
      )}
    </section>
  );
};
