import { useEffect, type ReactNode } from 'react';
import { loadSettings } from '../../services/currency';
import { Navbar } from './navbar';
import { Sidebar } from './sidebar';
import { StockAlert } from './StockAlert';

interface LayoutProps {
  children: ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
  // Salon settings (base currency, USD/CDF rate) are shared by every device: read them when the
  // app opens and whenever the window comes back to the foreground, to pick up changes made elsewhere.
  useEffect(() => {
    const refresh = () => { void loadSettings().catch(() => undefined); };
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  return (
    <div className="studio-shell">
      <Sidebar />
      <div className="studio-main">
        <Navbar />
        <main className="workspace-main">
          <StockAlert />
          {children}
        </main>
      </div>
    </div>
  );
};
