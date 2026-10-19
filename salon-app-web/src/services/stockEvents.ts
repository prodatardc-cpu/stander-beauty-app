// Sent after anything that changes stock (sale, cancellation, reception, inventory) so that the
// out-of-stock alert shown on every page refreshes at once.
export const stockChangedEvent = 'stander-stock-changed';

export const notifyStockChanged = () => window.dispatchEvent(new Event(stockChangedEvent));
