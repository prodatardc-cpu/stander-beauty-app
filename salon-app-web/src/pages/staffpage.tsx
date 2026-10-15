import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import type { Staff } from '../types';
import { apiClient, getApiError } from '../services/api';
import { formatCurrency, useCurrency } from '../services/currency';
import { useIsAdmin } from '../hooks/useAuth';
import { useFeedback } from '../components/UI/Feedback';
import { Modal } from '../components/UI/Modal';
import { Avatar, EmptyState, PageHeader } from '../components/UI/PageHeader';

const emptyDraft = {
  name: '', phone: '', position: '', positionCategory: 'Autre', payType: 'commission' as Staff['payType'],
  commissionRate: '40', monthlySalary: '', photoUrl: '' as string,
};
type StaffForm = typeof emptyDraft;
const positionOptions = ['Coiffeur / coiffeuse homme', 'Coiffeur / coiffeuse femme', 'Barbier', 'Spécialiste tresses', 'Technicien(ne) ongulaire', 'Maquilleur / maquilleuse', 'Esthéticien(ne)', 'Réceptionniste', 'Caissier / caissière', 'Assistant(e)', 'Autre'];

const toForm = (member: Staff): StaffForm => ({
  name: member.name, phone: member.phone,
  position: positionOptions.includes(member.position) ? '' : member.position,
  positionCategory: positionOptions.includes(member.position) ? member.position : 'Autre',
  payType: member.payType,
  commissionRate: String(Number(member.commissionRate)), monthlySalary: String(Number(member.monthlySalary || 0)),
  photoUrl: member.photoUrl ?? '',
});

// The API accepts JPEG data URLs up to ~90 KB, so photos are cropped, resized and recompressed in the browser.
const compressPhoto = (file: File) => new Promise<string>((resolve, reject) => {
  const image = new Image();
  const url = URL.createObjectURL(file);
  image.onload = () => {
    URL.revokeObjectURL(url);
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return reject(new Error('Canvas unavailable'));
    const side = Math.min(image.width, image.height);
    context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, size, size);
    let quality = 0.85;
    let result = canvas.toDataURL('image/jpeg', quality);
    while (result.length > 88000 && quality > 0.3) {
      quality -= 0.1;
      result = canvas.toDataURL('image/jpeg', quality);
    }
    resolve(result);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Invalid image'));
  };
  image.src = url;
});

export const StaffPage = () => {
  const currency = useCurrency();
  const isAdmin = useIsAdmin();
  const { notify, confirm } = useFeedback();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<{ id: string | 'new'; form: StaffForm } | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const loadStaff = useCallback(async () => {
    try {
      const { data } = await apiClient.get<Staff[]>('/staff', showArchived ? { includeArchived: 'true' } : undefined);
      setStaff(data);
      setError('');
    } catch (requestError) {
      setError(getApiError(requestError, 'Impossible de charger le personnel.'));
    }
  }, [showArchived]);

  useEffect(() => {
    let active = true;
    apiClient.get<Staff[]>('/staff', showArchived ? { includeArchived: 'true' } : undefined)
      .then(({ data }) => { if (active) setStaff(data); })
      .catch((requestError) => { if (active) setError(getApiError(requestError, 'Impossible de charger le personnel.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [showArchived]);

  const setField = (key: keyof StaffForm, value: string) =>
    setEditor((current) => current && { ...current, form: { ...current.form, [key]: value } });

  const handlePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      setField('photoUrl', await compressPhoto(file));
    } catch {
      notify('Cette image ne peut pas être utilisée.', 'error');
    }
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!editor) return;
    const { id, form } = editor;
    setSaving(true);
    try {
      const payload = {
        name: form.name, phone: form.phone,
        position: form.positionCategory === 'Autre' ? form.position : form.positionCategory,
        payType: form.payType,
        commissionRate: Number(form.commissionRate || 0), monthlySalary: Number(form.monthlySalary || 0),
      };
      if (id === 'new') {
        await apiClient.post('/staff', { ...payload, photoUrl: form.photoUrl || null });
        notify(`${form.name} a rejoint l’équipe.`);
      } else {
        await apiClient.patch(`/staff/${id}`, { ...payload, photoUrl: form.photoUrl });
        notify(`Fiche de ${form.name} mise à jour.`);
      }
      setEditor(null);
      await loadStaff();
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible d’enregistrer ce membre du personnel.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (member: Staff) => {
    const status = member.status === 'active' ? 'inactive' : 'active';
    try {
      await apiClient.patch(`/staff/${member.id}`, { status });
      notify(status === 'active' ? `${member.name} est de nouveau actif.` : `${member.name} est désactivé et n’apparaît plus en caisse.`);
      await loadStaff();
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible de modifier le statut.'), 'error');
    }
  };

  const handleDelete = async (member: Staff) => {
    const accepted = await confirm({
      title: `Supprimer ${member.name} ?`,
      message: 'S’il a des ventes, commissions, présences ou rendez-vous, il est archivé : tout cet historique reste intact et sa fiche peut être restaurée. Sinon, sa fiche est supprimée. Dans les deux cas, l’accès relié à sa fiche est bloqué.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!accepted) return;
    try {
      const { data } = await apiClient.delete<{ outcome: 'archived' | 'deleted' }>(`/staff/${member.id}`);
      notify(data.outcome === 'archived' ? `${member.name} a été archivé : son historique est conservé.` : `${member.name} a été supprimé.`);
      await loadStaff();
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible de supprimer ce membre du personnel.'), 'error');
    }
  };

  const restoreMember = async (member: Staff) => {
    try {
      await apiClient.post(`/staff/${member.id}/restore`);
      notify(`${member.name} est restauré (inactif) : réactivez-le pour l’affecter en caisse.`);
      await loadStaff();
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible de restaurer ce membre.'), 'error');
    }
  };

  const activeCount = staff.filter((member) => member.status === 'active' && !member.archivedAt).length;

  return (
    <section className="space-y-6">
      <PageHeader
        eyebrow="Équipe"
        title="Personnel"
        subtitle={`${activeCount} membre(s) actif(s) sur ${staff.length}`}
        actions={isAdmin && <button type="button" className="btn btn-primary" onClick={() => setEditor({ id: 'new', form: emptyDraft })}>Ajouter un membre</button>}
      />
      {isAdmin && <label className="flex items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
        Afficher les membres archivés
      </label>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto">
        {loading ? <p className="loading-line">Chargement de l’équipe…</p> : staff.length ? (
          <table className="data-table">
            <thead><tr><th>Membre</th><th>Téléphone</th><th>Rémunération</th><th>Statut</th>{isAdmin && <th className="actions">Actions</th>}</tr></thead>
            <tbody>{staff.map((member) => (
              <tr key={member.id}>
                <td>
                  <span className="flex items-center gap-3">
                    <Avatar name={member.name} photoUrl={member.photoUrl} />
                    <span><span className="cell-title">{member.name}</span><span className="cell-sub">{member.position}</span></span>
                  </span>
                </td>
                <td>{member.phone}</td>
                <td>{member.payType === 'fixed' ? `Salaire fixe · ${formatCurrency(member.monthlySalary, currency)} / mois` : `Commission · ${Number(member.commissionRate)} %`}</td>
                <td><span className={`badge ${member.status === 'active' ? 'badge-success' : ''}`}>{member.archivedAt ? 'Archivé' : member.status === 'active' ? 'Actif' : 'Inactif'}</span></td>
                {isAdmin && <td className="actions"><span className="row-actions">
                  {member.archivedAt ? <button type="button" className="link-button" onClick={() => void restoreMember(member)}>Restaurer</button> : <>
                    <button type="button" className="link-button" onClick={() => setEditor({ id: member.id, form: toForm(member) })}>Modifier</button>
                    <button type="button" className="link-button" onClick={() => void toggleStatus(member)}>{member.status === 'active' ? 'Désactiver' : 'Réactiver'}</button>
                    <button type="button" className="link-button is-danger" onClick={() => void handleDelete(member)}>Supprimer</button>
                  </>}
                </span></td>}
              </tr>
            ))}</tbody>
          </table>
        ) : <EmptyState title="Aucun membre enregistré." hint={isAdmin ? 'Ajoutez votre équipe pour suivre présences et commissions.' : undefined} />}
      </div>

      {editor && (
        <Modal title={editor.id === 'new' ? 'Nouveau membre' : `Modifier ${editor.form.name}`} onClose={() => setEditor(null)}>
          <form onSubmit={handleSave} className="form-grid">
            <div className="field-wide flex items-center gap-4">
              <Avatar name={editor.form.name || '?'} photoUrl={editor.form.photoUrl || null} size={64} />
              <div className="flex flex-wrap gap-2">
                <label className="btn btn-secondary btn-sm cursor-pointer">
                  {editor.form.photoUrl ? 'Changer la photo' : 'Ajouter une photo'}
                  <input type="file" accept="image/*" className="sr-only" onChange={(event) => void handlePhoto(event)} />
                </label>
                {editor.form.photoUrl && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setField('photoUrl', '')}>Retirer</button>}
              </div>
            </div>
            <label className="field">Nom complet<input required autoComplete="name" value={editor.form.name} onChange={(event) => setField('name', event.target.value)} /></label>
            <label className="field">Téléphone<input required type="tel" autoComplete="tel" value={editor.form.phone} onChange={(event) => setField('phone', event.target.value)} /></label>
            <label className="field">Poste
              <select required value={editor.form.positionCategory} onChange={(event) => setField('positionCategory', event.target.value)}>
                {positionOptions.map((position) => <option key={position} value={position}>{position}</option>)}
              </select>
            </label>
            {editor.form.positionCategory === 'Autre' && <label className="field">Préciser le poste<input required placeholder="Ex. responsable du salon" value={editor.form.position} onChange={(event) => setField('position', event.target.value)} /></label>}
            <label className="field">Rémunération
              <select value={editor.form.payType} onChange={(event) => setField('payType', event.target.value)}>
                <option value="commission">Commission sur prestations</option>
                <option value="fixed">Salaire fixe</option>
              </select>
            </label>
            {editor.form.payType === 'commission'
              ? <label className="field">Taux de commission (%)<input required type="number" min="0" max="100" step="0.01" value={editor.form.commissionRate} onChange={(event) => setField('commissionRate', event.target.value)} /></label>
              : <label className="field">Salaire mensuel ({currency})<input required type="number" min="0" step={currency === 'CDF' ? '1' : '0.01'} value={editor.form.monthlySalary} onChange={(event) => setField('monthlySalary', event.target.value)} /></label>}
            <div className="field-wide flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setEditor(null)}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
};
