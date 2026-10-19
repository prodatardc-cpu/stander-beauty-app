import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { isAxiosError } from 'axios';
import type { Appointment, Client, Service, Staff } from '../types';
import { apiClient, getApiError } from '../services/api';
import { formatCurrency, useCurrency, type Currency } from '../services/currency';
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
type Conflict = { scheduledAt: string; service: string | null; client: string | null };

// datetime-local value (local time) of an ISO instant.
const toLocalInput = (value: string) => {
  const date = new Date(value);
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export const AppointmentsPage = () => {
  const { notify, confirm } = useFeedback();
  const currency = useCurrency();
  const [editing, setEditing] = useState<Appointment | null>(null);
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

  const selectedService = services.find((service) => service.id === draft.serviceId);
  const serviceLabel = (service: Service) =>
    `${service.name} · ${formatCurrency(service.price, currency)} · ${service.duration} min`;

  // The API reports a booking overlapping another one of the same member: ask before forcing it.
  const confirmConflict = async (requestError: unknown) => {
    if (!isAxiosError(requestError) || requestError.response?.status !== 409) return false;
    const conflict = (requestError.response.data as { conflict?: Conflict }).conflict;
    if (!conflict) return false;
    return confirm({
      title: 'Conflit d’horaire',
      message: `Ce membre a déjà un rendez-vous à ${formatDateTime(conflict.scheduledAt)}${conflict.service ? ` (${conflict.service}${conflict.client ? `, ${conflict.client}` : ''})` : ''}. Enregistrer quand même ?`,
      confirmLabel: 'Enregistrer quand même',
    });
  };

  const createAppointment = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.serviceId || !draft.staffId || !draft.scheduledAt) {
      notify('Choisissez une prestation, un membre de l’équipe, une date et une heure.', 'error');
      return;
    }
    setSaving(true);
    try {
      let clientId = draft.clientId;
      if (!clientId) {
        const name = draft.clientName.trim();
        const phone = draft.clientPhone.trim();
        const existing = clients.find((client) => client.phone.trim() === phone);
        clientId = existing?.id ?? (await apiClient.post<Client>('/clients', { name, phone })).data.id;
      }
      const payload = {
        clientId,
        staffId: draft.staffId,
        serviceId: draft.serviceId,
        // datetime-local has no time zone: send an ISO instant so the server stores the intended time.
        scheduledAt: new Date(draft.scheduledAt).toISOString(),
        notes: draft.notes,
      };
      try {
        await apiClient.post('/appointments', payload);
      } catch (requestError) {
        if (!await confirmConflict(requestError)) throw requestError;
        await apiClient.post('/appointments', { ...payload, allowOverlap: true });
      }
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

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    const payload = {
      staffId: draft.staffId, serviceId: draft.serviceId, notes: draft.notes,
      scheduledAt: new Date(draft.scheduledAt).toISOString(),
    };
    try {
      try {
        await apiClient.patch(`/appointments/${editing.id}`, payload);
      } catch (requestError) {
        if (!await confirmConflict(requestError)) throw requestError;
        await apiClient.patch(`/appointments/${editing.id}`, { ...payload, allowOverlap: true });
      }
      notify('Rendez-vous modifié.');
      setEditing(null);
      setDraft(emptyDraft);
      await loadData();
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible de modifier le rendez-vous.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (appointment: Appointment) => {
    setEditing(appointment);
    setDraft({ ...emptyDraft, clientId: appointment.clientId, staffId: appointment.staffId, serviceId: appointment.serviceId, scheduledAt: toLocalInput(appointment.scheduledAt), notes: appointment.notes ?? '' });
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
            <thead><tr><th>Date</th><th>Client</th><th>Prestation</th><th className="num">Tarif</th><th>Avec</th><th>Statut</th><th className="actions">Actions</th></tr></thead>
            <tbody>{visible.map((appointment) => (
              <tr key={appointment.id}>
                <td className="whitespace-nowrap">{formatDateTime(appointment.scheduledAt)}</td>
                <td><span className="cell-title">{appointment.Client?.name ?? '—'}</span><span className="cell-sub">{appointment.Client?.phone}{appointment.notes ? ` · ${appointment.notes}` : ''}</span></td>
                <td>{appointment.Service?.name ?? '—'}{appointment.Service?.duration && <span className="cell-sub">{appointment.Service.duration} min</span>}</td>
                <td className="num">{appointment.price != null ? formatCurrency(appointment.price, (appointment.currency ?? currency) as Currency) : '—'}</td>
                <td>{appointment.Staff?.name ?? '—'}</td>
                <td>
                  <span className="flex items-center gap-2">
                    <span className={`badge ${statusTones[appointment.status]}`}>{statusLabels[appointment.status]}</span>
                    <select aria-label={`Changer le statut du rendez-vous de ${appointment.Client?.name ?? ''}`} value={appointment.status} onChange={(event) => void updateStatus(appointment, event.target.value as Appointment['status'])} className="px-2 py-1 text-sm">
                      {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </span>
                </td>
                <td className="actions"><span className="row-actions"><button type="button" className="link-button" onClick={() => startEdit(appointment)}>Modifier</button><button type="button" className="link-button is-danger" onClick={() => void deleteAppointment(appointment)}>Supprimer</button></span></td>
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
                {services.map((service) => <option key={service.id} value={service.id}>{serviceLabel(service)}</option>)}
              </select>
              {selectedService && <span className="field-hint">Tarif {formatCurrency(selectedService.price, currency)} ({currency}) · durée estimée {selectedService.duration} min. Le prix est figé à la réservation.</span>}
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

      {editing && (
        <Modal title="Modifier le rendez-vous" description={`${editing.Client?.name ?? 'Client'} · prix réservé ${editing.price != null ? formatCurrency(editing.price, (editing.currency ?? currency) as Currency) : '—'}`} onClose={() => { setEditing(null); setDraft(emptyDraft); }}>
          <form onSubmit={saveEdit} className="form-grid">
            <label className="field">Prestation
              <select required value={draft.serviceId} onChange={(event) => setDraft({ ...draft, serviceId: event.target.value })}>
                {!services.some((service) => service.id === draft.serviceId) && <option value={draft.serviceId}>{editing.Service?.name ?? 'Prestation actuelle'}</option>}
                {services.map((service) => <option key={service.id} value={service.id}>{serviceLabel(service)}</option>)}
              </select>
              {draft.serviceId !== editing.serviceId && <span className="field-hint">Changer de prestation applique son tarif actuel.</span>}
            </label>
            <label className="field">Avec
              <select required value={draft.staffId} onChange={(event) => setDraft({ ...draft, staffId: event.target.value })}>
                {!staff.some((member) => member.id === draft.staffId) && <option value={draft.staffId}>{editing.Staff?.name ?? 'Membre actuel'}</option>}
                {staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </select>
            </label>
            <label className="field">Date et heure<input required type="datetime-local" value={draft.scheduledAt} onChange={(event) => setDraft({ ...draft, scheduledAt: event.target.value })} /></label>
            <label className="field field-wide">Notes<textarea rows={2} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
            <div className="field-wide flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => { setEditing(null); setDraft(emptyDraft); }}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
};
