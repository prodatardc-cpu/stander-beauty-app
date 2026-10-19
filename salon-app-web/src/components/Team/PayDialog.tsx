import { useRef, useState, type FormEvent } from 'react';
import { isAxiosError } from 'axios';
import type { Sale, StaffPay } from '../../types';
import { apiClient, getApiError } from '../../services/api';
import { currencyLabels, formatCurrency, useCurrency, type Currency } from '../../services/currency';
import { paymentMethodLabels, periodLabel } from '../../utils/format';
import { useFeedback } from '../UI/Feedback';
import { Modal } from '../UI/Modal';

const paymentOptions = Object.entries(paymentMethodLabels) as [Sale['paymentMethod'], string][];

/**
 * Pays a member (or gives an advance) in one currency, after a summary of what they earned, received
 * and are still owed. A payment cannot exceed what is due (checked again by the API); the same
 * idempotency key is reused while a payment is retried, so a double click or a network retry pays once.
 */
export const PayDialog = ({ pay, onClose, onDone }: { pay: StaffPay; onClose: () => void; onDone: () => void }) => {
  const baseCurrency = useCurrency();
  const { notify } = useFeedback();
  const fixed = pay.payType === 'fixed';
  const firstDue = (['USD', 'CDF'] as Currency[]).find((value) => pay.byCurrency[value].remaining > 0);
  const [currency, setCurrency] = useState<Currency>(fixed ? baseCurrency : firstDue ?? baseCurrency);
  const [kind, setKind] = useState<'payment' | 'advance'>(pay.byCurrency[currency].remaining > 0 ? 'payment' : 'advance');
  const [amount, setAmount] = useState(() => String(Math.max(0, pay.byCurrency[currency].remaining)));
  const [paymentMethod, setPaymentMethod] = useState<Sale['paymentMethod']>('cash');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const intent = useRef<{ key: string; signature: string } | null>(null);

  const amounts = pay.byCurrency[currency];
  const due = Math.max(0, amounts.remaining);
  const money = (value: number) => formatCurrency(value, currency);

  const changeCurrency = (next: Currency) => {
    setCurrency(next);
    const nextDue = Math.max(0, pay.byCurrency[next].remaining);
    setAmount(String(nextDue));
    setKind(nextDue > 0 ? 'payment' : 'advance');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      notify('Saisissez un montant supérieur à zéro.', 'error');
      return;
    }
    if (kind === 'payment' && value > due) {
      notify(`Le paiement ne peut pas dépasser le solde dû (${money(due)}). Utilisez une avance pour verser davantage.`, 'error');
      return;
    }
    const signature = `${kind}:${currency}:${value}`;
    if (!intent.current || intent.current.signature !== signature) intent.current = { key: crypto.randomUUID(), signature };
    setSaving(true);
    try {
      await apiClient.post(`/payroll/${pay.staffId}/payouts`, { kind, amount: value, currency, paymentMethod, note: note.trim() || undefined }, { 'Idempotency-Key': intent.current.key });
      intent.current = null;
      notify(kind === 'advance'
        ? `Avance de ${money(value)} versée à ${pay.name}.`
        : value === due ? `${pay.name} est payé(e) : solde à zéro.` : `${money(value)} payés à ${pay.name}. Reste ${money(due - value)}.`);
      onDone();
    } catch (requestError) {
      if (!isAxiosError(requestError) || requestError.response) intent.current = null;
      notify(getApiError(requestError, 'Impossible d’enregistrer ce paiement.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Payer ${pay.name}`} description={periodLabel(pay)} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        {!fixed && <label className="field">Devise
          <select value={currency} onChange={(event) => changeCurrency(event.target.value as Currency)}>
            {(['USD', 'CDF'] as Currency[]).map((value) => <option key={value} value={value}>{currencyLabels[value]} · dû {formatCurrency(Math.max(0, pay.byCurrency[value].remaining), value)}</option>)}
          </select>
        </label>}
        <dl className="pay-summary">
          <div><dt>{fixed ? 'Salaire du mois' : `Prestations éligibles (${pay.commissionRate} %)`}</dt><dd>{fixed ? money(amounts.period.earned) : money(amounts.period.eligibleRevenue)}</dd></div>
          {!fixed && <div><dt>Rémunération acquise sur la période</dt><dd>{money(amounts.period.earned)}</dd></div>}
          {!fixed && amounts.carriedOver !== 0 && <div><dt>{amounts.carriedOver > 0 ? 'Reste des périodes précédentes' : 'Avance des périodes précédentes'}</dt><dd>{money(amounts.carriedOver)}</dd></div>}
          <div><dt>Avances reçues sur la période</dt><dd>− {money(amounts.period.advances)}</dd></div>
          <div><dt>Paiements déjà effectués sur la période</dt><dd>− {money(amounts.period.payments)}</dd></div>
          <div className="pay-due"><dt>Solde à payer</dt><dd>{money(amounts.remaining)}</dd></div>
        </dl>
        <div className="form-grid">
          <label className="field">Type de versement
            <select value={kind} onChange={(event) => setKind(event.target.value as 'payment' | 'advance')}>
              <option value="payment" disabled={due <= 0}>Paiement de la rémunération</option>
              <option value="advance">Avance</option>
            </select>
          </label>
          <label className="field">Montant versé ({currency})<input required type="number" min="0" max={kind === 'payment' ? due : undefined} step={currency === 'CDF' ? '1' : '0.01'} value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <label className="field">Mode de paiement
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as Sale['paymentMethod'])}>
              {paymentOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">Note (facultatif)<input maxLength={255} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        </div>
        <p className="field-hint">Le versement est enregistré comme sortie de caisse ({paymentMethodLabels[paymentMethod].toLowerCase()}) et apparaît dans l’historique du jour.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Enregistrement…' : kind === 'advance' ? 'Verser l’avance' : 'Confirmer le paiement'}</button>
        </div>
      </form>
    </Modal>
  );
};
