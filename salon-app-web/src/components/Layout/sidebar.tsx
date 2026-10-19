import { Fragment, useEffect, useState, type KeyboardEvent } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useCan } from '../../hooks/useAuth';
import type { Permission } from '../../utils/permissions';
import { BrandMark } from '../Common/BrandMark';
import { apiClient } from '../../services/api';
import type { Appointment, Client, Product, Service, Staff } from '../../types';
import { formatDate, formatTime } from '../../utils/format';

type NavItem = { label: string; path: string; permission?: Permission };
const navigationGroups: { label: string; items: NavItem[] }[] = [
  {
    label: 'Activité',
    items: [
      { label: "Vue d'ensemble", path: '/dashboard' },
      { label: 'Caisse', path: '/caisse' },
      { label: 'Ventes', path: '/ventes' },
      { label: 'Rendez-vous', path: '/appointments' },
      { label: 'Clients', path: '/clients' },
    ],
  },
  {
    label: 'Catalogue',
    items: [
      { label: 'Prestations', path: '/prestations' },
      { label: 'Boutique', path: '/boutique' },
    ],
  },
  {
    label: 'Équipe',
    items: [
      { label: 'Équipe', path: '/staff' },
      { label: 'Présences', path: '/presence' },
      { label: 'Rémunérations', path: '/remunerations' },
    ],
  },
  {
    label: 'Pilotage',
    items: [
      { label: 'Rapports', path: '/reports' },
      { label: 'Historique', path: '/historique', permission: 'readHistory' },
      { label: 'Paramètres', path: '/settings' },
    ],
  },
];

const titles: [string, string][] = [
  ...navigationGroups.flatMap((group) => group.items.map((item) => [item.path, item.label] as [string, string])),
];

// Title of the current page, secondary pages included (/staff/…, /historique/…).
// eslint-disable-next-line react-refresh/only-export-components
export const pageTitle = (pathname: string) =>
  titles.find(([path]) => pathname === path)?.[1] ?? titles.find(([path]) => pathname.startsWith(`${path}/`))?.[1] ?? 'Stander Beauty';

const NavEntry = ({ item }: { item: NavItem }) => {
  const allowed = useCan(item.permission ?? 'readAnyStaffFinancials');
  if (item.permission && !allowed) return null;
  return (
    <NavLink to={item.path} className={({ isActive }) => `studio-nav-link${isActive ? ' is-active' : ''}`}>
      {item.label}
    </NavLink>
  );
};

type SearchResult = { key: string; group: string; title: string; detail?: string; path: string };
type SearchData = { services: Service[]; products: Product[]; staff: Staff[]; appointments: Appointment[] };

const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const perGroup = 5;

// Searches the whole application: pages, clients, services, products, team members and appointments.
const SidebarSearch = () => {
  const navigate = useNavigate();
  const canReadHistory = useCan('readHistory');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [data, setData] = useState<SearchData | null>(null);
  const [clients, setClients] = useState<{ query: string; list: Client[] }>({ query: '', list: [] });
  const query = term.trim();
  const needle = normalize(query);

  // Catalogue, team and appointments are loaded when the field gets focus (fresh on every visit).
  const load = () => {
    Promise.all([
      apiClient.get<Service[]>('/services'), apiClient.get<Product[]>('/products'),
      apiClient.get<Staff[]>('/staff'), apiClient.get<Appointment[]>('/appointments'),
    ]).then(([services, products, staff, appointments]) => setData({ services: services.data, products: products.data, staff: staff.data, appointments: appointments.data }))
      .catch(() => undefined);
  };

  // Clients are searched on the server (name or phone number), a moment after typing stops.
  useEffect(() => {
    if (!query) return;
    let current = true;
    const timer = window.setTimeout(() => {
      apiClient.get<Client[]>('/clients/search', { q: query })
        .then(({ data: list }) => { if (current) setClients({ query, list }); })
        .catch(() => undefined);
    }, 200);
    return () => { current = false; window.clearTimeout(timer); };
  }, [query]);

  const matches = (...fields: (string | null | undefined)[]) => fields.some((field) => field && normalize(field).includes(needle));
  const results: SearchResult[] = !query ? [] : [
    ...navigationGroups.flatMap((group) => group.items)
      .filter((item) => (!item.permission || (item.permission === 'readHistory' && canReadHistory)) && matches(item.label))
      .map((item) => ({ key: `page-${item.path}`, group: 'Pages', title: item.label, path: item.path })),
    ...(clients.query === query ? clients.list : []).slice(0, perGroup)
      .map((client) => ({ key: `client-${client.id}`, group: 'Clients', title: client.name, detail: client.phone, path: `/clients?q=${encodeURIComponent(client.phone || client.name)}` })),
    ...(data?.services ?? []).filter((service) => matches(service.name, service.category)).slice(0, perGroup)
      .map((service) => ({ key: `service-${service.id}`, group: 'Prestations', title: service.name, detail: service.category, path: `/prestations?q=${encodeURIComponent(service.name)}` })),
    ...(data?.products ?? []).filter((product) => matches(product.name, product.sku, product.category)).slice(0, perGroup)
      .map((product) => ({ key: `product-${product.id}`, group: 'Produits', title: product.name, detail: `${product.quantityStock} en stock`, path: `/boutique?q=${encodeURIComponent(product.name)}` })),
    ...(data?.staff ?? []).filter((member) => matches(member.name, member.position, member.phone)).slice(0, perGroup)
      .map((member) => ({ key: `staff-${member.id}`, group: 'Équipe', title: member.name, detail: member.position, path: `/staff/${member.id}` })),
    ...(data?.appointments ?? [])
      .filter((appointment) => !['cancelled', 'completed', 'no_show'].includes(appointment.status) && new Date(appointment.scheduledAt) >= new Date(new Date().setHours(0, 0, 0, 0)))
      .filter((appointment) => matches(appointment.Client?.name, appointment.Service?.name, appointment.Staff?.name))
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)).slice(0, perGroup)
      .map((appointment) => ({ key: `appointment-${appointment.id}`, group: 'Rendez-vous à venir', title: `${appointment.Client?.name ?? 'Client'} · ${appointment.Service?.name ?? 'Prestation'}`, detail: `${formatDate(appointment.scheduledAt)} à ${formatTime(appointment.scheduledAt)}`, path: '/appointments' })),
  ];
  const selected = Math.min(active, Math.max(results.length - 1, 0));

  const go = (result: SearchResult | undefined) => {
    if (!result) return;
    navigate(result.path);
    setTerm('');
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') { setTerm(''); setOpen(false); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setActive(Math.min(selected + 1, results.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(Math.max(selected - 1, 0)); }
  };

  return (
    <form role="search" className="studio-search" onSubmit={(event) => { event.preventDefault(); go(results[selected]); }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <input type="search" aria-label="Rechercher dans l’application" placeholder="Client, prestation, produit…" value={term}
        onFocus={() => { setOpen(true); load(); }} onChange={(event) => { setTerm(event.target.value); setActive(0); setOpen(true); }} onKeyDown={onKeyDown} />
      {open && query && <div className="studio-search-results" role="listbox" aria-label="Résultats">
        {results.length ? results.map((result, index) => <Fragment key={result.key}>
          {result.group !== results[index - 1]?.group && <p className="studio-search-group">{result.group}</p>}
          <button type="button" role="option" aria-selected={index === selected} className={index === selected ? 'is-active' : undefined}
            onMouseEnter={() => setActive(index)} onClick={() => go(result)}>
            <span>{result.title}</span>{result.detail && <small>{result.detail}</small>}
          </button>
        </Fragment>) : <p className="studio-search-empty">Aucun résultat pour « {query} ».</p>}
      </div>}
    </form>
  );
};

export const Sidebar = () => (
  <aside className="studio-sidebar">
    <Link to="/dashboard" className="studio-brand" aria-label="Stander Beauty, accueil">
      <BrandMark className="studio-monogram" />
      <span className="studio-brand-copy">
        <strong>Stander Beauty</strong>
        <small>Votre beauté, notre signature</small>
      </span>
    </Link>
    <SidebarSearch />
    <nav className="studio-navigation" aria-label="Navigation principale">
      {navigationGroups.map((group) => (
        <div className="studio-nav-group" key={group.label}>
          <p className="studio-nav-label">{group.label}</p>
          {group.items.map((item) => <NavEntry key={item.path} item={item} />)}
        </div>
      ))}
    </nav>
  </aside>
);
