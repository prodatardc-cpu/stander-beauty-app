import { useEffect, useState, type ChangeEvent } from 'react';
import type { Staff, StaffAttendance } from '../types';
import { apiClient } from '../services/api';
import { useFeedback } from '../components/UI/Feedback';
import { Avatar, PageHeader } from '../components/UI/PageHeader';

type AttendanceStatus = StaffAttendance['status'];

const toLocalDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getInitialDate = () => {
  const today = new Date();
  if (today.getDay() === 0) today.setDate(today.getDate() - 1);
  return toLocalDateInput(today);
};

const isSunday = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).getDay() === 0;
};

const formatDate = (value: string) => new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
}).format(new Date(`${value}T12:00:00`));

export const AttendancePage = () => {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedDate, setSelectedDate] = useState(getInitialDate);
  const [attendance, setAttendance] = useState<Record<string, AttendanceStatus>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const { notify } = useFeedback();

  useEffect(() => {
    let active = true;
    Promise.all([
      apiClient.get<Staff[]>('/staff'),
      apiClient.get<StaffAttendance[]>('/attendance', { date: selectedDate }),
    ]).then(([staffResponse, attendanceResponse]) => {
      if (!active) return;
      setStaff(staffResponse.data);
      setAttendance(Object.fromEntries(attendanceResponse.data.map((entry) => [entry.staffId, entry.status])));
    }).catch(() => {
      if (active) setError('Impossible de charger la présence pour cette date.');
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [selectedDate]);

  const handleDateChange = (event: ChangeEvent<HTMLInputElement>) => {
    const date = event.target.value;
    if (!date) return;
    if (isSunday(date)) {
      setError('La présence est suivie du lundi au samedi, pas le dimanche.');
      return;
    }
    setLoading(true);
    setAttendance({});
    setSaved(false);
    setError('');
    setSelectedDate(date);
  };

  const setMemberStatus = (staffId: string, status: AttendanceStatus) => {
    setAttendance((current) => ({ ...current, [staffId]: status }));
    setSaved(false);
    setError('');
  };

  const saveAttendance = async () => {
    if (staff.some((member) => !attendance[member.id])) {
      setError('Choisissez Présent ou Absent pour chaque membre avant d’enregistrer.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const entries = staff.map((member) => ({ staffId: member.id, status: attendance[member.id] }));
      const { data } = await apiClient.put<StaffAttendance[]>(`/attendance/${selectedDate}`, { entries });
      setAttendance(Object.fromEntries(data.map((entry) => [entry.staffId, entry.status])));
      setSaved(true);
      notify('Présences enregistrées.');
    } catch {
      setError('Impossible d’enregistrer la présence pour cette date.');
    } finally {
      setSaving(false);
    }
  };

  const presentCount = Object.values(attendance).filter((status) => status === 'present').length;
  const absentCount = Object.values(attendance).filter((status) => status === 'absent').length;

  return (
    <section className="space-y-6">
      <PageHeader
        eyebrow="Équipe"
        title="Présences"
        subtitle="Un relevé indépendant pour chaque date, du lundi au samedi."
        actions={<label className="field">Date<input type="date" value={selectedDate} onChange={handleDateChange} /></label>}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold capitalize text-gray-900">{formatDate(selectedDate)}</h2>
          <p className="mt-1 text-sm text-gray-600">{presentCount} présent(s) · {absentCount} absent(s) · {staff.length - presentCount - absentCount} à renseigner</p>
        </div>
        <button type="button" onClick={() => void saveAttendance()} disabled={loading || saving || !staff.length} className="btn btn-primary">
          {saving ? 'Enregistrement…' : saved ? 'Présences enregistrées' : 'Enregistrer la journée'}
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {loading ? <p className="py-8 text-sm text-gray-600">Chargement…</p> : (
        <div className="divide-y divide-gray-200 border-y border-gray-200">
          {staff.map((member) => (
            <div key={member.id} className="flex flex-wrap items-center justify-between gap-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={member.name} photoUrl={member.photoUrl} />
                <div className="min-w-0"><p className="truncate text-sm font-medium text-gray-900">{member.name}</p><p className="text-sm text-gray-600">{member.position}</p></div>
              </div>
              <div role="group" aria-label={`Présence de ${member.name}`} className="flex rounded border border-gray-300 p-0.5">
                {(['present', 'absent'] as const).map((status) => (
                  <button key={status} type="button" aria-pressed={attendance[member.id] === status} onClick={() => setMemberStatus(member.id, status)} className={`rounded px-3 py-1.5 text-sm ${attendance[member.id] === status ? status === 'present' ? 'bg-green-100 font-semibold text-green-800' : 'bg-red-100 font-semibold text-red-800' : 'text-gray-600 hover:bg-gray-50'}`}>
                    {status === 'present' ? 'Présent' : 'Absent'}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!staff.length && <p className="py-8 text-sm text-gray-600">Aucun membre enregistré.</p>}
        </div>
      )}
    </section>
  );
};