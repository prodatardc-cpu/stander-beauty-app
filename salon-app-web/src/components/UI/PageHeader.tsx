import type { ReactNode } from 'react';
import { initials } from '../../utils/format';
import { BackButton } from './BackButton';

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  // Secondary pages: a back arrow to the previous screen (or to `back` when opened directly).
  back?: string;
}

export const PageHeader = ({ eyebrow, title, subtitle, actions, back }: PageHeaderProps) => (
  <header className="page-header">
    <div>
      {back && <BackButton fallback={back} />}
      {eyebrow && <p className="page-eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {subtitle && <p className="page-subtitle">{subtitle}</p>}
    </div>
    {actions && <div className="page-actions">{actions}</div>}
  </header>
);

export const EmptyState = ({ title, hint }: { title: string; hint?: string }) => (
  <div className="empty-state">
    <p className="empty-title">{title}</p>
    {hint && <p className="empty-hint">{hint}</p>}
  </div>
);

// Tones: positive/profit (green), warning/expense (amber), negative/danger (red).
export const StatCard = ({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'positive' | 'negative' | 'warning' | 'profit' | 'expense' | 'danger' }) => (
  <article className={`kpi-card${tone ? ` kpi-${tone}` : ''}`}>
    <p className="kpi-label">{label}</p>
    <p className="kpi-value">{value}</p>
    {hint && <p className="kpi-hint">{hint}</p>}
  </article>
);

export const Avatar = ({ name, photoUrl, size = 40 }: { name: string; photoUrl?: string | null; size?: number }) =>
  photoUrl
    ? <img src={photoUrl} alt="" className="avatar" style={{ width: size, height: size }} />
    : <span aria-hidden="true" className="avatar avatar-initials" style={{ width: size, height: size, fontSize: size * 0.36 }}>
        {initials(name)}
      </span>;
