import { useEffect, useState, type FormEvent } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import type { Staff, User } from '../types';
import { logout, setUser } from '../redux/slices/authSlice';
import { apiClient, checkApiStatus, getApiError } from '../services/api';
import { setCurrency, setExchangeRate, useCurrency, useExchangeRate } from '../services/currency';
import { formatDate, roleLabels } from '../utils/format';
import { useCurrentUser } from '../hooks/useAuth';
import { useFeedback } from '../components/UI/Feedback';
import { PageHeader } from '../components/UI/PageHeader';
import { Modal } from '../components/UI/Modal';

const emptyPasswords = { currentPassword: '', newPassword: '', confirmPassword: '' };
const emptyAccount = { email: '', password: '', role: 'staff' as 'staff' | 'cashier' };
const assignableRoles = ['staff', 'cashier'] as const;

export const SettingsPage = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const user = useCurrentUser();
  const currency = useCurrency();
  const exchangeRate = useExchangeRate();
  const { notify, confirm } = useFeedback();
  const [apiStatus, setApiStatus] = useState<'loading' | 'online' | 'degraded' | 'offline'>('loading');
  const [passwords, setPasswords] = useState(emptyPasswords);
  const [savingPassword, setSavingPassword] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [teamMembers, setTeamMembers] = useState<Staff[]>([]);
  const isAdmin = user?.role === 'admin';
  const [account, setAccount] = useState<typeof emptyAccount | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [savingAccount, setSavingAccount] = useState(false);
  const [exchangeRateInput, setExchangeRateInput] = useState(() => exchangeRate === null ? '' : String(exchangeRate));

  useEffect(() => {
    setExchangeRateInput(exchangeRate === null ? '' : String(exchangeRate));
  }, [exchangeRate]);

  useEffect(() => {
    void checkApiStatus().then(setApiStatus);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    apiClient.get<User[]>('/auth/users').then(({ data }) => setUsers(data)).catch(() => setUsers([]));
    apiClient.get<Staff[]>('/staff', { includeArchived: 'true' }).then(({ data }) => setTeamMembers(data)).catch(() => setTeamMembers([]));
  }, [isAdmin]);

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (passwords.newPassword !== passwords.confirmPassword) {
      notify('Les deux nouveaux mots de passe ne correspondent pas.', 'error');
      return;
    }
    setSavingPassword(true);
    try {
      const { data } = await apiClient.put<{ token: string }>('/auth/password', { currentPassword: passwords.currentPassword, newPassword: passwords.newPassword });
      // The server revoked every older session: keep this one alive with the fresh token.
      if (user) dispatch(setUser({ user, token: data.token }));
      setPasswords(emptyPasswords);
      notify('Mot de passe modifié. Vos autres appareils ont été déconnectés.');
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible de modifier le mot de passe.'), 'error');
    } finally {
      setSavingPassword(false);
    }
  };

  const updateUser = async (target: User, changes: Partial<Pick<User, 'role' | 'status' | 'staffId'>>) => {
    try {
      const { data } = await apiClient.patch<User>(`/auth/users/${target.id}`, changes);
      setUsers((current) => current.map((entry) => entry.id === data.id ? data : entry));
      notify(`Compte ${target.email} mis à jour.`);
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible de modifier ce compte.'), 'error');
    }
  };

  const createAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (!account) return;
    setSavingAccount(true);
    try {
      const { data } = await apiClient.post<User>('/auth/users', account);
      setUsers((current) => [...current, data]);
      notify(`Accès créé pour ${data.email}. Communiquez-lui son mot de passe de façon sécurisée.`);
      setAccount(null);
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible de créer cet accès.'), 'error');
    } finally {
      setSavingAccount(false);
    }
  };

  const submitPasswordReset = async (event: FormEvent) => {
    event.preventDefault();
    if (!resetTarget) return;
    setSavingAccount(true);
    try {
      await apiClient.put(`/auth/users/${resetTarget.id}/password`, { newPassword: resetPassword });
      notify(`Mot de passe de ${resetTarget.email} réinitialisé. Ses sessions ont été fermées.`);
      setResetTarget(null);
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible de réinitialiser ce mot de passe.'), 'error');
    } finally {
      setSavingAccount(false);
    }
  };

  const signOutEverywhere = async () => {
    const accepted = await confirm({
      title: 'Déconnecter tous les appareils ?',
      message: 'Toutes vos sessions, y compris celle-ci, seront fermées. Vous devrez vous reconnecter.',
      confirmLabel: 'Tout déconnecter',
      danger: true,
    });
    if (!accepted) return;
    try {
      await apiClient.post('/auth/logout-all');
    } finally {
      signOut();
    }
  };

  const signOut = () => {
    dispatch(logout());
    navigate('/login', { replace: true });
  };

  const saveExchangeRate = (event: FormEvent) => {
    event.preventDefault();
    const rate = Number(exchangeRateInput.trim().replace(',', '.'));
    if (!Number.isFinite(rate) || rate <= 0) {
      notify('Saisissez un taux supérieur à zéro, en francs congolais pour 1 USD.', 'error');
      return;
    }
    setExchangeRate(rate);
    notify(`Taux enregistré : 1 USD = ${new Intl.NumberFormat('fr-FR').format(rate)} CDF.`);
  };

  return <section className="space-y-6">
    <PageHeader eyebrow="Configuration" title="Paramètres" subtitle="Votre compte, la devise du salon et les accès de l’équipe." />

    <div className="grid gap-6 lg:grid-cols-2">
      <section className="panel">
        <div className="panel-header"><h2 className="section-title">Mon compte</h2><span className={`badge ${apiStatus === 'online' ? 'badge-success' : apiStatus === 'loading' ? '' : 'badge-danger'}`}>{apiStatus === 'online' ? 'API connectée' : apiStatus === 'degraded' ? 'Base de données indisponible' : apiStatus === 'offline' ? 'API indisponible' : 'API …'}</span></div>
        <div className="list-rows">
          <div className="list-row"><span className="text-gray-600">Adresse e-mail</span><span className="cell-title">{user?.email ?? '—'}</span></div>
          <div className="list-row"><span className="text-gray-600">Rôle</span><span className="cell-title">{user ? roleLabels[user.role] : '—'}</span></div>
          <div className="list-row">
            <span><span className="text-gray-600">Devise de base</span><span className="cell-sub">Les montants sont aussi affichés dans l’autre devise.</span></span>
            <select aria-label="Devise du salon" value={currency} onChange={(event) => setCurrency(event.target.value as 'USD' | 'CDF')} className="px-3 py-2 text-sm">
              <option value="CDF">Franc congolais (CDF)</option>
              <option value="USD">Dollar américain (USD)</option>
            </select>
          </div>
          <div className="list-row exchange-rate-row">
            <span><span className="text-gray-600">Taux du dollar</span><span className="cell-sub">Indiquez le nombre de CDF pour 1 USD.</span></span>
            <form className="exchange-rate-form" onSubmit={saveExchangeRate}>
              <label className="sr-only" htmlFor="usd-cdf-rate">Francs congolais pour un dollar</label>
              <input id="usd-cdf-rate" type="number" min="0.01" step="any" inputMode="decimal" placeholder="Ex. 2800" value={exchangeRateInput} onChange={(event) => setExchangeRateInput(event.target.value)} />
              <span className="exchange-rate-unit">CDF / USD</span>
              <button type="submit" className="btn btn-secondary">Enregistrer</button>
            </form>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => void signOutEverywhere()}>Déconnecter tous mes appareils</button>
          <button type="button" className="btn btn-danger" onClick={signOut}>Se déconnecter</button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><h2 className="section-title">Changer de mot de passe</h2></div>
        <form onSubmit={changePassword} className="grid gap-4">
          <label className="field">Mot de passe actuel<input required type="password" autoComplete="current-password" value={passwords.currentPassword} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} /></label>
          <label className="field">Nouveau mot de passe (8 caractères minimum)<input required minLength={8} type="password" autoComplete="new-password" value={passwords.newPassword} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} /></label>
          <label className="field">Confirmer le nouveau mot de passe<input required minLength={8} type="password" autoComplete="new-password" value={passwords.confirmPassword} onChange={(event) => setPasswords({ ...passwords, confirmPassword: event.target.value })} /></label>
          <div className="flex justify-end"><button type="submit" className="btn btn-primary" disabled={savingPassword}>{savingPassword ? 'Enregistrement…' : 'Mettre à jour'}</button></div>
        </form>
      </section>
    </div>

    {isAdmin && <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="section-title">Comptes utilisateurs</h2><p className="mt-1 max-w-3xl text-sm text-gray-600">Il n’existe qu’un seul compte administrateur. Les accès « Caisse » et « Équipe » sont créés ici : tous deux encaissent et gèrent clients et rendez-vous ; la caisse enregistre aussi les présences et clôture la journée. Aucun ne gère le catalogue, l’équipe, les annulations ni le paiement des commissions. Reliez un accès à sa fiche de l’équipe pour qu’il consulte ses propres commissions.</p></div>
        <button type="button" className="btn btn-primary" onClick={() => setAccount(emptyAccount)}>Créer un accès</button>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead><tr><th>Compte</th><th>Créé le</th><th>Rôle</th><th>Fiche équipe</th><th>Accès</th><th className="actions">Mot de passe</th></tr></thead>
          <tbody>{users.map((entry) => {
            const isSelf = entry.id === user?.id;
            const isAdminAccount = entry.role === 'admin';
            return <tr key={entry.id}>
              <td><span className="cell-title">{entry.email}</span>{isSelf && <span className="cell-sub">Vous</span>}</td>
              <td>{formatDate(entry.createdAt)}</td>
              <td>
                {isAdminAccount ? <span className="badge badge-accent">{roleLabels.admin}</span> : (
                  <select aria-label={`Rôle de ${entry.email}`} value={entry.role} onChange={(event) => void updateUser(entry, { role: event.target.value as User['role'] })} className="px-2 py-1 text-sm">
                    {assignableRoles.map((value) => <option key={value} value={value}>{roleLabels[value]}</option>)}
                  </select>
                )}
              </td>
              <td>
                {isAdminAccount ? <span className="cell-sub">—</span> : (
                  <select aria-label={`Fiche équipe de ${entry.email}`} value={entry.staffId ?? ''} onChange={(event) => void updateUser(entry, { staffId: event.target.value || null })} className="px-2 py-1 text-sm">
                    <option value="">Aucune</option>
                    {teamMembers.map((member) => <option key={member.id} value={member.id} disabled={Boolean(member.archivedAt)}>{member.name}{member.archivedAt ? ' (archivé)' : ''}</option>)}
                  </select>
                )}
              </td>
              <td>{isSelf || isAdminAccount ? <span className="badge badge-success">Actif</span> : <span className="flex items-center gap-2"><span className={`badge ${entry.status === 'active' ? 'badge-success' : 'badge-danger'}`}>{entry.status === 'active' ? 'Actif' : 'Bloqué'}</span><button type="button" className={`link-button${entry.status === 'active' ? ' is-danger' : ''}`} onClick={() => void updateUser(entry, { status: entry.status === 'active' ? 'inactive' : 'active' })}>{entry.status === 'active' ? 'Bloquer' : 'Rétablir'}</button></span>}</td>
              <td className="actions">{isAdminAccount ? <span className="cell-sub">Depuis « Mon compte »</span> : <button type="button" className="link-button" onClick={() => { setResetTarget(entry); setResetPassword(''); }}>Réinitialiser</button>}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </section>}

    {account && (
      <Modal title="Créer un accès" description="L’administrateur reste unique : seuls les rôles Équipe et Caisse peuvent être attribués." onClose={() => setAccount(null)}>
        <form onSubmit={createAccount} className="form-grid">
          <label className="field field-wide">Adresse e-mail<input required type="email" autoComplete="off" value={account.email} onChange={(event) => setAccount({ ...account, email: event.target.value })} /></label>
          <label className="field">Mot de passe provisoire<input required minLength={8} type="password" autoComplete="new-password" value={account.password} onChange={(event) => setAccount({ ...account, password: event.target.value })} /><span className="field-hint">8 caractères minimum. La personne pourra le changer dans ses paramètres.</span></label>
          <label className="field">Rôle
            <select value={account.role} onChange={(event) => setAccount({ ...account, role: event.target.value as 'staff' | 'cashier' })}>
              {assignableRoles.map((value) => <option key={value} value={value}>{roleLabels[value]}</option>)}
            </select>
          </label>
          <div className="field-wide flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setAccount(null)}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={savingAccount}>{savingAccount ? 'Création…' : 'Créer l’accès'}</button>
          </div>
        </form>
      </Modal>
    )}

    {resetTarget && (
      <Modal size="sm" title="Réinitialiser le mot de passe" description={resetTarget.email} onClose={() => setResetTarget(null)}>
        <form onSubmit={submitPasswordReset} className="grid gap-4">
          <label className="field">Nouveau mot de passe<input required minLength={8} type="password" autoComplete="new-password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} /><span className="field-hint">Ses sessions ouvertes seront fermées.</span></label>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setResetTarget(null)}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={savingAccount}>{savingAccount ? 'Enregistrement…' : 'Réinitialiser'}</button>
          </div>
        </form>
      </Modal>
    )}
  </section>;
};
