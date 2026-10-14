import type { ReactNode } from 'react';
import { Navbar } from './navbar';
import { Sidebar } from './sidebar';

interface LayoutProps {
  children: ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
  return (
    <div className="studio-shell">
      <Sidebar />
      <div className="studio-main">
        <Navbar />
        <main className="workspace-main">
          {children}
        </main>
      </div>
    </div>
  );
};