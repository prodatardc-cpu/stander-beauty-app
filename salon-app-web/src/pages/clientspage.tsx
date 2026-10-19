import { useEffect, useState, type FormEvent } from 'react';
import { useSearchTerm } from '../hooks/useSearchTerm';
import QRCode from 'qrcode';
import type { Client, Sale } from '../types';
import { apiClient, getApiError } from '../services/api';
import { formatCurrency, useCurrency } from '../services/currency';
import { formatDate, formatDateTime, paymentMethodLabels } from '../utils/format';
import { useIsAdmin } from '../hooks/useAuth';
import { useFeedback } from '../components/UI/Feedback';
import { Modal } from '../components/UI/Modal';
import { Avatar, EmptyState, PageHeader } from '../components/UI/PageHeader';

const emptyDraft = { name: '', phone: '', notes: '' };
type ClientForm = typeof emptyDraft;
type LoyaltyCard = { name: string; points: number; url: string; image: string };

export const ClientsPage = () => {
  const currency = useCurrency();
  const isAdmin = useIsAdmin();
  const { notify, confirm } = useFeedback();
  const [clients, setClients] = useState<Client[]>([]);
  const [query, setQuery] = useSearchTerm();
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<{ id: string | 'new'; form: ClientForm } | null>(null);
  const [loyaltyCard, setLoyaltyCard] = useState<LoyaltyCard | null>(null);
  const [history, setHistory] = useState<{ client: Client; sales: Sale[] | null } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let active = true;
    apiClient
      .get<Client[]>('/clients/search', { q: debouncedQuery, ...(showArchived && { includeArchived: 'true' }) })
      .then(({ data }) => {
        if (active) { setClients(data); setError(''); }
      })
      .catch((requestError) => {
        if (active) setError(getApiError(requestError, 'Impossible de charger les clients.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [debouncedQuery, reloadKey, showArchived]);

  const setField = (key: keyof ClientForm, value: string) =>
    setEditor((current) => current && { ...current, form: { ...current.form, [key]: value } });

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!editor) return;
    setSaving(true);
    try {
      if (editor.id === 'new') {
        await apiClient.post<Client>('/clients', editor.form);
        notify(`Client « ${editor.form.name} » ajouté.`);
      } else {
        await apiClient.put<Client>(`/clients/${editor.id}`, editor.form);
        notify(`Fiche de ${editor.form.name} mise à jour.`);
      }
      setEditor(null);
      setReloadKey((key) => key + 1);
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible d’enregistrer ce client.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (client: Client) => {
    const accepted = await confirm({
      title: `Supprimer ${client.name} ?`,
      message: 'Si ce client a des achats ou des rendez-vous, sa fiche est archivée : ventes, commissions et rapports restent intacts, et elle peut être restaurée. Sinon, elle est supprimée.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!accepted) return;
    try {
      const { data } = await apiClient.delete<{ outcome: 'archived' | 'deleted' }>(`/clients/${client.id}`);
      setReloadKey((key) => key + 1);
      notify(data.outcome === 'archived' ? `${client.name} a été archivé : son historique est conservé.` : `${client.name} a été supprimé.`);
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible de supprimer ce client.'), 'error');
    }
  };

  const restoreClient = async (client: Client) => {
    try {
      await apiClient.post(`/clients/${client.id}/restore`);
      setReloadKey((key) => key + 1);
      notify(`${client.name} est de nouveau dans le fichier client.`);
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible de restaurer ce client.'), 'error');
    }
  };

  const showHistory = async (client: Client) => {
    setHistory({ client, sales: null });
    try {
      const { data } = await apiClient.get<Sale[]>(`/sales/client/${client.id}`);
      setHistory({ client, sales: data });
    } catch (requestError) {
      setHistory(null);
      notify(getApiError(requestError, 'Impossible de charger l’historique.'), 'error');
    }
  };

  const showLoyaltyCard = async (client: Client) => {
    const url = `${window.location.origin}/carte/${client.id}`;
    try {
      const image = await QRCode.toDataURL(url, { width: 280, margin: 2, color: { dark: '#18221e', light: '#ffffff' } });
      setLoyaltyCard({ name: client.name, points: Number(client.loyaltyPoints || 0), url, image });
    } catch {
      notify('Impossible de générer la carte de fidélité.', 'error');
    }
  };

  return (
    <section className="space-y-6">
      <PageHeader
        eyebrow="Fichier client"
        title="Clients"
        subtitle={`${clients.length} client(s)${debouncedQuery ? ` pour « ${debouncedQuery} »` : ''}`}
        actions={<button type="button" className="btn btn-primary" onClick={() => setEditor({ id: 'new', form: emptyDraft })}>Ajouter un client</button>}
      />

      <div className="toolbar">
        <input
          type="search"
          aria-label="Rechercher un client"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher par nom ou téléphone…"
          className="search-input"
        />
        {isAdmin && <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
          Afficher les clients archivés
        </label>}
      </div>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto">
        {loading ? <p className="loading-line">Chargement des clients…</p> : clients.length === 0 ? (
          <EmptyState title={debouncedQuery ? 'Aucun client ne correspond à cette recherche.' : 'Aucun client enregistré.'} hint={debouncedQuery ? undefined : 'Les clients ajoutés ici peuvent cumuler des points fidélité à chaque passage en caisse.'} />
        ) : (
          <table className="data-table">
            <thead>
              <tr><th>Client</th><th>Téléphone</th><th>Dernière visite</th><th className="num">Points</th><th className="num">Total dépensé</th><th className="actions">Actions</th></tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id}>
                  <td>
                    <span className="flex items-center gap-3">
                      <Avatar name={client.name} size={36} />
                      <span><span className="cell-title">{client.name}{client.archivedAt && <> <span className="badge">Archivé</span></>}</span>{client.notes && <span className="cell-sub">{client.notes}</span>}</span>
                    </span>
                  </td>
                  <td>{client.phone}</td>
                  <td>{formatDate(client.lastVisit)}</td>
                  <td className="num"><span className="badge badge-accent">{Number(client.loyaltyPoints || 0)}</span></td>
                  <td className="num">{formatCurrency(client.totalSpent || 0, currency)}</td>
                  <td className="actions"><span className="row-actions">
                    <button type="button" className="link-button" onClick={() => void showHistory(client)}>Historique</button>
                    {client.archivedAt ? (
                      isAdmin && <button type="button" className="link-button" onClick={() => void restoreClient(client)}>Restaurer</button>
                    ) : <>
                      <button type="button" className="link-button" onClick={() => void showLoyaltyCard(client)}>Carte QR</button>
                      <button type="button" className="link-button" onClick={() => setEditor({ id: client.id, form: { name: client.name, phone: client.phone, notes: client.notes ?? '' } })}>Modifier</button>
                      {isAdmin && <button type="button" className="link-button is-danger" onClick={() => void handleDelete(client)}>Supprimer</button>}
                    </>}
                  </span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editor && (
        <Modal title={editor.id === 'new' ? 'Nouveau client' : `Modifier ${editor.form.name}`} onClose={() => setEditor(null)}>
          <form onSubmit={handleSave} className="form-grid">
            <label className="field">Nom complet<input required autoComplete="name" value={editor.form.name} onChange={(event) => setField('name', event.target.value)} /></label>
            <label className="field">Téléphone<input required type="tel" autoComplete="tel" value={editor.form.phone} onChange={(event) => setField('phone', event.target.value)} /></label>
            <label className="field field-wide">Notes<textarea rows={3} placeholder="Préférences, allergies, type de cheveux…" value={editor.form.notes} onChange={(event) => setField('notes', event.target.value)} /></label>
            <div className="field-wide flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setEditor(null)}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
            </div>
          </form>
        </Modal>
      )}

      {history && (
        <Modal size="lg" title={`Historique de ${history.client.name}`} description={`Client depuis le ${formatDate(history.client.registrationDate)} · ${formatCurrency(history.client.totalSpent || 0, currency)} dépensés`} onClose={() => setHistory(null)}>
          {history.sales === null ? <p className="loading-line">Chargement…</p> : history.sales.length ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Date</th><th>Paiement</th><th className="num">Articles</th><th className="num">Total</th><th className="num">Reste dû</th></tr></thead>
                <tbody>{history.sales.map((sale) => <tr key={sale.id}>
                  <td>{formatDateTime(sale.saleDate)}</td>
                  <td>{paymentMethodLabels[sale.paymentMethod]}</td>
                  <td className="num">{(sale.items ?? []).reduce((sum, item) => sum + Number(item.quantity), 0)}</td>
                  <td className="num">{formatCurrency(sale.totalAmount, currency)}</td>
                  <td className="num">{Number(sale.remainingAmount) > 0 ? <span className="badge badge-danger">{formatCurrency(sale.remainingAmount, currency)}</span> : '—'}</td>
                </tr>)}</tbody>
              </table>
            </div>
          ) : <EmptyState title="Aucun achat enregistré pour ce client." />}
        </Modal>
      )}

      {loyaltyCard && (
        <Modal size="sm" title={loyaltyCard.name} description="Stander Beauty · carte de fidélité" onClose={() => setLoyaltyCard(null)}>
          <div className="text-center">
            <img src={loyaltyCard.image} alt={`Code QR de la carte fidélité de ${loyaltyCard.name}`} className="mx-auto mb-4 h-56 w-56 rounded" />
            <p className="text-sm text-gray-600">Solde de fidélité</p>
            <p className="font-display text-4xl font-semibold text-orange-700">{loyaltyCard.points} points</p>
            <p className="mt-3 break-all text-xs text-gray-500">{loyaltyCard.url}</p>
            <a href={loyaltyCard.image} download={`carte-fidelite-${loyaltyCard.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`} className="btn btn-primary mt-5">Télécharger la carte QR</a>
          </div>
        </Modal>
      )}
    </section>
  );
};
