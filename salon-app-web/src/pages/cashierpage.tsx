import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { isAxiosError } from 'axios';
import type { Client, Expense, PeriodReport, Product, Sale, Service, Staff, StockAlert } from '../types';
import { apiClient, getApiError } from '../services/api';
import { convertMoney, currencyLabels, formatCurrency, loadSettings, roundMoney, useCurrency, useExchangeRate, type Currency } from '../services/currency';
import { lineKey, readTill, writeTill, type TillLine } from '../services/till';
import { notifyStockChanged } from '../services/stockEvents';
import { formatReceiptNumber, formatTime, paymentMethodLabels, toLocalDateInput } from '../utils/format';
import { useCan, useIsAdmin } from '../hooks/useAuth';
import { useFeedback } from '../components/UI/Feedback';
import { Modal } from '../components/UI/Modal';
import { Money } from '../components/UI/Money';
import { EmptyState, PageHeader, StatCard } from '../components/UI/PageHeader';
import { ReceiptModal } from '../components/Sales/Receipt';
import { CancelSaleDialog, DebtPaymentDialog } from '../components/Sales/SaleDialogs';

const paymentOptions = Object.entries(paymentMethodLabels) as [Sale['paymentMethod'], string][];
const emptyExpense = { description: '', category: 'Fonctionnement', amount: '', paymentMethod: 'cash' as Sale['paymentMethod'] };
const otherCurrency = (currency: Currency): Currency => (currency === 'USD' ? 'CDF' : 'USD');

// Price field of a cart line: keeps what is being typed (even an empty field) and only reports valid prices.
const LinePriceInput = ({ value, step, label, onCommit }: { value: number; step: string; label: string; onCommit: (price: number) => void }) => {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(String(value));
  }
  return (
    <input
      aria-label={label} type="number" min="0" step={step} value={text}
      onChange={(event) => {
        setText(event.target.value);
        const price = Number(event.target.value);
        if (event.target.value !== '' && Number.isFinite(price) && price >= 0) {
          setShown(price);
          onCommit(price);
        }
      }}
      onBlur={() => { if (text === '') setText(String(value)); }}
    />
  );
};

export const CashierPage = () => {
  const currency = useCurrency();
  const exchangeRate = useExchangeRate();
  const isAdmin = useIsAdmin();
  const canRecordCash = useCan('recordCash');
  const { notify, confirm } = useFeedback();
  const [initialDraft] = useState(readTill);
  const [saleCurrency, setSaleCurrency] = useState<Currency>(initialDraft.saleCurrency ?? currency);
  const [cart, setCart] = useState<TillLine[]>(initialDraft.baseCurrency && initialDraft.baseCurrency !== currency ? [] : initialDraft.cart);
  const [clientId, setClientId] = useState(initialDraft.clientId ?? '');
  const [guestClientName, setGuestClientName] = useState(initialDraft.guestClientName ?? '');
  const [staffId, setStaffId] = useState(initialDraft.staffId ?? '');
  const [clients, setClients] = useState<Client[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [todayReport, setTodayReport] = useState<PeriodReport | null>(null);
  const [expenseDraft, setExpenseDraft] = useState(emptyExpense);
  const [savingExpense, setSavingExpense] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<Sale['paymentMethod']>('cash');
  const [amountPaid, setAmountPaid] = useState('');
  // Service picker: the chosen service and its price (catalogue price, editable by the cashier).
  const [serviceKey, setServiceKey] = useState('');
  const [servicePrice, setServicePrice] = useState('');
  // Product picker.
  const [productKey, setProductKey] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [cancelling, setCancelling] = useState<Sale | null>(null);
  const [settling, setSettling] = useState<Sale | null>(null);
  const [cashOperation, setCashOperation] = useState<'in' | 'out' | 'count' | null>(null);

  // The base currency changed (Settings, another device): the catalogue prices were converted, so the
  // cart's base prices are stale; start the sale over (the catalogue reloads below). Adjusted during render.
  const [cartBaseCurrency, setCartBaseCurrency] = useState<Currency>(currency);
  if (cartBaseCurrency !== currency) {
    setCartBaseCurrency(currency);
    setSaleCurrency(currency);
    setCart([]);
    setAmountPaid('');
  }

  // The transaction in progress survives navigation (back arrow, shop, other pages).
  useEffect(() => {
    writeTill({ cart, baseCurrency: currency, saleCurrency, clientId, guestClientName, staffId });
  }, [cart, currency, saleCurrency, clientId, guestClientName, staffId]);

  // Fetches everything the till needs and returns a function that applies it to state.
  const fetchAll = useCallback(async () => {
    const today = toLocalDateInput(new Date());
    const [clientResponse, staffResponse, productResponse, serviceResponse, salesResponse, expenseResponse, reportResponse] = await Promise.all([
      apiClient.get<Client[]>('/clients'), apiClient.get<Staff[]>('/staff'),
      apiClient.get<Product[]>('/products'), apiClient.get<Service[]>('/services'),
      apiClient.get<Sale[]>('/sales', { startDate: today, endDate: today }),
      apiClient.get<Expense[]>('/expenses', { startDate: today, endDate: today }),
      // Received today includes debts settled today on older sales.
      apiClient.get<PeriodReport>('/reports/period', { startDate: today, endDate: today }),
    ]);
    return () => {
      setClients(clientResponse.data.filter((entry) => !entry.archivedAt));
      setStaff(staffResponse.data.filter((entry) => entry.status === 'active'));
      setProducts(productResponse.data);
      setServices(serviceResponse.data);
      setSales(salesResponse.data);
      setExpenses(expenseResponse.data);
      setTodayReport(reportResponse.data);
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

  // Reloaded when the base currency changes: catalogue prices are then expressed in the new one.
  useEffect(() => {
    let active = true;
    fetchAll()
      .then((apply) => { if (active) apply(); })
      .catch((requestError) => { if (active) setError(getApiError(requestError, 'Impossible de charger les données de caisse.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fetchAll, currency]);

  // Explicit conversion chosen by the cashier (rate displayed); same rounding as the API.
  const converting = saleCurrency !== currency;
  const toSalePrice = useCallback((basePrice: number) =>
    roundMoney(convertMoney(basePrice, currency, saleCurrency, exchangeRate ?? 1), saleCurrency), [currency, saleCurrency, exchangeRate]);
  const catalog = useMemo(() => [
    ...services.filter((entry) => entry.status === 'active').flatMap((entry) => {
      const audiences: ('women' | 'men')[] = entry.audience === 'women' ? ['women'] : entry.audience === 'men' ? ['men'] : ['women', 'men'];
      return audiences.map((audience) => ({
        type: 'service' as const, itemId: entry.id, audience,
        name: `${entry.name} · ${audience === 'women' ? 'Femmes' : 'Hommes'}`,
        basePrice: Number(audience === 'women' ? entry.womenPrice ?? entry.price : entry.menPrice ?? entry.price),
        stock: Infinity,
      }));
    }),
    ...products.filter((entry) => entry.status === 'active').map((entry) => ({ type: 'product' as const, itemId: entry.id, name: entry.name, basePrice: Number(entry.priceSell), audience: undefined, stock: entry.quantityStock })),
  ].map((entry) => ({ ...entry, price: toSalePrice(entry.basePrice) })), [products, services, toSalePrice]);

  // A price typed by the cashier applies in the currency it was typed in; otherwise the catalogue price.
  const pricedCart = cart.map((line) => {
    const catalogPrice = toSalePrice(line.basePrice);
    const custom = line.type === 'service' && line.customPrice !== undefined && line.customCurrency === saleCurrency;
    return { ...line, catalogPrice, price: custom ? line.customPrice! : catalogPrice, modified: custom && line.customPrice !== catalogPrice };
  });
  const serviceOptions = catalog.filter((entry) => entry.type === 'service');
  const productOptions = catalog.filter((entry) => entry.type === 'product');
  const total = roundMoney(pricedCart.reduce((sum, line) => sum + roundMoney(line.price * line.quantity, saleCurrency), 0), saleCurrency);
  const paidPreview = amountPaid === '' ? total : Number(amountPaid);
  const activeSales = sales.filter((sale) => sale.status !== 'refunded');
  // Cancelled sales are not counted: they no longer bring anything in.
  const receivedToday = (target: Currency) => todayReport?.byCurrency[target].amountReceived ?? 0;
  const expensesToday = (target: Currency) => todayReport?.byCurrency[target].totalExpenses ?? 0;
  const lowStock = products.filter((product) => product.status === 'active' && product.quantityStock > 0 && product.quantityStock <= product.lowStockThreshold);
  const clientLabel = (sale: Sale) => sale.clientName ?? clients.find((client) => client.id === sale.clientId)?.name ?? 'Client de passage';
  const money = (value: number | string) => formatCurrency(value, saleCurrency);

  const inCart = (key: string) => cart.find((line) => lineKey(line) === key)?.quantity ?? 0;

  const chooseService = (key: string) => {
    setServiceKey(key);
    const selected = serviceOptions.find((entry) => lineKey(entry) === key);
    setServicePrice(selected ? String(selected.price) : '');
  };

  // Adds the chosen service at the price shown (the catalogue price unless the cashier changed it).
  const addService = () => {
    const selected = serviceOptions.find((entry) => lineKey(entry) === serviceKey);
    const price = roundMoney(Number(servicePrice), saleCurrency);
    if (!selected) {
      notify('Choisissez une prestation dans la liste.', 'error');
      return;
    }
    if (servicePrice === '' || !Number.isFinite(price) || price < 0) {
      notify('Saisissez un prix valide pour la prestation.', 'error');
      return;
    }
    const custom = price !== selected.price ? { customPrice: price, customCurrency: saleCurrency } : { customPrice: undefined, customCurrency: undefined };
    setCart((current) => current.some((line) => lineKey(line) === serviceKey)
      ? current.map((line) => lineKey(line) === serviceKey ? { ...line, ...custom, quantity: line.quantity + 1 } : line)
      : [...current, { type: 'service', itemId: selected.itemId, audience: selected.audience, name: selected.name, basePrice: selected.basePrice, quantity: 1, ...custom }]);
    setServiceKey('');
    setServicePrice('');
  };

  const addProduct = () => {
    const selected = productOptions.find((entry) => lineKey(entry) === productKey);
    const count = Number(quantity);
    if (!selected || !Number.isInteger(count) || count < 1) {
      notify('Choisissez un produit et une quantité entière.', 'error');
      return;
    }
    if (inCart(productKey) + count > selected.stock) {
      notify(`Stock insuffisant : ${selected.stock} ${selected.name} disponible(s).`, 'error');
      return;
    }
    setCart((current) => current.some((line) => lineKey(line) === productKey)
      ? current.map((line) => lineKey(line) === productKey ? { ...line, quantity: line.quantity + count } : line)
      : [...current, { type: 'product', itemId: selected.itemId, name: selected.name, basePrice: selected.basePrice, quantity: count }]);
    setProductKey('');
    setQuantity('1');
  };

  // Changes the price of a service already in the cart (empty field: back to the catalogue price).
  const setLinePrice = (key: string, value: string) => {
    setCart((current) => current.map((line) => {
      if (lineKey(line) !== key) return line;
      if (value === '') return { ...line, customPrice: undefined, customCurrency: undefined };
      const price = Number(value);
      return Number.isFinite(price) && price >= 0 ? { ...line, customPrice: price, customCurrency: saleCurrency } : line;
    }));
  };

  const changeQuantity = (key: string, delta: number) => {
    const entry = catalog.find((item) => lineKey(item) === key);
    setCart((current) => current
      .map((line) => lineKey(line) === key ? { ...line, quantity: Math.min(line.quantity + delta, entry?.stock ?? Infinity) } : line)
      .filter((line) => line.quantity > 0));
  };

  const clearSale = () => {
    setCart([]);
    setAmountPaid('');
    setClientId('');
    setGuestClientName('');
  };

  const checkout = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!cart.length) {
      notify('Ajoutez au moins un article à la vente.', 'error');
      return;
    }
    const missing = cart.find((line) => !catalog.some((entry) => lineKey(entry) === lineKey(line)));
    if (pricedCart.some((line) => !Number.isFinite(line.price) || line.price < 0)) {
      notify('Un prix de prestation est invalide.', 'error');
      return;
    }
    if (missing) {
      notify(`« ${missing.name} » n’est plus disponible : retirez-le du panier.`, 'error');
      return;
    }
    const paid = paidPreview;
    if (!Number.isFinite(paid) || paid < 0 || paid > total) {
      notify('Le montant reçu doit être compris entre zéro et le total.', 'error');
      return;
    }
    setSaving(true);
    try {
      const { data: sale } = await apiClient.post<Sale & { stockAlerts?: StockAlert[] }>('/sales', {
        clientId: clientId || undefined,
        clientName: guestClientName.trim() || undefined,
        // The API prices the sale from the catalogue and refuses it if its total differs from the one
        // shown here (rate or prices changed meanwhile on another device).
        staffId: staffId || undefined, paymentMethod, amountPaid: paid, expectedTotal: total,
        currency: saleCurrency,
        // Service prices changed by the cashier are sent; the API keeps the catalogue price alongside.
        items: pricedCart.map(({ type, itemId, audience, quantity: count, price, modified }) => ({
          type, itemId, audience, quantity: count, ...(type === 'service' && modified && { unitPrice: roundMoney(price, saleCurrency) }),
        })),
      });
      clearSale();
      setLastSale(sale);
      setReceiptId(sale.id);
      notify(`Vente ${formatReceiptNumber(sale.receiptNumber)} enregistrée.`);
      if (sale.items?.some((item) => item.type === 'product')) notifyStockChanged();
      await load();
      for (const alert of sale.stockAlerts ?? []) {
        notify(alert.level === 'out'
          ? `Rupture de stock : « ${alert.name} » est épuisé. Réapprovisionnez-le.`
          : `Stock bas : « ${alert.name} » n’a plus que ${alert.quantityStock} unité(s) (seuil ${alert.lowStockThreshold}).`, 'error');
      }
    } catch (requestError) {
      notify(getApiError(requestError, 'Vente refusée. Vérifiez le stock, le client et le mode de paiement.'), 'error');
      // Prices or rate changed elsewhere: refresh them so that the cart shows what the API will charge.
      if (isAxiosError(requestError) && requestError.response?.status === 409) await Promise.all([load(), loadSettings()]).catch(() => undefined);
    } finally {
      setSaving(false);
    }
  };

  const createExpense = async (event: FormEvent) => {
    event.preventDefault();
    setSavingExpense(true);
    try {
      await apiClient.post('/expenses', { ...expenseDraft, amount: Number(expenseDraft.amount), currency });
      notify(`Dépense « ${expenseDraft.description} » enregistrée.`);
      setExpenseDraft(emptyExpense);
      await load();
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible d’enregistrer la dépense.'), 'error');
    } finally {
      setSavingExpense(false);
    }
  };

  // Expenses are cancelled, not erased: they stay in the daily history.
  const cancelExpense = async (expense: Expense) => {
    if (!await confirm({ title: 'Annuler cette dépense ?', message: `${expense.description} · ${formatCurrency(expense.amount, expense.currency)}. Elle restera visible dans l’historique, marquée annulée.`, confirmLabel: 'Annuler la dépense', danger: true })) return;
    try {
      await apiClient.post(`/expenses/${expense.id}/cancel`, {});
      notify('Dépense annulée.');
      await load();
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible d’annuler la dépense.'), 'error');
    }
  };

  return (
    <section className="space-y-5 till">
      <PageHeader
        back="/dashboard"
        eyebrow="Encaissement"
        title="Caisse"
        subtitle="Prestations et produits, paiement complet ou partiel, reçu."
        actions={<>
          <Link to="/ventes" className="btn btn-secondary btn-sm">Toutes les ventes</Link>
          {canRecordCash && <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCashOperation('in')}>Entrée</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCashOperation('out')}>Sortie</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCashOperation('count')}>Comptage</button>
          </>}
        </>}
      />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {/* Sold-out products: red alert shown on every page (layout). */}
      {lowStock.length > 0 && <p role="status" className="till-alert">
        <span className="tone-expense">Stock bas : {lowStock.map((product) => `${product.name} (${product.quantityStock})`).join(', ')}.</span>
      </p>}

      <div className="kpi-grid kpi-grid-4 kpi-compact" aria-label="Caisse du jour">
        <StatCard label="Ventes du jour" value={activeSales.length} />
        {(['USD', 'CDF'] as Currency[]).map((value) => <StatCard key={value} label={`Encaissé · ${value}`} value={formatCurrency(receivedToday(value), value)} />)}
        <StatCard tone="expense" label="Dépenses du jour" value={<span className="money-stack"><span>{formatCurrency(expensesToday('USD'), 'USD')}</span><span>{formatCurrency(expensesToday('CDF'), 'CDF')}</span></span>} />
      </div>

      {lastSale && <p role="status" className="till-last">
        Dernière vente : <strong>{formatReceiptNumber(lastSale.receiptNumber)}</strong> · {formatCurrency(lastSale.totalAmount, (lastSale.currency ?? currency) as Currency)}
        <button type="button" className="link-button" onClick={() => setReceiptId(lastSale.id)}>Reçu</button>
        <Link to="/ventes" className="link-button">Consulter la transaction</Link>
      </p>}

      {loading ? <p className="loading-line">Chargement de la caisse…</p> : <div className="till-grid">
        <form onSubmit={checkout} className="panel till-panel">
          <div className="panel-header"><h2 className="section-title">Nouvelle vente</h2>{cart.length > 0 && <button type="button" className="link-button is-danger" onClick={() => setCart([])}>Vider</button>}</div>
          <div className="till-fields">
            <label className="field">Client
              <select value={clientId} onChange={(event) => { setClientId(event.target.value); if (event.target.value) setGuestClientName(''); }}>
                <option value="">Client de passage</option>
                {clients.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.phone}</option>)}
              </select>
            </label>
            {!clientId && <label className="field">Nom (facultatif)<input placeholder="Client de passage" value={guestClientName} onChange={(event) => setGuestClientName(event.target.value)} /></label>}
            <label className="field">Réalisé par
              <select value={staffId} onChange={(event) => setStaffId(event.target.value)}>
                <option value="">Non attribué</option>
                {staff.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </select>
            </label>
          </div>
          {!staffId && cart.some((line) => line.type === 'service') && <p className="field-hint">Attribuez la prestation à un membre de l’équipe pour qu’elle apparaisse dans son historique et sa commission.</p>}

          <div className="till-picker-group">
            <label className="field">Prestation
              <select value={serviceKey} onChange={(event) => chooseService(event.target.value)}>
                <option value="">Choisir une prestation</option>
                {serviceOptions.map((entry) => <option key={lineKey(entry)} value={lineKey(entry)}>{entry.name} · {money(entry.price)}</option>)}
              </select>
            </label>
            <label className="field till-price-field">Prix ({saleCurrency})
              <input type="number" min="0" step={saleCurrency === 'CDF' ? '1' : '0.01'} disabled={!serviceKey} value={servicePrice} onChange={(event) => setServicePrice(event.target.value)} />
            </label>
            <button type="button" className="btn btn-secondary btn-sm" disabled={!serviceKey} onClick={addService}>Ajouter</button>
          </div>
          {serviceKey && Number(servicePrice) !== serviceOptions.find((entry) => lineKey(entry) === serviceKey)?.price && servicePrice !== '' &&
            <p className="field-hint">Prix modifié : catalogue {money(serviceOptions.find((entry) => lineKey(entry) === serviceKey)!.price)}.</p>}
          <div className="till-picker-group">
            <label className="field">Produit
              <select value={productKey} onChange={(event) => setProductKey(event.target.value)}>
                <option value="">Choisir un produit</option>
                {productOptions.map((entry) => <option key={lineKey(entry)} disabled={entry.stock < 1} value={lineKey(entry)}>{entry.name} · {money(entry.price)} · {entry.stock < 1 ? 'épuisé' : `stock ${entry.stock}`}</option>)}
              </select>
            </label>
            <label className="field till-price-field">Quantité<input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
            <button type="button" className="btn btn-secondary btn-sm" disabled={!productKey} onClick={addProduct}>Ajouter</button>
          </div>

          <div className="till-lines">
            {pricedCart.map((line) => {
              const key = lineKey(line);
              return <div key={key} className="till-line">
                <div className="min-w-0">
                  <p className="cell-title truncate">{line.name}</p>
                  {line.type === 'service'
                    ? <label className="till-line-price">
                      <LinePriceInput label={`Prix de ${line.name}`} value={line.price} step={saleCurrency === 'CDF' ? '1' : '0.01'} onCommit={(price) => setLinePrice(key, String(price))} />
                      <span className="cell-sub">{saleCurrency} l’unité{line.modified
                        ? <> · <button type="button" className="link-button tone-expense" onClick={() => setLinePrice(key, '')}>prix catalogue {money(line.catalogPrice)}</button></>
                        : converting ? <> · catalogue {formatCurrency(line.basePrice, currency)}</> : null}</span>
                    </label>
                    : <p className="cell-sub">{money(line.price)} l’unité{converting && <> · catalogue {formatCurrency(line.basePrice, currency)}</>}</p>}
                </div>
                <span className="till-qty">
                  <button type="button" aria-label={`Retirer un ${line.name}`} onClick={() => changeQuantity(key, -1)}>−</button>
                  <span>{line.quantity}</span>
                  <button type="button" aria-label={`Ajouter un ${line.name}`} onClick={() => changeQuantity(key, 1)}>+</button>
                </span>
                <span className="till-amount">{money(roundMoney(line.quantity * line.price, saleCurrency))}</span>
              </div>;
            })}
            {!cart.length && <EmptyState title="Le panier est vide." hint="Choisissez un article ci-dessus ou depuis la Boutique." />}
          </div>

          <div className="till-fields">
            <label className="field">Devise
              <select value={saleCurrency} onChange={(event) => { setSaleCurrency(event.target.value as Currency); setAmountPaid(''); }}>
                <option value={currency}>{currencyLabels[currency]}</option>
                <option value={otherCurrency(currency)} disabled={!exchangeRate}>{currencyLabels[otherCurrency(currency)]}{!exchangeRate ? ' · taux requis' : ''}</option>
              </select>
            </label>
            <label className="field">Paiement
              <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as Sale['paymentMethod'])}>
                {paymentOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="field">Reçu ({saleCurrency})
              <input type="number" min="0" max={total} step={saleCurrency === 'CDF' ? '1' : '0.01'} value={amountPaid} onChange={(event) => setAmountPaid(event.target.value)} placeholder={`${total} (complet)`} />
            </label>
          </div>
          {converting && exchangeRate && <p className="field-hint">Conversion demandée : prix catalogue en {currency} convertis en {saleCurrency} au taux du salon, 1 USD = {new Intl.NumberFormat('fr-FR').format(exchangeRate)} CDF.</p>}
          {amountPaid !== '' && paidPreview < total && <p className="field-hint tone-expense">Paiement partiel : reste dû {money(total - paidPreview)} (enregistré comme dette du client).</p>}

          <div className="till-total"><span>Total</span><strong>{money(total)}</strong></div>
          <button type="submit" className="btn btn-primary w-full" disabled={saving || !cart.length}>{saving ? 'Enregistrement…' : `Valider la vente · ${money(total)}`}</button>
        </form>

        <div className="space-y-5">
          <section className="panel till-panel">
            <div className="panel-header"><h2 className="section-title">Ventes du jour</h2><Link to="/ventes" className="link-button">Historique</Link></div>
            <div className="list-rows">
              {activeSales.slice(0, 8).map((sale) => <div key={sale.id} className="list-row till-sale">
                <div className="min-w-0">
                  <p className="cell-title truncate">{formatReceiptNumber(sale.receiptNumber)} · {clientLabel(sale)}</p>
                  <p className="cell-sub">{formatTime(sale.saleDate)} · {paymentMethodLabels[sale.paymentMethod]}{Number(sale.remainingAmount) > 0 && <> · <span className="tone-expense">reste {formatCurrency(sale.remainingAmount, (sale.currency ?? currency) as Currency)}</span></>}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end">
                  <Money value={sale.totalAmount} currency={(sale.currency ?? currency) as Currency} />
                  <span className="row-actions">
                    <button type="button" className="link-button" onClick={() => setReceiptId(sale.id)}>Reçu</button>
                    {Number(sale.remainingAmount) > 0 && <button type="button" className="link-button" onClick={() => setSettling(sale)}>Encaisser</button>}
                    {isAdmin && <button type="button" className="link-button is-danger" onClick={() => setCancelling(sale)}>Annuler</button>}
                  </span>
                </div>
              </div>)}
              {!activeSales.length && <EmptyState title="Aucune vente active aujourd’hui." />}
            </div>
          </section>

          <section className="panel till-panel">
            <div className="panel-header"><h2 className="section-title">Dépense</h2></div>
            <form onSubmit={createExpense} className="till-fields">
              <label className="field">Libellé<input required maxLength={255} value={expenseDraft.description} onChange={(event) => setExpenseDraft({ ...expenseDraft, description: event.target.value })} placeholder="Ex. électricité" /></label>
              <label className="field">Catégorie<input required maxLength={100} value={expenseDraft.category} onChange={(event) => setExpenseDraft({ ...expenseDraft, category: event.target.value })} /></label>
              <label className="field">Montant ({currency})<input required type="number" min="0.01" step={currency === 'CDF' ? '1' : '0.01'} value={expenseDraft.amount} onChange={(event) => setExpenseDraft({ ...expenseDraft, amount: event.target.value })} /></label>
              <label className="field">Paiement
                <select value={expenseDraft.paymentMethod} onChange={(event) => setExpenseDraft({ ...expenseDraft, paymentMethod: event.target.value as Sale['paymentMethod'] })}>
                  {paymentOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <button type="submit" className="btn btn-secondary btn-sm field-wide" disabled={savingExpense}>{savingExpense ? 'Enregistrement…' : 'Ajouter la dépense'}</button>
            </form>
            {expenses.length > 0 && <div className="list-rows mt-3">
              {expenses.slice(0, 6).map((expense) => <div key={expense.id} className={`list-row${expense.cancelledAt ? ' is-cancelled' : ''}`}>
                <div><p className="cell-title">{expense.description}</p><p className="cell-sub">{expense.category} · {formatTime(expense.createdAt)}{expense.cancelledAt && ' · annulée'}</p></div>
                <span className="flex items-center gap-2"><Money value={expense.amount} currency={expense.currency} tone={expense.cancelledAt ? 'muted' : 'expense'} />{isAdmin && !expense.cancelledAt && <button type="button" aria-label={`Annuler la dépense ${expense.description}`} className="link-button is-danger" onClick={() => void cancelExpense(expense)}>Annuler</button>}</span>
              </div>)}
            </div>}
          </section>
        </div>
      </div>}

      {receiptId && <ReceiptModal saleId={receiptId} onClose={() => setReceiptId(null)} />}
      {cancelling && <CancelSaleDialog sale={cancelling} onClose={() => setCancelling(null)} onDone={() => { setCancelling(null); void load(); }} />}
      {settling && <DebtPaymentDialog sale={settling} onClose={() => setSettling(null)} onDone={() => { setSettling(null); void load(); }} />}
      {cashOperation && <CashOperationDialog kind={cashOperation} baseCurrency={currency} onClose={() => setCashOperation(null)} />}
    </section>
  );
};

// Cash entries and withdrawals that are not sales nor expenses, and the drawer count.
const CashOperationDialog = ({ kind, baseCurrency, onClose }: { kind: 'in' | 'out' | 'count'; baseCurrency: Currency; onClose: () => void }) => {
  const { notify } = useFeedback();
  const [currency, setCurrency] = useState<Currency>(baseCurrency);
  const [amount, setAmount] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0 || (kind !== 'count' && value === 0)) {
      notify('Saisissez un montant valide.', 'error');
      return;
    }
    setSaving(true);
    try {
      if (kind === 'count') {
        const { data } = await apiClient.post<{ expectedAmount: string; difference: number }>('/cash/counts', { currency, countedAmount: value, note: text || undefined });
        notify(data.difference === 0
          ? `Caisse juste : ${formatCurrency(value, currency)}.`
          : `Écart de ${formatCurrency(data.difference, currency)} (attendu ${formatCurrency(data.expectedAmount, currency)}, compté ${formatCurrency(value, currency)}).`, data.difference === 0 ? 'success' : 'error');
      } else {
        await apiClient.post('/cash/adjustments', { direction: kind, amount: value, currency, reason: text });
        notify(`${kind === 'in' ? 'Entrée' : 'Sortie'} de ${formatCurrency(value, currency)} enregistrée.`);
      }
      onClose();
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible d’enregistrer cette opération.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const title = kind === 'in' ? 'Entrée de caisse' : kind === 'out' ? 'Sortie de caisse' : 'Comptage de la caisse';
  return (
    <Modal size="sm" title={title} description={kind === 'count' ? 'Espèces réellement présentes, comparées au solde théorique des opérations en espèces du jour.' : 'Hors ventes, dépenses et rémunérations, qui sont enregistrées automatiquement.'} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <label className="field">Devise
          <select value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}>
            <option value="USD">{currencyLabels.USD}</option>
            <option value="CDF">{currencyLabels.CDF}</option>
          </select>
        </label>
        <label className="field">{kind === 'count' ? 'Montant compté' : 'Montant'} ({currency})<input required type="number" min="0" step={currency === 'CDF' ? '1' : '0.01'} value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label className="field">{kind === 'count' ? 'Remarque (facultatif)' : 'Motif'}<input required={kind !== 'count'} maxLength={255} placeholder={kind === 'in' ? 'Ex. fond de caisse' : kind === 'out' ? 'Ex. dépôt en banque' : ''} value={text} onChange={(event) => setText(event.target.value)} /></label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </form>
    </Modal>
  );
};
