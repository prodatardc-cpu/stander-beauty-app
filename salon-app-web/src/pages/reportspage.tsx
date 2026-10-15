import { useEffect, useMemo, useState } from 'react';
import type { ReportArchive } from '../types';
import { apiClient } from '../services/api';
import { formatCurrency, useCurrency } from '../services/currency';
import { useCan, useIsAdmin } from '../hooks/useAuth';
import { useFeedback } from '../components/UI/Feedback';
import { PageHeader } from '../components/UI/PageHeader';

type ReportKind = 'daily' | 'weekly' | 'monthly' | 'annual';
type PeriodReport = {
  period: { start: string; end: string };
  totalSales: number;
  amountReceived: number;
  outstandingAmount: number;
  serviceRevenue: number;
  productRevenue: number;
  totalExpenses: number;
  netBalance: number;
  totalCommissions: number;
  transactionCount: number;
  expenseCount: number;
};

const dateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const today = dateInput(new Date());
const currentMonth = today.slice(0, 7);
const currentYear = today.slice(0, 4);
const formatDate = (value: string) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(value));

const getRange = (kind: ReportKind, selection: string) => {
  if (kind === 'daily') return { startDate: selection, endDate: selection };
  if (kind === 'weekly') {
    const selectedDate = new Date(`${selection}T00:00:00`);
    const dayFromMonday = (selectedDate.getDay() + 6) % 7;
    const monday = new Date(selectedDate);
    monday.setDate(monday.getDate() - dayFromMonday);
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    return { startDate: dateInput(monday), endDate: dateInput(sunday) };
  }
  if (kind === 'monthly') {
    const [year, month] = selection.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    return { startDate: `${selection}-01`, endDate: `${selection}-${String(lastDay).padStart(2, '0')}` };
  }
  return { startDate: `${selection}-01-01`, endDate: `${selection}-12-31` };
};

export const ReportsPage = () => {
  const currency = useCurrency();
  const { confirm } = useFeedback();
  const canCloseDay = useCan('closeDay');
  const canCloseYear = useIsAdmin();
  const [kind, setKind] = useState<ReportKind>('daily');
  const [selection, setSelection] = useState(today);
  const [report, setReport] = useState<PeriodReport | null>(null);
  const [archives, setArchives] = useState<ReportArchive[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const range = useMemo(() => getRange(kind, selection), [kind, selection]);
  const dayArchive = kind === 'daily' ? archives.find((archive) => archive.kind === 'daily' && archive.periodKey === selection) : undefined;
  const yearArchive = kind === 'annual' ? archives.find((archive) => archive.kind === 'annual' && archive.periodKey === selection) : undefined;
  const selectedYearCanClose = Number(selection) < new Date().getFullYear() || (Number(selection) === new Date().getFullYear() && new Date().getMonth() === 11 && new Date().getDate() === 31);

  const loadArchives = async () => {
    const { data } = await apiClient.get<ReportArchive[]>('/reports/archives');
    setArchives(data);
  };

  useEffect(() => {
    let active = true;
    Promise.all([
      apiClient.get<PeriodReport>('/reports/period', { startDate: range.startDate, endDate: range.endDate }),
      apiClient.get<ReportArchive[]>('/reports/archives'),
    ]).then(([reportResponse, archiveResponse]) => {
      if (!active) return;
      setError('');
      setNotice('');
      setArchives(archiveResponse.data);
      const snapshot = archiveResponse.data.find((archive) =>
        (kind === 'daily' && archive.kind === 'daily' && archive.periodKey === selection) ||
        (kind === 'annual' && archive.kind === 'annual' && archive.periodKey === selection)
      );
      setReport(snapshot ? {
        period: { start: snapshot.periodStart, end: snapshot.periodEnd },
        totalSales: Number(snapshot.totalSales),
        amountReceived: Number(snapshot.amountReceived),
        outstandingAmount: Number(snapshot.outstandingAmount),
        serviceRevenue: Number(snapshot.serviceRevenue),
        productRevenue: Number(snapshot.productRevenue),
        totalExpenses: Number(snapshot.totalExpenses),
        netBalance: Number(snapshot.netBalance),
        totalCommissions: Number(snapshot.totalCommissions),
        transactionCount: snapshot.transactionCount,
        expenseCount: snapshot.expenseCount,
      } : reportResponse.data);
    }).catch(() => { if (active) setError('Impossible de charger cette période et son historique.'); });
    return () => { active = false; };
  }, [kind, range.startDate, range.endDate, selection]);

  const closeDay = async () => {
    if (!await confirm({ title: 'Clôturer la journée ?', message: `Le bilan du ${formatDate(`${selection}T00:00:00`)} sera figé et conservé dans l’historique.`, confirmLabel: 'Clôturer' })) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data } = await apiClient.post<{ alreadyClosed: boolean }>('/reports/close-day', { date: selection });
      await loadArchives();
      setNotice(data.alreadyClosed ? 'Cette journée était déjà archivée. Son rapport historique est conservé.' : 'Journée clôturée et rapport ajouté à l’historique.');
    } catch {
      setError('Impossible de clôturer cette journée. Vérifie que la date n’est pas dans le futur.');
    } finally {
      setSaving(false);
    }
  };

  const closeYear = async () => {
    if (!await confirm({ title: `Clôturer l’exercice ${selection} ?`, message: 'Le bilan annuel sera archivé. Les ventes et dépenses resteront consultables dans l’historique.', confirmLabel: 'Clôturer l’exercice' })) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data } = await apiClient.post<{ alreadyClosed: boolean }>('/reports/close-year', { year: Number(selection) });
      await loadArchives();
      setNotice(data.alreadyClosed ? `L’exercice ${selection} était déjà archivé.` : `Exercice ${selection} clôturé et archivé. Le nouvel exercice suit automatiquement le calendrier.`);
    } catch {
      setError('Seul un exercice terminé peut être clôturé.');
    } finally {
      setSaving(false);
    }
  };

  return <section className="space-y-6">
    <PageHeader
      eyebrow="Pilotage"
      title="Rapports et clôtures"
      subtitle="Suivi de caisse et historique des exercices."
      actions={<div className="tabs" role="tablist" aria-label="Période du rapport">
        {([['daily', 'Journalier'], ['weekly', 'Hebdomadaire'], ['monthly', 'Mensuel'], ['annual', 'Annuel']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={kind === value} onClick={() => { setKind(value); setSelection(value === 'daily' || value === 'weekly' ? today : value === 'monthly' ? currentMonth : currentYear); }} className={`tab${kind === value ? ' is-active' : ''}`}>{label}</button>)}
      </div>}
    />

    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-gray-200 pb-5">
      <label className="space-y-1 text-sm font-medium text-gray-700">{kind === 'daily' ? 'Journée' : kind === 'weekly' ? 'Semaine du' : kind === 'monthly' ? 'Mois' : 'Année'}<input type={kind === 'daily' || kind === 'weekly' ? 'date' : kind === 'monthly' ? 'month' : 'number'} min={kind === 'annual' ? '2000' : undefined} max={kind === 'annual' ? currentYear : undefined} value={selection} onChange={(event) => setSelection(event.target.value)} className="block rounded border border-gray-300 bg-white px-3 py-2 font-normal" /></label>
      {kind === 'daily' && canCloseDay && <button type="button" disabled={saving || Boolean(dayArchive)} onClick={() => void closeDay()} className="rounded bg-orange-700 px-4 py-2 text-sm text-white hover:bg-orange-800 disabled:opacity-50">{dayArchive ? 'Journée archivée' : saving ? 'Clôture…' : 'Clôturer la journée'}</button>}
      {kind === 'annual' && canCloseYear && <button type="button" disabled={saving || !selectedYearCanClose || Boolean(yearArchive)} onClick={() => void closeYear()} className="rounded bg-orange-700 px-4 py-2 text-sm text-white hover:bg-orange-800 disabled:opacity-50">{yearArchive ? 'Exercice archivé' : saving ? 'Clôture…' : 'Clôturer et archiver l’exercice'}</button>}
    </div>

    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-sm text-green-800">{notice}</p>}
    {report && <>
      {kind === 'weekly' && <p className="text-sm font-medium text-gray-600">Semaine du {formatDate(`${range.startDate}T00:00:00`)} au {formatDate(`${range.endDate}T00:00:00`)}</p>}
      {(dayArchive || yearArchive) && <p className="text-xs font-semibold uppercase text-orange-800">Bilan archivé le {formatDate((dayArchive ?? yearArchive)!.closedAt)}</p>}
      <div className="grid gap-5 border-b border-gray-200 pb-6 sm:grid-cols-2 lg:grid-cols-4">
        <div><p className="text-sm text-gray-600">Ventes ({report.transactionCount})</p><p className="mt-1 text-xl font-semibold">{formatCurrency(report.totalSales, currency)}</p></div>
        <div><p className="text-sm text-gray-600">Argent encaissé</p><p className="mt-1 text-xl font-semibold">{formatCurrency(report.amountReceived, currency)}</p><p className="text-xs text-gray-500">Reste dû : {formatCurrency(report.outstandingAmount, currency)}</p></div>
        <div><p className="text-sm text-gray-600">Dépenses ({report.expenseCount})</p><p className="mt-1 text-xl font-semibold">{formatCurrency(report.totalExpenses, currency)}</p></div>
        <div><p className="text-sm text-gray-600">Solde net</p><p className="mt-1 text-xl font-semibold">{formatCurrency(report.netBalance, currency)}</p></div>
      </div>
      <div className="grid gap-5 border-b border-gray-200 pb-6 sm:grid-cols-3"><div><p className="text-sm text-gray-600">Prestations</p><p className="mt-1 text-lg font-semibold">{formatCurrency(report.serviceRevenue, currency)}</p></div><div><p className="text-sm text-gray-600">Produits vendus</p><p className="mt-1 text-lg font-semibold">{formatCurrency(report.productRevenue, currency)}</p></div><div><p className="text-sm text-gray-600">Commissions calculées</p><p className="mt-1 text-lg font-semibold">{formatCurrency(report.totalCommissions, currency)}</p></div></div>
    </>}

    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold text-gray-900">Historique des clôtures</h2><p className="text-sm text-gray-600">Les rapports archivés restent disponibles après le changement d’exercice.</p></div><span className="text-sm text-gray-500">{archives.length} archive(s)</span></div>
      <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm"><thead><tr className="border-b border-gray-300 text-xs uppercase text-gray-500"><th className="py-3 pr-4 font-medium">Type</th><th className="py-3 pr-4 font-medium">Période</th><th className="py-3 pr-4 text-right font-medium">Encaissé</th><th className="py-3 pr-4 text-right font-medium">Dépenses</th><th className="py-3 pr-4 text-right font-medium">Net</th><th className="py-3 text-right font-medium">Archivé le</th></tr></thead><tbody>{archives.map((archive) => <tr key={archive.id} className="border-b border-gray-200"><td className="py-3 pr-4">{archive.kind === 'daily' ? 'Journalier' : 'Annuel'}</td><td className="py-3 pr-4">{archive.kind === 'daily' ? formatDate(archive.periodStart) : archive.periodKey}</td><td className="py-3 pr-4 text-right">{formatCurrency(archive.amountReceived, currency)}</td><td className="py-3 pr-4 text-right">{formatCurrency(archive.totalExpenses, currency)}</td><td className="py-3 pr-4 text-right">{formatCurrency(archive.netBalance, currency)}</td><td className="py-3 text-right">{formatDate(archive.closedAt)}</td></tr>)}{!archives.length && <tr><td colSpan={6} className="py-8 text-sm text-gray-600">Aucune clôture archivée pour le moment.</td></tr>}</tbody></table></div>
    </section>
  </section>;
};
