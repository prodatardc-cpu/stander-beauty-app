import { Link, NavLink } from 'react-router-dom';
import { BrandMark } from '../Common/BrandMark';

const navigationGroups = [
  {
    label: 'Activité',
    items: [
      { label: "Vue d'ensemble", path: '/dashboard' },
      { label: 'Rendez-vous', path: '/appointments' },
      { label: 'Clients', path: '/clients' },
      { label: 'Caisse', path: '/caisse' },
    ],
  },
  {
    label: 'Gestion',
    items: [
      { label: 'Boutique & prestations', path: '/boutique' },
      { label: 'Équipe', path: '/staff' },
      { label: 'Présences', path: '/presence' },
      { label: 'Commissions', path: '/commissions' },
      { label: 'Rapports', path: '/reports' },
    ],
  },
];

// eslint-disable-next-line react-refresh/only-export-components
export const pageTitles: Record<string, string> = Object.fromEntries([
  ...navigationGroups.flatMap((group) => group.items.map((item) => [item.path, item.label])),
  ['/settings', 'Paramètres'],
]);

export const Sidebar = () => (
  <aside className="studio-sidebar">
    <Link to="/dashboard" className="studio-brand" aria-label="Stander Beauty, accueil">
      <BrandMark className="studio-monogram" />
      <span className="studio-brand-copy">
        <strong>Stander Beauty</strong>
        <small>Votre beauté, notre signature</small>
      </span>
    </Link>
    <nav className="studio-navigation" aria-label="Navigation principale">
      {navigationGroups.map((group) => (
        <div className="studio-nav-group" key={group.label}>
          <p className="studio-nav-label">{group.label}</p>
          {group.items.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `studio-nav-link${isActive ? ' is-active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      ))}
      <div className="studio-nav-footer">
        <NavLink
          to="/settings"
          className={({ isActive }) => `studio-nav-link${isActive ? ' is-active' : ''}`}
        >
          Paramètres
        </NavLink>
      </div>
    </nav>
  </aside>
);
