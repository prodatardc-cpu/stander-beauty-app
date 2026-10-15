import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Client, Expense, Product, Sale, Service, Staff, StockAlert } from '../types';
import { apiClient, getApiError } from '../services/api';
import { formatCurrency, formatCurrencyExact, useCurrency, useExchangeRate, type Currency } from '../services/currency';
import { formatDateTime, isSameLocalDay, paymentMethodLabels } from '../utils/format';
import { useIsAdmin } from '../hooks/useAuth';
import { useFeedback } from '../components/UI/Feedback';
import { Modal } from '../components/UI/Modal';
import { EmptyState, PageHeader, StatCard } from '../components/UI/PageHeader';

type CartLine = { type: 'product' | 'service'; itemId: string; name: string; price: number; quantity: number; audience?: 'women' | 'men' };
type Receipt = { id: string; date: string; client: string; staff?: string; lines: { name: string; quantity: number; price: number }[]; total: number; paid: number; paymentMethod: Sale['paymentMethod']; currency: Currency };

const paymentOptions = Object.entries(paymentMethodLabels) as [Sale['paymentMethod'], string][];
const emptyExpense = { description: '', category: 'Fonctionnement', amount: '', paymentMethod: 'cash' as Sale['paymentMethod'] };
const lineKey = (line: Pick<CartLine, 'type' | 'itemId' | 'audience'>) => `${line.type}:${line.itemId}:${line.audience ?? ''}`;

export const CashierPage = () => {
  const currency = useCurrency();
  const exchangeRate = useExchangeRate();
  const money = (value: number | string) => formatCurrency(value, currency);
  const [saleCurrency, setSaleCurrency] = useState<Currency>(currency);
  const saleMoney = (value: number | string) => formatCurrencyExact(value, saleCurrency);
  const isAdmin = useIsAdmin();
  const { notify, confirm } = useFeedback();
  const [clients, setClients] = useState<Client[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expenseDraft, setExpenseDraft] = useState(emptyExpense);
  const [savingExpense, setSavingExpense] = useState(false);
  const [stockNotice, setStockNotice] = useState('');
  const [clientId, setClientId] = useState('');
  const [guestClientName, setGuestClientName] = useState('');
  const [staffId, setStaffId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<Sale['paymentMethod']>('cash');
  const [amountPaid, setAmountPaid] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  useEffect(() => setSaleCurrency(currency), [currency]);

  // Fetches everything the till needs and returns a function that applies it to state.
  const fetchAll = useCallback(async () => {
    const [clientResponse, staffResponse, productResponse, serviceResponse, salesResponse, expenseResponse] = await Promise.all([
      // Archived clients are kept to name past sales; they are not offered for new ones.
      apiClient.get<Client[]>('/clients', { includeArchived: 'true' }), apiClient.get<Staff[]>('/staff'),
      apiClient.get<Product[]>('/products'), apiClient.get<Service[]>('/services'),
      apiClient.get<Sale[]>('/sales'),
      apiClient.get<Expense[]>('/expenses'),
    ]);
    return () => {
      setClients(clientResponse.data);
      setStaff(staffResponse.data.filter((entry) => entry.status === 'active'));
      setProducts(productResponse.data);
      setServices(serviceResponse.data);
      setSales(salesResponse.data);
      setExpenses(expenseResponse.data);
      setError('');
    };
  }, []);

  const load = useCallback(async () => {
    try {
      (await fetchAll())();
    } catch (requestError) {
      setError(getApiError(requestError, 'Impossible de charger les données de caisse.'));
    }
  }, [fetchAll]);

  useEffect(() => {
    let active = true;
    fetchAll()
      .then((apply) => { if (active) apply(); })
      .catch((requestError) => { if (active) setError(getApiError(requestError, 'Impossible de charger les données de caisse.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fetchAll]);

  const salePriceMultiplier = saleCurrency === currency || !exchangeRate
    ? 1
    : saleCurrency === 'CDF' ? exchangeRate : 1 / exchangeRate;
  const catalog = useMemo(() => [
    ...services.filter((entry) => entry.status === 'active').flatMap((entry) => {
      const audiences: ('women' | 'men')[] = entry.audience === 'women' ? ['women'] : entry.audience === 'men' ? ['men'] : ['women', 'men'];
      return audiences.map((audience) => ({
        type: 'service' as const,
        itemId: entry.id,
        audience,
        name: `${entry.name} · ${audience === 'women' ? 'Femmes' : 'Hommes'}`,
        price: Number(audience === 'women' ? entry.womenPrice ?? entry.price : entry.menPrice ?? entry.price) * salePriceMultiplier,
        stock: Infinity,
      }));
    }),
    ...products.filter((entry) => entry.status !== 'inactive').map((entry) => ({ type: 'product' as const, itemId: entry.id, name: entry.name, price: Number(entry.priceSell) * salePriceMultiplier, audience: undefined, stock: entry.quantityStock })),
  ], [products, services, salePriceMultiplier]);

  const catalogNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const service of services) names.set(service.id, service.name);
    for (const product of products) names.set(product.id, product.name);
    return names;
  }, [products, services]);

  const total = cart.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const paidPreview = amountPaid === '' ? total : Number(amountPaid);
  const salesToday = sales.filter((sale) => sale.status !== 'refunded' && isSameLocalDay(sale.saleDate));
  const receivedTodayUSD = salesToday.filter((sale) => sale.currency === 'USD').reduce((sum, sale) => sum + Number(sale.amountPaid), 0);
  const receivedTodayCDF = salesToday.filter((sale) => sale.currency === 'CDF').reduce((sum, sale) => sum + Number(sale.amountPaid), 0);
  const expensesToday = expenses.filter((expense) => isSameLocalDay(expense.createdAt)).reduce((sum, expense) => sum + Number(expense.amount), 0);
  const lowStock = products.filter((product) => product.status !== 'inactive' && product.quantityStock <= product.lowStockThreshold);

  const clientLabel = (sale: Sale) => sale.clientName ?? clients.find((client) => client.id === sale.clientId)?.name ?? 'Client de passage';

  const createExpense = async (event: FormEvent) => {
    event.preventDefault();
    setSavingExpense(true);
    try {
      await apiClient.post('/expenses', { ...expenseDraft, amount: Number(expenseDraft.amount) });
      notify(`Dépense « ${expenseDraft.description} » enregistrée.`);
      setExpenseDraft(emptyExpense);
      await load();
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible d’enregistrer la dépense.'), 'error');
    } finally {
      setSavingExpense(false);
    }
  };

  const deleteExpense = async (expense: Expense) => {
    if (!await confirm({ title: 'Supprimer cette dépense ?', message: `${expense.description} · ${money(expense.amount)}`, confirmLabel: 'Supprimer', danger: true })) return;
    try {
      await apiClient.delete(`/expenses/${expense.id}`);
      notify('Dépense supprimée.');
      await load();
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible de supprimer la dépense.'), 'error');
    }
  };

  const inCart = (key: string) => cart.find((line) => lineKey(line) === key)?.quantity ?? 0;

  const addLine = () => {
    const selected = catalog.find((entry) => lineKey(entry) === selectedKey);
    const count = Number(quantity);
    if (!selected || !Number.isInteger(count) || count < 1) return;
    if (inCart(selectedKey) + count > selected.stock) {
      notify(`Stock insuffisant : ${selected.stock} ${selected.name} disponible(s).`, 'error');
      return;
    }
    setCart((current) => current.some((line) => lineKey(line) === selectedKey)
      ? current.map((line) => lineKey(line) === selectedKey ? { ...line, quantity: line.quantity + count } : line)
      : [...current, { type: selected.type, itemId: selected.itemId, audience: selected.audience, name: selected.name, price: selected.price, quantity: count }]);
    setSelectedKey('');
    setQuantity('1');
  };

  const changeQuantity = (key: string, delta: number) => {
    const entry = catalog.find((item) => lineKey(item) === key);
    setCart((current) => current
      .map((line) => lineKey(line) === key ? { ...line, quantity: Math.min(line.quantity + delta, entry?.stock ?? Infinity) } : line)
      .filter((line) => line.quantity > 0));
  };

  const checkout = async (event: FormEvent) => {
    event.preventDefault();
    if (!cart.length) {
      notify('Ajoutez au moins un article à la vente.', 'error');
      return;
    }
    const paid = paidPreview;
    if (!Number.isFinite(paid) || paid < 0 || paid > total) {
      notify('Le montant reçu doit être compris entre zéro et le total.', 'error');
      return;
    }
    setSaving(true);
    setStockNotice('');
    try {
      const stockChanges = cart.filter((line) => line.type === 'product').map((line) => {
        const product = products.find((entry) => entry.id === line.itemId);
        return product ? `${product.name} : -${line.quantity}, ${product.quantityStock - line.quantity} restant${product.quantityStock - line.quantity === 1 ? '' : 's'}` : '';
      }).filter(Boolean);
      const { data: sale } = await apiClient.post<Sale & { stockAlerts?: StockAlert[] }>('/sales', {
        clientId: clientId || undefined,
        clientName: guestClientName.trim() || undefined,
        staffId: staffId || undefined, paymentMethod, amountPaid: paid,
        currency: saleCurrency, baseCurrency: currency, exchangeRate,
        items: cart.map(({ type, itemId, audience, quantity: count }) => ({ type, itemId, audience, quantity: count })),
      });
      setReceipt({
        id: sale.id,
        date: String(sale.saleDate ?? new Date().toISOString()),
        client: guestClientName.trim() || clients.find((client) => client.id === clientId)?.name || 'Client de passage',
        staff: staff.find((member) => member.id === staffId)?.name,
        lines: cart.map((line) => ({ name: line.name, quantity: line.quantity, price: line.price })),
        total, paid, paymentMethod,
        currency: saleCurrency,
      });
      setCart([]);
      setAmountPaid('');
      setClientId('');
      setGuestClientName('');
      await load();
      if (stockChanges.length) setStockNotice(`Stock mis à jour : ${stockChanges.join(' · ')}`);
      // Only threshold crossings are pushed as alerts; ordinary decreases stay in the notice above.
      for (const alert of sale.stockAlerts ?? []) {
        notify(alert.level === 'out'
          ? `Rupture : « ${alert.name} » est épuisé. Pensez à réapprovisionner.`
          : `Stock bas : « ${alert.name} » n’a plus que ${alert.quantityStock} unité(s) (seuil ${alert.lowStockThreshold}).`, 'error');
      }
    } catch (requestError) {
      notify(getApiError(requestError, 'Vente refusée. Vérifiez le stock, le client et le mode de paiement.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const showSaleReceipt = (sale: Sale) => setReceipt({
    id: sale.id,
    date: String(sale.saleDate),
    client: clientLabel(sale),
    staff: staff.find((member) => member.id === sale.staffId)?.name,
    lines: (sale.items ?? []).map((item) => ({
      name: `${catalogNames.get(item.itemId) ?? (item.type === 'service' ? 'Prestation' : 'Produit')}${item.audience ? ` · ${item.audience === 'women' ? 'Femmes' : 'Hommes'}` : ''}`,
      quantity: Number(item.quantity),
      price: Number(item.unitPrice),
    })),
    total: Number(sale.totalAmount),
    paid: Number(sale.amountPaid),
    paymentMethod: sale.paymentMethod,
    currency: sale.currency ?? currency,
  });

  const cancelSale = async (sale: Sale) => {
    const accepted = await confirm({
      title: 'Annuler cette vente ?',
      message: `Vente du ${formatDateTime(sale.saleDate)} (${sale.currency ? formatCurrencyExact(sale.totalAmount, sale.currency) : money(sale.totalAmount)}). Les produits retournent en stock, les commissions et points fidélité associés sont retirés.`,
      confirmLabel: 'Annuler la vente',
      danger: true,
    });
    if (!accepted) return;
    try {
      await apiClient.delete(`/sales/${sale.id}`);
      notify('Vente annulée.');
      await load();
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible d’annuler cette vente.'), 'error');
    }
  };

  const resetSales = async () => {
    const accepted = await confirm({
      title: 'Réinitialiser la caisse ?',
      message: 'Toutes les ventes et commissions enregistrées seront supprimées définitivement. Cette action est irréversible.',
      confirmLabel: 'Tout supprimer',
      danger: true,
    });
    if (!accepted) return;
    try {
      await apiClient.delete('/sales/reset');
      setCart([]);
      setClientId('');
      setGuestClientName('');
      setStaffId('');
      notify('La caisse a été réinitialisée.');
      await load();
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible de réinitialiser la caisse.'), 'error');
    }
  };

  return (
    <section className="space-y-6">
      <PageHeader
        eyebrow="Encaissement"
        title="Caisse"
        subtitle="Enregistrez les prestations et les ventes de produits."
        actions={isAdmin && <button type="button" className="btn btn-danger" onClick={() => void resetSales()}>Réinitialiser la caisse</button>}
      />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {stockNotice && <p role="status" className="border-l-4 border-orange-700 bg-orange-50 px-4 py-3 text-sm text-gray-900">{stockNotice}</p>}
      {lowStock.length > 0 && <div role="alert" className="text-sm text-red-700"><p className="font-semibold">Alerte stock bas</p><p className="mt-1">{lowStock.map((product) => `${product.name} : ${product.quantityStock} restant${product.quantityStock > 1 ? 's' : ''} (seuil ${product.lowStockThreshold})`).join(' · ')}</p></div>}

      <div className="kpi-grid kpi-grid-4" aria-label="Bilan de caisse du jour">
        <StatCard label="Ventes du jour" value={salesToday.length} />
        <StatCard label="Encaissé · USD" value={formatCurrencyExact(receivedTodayUSD, 'USD')} />
        <StatCard label="Encaissé · CDF" value={formatCurrencyExact(receivedTodayCDF, 'CDF')} />
        <StatCard label="Dépenses aujourd’hui" value={money(expensesToday)} />
      </div>

      {loading ? <p className="loading-line">Chargement de la caisse…</p> : <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <form onSubmit={checkout} className="panel space-y-5">
          <div className="panel-header"><h2 className="section-title">Nouvelle vente</h2>{cart.length > 0 && <button type="button" className="link-button is-danger" onClick={() => setCart([])}>Vider le panier</button>}</div>
          <div className="form-grid">
            <label className="field">Client enregistré
              <select value={clientId} onChange={(event) => { setClientId(event.target.value); if (event.target.value) setGuestClientName(''); }}>
                <option value="">Aucun</option>
                {clients.filter((entry) => !entry.archivedAt).map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.phone}</option>)}
              </select>
            </label>
            <label className="field">Ou client de passage<input placeholder="Nom (facultatif)" value={guestClientName} onChange={(event) => { setGuestClientName(event.target.value); if (event.target.value) setClientId(''); }} /></label>
            <label className="field">Réalisé par
              <select value={staffId} onChange={(event) => setStaffId(event.target.value)}>
                <option value="">Non attribué</option>
                {staff.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </select>
            </label>
          </div>
          <div className="toolbar">
            <select aria-label="Article à ajouter" value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)} className="min-w-56 flex-1">
              <option value="">Choisir une prestation ou un produit</option>
              <optgroup label="Prestations">{catalog.filter((entry) => entry.type === 'service').map((entry) => <option key={lineKey(entry)} value={lineKey(entry)}>{entry.name} · {saleMoney(entry.price)}</option>)}</optgroup>
              <optgroup label="Produits">{catalog.filter((entry) => entry.type === 'product').map((entry) => <option key={lineKey(entry)} disabled={entry.stock < 1} value={lineKey(entry)}>{entry.name} · {saleMoney(entry.price)} · stock {entry.stock}</option>)}</optgroup>
            </select>
            <input aria-label="Quantité" type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="w-24" />
            <button type="button" className="btn btn-secondary" disabled={!selectedKey} onClick={addLine}>Ajouter</button>
          </div>
          <div className="list-rows border-y border-gray-200">
            {cart.map((line) => {
              const key = lineKey(line);
              return <div key={key} className="list-row">
                <div><p className="cell-title">{line.name}</p><p className="cell-sub">{saleMoney(line.price)} l’unité</p></div>
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center rounded border border-gray-300">
                    <button type="button" aria-label={`Retirer un ${line.name}`} className="link-button" onClick={() => changeQuantity(key, -1)}>−</button>
                    <span className="min-w-8 text-center text-sm font-semibold">{line.quantity}</span>
                    <button type="button" aria-label={`Ajouter un ${line.name}`} className="link-button" onClick={() => changeQuantity(key, 1)}>+</button>
                  </span>
                  <span className="w-28 text-right font-semibold">{saleMoney(line.quantity * line.price)}</span>
                </div>
              </div>;
            })}
            {!cart.length && <EmptyState title="Le panier est vide." hint="Choisissez une prestation ou un produit ci-dessus." />}
          </div>
          <div className="flex items-baseline justify-between"><span className="text-sm text-gray-600">Total à payer ({saleCurrency})</span><span className="font-display text-3xl font-semibold">{saleMoney(total)}</span></div>
          <div className="form-grid">
            <label className="field">Devise de la vente
              <select value={saleCurrency} onChange={(event) => { setSaleCurrency(event.target.value as Currency); setCart([]); setAmountPaid(''); }}>
                <option value={currency}>{currency === 'USD' ? 'Dollar américain (USD)' : 'Franc congolais (CDF)'} · devise de base</option>
                <option value={currency === 'USD' ? 'CDF' : 'USD'} disabled={!exchangeRate}>{currency === 'USD' ? 'Franc congolais (CDF)' : 'Dollar américain (USD)'}{!exchangeRate ? ' · taux requis' : ''}</option>
              </select>
              {saleCurrency !== currency && exchangeRate && <span className="field-hint">Taux utilisé : 1 USD = {new Intl.NumberFormat('fr-FR').format(exchangeRate)} CDF. Changer de devise vide le panier.</span>}
            </label>
            <label className="field">Mode de paiement
              <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as Sale['paymentMethod'])}>
                {paymentOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="field">Montant reçu ({saleCurrency})
              <input type="number" min="0" max={total} step={saleCurrency === 'CDF' ? '1' : '0.01'} value={amountPaid} onChange={(event) => setAmountPaid(event.target.value)} placeholder={`${total} (paiement complet)`} />
              {amountPaid !== '' && paidPreview < total && <span className="field-hint">Reste dû par le client : {saleMoney(total - paidPreview)}</span>}
            </label>
          </div>
          <button type="submit" className="btn btn-primary w-full" disabled={saving || !cart.length}>{saving ? 'Enregistrement…' : `Valider la vente · ${saleMoney(total)}`}</button>
        </form>

        <div className="space-y-6">
          <section className="panel">
            <div className="panel-header"><h2 className="section-title">Ventes récentes</h2><span className="text-xs text-gray-500">{sales.length} au total</span></div>
            <div className="list-rows">
              {sales.slice(0, 8).map((sale) => <div key={sale.id} className="list-row">
                <div className="min-w-0">
                  <p className="cell-title truncate">{clientLabel(sale)}</p>
                  <p className="cell-sub">{formatDateTime(sale.saleDate)} · {paymentMethodLabels[sale.paymentMethod]} · {sale.currency ?? 'Devise historique inconnue'}{Number(sale.remainingAmount) > 0 && <> · <span className="text-red-700">reste {sale.currency ? formatCurrencyExact(sale.remainingAmount, sale.currency) : money(sale.remainingAmount)}</span></>}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end">
                  <span className="font-semibold">{sale.currency ? formatCurrencyExact(sale.totalAmount, sale.currency) : money(sale.totalAmount)}</span>
                  <span className="row-actions">
                    <button type="button" className="link-button" onClick={() => showSaleReceipt(sale)}>Reçu</button>
                    {isAdmin && <button type="button" className="link-button is-danger" onClick={() => void cancelSale(sale)}>Annuler</button>}
                  </span>
                </div>
              </div>)}
              {!sales.length && <EmptyState title="Aucune vente enregistrée." />}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header"><h2 className="section-title">Enregistrer une dépense</h2></div>
            <form onSubmit={createExpense} className="form-grid">
              <label className="field">Libellé<input required value={expenseDraft.description} onChange={(event) => setExpenseDraft({ ...expenseDraft, description: event.target.value })} placeholder="Ex. électricité" /></label>
              <label className="field">Catégorie<input required value={expenseDraft.category} onChange={(event) => setExpenseDraft({ ...expenseDraft, category: event.target.value })} /></label>
              <label className="field">Montant ({currency})<input required type="number" min="0.01" step={currency === 'CDF' ? '1' : '0.01'} value={expenseDraft.amount} onChange={(event) => setExpenseDraft({ ...expenseDraft, amount: event.target.value })} /></label>
              <label className="field">Paiement
                <select value={expenseDraft.paymentMethod} onChange={(event) => setExpenseDraft({ ...expenseDraft, paymentMethod: event.target.value as Sale['paymentMethod'] })}>
                  {paymentOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <button type="submit" className="btn btn-secondary field-wide" disabled={savingExpense}>{savingExpense ? 'Enregistrement…' : 'Ajouter la dépense'}</button>
            </form>
            {expenses.length > 0 && <div className="list-rows mt-4">
              {expenses.slice(0, 5).map((expense) => <div key={expense.id} className="list-row">
                <div><p className="cell-title">{expense.description}</p><p className="cell-sub">{expense.category} · {formatDateTime(expense.createdAt)}</p></div>
                <span className="flex items-center gap-2"><span className="font-semibold">{money(expense.amount)}</span>{isAdmin && <button type="button" aria-label={`Supprimer la dépense ${expense.description}`} className="link-button is-danger" onClick={() => void deleteExpense(expense)}>Supprimer</button>}</span>
              </div>)}
            </div>}
          </section>
        </div>
      </div>}

      {receipt && (
        <Modal
          size="sm"
          title="Reçu de vente"
          onClose={() => setReceipt(null)}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setReceipt(null)}>Fermer</button>
            <button type="button" className="btn btn-primary" onClick={() => window.print()}>Imprimer</button>
          </>}
        >
          <div className="receipt printable">
            <div className="receipt-head">
              <strong>Stander Beauty</strong>
              <span>{formatDateTime(receipt.date)}</span><br />
              <span>N° {receipt.id.slice(0, 8).toUpperCase()}</span>
            </div>
            <div className="receipt-line"><span>Client</span><span>{receipt.client}</span></div>
            {receipt.staff && <div className="receipt-line"><span>Réalisé par</span><span>{receipt.staff}</span></div>}
            <div className="mt-2 border-t border-dashed border-gray-300 pt-2">
              {receipt.lines.map((line, index) => <div key={index} className="receipt-line"><span>{line.quantity} × {line.name}</span><span>{formatCurrencyExact(line.quantity * line.price, receipt.currency)}</span></div>)}
            </div>
            <div className="receipt-line receipt-total"><span>Total ({receipt.currency})</span><span>{formatCurrencyExact(receipt.total, receipt.currency)}</span></div>
            <div className="receipt-line"><span>Payé ({paymentMethodLabels[receipt.paymentMethod]})</span><span>{formatCurrencyExact(receipt.paid, receipt.currency)}</span></div>
            {receipt.total - receipt.paid > 0 && <div className="receipt-line"><span>Reste dû</span><span>{formatCurrencyExact(receipt.total - receipt.paid, receipt.currency)}</span></div>}
            <p className="receipt-foot">Merci de votre visite !</p>
          </div>
        </Modal>
      )}
    </section>
  );
};
