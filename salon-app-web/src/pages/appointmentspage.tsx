import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Appointment, Client, Service, Staff } from '../types';
import { apiClient, getApiError } from '../services/api';
import { formatDateTime, isSameLocalDay } from '../utils/format';
import { useFeedback } from '../components/UI/Feedback';
import { Modal } from '../components/UI/Modal';
import { EmptyState, PageHeader } from '../components/UI/PageHeader';

const emptyDraft = { clientId: '', clientName: '', clientPhone: '', staffId: '', serviceId: '', scheduledAt: '', notes: '' };
const statusLabels: Record<Appointment['status'], string> = {
  scheduled: 'Planifié', confirmed: 'Confirmé', completed: 'Terminé', cancelled: 'Annulé', no_show: 'Absent',
};
const statusTones: Record<Appointment['status'], string> = {
  scheduled: '', confirmed: 'badge-accent', completed: 'badge-success', cancelled: 'badge-danger', no_show: 'badge-warning',
};
type Filter = 'upcoming' | 'today' | 'all';

export const AppointmentsPage = () => {
  const { notify, confirm } = useFeedback();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const fetchData = useCallback(async () => {
    const [appointmentResponse, clientResponse, staffResponse, serviceResponse] = await Promise.all([
      apiClient.get<Appointment[]>('/appointments'),
      apiClient.get<Client[]>('/clients'),
      apiClient.get<Staff[]>('/staff'),
      apiClient.get<Service[]>('/services'),
    ]);
    return () => {
      setAppointments(appointmentResponse.data);
      setClients(clientResponse.data);
      setStaff(staffResponse.data.filter((member) => member.status === 'active'));
      setServices(serviceResponse.data.filter((service) => service.status === 'active'));
      setError('');
      setNow(Date.now());
    };
  }, []);

  const loadData = useCallback(async () => {
    try {
      (await fetchData())();
    } catch (requestError) {
      setError(getApiError(requestError, 'Impossible de charger les rendez-vous.'));
    }
  }, [fetchData]);

  useEffect(() => {
    let active = true;
    fetchData()
      .then((apply) => { if (active) apply(); })
      .catch((requestError) => { if (active) setError(getApiError(requestError, 'Impossible de charger les rendez-vous.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fetchData]);

  const visible = useMemo(() => {
    if (filter === 'today') return appointments.filter((appointment) => isSameLocalDay(appointment.scheduledAt));
    if (filter === 'upcoming') return appointments.filter((appointment) => new Date(appointment.scheduledAt).getTime() >= now - 60 * 60 * 1000 && !['cancelled', 'completed', 'no_show'].includes(appointment.status));
    return [...appointments].reverse();
  }, [appointments, filter, now]);

  const createAppointment = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      let clientId = draft.clientId;
      if (!clientId) {
        const name = draft.clientName.trim();
        const phone = draft.clientPhone.trim();
        const existing = clients.find((client) => client.phone.trim() === phone);
        clientId = existing?.id ?? (await apiClient.post<Client>('/clients', { name, phone })).data.id;
      }
      await apiClient.post('/appointments', {
        clientId,
        staffId: draft.staffId,
        serviceId: draft.serviceId,
        // datetime-local has no time zone: send an ISO instant so the server stores the intended time.
        scheduledAt: new Date(draft.scheduledAt).toISOString(),
        notes: draft.notes,
      });
      notify('Rendez-vous enregistré.');
      setDraft(emptyDraft);
      setShowForm(false);
      await loadData();
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible de créer le rendez-vous. Vérifiez les informations.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (appointment: Appointment, status: Appointment['status']) => {
    try {
      await apiClient.patch(`/appointments/${appointment.id}`, { status });
      setAppointments((current) => current.map((entry) => entry.id === appointment.id ? { ...entry, status } : entry));
      notify(`Rendez-vous de ${appointment.Client?.name ?? 'ce client'} : ${statusLabels[status].toLowerCase()}.`);
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible de modifier le rendez-vous.'), 'error');
    }
  };

  const deleteAppointment = async (appointment: Appointment) => {
    const accepted = await confirm({
      title: 'Supprimer ce rendez-vous ?',
      message: `${appointment.Client?.name ?? 'Client'} · ${formatDateTime(appointment.scheduledAt)}. Pour garder une trace, préférez le statut « Annulé ».`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!accepted) return;
    try {
      await apiClient.delete(`/appointments/${appointment.id}`);
      setAppointments((current) => current.filter((entry) => entry.id !== appointment.id));
      notify('Rendez-vous supprimé.');
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible de supprimer ce rendez-vous.'), 'error');
    }
  };

  const todayCount = appointments.filter((appointment) => isSameLocalDay(appointment.scheduledAt)).length;

  return (
    <section className="space-y-6">
      <PageHeader
        eyebrow="Agenda"
        title="Rendez-vous"
        subtitle={`${todayCount} aujourd’hui · ${appointments.length} au total`}
        actions={<button type="button" className="btn btn-primary" onClick={() => setShowForm(true)}>Nouveau rendez-vous</button>}
      />
      <div className="tabs" role="tablist" aria-label="Filtrer les rendez-vous">
        {([['upcoming', 'À venir'], ['today', 'Aujourd’hui'], ['all', 'Tous']] as const).map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={filter === value} className={`tab${filter === value ? ' is-active' : ''}`} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto">
        {loading ? <p className="loading-line">Chargement de l’agenda…</p> : visible.length ? (
          <table className="data-table">
            <thead><tr><th>Date</th><th>Client</th><th>Prestation</th><th>Avec</th><th>Statut</th><th className="actions">Action</th></tr></thead>
            <tbody>{visible.map((appointment) => (
              <tr key={appointment.id}>
                <td className="whitespace-nowrap">{formatDateTime(appointment.scheduledAt)}</td>
                <td><span className="cell-title">{appointment.Client?.name ?? '—'}</span><span className="cell-sub">{appointment.Client?.phone}{appointment.notes ? ` · ${appointment.notes}` : ''}</span></td>
                <td>{appointment.Service?.name ?? '—'}{appointment.Service?.duration && <span className="cell-sub">{appointment.Service.duration} min</span>}</td>
                <td>{appointment.Staff?.name ?? '—'}</td>
                <td>
                  <span className="flex items-center gap-2">
                    <span className={`badge ${statusTones[appointment.status]}`}>{statusLabels[appointment.status]}</span>
                    <select aria-label={`Changer le statut du rendez-vous de ${appointment.Client?.name ?? ''}`} value={appointment.status} onChange={(event) => void updateStatus(appointment, event.target.value as Appointment['status'])} className="px-2 py-1 text-sm">
                      {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </span>
                </td>
                <td className="actions"><button type="button" className="link-button is-danger" onClick={() => void deleteAppointment(appointment)}>Supprimer</button></td>
              </tr>
            ))}</tbody>
          </table>
        ) : <EmptyState title={filter === 'all' ? 'Aucun rendez-vous enregistré.' : filter === 'today' ? 'Aucun rendez-vous aujourd’hui.' : 'Aucun rendez-vous à venir.'} />}
      </div>

      {showForm && (
        <Modal title="Nouveau rendez-vous" onClose={() => setShowForm(false)}>
          <form onSubmit={createAppointment} className="form-grid">
            <label className="field field-wide">Client existant
              <select value={draft.clientId} onChange={(event) => setDraft({ ...draft, clientId: event.target.value })}>
                <option value="">Nouveau client</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.name} · {client.phone}</option>)}
              </select>
            </label>
            {!draft.clientId && <>
              <label className="field">Nom du client<input required autoComplete="name" value={draft.clientName} onChange={(event) => setDraft({ ...draft, clientName: event.target.value })} /></label>
              <label className="field">Téléphone<input required type="tel" autoComplete="tel" value={draft.clientPhone} onChange={(event) => setDraft({ ...draft, clientPhone: event.target.value })} /></label>
            </>}
            <label className="field">Prestation
              <select required value={draft.serviceId} onChange={(event) => setDraft({ ...draft, serviceId: event.target.value })}>
                <option value="">Choisir une prestation</option>
                {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
              </select>
            </label>
            <label className="field">Avec
              <select required value={draft.staffId} onChange={(event) => setDraft({ ...draft, staffId: event.target.value })}>
                <option value="">Choisir un membre</option>
                {staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            </label>
            <label className="field">Date et heure<input required type="datetime-local" value={draft.scheduledAt} onChange={(event) => setDraft({ ...draft, scheduledAt: event.target.value })} /></label>
            <label className="field field-wide">Notes<textarea rows={2} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
            {(!services.length || !staff.length) && <p className="field-wide text-sm text-red-700">Ajoutez d’abord au moins une prestation active et un membre de l’équipe actif.</p>}
            <div className="field-wide flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
};
