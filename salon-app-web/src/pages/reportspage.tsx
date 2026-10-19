import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { CashCount, JournalEntry, PeriodFigures, PeriodReport, ReportArchive, Staff } from '../types';
import { apiClient, getApiError } from '../services/api';
import { formatCurrency, type Currency } from '../services/currency';
import { formatDate, formatDateTime, formatReceiptNumber, paymentMethodLabels, toLocalDateInput } from '../utils/format';
import { useCan } from '../hooks/useAuth';
import { useFeedback } from '../components/UI/Feedback';
import { Money, MoneyByCurrency, type MoneyTone } from '../components/UI/Money';
import { EmptyState, PageHeader } from '../components/UI/PageHeader';

type Tab = 'summary' | 'sales' | 'cash' | 'debts' | 'team';
type PeriodKind = 'daily' | 'weekly' | 'monthly' | 'annual';
const currencies: Currency[] = ['USD', 'CDF'];

const today = toLocalDateInput(new Date());
const monthStart = () => {
  const date = new Date();
  return toLocalDateInput(new Date(date.getFullYear(), date.getMonth(), 1));
};

const getRange = (kind: PeriodKind, selection: string) => {
  if (kind === 'daily') return { startDate: selection, endDate: selection };
  if (kind === 'weekly') {
    const selectedDate = new Date(`${selection}T00:00:00`);
    const monday = new Date(selectedDate);
    monday.setDate(monday.getDate() - ((selectedDate.getDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    return { startDate: toLocalDateInput(monday), endDate: toLocalDateInput(sunday) };
  }
  if (kind === 'monthly') {
    const [year, month] = selection.split('-').map(Number);
    return { startDate: `${selection}-01`, endDate: `${selection}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}` };
  }
  return { startDate: `${selection}-01-01`, endDate: `${selection}-12-31` };
};

// A small two-currency table: one row per figure, one column per currency, never added together.
const FiguresTable = ({ rows, labelClassName }: { rows: { label: string; hint?: string; values: Record<Currency, number | null | undefined>; tone?: MoneyTone; strong?: boolean }[]; labelClassName?: string }) => (
  <table className="data-table compact-table figures-table">
    <thead><tr><th>Indicateur</th>{currencies.map((currency) => <th key={currency} className="num">{currency}</th>)}</tr></thead>
    <tbody>{rows.map((row) => <tr key={row.label} className={row.strong ? 'is-strong' : undefined}>
      <td className={labelClassName}>{row.label}{row.hint && <span className="cell-sub">{row.hint}</span>}</td>
      {currencies.map((currency) => <td key={currency} className="num">
        {row.values[currency] === null ? <span className="cell-sub">non calculable</span> : <Money value={row.values[currency] ?? 0} currency={currency} tone={row.tone} />}
      </td>)}
    </tr>)}</tbody>
  </table>
);

const Section = ({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) => (
  <section className="report-section">
    <div className="panel-header"><h2 className="section-title">{title}</h2>{actions}</div>
    <div className="overflow-x-auto">{children}</div>
  </section>
);

const DateRange = ({ start, end, onChange }: { start: string; end: string; onChange: (start: string, end: string) => void }) => <>
  <label className="field">Du<input type="date" value={start} max={end} onChange={(event) => onChange(event.target.value, end)} /></label>
  <label className="field">Au<input type="date" value={end} min={start} onChange={(event) => onChange(start, event.target.value)} /></label>
</>;

export const ReportsPage = () => {
  const canReadTeam = useCan('readAnyStaffFinancials');
  const canReadCash = useCan('readHistory');
  const [tab, setTab] = useState<Tab>('summary');
  const tabs: [Tab, string][] = [
    ['summary', 'Synthèse et clôtures'], ['sales', 'Ventes'],
    ...(canReadCash ? [['cash', 'Caisse'] as [Tab, string]] : []), ['debts', 'Dettes'],
    ...(canReadTeam ? [['team', 'Équipe'] as [Tab, string]] : []),
  ];
  return (
    <section className="space-y-5">
      <PageHeader eyebrow="Pilotage" title="Rapports" subtitle="Tableaux par catégorie, chaque devise dans sa colonne. Le détail jour par jour est dans l’Historique." actions={<Link to="/historique" className="btn btn-secondary btn-sm">Historique journalier</Link>} />
      <div className="tabs" role="tablist" aria-label="Catégorie de rapport">
        {tabs.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={tab === value} className={`tab${tab === value ? ' is-active' : ''}`} onClick={() => setTab(value)}>{label}</button>)}
      </div>
      {tab === 'summary' && <SummaryReport />}
      {tab === 'sales' && <SalesReport />}
      {tab === 'cash' && <CashReport />}
      {tab === 'debts' && <DebtsReport />}
      {tab === 'team' && <TeamReport />}
    </section>
  );
};

// The same five figures as the overview's daily report, in the same order.
type ReportRow = { field: Exclude<keyof PeriodFigures, 'transactionCount' | 'expenseCount'>; label: string; hint?: string; tone?: MoneyTone; strong?: boolean };
const summaryRows = (daily: boolean): ReportRow[] => [
  { field: 'serviceRevenue', label: 'Prestations' },
  { field: 'productRevenue', label: 'Produits vendus' },
  { field: 'netBalance', label: daily ? 'Total du jour en caisse' : 'Total en caisse', hint: 'Encaissé − dépenses − rémunérations ± entrées/sorties', strong: true },
  { field: 'totalExpenses', label: 'Dépenses', tone: 'expense' },
  { field: 'estimatedProfit', label: 'Bénéfice estimé', hint: 'Ventes − coût des produits − commissions − dépenses − salaires fixes versés', tone: 'profit', strong: true },
];

// The rest of the report, unchanged.
const detailRows: ReportRow[] = [
  { field: 'totalCommissions', label: 'Commissions acquises' },
  { field: 'costOfGoods', label: 'Coût d’achat des produits vendus' },
  { field: 'payroll', label: 'Rémunérations versées' },
  { field: 'adjustmentsIn', label: 'Entrées de caisse' },
  { field: 'adjustmentsOut', label: 'Sorties de caisse', tone: 'danger' },
  { field: 'outstandingAmount', label: 'Reste dû par les clients', hint: 'Sur les ventes de la période', tone: 'expense' },
];

type AttendanceReport = {
  recordedDays: number;
  staff: { staffId: string; name: string; position: string; archived: boolean; present: number; absent: number; days: { date: string; status: 'present' | 'absent' }[] }[];
};

// One day: the status saved in the attendance list; longer periods: days present and absent.
const AttendanceTable = ({ data, daily }: { data: AttendanceReport; daily: boolean }) => !data.recordedDays
  ? <EmptyState title={daily ? 'Aucune présence enregistrée pour cette journée.' : 'Aucune présence enregistrée sur cette période.'} hint="Les présences se saisissent dans la page Présences." />
  : <table className="data-table compact-table">
    <thead><tr><th>Membre</th>{daily ? <th>Statut</th> : <><th className="num">Jours présent</th><th className="num">Jours absent</th></>}</tr></thead>
    <tbody>{data.staff.map((member) => <tr key={member.staffId}>
      <td><span className="cell-title">{member.name}</span><span className="cell-sub">{member.position}{member.archived ? ' · archivé(e)' : ''}</span></td>
      {daily
        ? <td>{member.days[0] ? <span className={`badge ${member.days[0].status === 'present' ? 'badge-success' : 'badge-danger'}`}>{member.days[0].status === 'present' ? 'Présent(e)' : 'Absent(e)'}</span> : <span className="cell-sub">Non enregistré</span>}</td>
        : <><td className="num">{member.present}</td><td className="num">{member.absent}</td></>}
    </tr>)}</tbody>
  </table>;

// PDF fonts only cover Latin-1: French number spacing (narrow no-break spaces) becomes plain spaces.
const pdfText = (text: string) => text
  .replaceAll(String.fromCharCode(0x202f), ' ').replaceAll(String.fromCharCode(0xa0), ' ').replaceAll(String.fromCharCode(0x2212), '-').replaceAll('’', "'");

// Saves a closure as a PDF file with the five figures of the report.
const downloadArchive = async (entry: ReportArchive) => {
  const [{ jsPDF }, attendance] = await Promise.all([
    import('jspdf'),
    apiClient.get<AttendanceReport>('/reports/attendance', entry.kind === 'daily' ? { startDate: entry.periodKey, endDate: entry.periodKey } : { startDate: `${entry.periodKey}-01-01`, endDate: `${entry.periodKey}-12-31` })
      .then(({ data }) => data).catch(() => null),
  ]);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const daily = entry.kind === 'daily';
  const left = 20, right = 190;
  pdf.setFont('helvetica', 'bold').setFontSize(20).text('Stander Beauty', left, 25);
  pdf.setFont('helvetica', 'normal').setFontSize(10).setTextColor(150, 120, 30).text('Votre beauté, notre signature', left, 31);
  pdf.setTextColor(30, 30, 30).setFontSize(14).setFont('helvetica', 'bold')
    .text(pdfText(daily ? `Rapport du jour · ${formatDate(entry.periodStart)}` : `Rapport de l’exercice ${entry.periodKey}`), left, 46);
  pdf.setFont('helvetica', 'normal').setFontSize(9).setTextColor(110, 110, 110).text(pdfText(`Clôturé le ${formatDateTime(entry.closedAt)}`), left, 52);

  let y = 66;
  const columns = entry.breakdown ? currencies : ['Total (USD + CDF mélangés)'];
  const columnX = (index: number) => right - (columns.length - 1 - index) * 45;
  pdf.setFontSize(10).setFont('helvetica', 'bold').setTextColor(30, 30, 30).text('Indicateur', left, y);
  columns.forEach((column, index) => pdf.text(column, columnX(index), y, { align: 'right' }));
  pdf.setDrawColor(200, 200, 200).line(left, y + 3, right, y + 3);
  const sections: [string, ReportRow[]][] = [[daily ? 'Rapport du jour' : 'Rapport de l’exercice', summaryRows(daily)], ['Détails', detailRows]];
  for (const [title, rows] of sections) {
    y += 14;
    pdf.setFont('helvetica', 'bold').setFontSize(12).setTextColor(150, 120, 30).text(pdfText(title), left, y);
    for (const row of rows) {
      y += 10;
      const values = entry.breakdown
        ? currencies.map((currency) => {
          const amount = entry.breakdown!.byCurrency[currency][row.field];
          return amount === null ? 'non calculable' : formatCurrency(amount ?? 0, currency);
        })
        : [row.field in entry ? new Intl.NumberFormat('fr-FR').format(Number(entry[row.field as keyof ReportArchive])) : '—'];
      pdf.setFont('helvetica', row.strong ? 'bold' : 'normal').setFontSize(11).setTextColor(30, 30, 30).text(pdfText(row.label), left, y);
      values.forEach((text, index) => pdf.text(pdfText(text), columnX(index), y, { align: 'right' }));
      if (row.hint) pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(130, 130, 130).text(pdfText(row.hint), left, y + 4);
      pdf.setDrawColor(230, 230, 230).line(left, y + 6, right, y + 6);
    }
  }
  if (attendance) {
    y += 14;
    pdf.setFont('helvetica', 'bold').setFontSize(12).setTextColor(150, 120, 30).text('Présences', left, y);
    if (!attendance.recordedDays) {
      y += 9;
      pdf.setFont('helvetica', 'normal').setFontSize(10).setTextColor(110, 110, 110).text('Aucune présence enregistrée.', left, y);
    } else {
      y += 9;
      pdf.setFont('helvetica', 'bold').setFontSize(10).setTextColor(30, 30, 30).text('Membre', left, y);
      if (daily) pdf.text('Statut', right, y, { align: 'right' });
      else { pdf.text('Jours présent', columnX(0), y, { align: 'right' }); pdf.text('Jours absent', right, y, { align: 'right' }); }
      for (const member of attendance.staff) {
        y += 8;
        if (y > 275) { pdf.addPage(); y = 25; }
        pdf.setFont('helvetica', 'normal').setFontSize(10).setTextColor(30, 30, 30).text(pdfText(`${member.name} · ${member.position}`), left, y);
        if (daily) pdf.text(member.days[0] ? (member.days[0].status === 'present' ? 'Présent(e)' : 'Absent(e)') : 'Non enregistré', right, y, { align: 'right' });
        else { pdf.text(String(member.present), columnX(0), y, { align: 'right' }); pdf.text(String(member.absent), right, y, { align: 'right' }); }
        pdf.setDrawColor(230, 230, 230).line(left, y + 3, right, y + 3);
      }
    }
  }
  pdf.setFontSize(8).setTextColor(150, 150, 150).text(pdfText(`Document généré le ${formatDateTime(new Date())}`), left, 285);
  pdf.save(`rapport-${daily ? 'journee' : 'exercice'}-${entry.periodKey}.pdf`);
};

// E. Period summary (day, week, month, year) and closures.
const SummaryReport = () => {
  const { confirm, notify } = useFeedback();
  const canCloseDay = useCan('closeDay');
  const canCloseYear = useCan('readAnyStaffFinancials');
  const [kind, setKind] = useState<PeriodKind>('daily');
  const [selection, setSelection] = useState(today);
  const [report, setReport] = useState<PeriodReport | null>(null);
  const [attendance, setAttendance] = useState<AttendanceReport | null>(null);
  const [archives, setArchives] = useState<ReportArchive[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);
  const range = useMemo(() => getRange(kind, selection), [kind, selection]);
  const archive = archives.find((entry) => (kind === 'daily' && entry.kind === 'daily' && entry.periodKey === selection) || (kind === 'annual' && entry.kind === 'annual' && entry.periodKey === selection));
  const yearCanClose = Number(selection) < new Date().getFullYear() || (Number(selection) === new Date().getFullYear() && new Date().getMonth() === 11 && new Date().getDate() === 31);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiClient.get<PeriodReport>('/reports/period', range),
      apiClient.get<ReportArchive[]>('/reports/archives'),
      apiClient.get<AttendanceReport>('/reports/attendance', range),
    ]).then(([reportResponse, archiveResponse, attendanceResponse]) => {
      if (!active) return;
      setReport(reportResponse.data);
      setArchives(archiveResponse.data);
      setAttendance(attendanceResponse.data);
      setError('');
    }).catch((requestError) => { if (active) setError(getApiError(requestError, 'Impossible de charger cette période.')); });
    return () => { active = false; };
  }, [range, version]);

  const close = async (which: 'day' | 'year') => {
    if (!await confirm(which === 'day'
      ? { title: 'Clôturer la journée ?', message: `Les totaux du ${formatDate(`${selection}T00:00:00`)} seront figés dans les archives.`, confirmLabel: 'Clôturer' }
      : { title: `Clôturer l’exercice ${selection} ?`, message: 'Le bilan annuel sera archivé. Toutes les opérations restent consultables.', confirmLabel: 'Clôturer l’exercice' })) return;
    setSaving(true);
    try {
      const { data } = await apiClient.post<{ alreadyClosed: boolean }>(which === 'day' ? '/reports/close-day' : '/reports/close-year', which === 'day' ? { date: selection } : { year: Number(selection) });
      notify(data.alreadyClosed ? 'Cette période était déjà archivée.' : 'Période clôturée et archivée.');
      setVersion((value) => value + 1);
    } catch (requestError) {
      notify(getApiError(requestError, which === 'day' ? 'Impossible de clôturer cette journée.' : 'Seul un exercice terminé peut être clôturé.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeArchive = async (entry: ReportArchive) => {
    const label = entry.kind === 'daily' ? `la clôture du ${formatDate(entry.periodStart)}` : `la clôture de l’exercice ${entry.periodKey}`;
    if (!await confirm({ title: 'Supprimer cette archive ?', message: `Supprimer ${label} ? Les ventes et dépenses restent enregistrées, et la période pourra être clôturée à nouveau. Téléchargez l’archive avant si vous voulez la garder.`, confirmLabel: 'Supprimer' })) return;
    try {
      await apiClient.delete(`/reports/archives/${entry.id}`);
      notify('Archive supprimée.');
      setVersion((value) => value + 1);
    } catch (requestError) {
      notify(getApiError(requestError, 'Impossible de supprimer cette archive.'), 'error');
    }
  };

  const value = (field: keyof PeriodFigures) => Object.fromEntries(currencies.map((currency) => [currency, report?.byCurrency[currency][field] as number | null | undefined])) as Record<Currency, number | null | undefined>;

  return <div className="space-y-5">
    <div className="toolbar">
      <div className="tabs" role="tablist" aria-label="Période">
        {([['daily', 'Jour'], ['weekly', 'Semaine'], ['monthly', 'Mois'], ['annual', 'Année']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={kind === value} className={`tab${kind === value ? ' is-active' : ''}`} onClick={() => { setKind(value); setSelection(value === 'daily' || value === 'weekly' ? today : value === 'monthly' ? today.slice(0, 7) : today.slice(0, 4)); }}>{label}</button>)}
      </div>
      <label className="field">{kind === 'daily' ? 'Journée' : kind === 'weekly' ? 'Semaine du' : kind === 'monthly' ? 'Mois' : 'Année'}
        <input type={kind === 'daily' || kind === 'weekly' ? 'date' : kind === 'monthly' ? 'month' : 'number'} min={kind === 'annual' ? '2000' : undefined} max={kind === 'annual' ? today.slice(0, 4) : undefined} value={selection} onChange={(event) => setSelection(event.target.value)} />
      </label>
      {kind === 'daily' && <Link to={`/historique/${selection}`} className="btn btn-secondary btn-sm">Détail de la journée</Link>}
      {kind === 'daily' && canCloseDay && <button type="button" className="btn btn-primary btn-sm" disabled={saving || Boolean(archive)} onClick={() => void close('day')}>{archive ? 'Journée clôturée' : 'Clôturer la journée'}</button>}
      {kind === 'annual' && canCloseYear && <button type="button" className="btn btn-primary btn-sm" disabled={saving || !yearCanClose || Boolean(archive)} onClick={() => void close('year')}>{archive ? 'Exercice clôturé' : 'Clôturer l’exercice'}</button>}
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {kind !== 'daily' && <p className="text-sm text-gray-600">Du {formatDate(`${range.startDate}T00:00:00`)} au {formatDate(`${range.endDate}T00:00:00`)}</p>}
    {archive && <p className="text-xs font-semibold uppercase text-orange-800">Archivé le {formatDateTime(archive.closedAt)} · chiffres ci-dessous recalculés depuis les opérations enregistrées</p>}
    {report && <>
      {report.unclassifiedSales > 0 && <p role="status" className="text-sm text-amber-700">{report.unclassifiedSales} ancienne(s) vente(s) sans devise ne figure(nt) dans aucune colonne.</p>}
      <div className="report-grid">
        <Section title={kind === 'daily' ? 'Rapport du jour' : 'Rapport de la période'}>
          <FiguresTable labelClassName="font-century" rows={summaryRows(kind === 'daily').map((row) => ({ ...row, values: value(row.field) }))} />
        </Section>
        <Section title="Détails">
          <FiguresTable rows={detailRows.map((row) => ({ ...row, values: value(row.field) }))} />
        </Section>
      </div>
      {attendance && <Section title="Présences">
        <AttendanceTable data={attendance} daily={kind === 'daily'} />
      </Section>}
    </>}
    <Section title="Archives des clôtures">
      {archives.length ? <table className="data-table compact-table">
        <thead><tr><th>Type</th><th>Période</th><th className="num">Encaissé</th><th className="num">Dépenses</th><th className="num">Solde</th><th>Archivé le</th><th className="actions">Actions</th></tr></thead>
        <tbody>{archives.map((entry) => {
          const values = (field: 'amountReceived' | 'totalExpenses' | 'netBalance') => entry.breakdown
            ? Object.fromEntries(currencies.map((currency) => [currency, Number(entry.breakdown!.byCurrency[currency][field])])) as Record<Currency, number>
            : null;
          const cell = (field: 'amountReceived' | 'totalExpenses' | 'netBalance', tone?: MoneyTone) => {
            const split = values(field);
            return split ? <MoneyByCurrency values={split} tone={tone} /> : <span className="cell-sub">{new Intl.NumberFormat('fr-FR').format(Number(entry[field]))} (USD + CDF mélangés)</span>;
          };
          return <tr key={entry.id}>
            <td>{entry.kind === 'daily' ? 'Journée' : 'Exercice'}</td>
            <td>{entry.kind === 'daily' ? formatDate(entry.periodStart) : entry.periodKey}</td>
            <td className="num">{cell('amountReceived')}</td><td className="num">{cell('totalExpenses', 'expense')}</td><td className="num">{cell('netBalance')}</td>
            <td>{formatDate(entry.closedAt)}</td>
            <td className="actions"><span className="row-actions">
              {entry.kind === 'daily' && <Link to={`/historique/${entry.periodKey}`} className="link-button">Voir</Link>}
              <button type="button" className="link-button" onClick={() => void downloadArchive(entry)}>Télécharger</button>
              {(entry.kind === 'daily' ? canCloseDay : canCloseYear) && <button type="button" className="link-button is-danger" onClick={() => void removeArchive(entry)}>Supprimer</button>}
            </span></td>
          </tr>;
        })}</tbody>
      </table> : <EmptyState title="Aucune clôture pour le moment." />}
    </Section>
  </div>;
};

type SalesRow = { saleId: string; receiptNumber: number; date: string; type: 'service' | 'product'; name: string; quantity: number; unitPrice: number; amount: number; currency: Currency | null; staffName: string | null; client: string | null };
type SalesTotals = Record<Currency, { services: number; products: number; servicesQuantity: number; productsQuantity: number; total: number }>;

// A. Sales: products sold and services performed.
const SalesReport = () => {
  const [start, setStart] = useState(monthStart);
  const [end, setEnd] = useState(today);
  const [type, setType] = useState('');
  const [currency, setCurrency] = useState('');
  const [staffId, setStaffId] = useState('');
  const [staff, setStaff] = useState<Staff[]>([]);
  const [data, setData] = useState<{ rows: SalesRow[]; totals: SalesTotals } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => { apiClient.get<Staff[]>('/staff', { includeArchived: 'true' }).then(({ data: list }) => setStaff(list)).catch(() => undefined); }, []);
  useEffect(() => {
    let active = true;
    const params: Record<string, string> = { startDate: start, endDate: end };
    if (type) params.type = type;
    if (currency) params.currency = currency;
    if (staffId) params.staffId = staffId;
    apiClient.get<{ rows: SalesRow[]; totals: SalesTotals }>('/reports/sales', params)
      .then(({ data: result }) => { if (active) { setData(result); setError(''); } })
      .catch((requestError) => { if (active) setError(getApiError(requestError, 'Impossible de charger le rapport des ventes.')); });
    return () => { active = false; };
  }, [start, end, type, currency, staffId]);

  const totals = (field: keyof SalesTotals[Currency]) => Object.fromEntries(currencies.map((value) => [value, data?.totals[value][field] ?? 0])) as Record<Currency, number>;
  return <div className="space-y-5">
    <div className="toolbar">
      <DateRange start={start} end={end} onChange={(nextStart, nextEnd) => { setStart(nextStart); setEnd(nextEnd); }} />
      <label className="field">Catégorie<select value={type} onChange={(event) => setType(event.target.value)}><option value="">Prestations et produits</option><option value="service">Prestations</option><option value="product">Produits</option></select></label>
      <label className="field">Employé<select value={staffId} onChange={(event) => setStaffId(event.target.value)}><option value="">Tous</option>{staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
      <label className="field">Devise<select value={currency} onChange={(event) => setCurrency(event.target.value)}><option value="">Toutes</option><option value="USD">USD</option><option value="CDF">CDF</option></select></label>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {data && <>
      <Section title="Totaux">
        <table className="data-table compact-table figures-table">
          <thead><tr><th>Catégorie</th>{currencies.map((value) => <th key={value} className="num">{value}</th>)}</tr></thead>
          <tbody>
            <tr><td>Prestations réalisées<span className="cell-sub">{currencies.map((value) => `${data.totals[value].servicesQuantity} en ${value}`).join(' · ')}</span></td>{currencies.map((value) => <td key={value} className="num"><Money value={totals('services')[value]} currency={value} /></td>)}</tr>
            <tr><td>Produits vendus<span className="cell-sub">{currencies.map((value) => `${data.totals[value].productsQuantity} en ${value}`).join(' · ')}</span></td>{currencies.map((value) => <td key={value} className="num"><Money value={totals('products')[value]} currency={value} /></td>)}</tr>
            <tr className="is-strong"><td>Total général</td>{currencies.map((value) => <td key={value} className="num"><Money value={totals('total')[value]} currency={value} /></td>)}</tr>
          </tbody>
        </table>
      </Section>
      <Section title={`Détail (${data.rows.length} ligne(s))`}>
        {data.rows.length ? <table className="data-table compact-table">
          <thead><tr><th>Date</th><th>Reçu</th><th>Catégorie</th><th>Article</th><th className="num">Qté</th><th className="num">P.U.</th><th className="num">Montant</th><th>Employé</th><th>Client</th></tr></thead>
          <tbody>{data.rows.map((row, index) => <tr key={`${row.saleId}-${index}`}>
            <td className="whitespace-nowrap">{formatDateTime(row.date)}</td><td>{formatReceiptNumber(row.receiptNumber)}</td>
            <td>{row.type === 'service' ? 'Prestation' : 'Produit'}</td><td>{row.name}</td><td className="num">{row.quantity}</td>
            <td className="num">{row.currency ? formatCurrency(row.unitPrice, row.currency) : '—'}</td>
            <td className="num">{row.currency ? <Money value={row.amount} currency={row.currency} /> : '—'}</td>
            <td>{row.staffName ?? '—'}</td><td>{row.client ?? 'Client de passage'}</td>
          </tr>)}</tbody>
        </table> : <EmptyState title="Aucune vente pour ces filtres." />}
      </Section>
    </>}
  </div>;
};

type CashTotals = Record<Currency, { in: number; out: number; balance: number; cashIn: number; cashOut: number; cashBalance: number }>;
const journalLabels: Record<JournalEntry['type'], string> = {
  sale_payment: 'Encaissement', debt_payment: 'Règlement de dette', refund: 'Remboursement', expense: 'Dépense',
  expense_cancel: 'Dépense annulée', payout: 'Rémunération', adjustment: 'Entrée / sortie',
};

// B. Cash: money in and out, balances and counts.
const CashReport = () => {
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [data, setData] = useState<{ entries: JournalEntry[]; totals: CashTotals; counts: CashCount[] } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    apiClient.get<{ entries: JournalEntry[]; totals: CashTotals; counts: CashCount[] }>('/reports/cash', { startDate: start, endDate: end })
      .then(({ data: result }) => { if (active) { setData(result); setError(''); } })
      .catch((requestError) => { if (active) setError(getApiError(requestError, 'Impossible de charger le rapport de caisse.')); });
    return () => { active = false; };
  }, [start, end]);

  const value = (field: keyof CashTotals[Currency]) => Object.fromEntries(currencies.map((currency) => [currency, data?.totals[currency][field] ?? 0])) as Record<Currency, number>;
  const byType = (type: JournalEntry['type'], direction: 'in' | 'out') => Object.fromEntries(currencies.map((currency) => [currency,
    (data?.entries ?? []).filter((entry) => entry.type === type && entry.direction === direction && entry.currency === currency).reduce((sum, entry) => sum + entry.amount, 0)])) as Record<Currency, number>;

  return <div className="space-y-5">
    <div className="toolbar"><DateRange start={start} end={end} onChange={(nextStart, nextEnd) => { setStart(nextStart); setEnd(nextEnd); }} /></div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {data && <>
      <div className="report-grid">
        <Section title="Encaissements et décaissements">
          <FiguresTable rows={[
            { label: 'Encaissements des ventes', values: byType('sale_payment', 'in'), tone: 'profit' },
            { label: 'Règlements de dettes', values: byType('debt_payment', 'in'), tone: 'profit' },
            { label: 'Entrées de caisse', values: byType('adjustment', 'in') },
            { label: 'Dépenses', values: byType('expense', 'out'), tone: 'expense' },
            { label: 'Dépenses annulées (retour)', values: byType('expense_cancel', 'in') },
            { label: 'Rémunérations', values: byType('payout', 'out') },
            { label: 'Sorties de caisse', values: byType('adjustment', 'out'), tone: 'danger' },
            { label: 'Solde calculé (tous modes)', values: value('balance'), strong: true },
            { label: 'Solde en espèces', hint: 'À comparer au comptage', values: value('cashBalance'), strong: true },
          ]} />
        </Section>
        <Section title="Comptages et écarts">
          {data.counts.length ? <table className="data-table compact-table">
            <thead><tr><th>Jour</th><th className="num">Attendu</th><th className="num">Compté</th><th className="num">Écart</th></tr></thead>
            <tbody>{data.counts.map((count) => {
              const difference = Number(count.countedAmount) - Number(count.expectedAmount);
              return <tr key={count.id}><td>{formatDate(`${count.day}T00:00:00`)}<span className="cell-sub">{count.note ?? ''}</span></td>
                <td className="num"><Money value={count.expectedAmount} currency={count.currency} /></td><td className="num"><Money value={count.countedAmount} currency={count.currency} /></td>
                <td className="num"><Money value={difference} currency={count.currency} tone={Math.abs(difference) < 0.005 ? 'profit' : 'danger'} /></td></tr>;
            })}</tbody>
          </table> : <EmptyState title="Aucun comptage sur la période." hint="Le comptage se fait depuis la Caisse." />}
        </Section>
      </div>
      <Section title={`Journal (${data.entries.length} opération(s))`}>
        {data.entries.length ? <table className="data-table compact-table">
          <thead><tr><th>Date</th><th>Type</th><th>Libellé</th><th>Mode</th><th className="num">Entrée</th><th className="num">Sortie</th><th>Par</th></tr></thead>
          <tbody>{data.entries.map((entry) => <tr key={entry.id}>
            <td className="whitespace-nowrap">{formatDateTime(entry.at)}</td><td>{journalLabels[entry.type]}</td>
            <td>{entry.label}{entry.receiptNumber ? ` · ${formatReceiptNumber(entry.receiptNumber)}` : ''}</td><td>{paymentMethodLabels[entry.paymentMethod] ?? entry.paymentMethod}</td>
            <td className="num">{entry.direction === 'in' && <Money value={entry.amount} currency={entry.currency} tone="profit" />}</td>
            <td className="num">{entry.direction === 'out' && <Money value={entry.amount} currency={entry.currency} tone={entry.type === 'expense' ? 'expense' : 'danger'} />}</td>
            <td><span className="cell-sub">{entry.userEmail ?? '—'}</span></td>
          </tr>)}</tbody>
        </table> : <EmptyState title="Aucun mouvement sur la période." />}
      </Section>
    </>}
  </div>;
};

type DebtRow = { saleId: string; receiptNumber: number; date: string; client: string; currency: Currency | null; initialAmount: number; paidAmount: number; remainingAmount: number; lastPaymentAt: string | null; status: 'open' | 'settled' };
type DebtTotals = Record<Currency, { initialAmount: number; paidAmount: number; remainingAmount: number; count: number }>;

// C. Debts: what clients still owe, and what they settled.
const DebtsReport = () => {
  const [status, setStatus] = useState<'open' | 'settled' | 'all'>('open');
  const [currency, setCurrency] = useState('');
  const [data, setData] = useState<{ rows: DebtRow[]; totals: DebtTotals } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    apiClient.get<{ rows: DebtRow[]; totals: DebtTotals }>('/reports/debts', { status, ...(currency && { currency }) })
      .then(({ data: result }) => { if (active) { setData(result); setError(''); } })
      .catch((requestError) => { if (active) setError(getApiError(requestError, 'Impossible de charger les dettes.')); });
    return () => { active = false; };
  }, [status, currency]);

  return <div className="space-y-5">
    <div className="toolbar">
      <label className="field">Statut<select value={status} onChange={(event) => setStatus(event.target.value as 'open' | 'settled' | 'all')}><option value="open">En cours</option><option value="settled">Soldées</option><option value="all">Toutes</option></select></label>
      <label className="field">Devise<select value={currency} onChange={(event) => setCurrency(event.target.value)}><option value="">Toutes</option><option value="USD">USD</option><option value="CDF">CDF</option></select></label>
      <Link to="/ventes" className="btn btn-secondary btn-sm">Encaisser un règlement</Link>
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {data && <>
      <Section title="Totaux">
        <FiguresTable rows={[
          { label: 'Montant initial', values: Object.fromEntries(currencies.map((value) => [value, data.totals[value].initialAmount])) as Record<Currency, number> },
          { label: 'Déjà payé', values: Object.fromEntries(currencies.map((value) => [value, data.totals[value].paidAmount])) as Record<Currency, number>, tone: 'profit' },
          { label: 'Reste dû', values: Object.fromEntries(currencies.map((value) => [value, data.totals[value].remainingAmount])) as Record<Currency, number>, tone: 'expense', strong: true },
        ]} />
      </Section>
      <Section title={`Détail (${data.rows.length})`}>
        {data.rows.length ? <table className="data-table compact-table">
          <thead><tr><th>Date</th><th>Reçu</th><th>Client</th><th className="num">Montant initial</th><th className="num">Payé</th><th className="num">Reste</th><th>Dernier règlement</th><th>Statut</th></tr></thead>
          <tbody>{data.rows.map((row) => {
            const value = (amount: number, tone?: MoneyTone) => row.currency ? <Money value={amount} currency={row.currency} tone={tone} /> : '—';
            return <tr key={row.saleId}>
              <td className="whitespace-nowrap">{formatDate(row.date)}</td><td>{formatReceiptNumber(row.receiptNumber)}</td><td>{row.client}</td>
              <td className="num">{value(row.initialAmount)}</td><td className="num">{value(row.paidAmount)}</td><td className="num">{value(row.remainingAmount, row.remainingAmount > 0 ? 'expense' : undefined)}</td>
              <td>{row.lastPaymentAt ? formatDateTime(row.lastPaymentAt) : '—'}</td>
              <td>{row.status === 'open' ? <span className="badge badge-warning">En cours</span> : <span className="badge badge-success">Soldée</span>}</td>
            </tr>;
          })}</tbody>
        </table> : <EmptyState title={status === 'open' ? 'Aucune dette en cours.' : 'Aucune dette pour ces filtres.'} />}
      </Section>
    </>}
  </div>;
};

type TeamMember = {
  staffId: string; name: string; position: string; payType: 'commission' | 'fixed'; commissionRate: number; monthlySalary: number; archivedAt: string | null;
  byCurrency: Record<Currency, { servicesCount: number; revenue: number; earned: number; advances: number; payments: number; remaining: number }>;
};

// D. Team: services, attributed turnover, remuneration, advances and payments, balance.
const TeamReport = () => {
  const [start, setStart] = useState(monthStart);
  const [end, setEnd] = useState(today);
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    apiClient.get<{ members: TeamMember[] }>('/reports/team', { startDate: start, endDate: end })
      .then(({ data }) => { if (active) { setMembers(data.members); setError(''); } })
      .catch((requestError) => { if (active) setError(getApiError(requestError, 'Impossible de charger le rapport de l’équipe.')); });
    return () => { active = false; };
  }, [start, end]);

  const pick = (member: TeamMember, field: keyof TeamMember['byCurrency'][Currency]) =>
    Object.fromEntries(currencies.map((currency) => [currency, member.byCurrency[currency][field]])) as Record<Currency, number>;

  return <div className="space-y-5">
    <div className="toolbar"><DateRange start={start} end={end} onChange={(nextStart, nextEnd) => { setStart(nextStart); setEnd(nextEnd); }} /></div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {members && <Section title="Équipe">
      {members.length ? <table className="data-table compact-table">
        <thead><tr><th>Employé</th><th className="num">Prestations</th><th className="num">CA attribué</th><th>Rémunération</th><th className="num">Acquis</th><th className="num">Avances</th><th className="num">Paiements</th><th className="num">Reste à payer</th></tr></thead>
        <tbody>{members.filter((member) => !member.archivedAt || currencies.some((currency) => member.byCurrency[currency].servicesCount || member.byCurrency[currency].remaining)).map((member) => <tr key={member.staffId}>
          <td><Link to={`/staff/${member.staffId}`} className="cell-title link-button">{member.name}</Link><span className="cell-sub">{member.position}</span></td>
          <td className="num">{currencies.reduce((sum, currency) => sum + member.byCurrency[currency].servicesCount, 0)}</td>
          <td className="num"><MoneyByCurrency values={pick(member, 'revenue')} /></td>
          <td>{member.payType === 'fixed' ? 'Salaire fixe' : `Commission ${member.commissionRate} %`}</td>
          <td className="num"><MoneyByCurrency values={pick(member, 'earned')} /></td>
          <td className="num"><MoneyByCurrency values={pick(member, 'advances')} tone="expense" /></td>
          <td className="num"><MoneyByCurrency values={pick(member, 'payments')} /></td>
          <td className="num"><MoneyByCurrency values={pick(member, 'remaining')} tone="expense" /></td>
        </tr>)}</tbody>
      </table> : <EmptyState title="Aucun membre dans l’équipe." />}
      <p className="mt-2 text-xs text-gray-500">« Reste à payer » est le solde à ce jour, toutes périodes confondues ; les autres colonnes portent sur la période choisie.</p>
    </Section>}
  </div>;
};
