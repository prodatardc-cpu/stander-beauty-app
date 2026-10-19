import { useEffect, useState } from 'react';
import type { SaleReceipt } from '../../types';
import { apiClient, getApiError } from '../../services/api';
import { currencyLabels, formatCurrency, type Currency } from '../../services/currency';
import { formatDateTime, formatReceiptNumber, paymentMethodLabels } from '../../utils/format';
import { Modal } from '../UI/Modal';



const audienceLabel = (audience?: 'women' | 'men' | null) => (audience === 'women' ? ' · Femmes' : audience === 'men' ? ' · Hommes' : '');

// The printable receipt. Amounts stay in the sale's currency: nothing is converted here.
export const Receipt = ({ sale }: { sale: SaleReceipt }) => {
  const currency = (sale.currency ?? 'USD') as Currency;
  const money = (value: number | string) => formatCurrency(value, currency);
  const discount = Number(sale.discountAmount ?? 0);
  const remaining = Number(sale.remainingAmount);
  const payments = sale.payments ?? [];
  const { business } = sale;
  return (
    <article className="receipt printable" aria-label={`Reçu ${formatReceiptNumber(sale.receiptNumber)}`}>
      <header className="receipt-head">
        <img src="/logo1.png" alt="" className="receipt-logo" />
        <strong>{business.businessName}</strong>
        {business.businessAddress && <span>{business.businessAddress}</span>}
        {(business.businessPhone || business.businessEmail) && <span>{[business.businessPhone, business.businessEmail].filter(Boolean).join(' · ')}</span>}
        {business.taxId && <span>N° d’impôt (NIF) : {business.taxId}</span>}
      </header>

      {sale.status === 'refunded' && <p className="receipt-cancelled">Vente annulée le {formatDateTime(sale.cancelledAt)}{sale.cancelReason ? ` · ${sale.cancelReason}` : ''}</p>}

      <dl className="receipt-meta">
        <div><dt>Reçu</dt><dd>{formatReceiptNumber(sale.receiptNumber)}</dd></div>
        <div><dt>Date</dt><dd>{formatDateTime(sale.saleDate)}</dd></div>
        <div><dt>Client</dt><dd>{sale.clientLabel ?? 'Client de passage'}</dd></div>
        {sale.staffName && <div><dt>Réalisé par</dt><dd>{sale.staffName}</dd></div>}
        {sale.createdByEmail && <div><dt>Caisse</dt><dd>{sale.createdByEmail}</dd></div>}
        <div><dt>Devise</dt><dd>{currencyLabels[currency]}</dd></div>
      </dl>

      <table className="receipt-lines">
        <thead><tr><th>Article</th><th className="num">Qté</th><th className="num">P.U.</th><th className="num">Montant</th></tr></thead>
        <tbody>{(sale.items ?? []).map((item) => (
          <tr key={item.id}>
            <td>{item.itemName ?? (item.type === 'service' ? 'Prestation' : 'Produit')}{audienceLabel(item.audience)}</td>
            <td className="num">{item.quantity}</td>
            <td className="num">{money(item.unitPrice)}</td>
            <td className="num">{money(item.subtotal)}</td>
          </tr>
        ))}</tbody>
      </table>

      <div className="receipt-totals">
        {discount > 0 && <div className="receipt-line"><span>Réduction</span><span>− {money(discount)}</span></div>}
        <div className="receipt-line receipt-total"><span>Total ({currency})</span><span>{money(sale.totalAmount)}</span></div>
        {payments.length > 1
          ? payments.map((payment) => <div key={payment.id} className="receipt-line"><span>{payment.kind === 'debt' ? 'Règlement' : 'Payé'} le {formatDateTime(payment.createdAt)} · {paymentMethodLabels[payment.paymentMethod]}</span><span>{money(payment.amount)}</span></div>)
          : <div className="receipt-line"><span>Payé · {paymentMethodLabels[sale.paymentMethod]}</span><span>{money(sale.amountPaid)}</span></div>}
        {remaining > 0 && <div className="receipt-line receipt-due"><span>Reste à payer</span><span>{money(remaining)}</span></div>}
      </div>
      <p className="receipt-foot">Merci de votre visite.</p>
    </article>
  );
};

// Loads a sale and shows its receipt, ready to print (or to save as PDF from the print dialog).
export const ReceiptModal = ({ saleId, onClose }: { saleId: string; onClose: () => void }) => {
  const [sale, setSale] = useState<SaleReceipt | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    apiClient.get<SaleReceipt>(`/sales/${saleId}`)
      .then(({ data }) => { if (active) setSale(data); })
      .catch((requestError) => { if (active) setError(getApiError(requestError, 'Impossible de charger ce reçu.')); });
    return () => { active = false; };
  }, [saleId]);

  return (
    <Modal
      size="sm"
      title={sale ? `Reçu ${formatReceiptNumber(sale.receiptNumber)}` : 'Reçu'}
      onClose={onClose}
      footer={sale && <>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Fermer</button>
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>Imprimer ou enregistrer en PDF</button>
      </>}
    >
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : sale ? <Receipt sale={sale} /> : <p className="loading-line">Chargement du reçu…</p>}
    </Modal>
  );
};
