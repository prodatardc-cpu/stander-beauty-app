import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { useSearchTerm } from '../hooks/useSearchTerm';
import { useNavigate } from 'react-router-dom';
import type { Product, Sale, StockMovement } from '../types';
import { formatDateTime } from '../utils/format';
import { apiClient, getApiError } from '../services/api';
import { formatCurrency, useCurrency } from '../services/currency';
import { addToTill } from '../services/till';
import { notifyStockChanged } from '../services/stockEvents';
import { useIsAdmin } from '../hooks/useAuth';
import { useFeedback } from '../components/UI/Feedback';
import { Modal } from '../components/UI/Modal';
import { EmptyState, PageHeader } from '../components/UI/PageHeader';
import { BrandMark } from '../components/Common/BrandMark';
import { compressPhoto } from '../utils/image';

// Product photos are shown 4:3 in the shop window.
const photoSize = { width: 480, height: 360 };
const isPhotoData = (value: string) => value.startsWith('data:image/');

const productDraft = { name: '', sku: '', category: '', description: '', priceBuy: '', priceSell: '', quantityStock: '0', lowStockThreshold: '5', imageUrl: '' };
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
type ProductForm = typeof productDraft;

const toProductForm = (product: Product): ProductForm => ({
  name: product.name, sku: product.sku, category: product.category, description: product.description ?? '',
  priceBuy: String(Number(product.priceBuy)), priceSell: String(Number(product.priceSell)),
  quantityStock: String(product.quantityStock), lowStockThreshold: String(product.lowStockThreshold ?? 5),
  imageUrl: product.imageUrl ?? '',
});

type StockFilter = 'all' | 'low' | 'out' | 'inactive';
type View = 'cards' | 'table';
const movementLabels: Record<StockMovement['reason'], string> = {
  initial: 'Stock initial', reception: 'Réception', sale: 'Vente', sale_cancel: 'Vente annulée', adjustment: 'Ajustement d’inventaire',
};
const isLowStock = (product: Product) => product.quantityStock <= product.lowStockThreshold;

export const BoutiquePage = () => {
  const currency = useCurrency();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const { notify, confirm } = useFeedback();
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useSearchTerm();
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<View>('cards');
  // null = closed, 'new' = creation, otherwise the edited record id
  const [productEditor, setProductEditor] = useState<{ id: string | 'new'; form: ProductForm } | null>(null);
  const [stockTarget, setStockTarget] = useState<Product | null>(null);
  const [stockQuantity, setStockQuantity] = useState('');
  const [stockNote, setStockNote] = useState('');
  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const [history, setHistory] = useState<{ product: Product; movements: StockMovement[] | null } | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');

  const priceStep = currency === 'CDF' ? '1' : '0.01';

  const fetchCatalog = useCallback(async () => {
    const [productResponse, salesResponse] = await Promise.all([
      apiClient.get<Product[]>('/products'),
      apiClient.get<Sale[]>('/sales', { status: 'completed' }),
    ]);
    return () => {
      setProducts(productResponse.data);
      setSales(salesResponse.data);
      setError('');
    };
  }, []);

  // Called after every change made here: the out-of-stock alert of the other pages refreshes too.
  const loadCatalog = useCallback(async () => {
    notifyStockChanged();
    try {
      (await fetchCatalog())();
    } catch (requestError) {
      setError(getApiError(requestError, 'Impossible de charger la boutique.'));
    }
  }, [fetchCatalog]);

  useEffect(() => {
    let active = true;
    fetchCatalog()
      .then((apply) => { if (active) apply(); })
      .catch((requestError) => { if (active) setError(getApiError(requestError, 'Impossible de charger la boutique.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fetchCatalog]);

  // Units sold per product, cancelled sales excluded.
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
    (!term || `${product.name} ${product.sku} ${product.category} ${product.description ?? ''}`.toLowerCase().includes(term)) &&
    (!categoryFilter || product.category === categoryFilter) &&
    (stockFilter === 'all' ? product.status !== 'inactive'
      : stockFilter === 'inactive' ? product.status === 'inactive'
      : product.status !== 'inactive' && (stockFilter === 'out' ? product.quantityStock === 0 : isLowStock(product) && product.quantityStock > 0)));
  const activeProducts = products.filter((product) => product.status !== 'inactive');
  const outOfStock = activeProducts.filter((product) => product.quantityStock === 0);
  const lowStock = activeProducts.filter((product) => isLowStock(product) && product.quantityStock > 0);
  const stockValue = products.reduce((sum, product) => sum + Number(product.priceBuy) * product.quantityStock, 0);

  // Reads a picture chosen (or taken) on the device, compressed for the API.
  const readPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return null;
    try {
      return await compressPhoto(file, photoSize);
    } catch {
      notify('Cette image ne peut pas être utilisée. Essayez une photo JPEG ou PNG.', 'error');
      return null;
    }
  };

  // Directly from the product card.
  const changeCardPhoto = async (product: Product, event: ChangeEvent<HTMLInputElement>) => {
    const photo = await readPhoto(event);
    if (!photo) return;
    try {
      await apiClient.patch(`/products/${product.id}`, { imageUrl: photo });
      notify(`Photo de « ${product.name} » enregistrée.`);
      await loadCatalog();
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible d’enregistrer cette photo.'), 'error');
    }
  };

  const sendToTill = (product: Product) => {
    addToTill({ type: 'product', itemId: product.id, name: product.name, basePrice: Number(product.priceSell), quantity: 1 }, currency);
    notify(`« ${product.name} » ajouté à la vente en cours.`);
    navigate('/caisse');
  };

  const saveProduct = async (event: FormEvent) => {
    event.preventDefault();
    if (!productEditor) return;
    const { id, form } = productEditor;
    setSaving(true);
    try {
      const payload = {
        name: form.name, sku: form.sku, category: form.category, description: form.description.trim(),
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
    setProductEditor({ ...productEditor, form: { ...productEditor.form, ...template, sku } });
  };

  const setProductField = (key: keyof ProductForm, value: string) =>
    setProductEditor((current) => current && { ...current, form: { ...current.form, [key]: value } });

  const stockBadge = (product: Product) => product.quantityStock === 0
    ? <span className="badge badge-danger">Épuisé</span>
    : isLowStock(product) ? <span className="badge badge-warning">Plus que {product.quantityStock}</span>
    : <span className="badge badge-success">{product.quantityStock} en stock</span>;

  const productActions = (product: Product) => <>
    {product.status !== 'inactive' && <button type="button" className="link-button" onClick={() => { setStockTarget(product); setStockQuantity(''); setStockNote(''); }}>Réception</button>}
    <button type="button" className="link-button" onClick={() => void showHistory(product)}>Mouvements</button>
    {isAdmin && <>
      <button type="button" className="link-button" onClick={() => { setAdjustTarget(product); setStockQuantity(String(product.quantityStock)); setStockNote(''); }}>Inventaire</button>
      <button type="button" className="link-button" onClick={() => setProductEditor({ id: product.id, form: toProductForm(product) })}>Modifier</button>
      <button type="button" className={`link-button${product.status === 'inactive' ? '' : ' is-danger'}`} onClick={() => void toggleProduct(product)}>{product.status === 'inactive' ? 'Réactiver' : 'Désactiver'}</button>
      {!(soldByProduct.get(product.id) ?? 0) && <button type="button" className="link-button is-danger" onClick={() => void deleteProduct(product)}>Supprimer</button>}
    </>}
  </>;

  return (
    <section className="space-y-5">
      <PageHeader
        eyebrow="Catalogue"
        title="Boutique"
        subtitle={`${activeProducts.length} produit(s) en vente · prix en ${currency}${isAdmin ? ` · valeur du stock (prix d’achat) ${formatCurrency(stockValue, currency)}` : ''}`}
        actions={isAdmin && <button type="button" className="btn btn-primary" onClick={() => setProductEditor({ id: 'new', form: productDraft })}>Ajouter un produit</button>}
      />

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {lowStock.length > 0 && (
        <p role="status" className="till-alert"><span className="tone-expense"><strong>Stock bas :</strong> {lowStock.map((product) => `${product.name} (${product.quantityStock}, seuil ${product.lowStockThreshold})`).join(' · ')}</span></p>
      )}
      <div className="toolbar">
        <input type="search" aria-label="Rechercher un produit" placeholder="Rechercher un nom, un SKU, une catégorie…" value={query} onChange={(event) => setQuery(event.target.value)} className="search-input" />
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
        <div className="tabs" role="tablist" aria-label="Présentation">
          <button type="button" role="tab" aria-selected={view === 'cards'} className={`tab${view === 'cards' ? ' is-active' : ''}`} onClick={() => setView('cards')}>Vitrine</button>
          <button type="button" role="tab" aria-selected={view === 'table'} className={`tab${view === 'table' ? ' is-active' : ''}`} onClick={() => setView('table')}>Gestion du stock</button>
        </div>
      </div>

      {loading ? <p className="loading-line">Chargement de la boutique…</p> : !visibleProducts.length
        ? <EmptyState title={term || categoryFilter || stockFilter !== 'all' ? 'Aucun produit ne correspond à ces filtres.' : 'Aucun produit enregistré.'} hint={isAdmin && !term ? 'Ajoutez vos premiers produits pour les vendre en caisse.' : undefined} />
        : view === 'cards' ? (
          <div className="product-grid">
            {visibleProducts.map((product) => <article key={product.id} className={`product-card${product.quantityStock === 0 ? ' is-soldout' : ''}`}>
              <div className="product-media">
                {product.imageUrl ? <img src={product.imageUrl} alt="" loading="lazy" /> : <BrandMark className="product-placeholder" />}
                {isAdmin && <label className="product-photo-button">
                  {product.imageUrl ? 'Changer la photo' : 'Ajouter une photo'}
                  <input type="file" accept="image/*" className="sr-only" aria-label={`Photo de ${product.name}`} onChange={(event) => void changeCardPhoto(product, event)} />
                </label>}
              </div>
              <div className="product-body">
                <p className="product-category">{product.category}</p>
                <h3 className="product-name">{product.name}</h3>
                {product.description && <p className="product-description">{product.description}</p>}
                <div className="product-meta">
                  {stockBadge(product)}
                  <span className="product-price">{formatCurrency(product.priceSell, currency)}</span>
                </div>
                <button type="button" className="btn btn-primary btn-sm w-full" disabled={product.status !== 'active' || product.quantityStock < 1} onClick={() => sendToTill(product)}>
                  {product.quantityStock < 1 ? 'Indisponible' : 'Ajouter à la caisse'}
                </button>
              </div>
            </article>)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table compact-table">
              <thead><tr><th>Produit</th><th>Catégorie</th>{isAdmin && <th className="num">Achat</th>}<th className="num">Vente</th>{isAdmin && <th className="num">Marge</th>}<th className="num">Entrées</th><th className="num">Vendus</th><th className="num">Stock</th><th className="actions">Actions</th></tr></thead>
              <tbody>{visibleProducts.map((product) => <tr key={product.id}>
                <td><span className="cell-title">{product.name}</span><span className="cell-sub">{product.sku}{product.status === 'inactive' && ' · désactivé'}</span></td>
                <td>{product.category}</td>
                {isAdmin && <td className="num">{formatCurrency(product.priceBuy, currency)}</td>}
                <td className="num">{formatCurrency(product.priceSell, currency)}</td>
                {isAdmin && <td className="num">{formatCurrency(Number(product.priceSell) - Number(product.priceBuy), currency)}</td>}
                <td className="num">{product.quantityReceived}</td>
                <td className="num">{soldByProduct.get(product.id) ?? 0}</td>
                <td className="num">{stockBadge(product)}</td>
                <td className="actions"><span className="row-actions">{productActions(product)}</span></td>
              </tr>)}</tbody>
            </table>
          </div>
        )}

      {productEditor && (
        <Modal
          title={productEditor.id === 'new' ? 'Nouveau produit' : 'Modifier le produit'}
          description={productEditor.id === 'new' ? 'Partez d’un modèle ou saisissez votre propre produit.' : 'Le stock se modifie via « Réception », « Inventaire » ou les ventes.'}
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
            <label className="field field-wide">Description courte<textarea rows={2} maxLength={2000} placeholder="Ex. huile légère pour cheveux secs, 100 ml" value={productEditor.form.description} onChange={(event) => setProductField('description', event.target.value)} /></label>
            <div className="field field-wide">Photo du produit
              <div className="product-photo-field">
                <div className="product-media">{productEditor.form.imageUrl ? <img src={productEditor.form.imageUrl} alt="" /> : <BrandMark className="product-placeholder" />}</div>
                <div className="flex flex-wrap gap-2">
                  <label className="btn btn-secondary btn-sm cursor-pointer">
                    {productEditor.form.imageUrl ? 'Changer la photo' : 'Choisir une photo'}
                    <input type="file" accept="image/*" className="sr-only" onChange={(event) => void readPhoto(event).then((photo) => { if (photo) setProductField('imageUrl', photo); })} />
                  </label>
                  {productEditor.form.imageUrl && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setProductField('imageUrl', '')}>Retirer (logo du salon)</button>}
                </div>
              </div>
              {!isPhotoData(productEditor.form.imageUrl) && <input type="url" placeholder="Ou une adresse web : https://…" value={productEditor.form.imageUrl} onChange={(event) => setProductField('imageUrl', event.target.value)} />}
              <span className="field-hint">Sans photo, le logo du salon est affiché.</span>
            </div>
            <div className="field-wide flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setProductEditor(null)}>Annuler</button>
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
              <table className="data-table compact-table">
                <thead><tr><th>Date</th><th>Opération</th><th className="num">Quantité</th><th className="num">Stock après</th><th>Détail</th></tr></thead>
                <tbody>{history.movements.map((movement) => <tr key={movement.id}>
                  <td className="whitespace-nowrap">{formatDateTime(movement.createdAt)}</td>
                  <td>{movementLabels[movement.reason]}</td>
                  <td className="num"><span className={movement.type === 'in' ? 'tone-profit' : 'tone-danger'}>{movement.type === 'in' ? '+' : '−'}{movement.quantity}</span></td>
                  <td className="num">{movement.stockAfter}</td>
                  <td><span className="cell-sub">{[movement.note, movement.userEmail].filter(Boolean).join(' · ') || '—'}</span></td>
                </tr>)}</tbody>
              </table>
            </div>
          ) : <EmptyState title="Aucun mouvement enregistré pour ce produit." />}
        </Modal>
      )}
    </section>
  );
};
