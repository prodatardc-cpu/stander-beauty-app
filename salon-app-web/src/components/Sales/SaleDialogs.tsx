import { useRef, useState, type FormEvent } from 'react';
import { isAxiosError } from 'axios';
import type { Sale } from '../../types';
import { apiClient, getApiError } from '../../services/api';
import { formatCurrency, type Currency } from '../../services/currency';
import { formatDateTime, formatReceiptNumber, paymentMethodLabels } from '../../utils/format';
import { useFeedback } from '../UI/Feedback';
import { Modal } from '../UI/Modal';
import { notifyStockChanged } from '../../services/stockEvents';

const paymentOptions = Object.entries(paymentMethodLabels) as [Sale['paymentMethod'], string][];

// Cancelling keeps the sale on record (marked cancelled, with the reason): stock, figures and the
// client's total are corrected by the API, and what was paid appears as a refund in the cash journal.
export const CancelSaleDialog = ({ sale, onClose, onDone }: { sale: Sale; onClose: () => void; onDone: () => void }) => {
  const { notify } = useFeedback();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const currency = (sale.currency ?? 'USD') as Currency;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await apiClient.post(`/sales/${sale.id}/cancel`, { reason: reason.trim() || undefined });
      notify(`Vente ${formatReceiptNumber(sale.receiptNumber)} annulée. Le stock et les totaux ont été corrigés.`);
      notifyStockChanged();
      onDone();
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible d’annuler cette vente.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal size="sm" title="Annuler cette vente ?" description={`${formatReceiptNumber(sale.receiptNumber)} · ${formatDateTime(sale.saleDate)} · ${formatCurrency(sale.totalAmount, currency)}`} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <p className="text-sm text-gray-700">
          La vente ne comptera plus dans aucun total (encaissé, caisse, chiffre d’affaires). Les produits retournent en stock et la commission est retirée.
          {Number(sale.amountPaid) > 0 ? ` Rendez au client les ${formatCurrency(sale.amountPaid, currency)} déjà encaissés.` : ''} Elle reste visible 7 jours dans l’Historique et dans « Annulées », puis disparaît.
        </p>
        <label className="field">Motif (facultatif)<input maxLength={255} placeholder="Ex. erreur de saisie, client parti…" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Garder la vente</button>
          <button type="submit" className="btn btn-danger" disabled={saving}>{saving ? 'Annulation…' : 'Annuler la vente'}</button>
        </div>
      </form>
    </Modal>
  );
};

// Records all or part of what a client still owes on a sale, in the sale's currency.
export const DebtPaymentDialog = ({ sale, onClose, onDone }: { sale: Sale; onClose: () => void; onDone: () => void }) => {
  const { notify } = useFeedback();
  const currency = (sale.currency ?? 'USD') as Currency;
  const remaining = Number(sale.remainingAmount);
  const [amount, setAmount] = useState(String(remaining));
  const [paymentMethod, setPaymentMethod] = useState<Sale['paymentMethod']>('cash');
  const [saving, setSaving] = useState(false);
  // Same key while the same payment is retried after a network failure: it is recorded once.
  const intent = useRef<{ key: string; amount: number } | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > remaining) {
      notify(`Saisissez un montant entre 0 et ${formatCurrency(remaining, currency)}.`, 'error');
      return;
    }
    if (!intent.current || intent.current.amount !== value) intent.current = { key: crypto.randomUUID(), amount: value };
    setSaving(true);
    try {
      await apiClient.post(`/sales/${sale.id}/payments`, { amount: value, paymentMethod }, { 'Idempotency-Key': intent.current.key });
      intent.current = null;
      notify(value === remaining ? 'Dette soldée.' : `${formatCurrency(value, currency)} encaissés. Reste ${formatCurrency(remaining - value, currency)}.`);
      onDone();
    } catch (requestError) {
      if (!isAxiosError(requestError) || requestError.response) intent.current = null;
      notify(getApiError(requestError, 'Impossible d’enregistrer ce règlement.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal size="sm" title="Encaisser un règlement" description={`${formatReceiptNumber(sale.receiptNumber)} · reste ${formatCurrency(remaining, currency)}`} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <label className="field">Montant reçu ({currency})<input required type="number" min="0" max={remaining} step={currency === 'CDF' ? '1' : '0.01'} value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label className="field">Mode de paiement
          <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as Sale['paymentMethod'])}>
            {paymentOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Fermer</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Enregistrement…' : 'Encaisser'}</button>
        </div>
      </form>
    </Modal>
  );
};
