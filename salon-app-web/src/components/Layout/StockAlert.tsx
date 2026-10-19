import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Product } from '../../types';
import { apiClient } from '../../services/api';
import { stockChangedEvent } from '../../services/stockEvents';

// Red alert shown on every page while products on sale are out of stock. Refreshed when the app
// opens, when the window comes back to the foreground and after every stock change made here.
export const StockAlert = () => {
  const [soldOut, setSoldOut] = useState<Product[]>([]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      apiClient.get<Product[]>('/products')
        .then(({ data }) => { if (active) setSoldOut(data.filter((product) => product.status === 'active' && product.quantityStock <= 0)); })
        .catch(() => undefined);
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener(stockChangedEvent, refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      window.removeEventListener(stockChangedEvent, refresh);
    };
  }, []);

  if (!soldOut.length) return null;
  return (
    <div role="alert" className="stock-alert">
      <strong>Rupture de stock :</strong> {soldOut.map((product) => product.name).join(', ')}.
      <Link to="/boutique" className="stock-alert-link">Réapprovisionner</Link>
    </div>
  );
};
