import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from './redux/store';
import type { User } from './types';
import { logout, setUser } from './redux/slices/authSlice';
import { apiClient } from './services/api';
import { FeedbackProvider } from './components/UI/Feedback';
import { LoginPage } from './pages/loginpage';
const ClientsPage = lazy(() => import('./pages/clientspage').then((module) => ({ default: module.ClientsPage })));
const DashboardPage = lazy(() => import('./pages/dashboardpage').then((module) => ({ default: module.DashboardPage })));
const AppointmentsPage = lazy(() => import('./pages/appointmentspage').then((module) => ({ default: module.AppointmentsPage })));
const BoutiquePage = lazy(() => import('./pages/boutiquepage').then((module) => ({ default: module.BoutiquePage })));
const StaffPage = lazy(() => import('./pages/staffpage').then((module) => ({ default: module.StaffPage })));
const CashierPage = lazy(() => import('./pages/cashierpage').then((module) => ({ default: module.CashierPage })));
const AttendancePage = lazy(() => import('./pages/attendancepage').then((module) => ({ default: module.AttendancePage })));
const CommissionsPage = lazy(() => import('./pages/commissionspage').then((module) => ({ default: module.CommissionsPage })));
const ReportsPage = lazy(() => import('./pages/reportspage').then((module) => ({ default: module.ReportsPage })));
const SettingsPage = lazy(() => import('./pages/settingspage').then((module) => ({ default: module.SettingsPage })));
const LoyaltyCardPage = lazy(() => import('./pages/loyaltycardpage').then((module) => ({ default: module.LoyaltyCardPage })));
const SalesPage = lazy(() => import('./pages/salespage').then((module) => ({ default: module.SalesPage })));
const PrestationsPage = lazy(() => import('./pages/prestationspage').then((module) => ({ default: module.PrestationsPage })));
const StaffDetailPage = lazy(() => import('./pages/staffdetailpage').then((module) => ({ default: module.StaffDetailPage })));
const HistoryPage = lazy(() => import('./pages/historypage').then((module) => ({ default: module.HistoryPage })));
const HistoryDayPage = lazy(() => import('./pages/historydaypage').then((module) => ({ default: module.HistoryDayPage })));
import { Layout } from './components/Layout/layout';

// Restores the signed-in user (and refreshes the token) on page load. "Checking" is derived
// from the store: a token without a user means the session has not been confirmed yet.
const useSessionRestore = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { isAuthenticated, user } = useSelector((state: RootState) => state.auth);
  const checking = isAuthenticated && !user;

  useEffect(() => {
    if (!checking) return;
    let active = true;
    apiClient.get<{ user: User; token: string }>('/auth/me')
      .then(({ data }) => { if (active) dispatch(setUser(data)); })
      .catch(() => { if (active) dispatch(logout()); });
    return () => { active = false; };
  }, [dispatch, checking]);

  return checking;
};

const ProtectedPage = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated } = useSelector((state: RootState) => state.auth);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Layout><Suspense fallback={<p className="loading-line">Chargement…</p>}>{children}</Suspense></Layout>;
};

const GuestOnly = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated } = useSelector((state: RootState) => state.auth);
  return isAuthenticated ? <Navigate to="/dashboard" replace /> : children;
};

function App() {
  const checkingSession = useSessionRestore();

  if (checkingSession) {
    return <div className="session-loading" role="status">Chargement de votre espace…</div>;
  }

  return (
    <FeedbackProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
          {/* Public sign-up is disabled: accounts are created by the administrator in Settings. */}
          <Route path="/register" element={<Navigate to="/login" replace />} />
          <Route path="/carte/:id" element={<Suspense fallback={null}><LoyaltyCardPage /></Suspense>} />

          <Route path="/dashboard" element={<ProtectedPage><DashboardPage /></ProtectedPage>} />
          <Route path="/appointments" element={<ProtectedPage><AppointmentsPage /></ProtectedPage>} />
          <Route path="/clients" element={<ProtectedPage><ClientsPage /></ProtectedPage>} />
          <Route path="/caisse" element={<ProtectedPage><CashierPage /></ProtectedPage>} />
          <Route path="/ventes" element={<ProtectedPage><SalesPage /></ProtectedPage>} />
          <Route path="/prestations" element={<ProtectedPage><PrestationsPage /></ProtectedPage>} />
          <Route path="/boutique" element={<ProtectedPage><BoutiquePage /></ProtectedPage>} />
          <Route path="/staff" element={<ProtectedPage><StaffPage /></ProtectedPage>} />
          <Route path="/staff/:id" element={<ProtectedPage><StaffDetailPage /></ProtectedPage>} />
          <Route path="/presence" element={<ProtectedPage><AttendancePage /></ProtectedPage>} />
          <Route path="/remunerations" element={<ProtectedPage><CommissionsPage /></ProtectedPage>} />
          <Route path="/commissions" element={<Navigate to="/remunerations" replace />} />
          <Route path="/reports" element={<ProtectedPage><ReportsPage /></ProtectedPage>} />
          <Route path="/historique" element={<ProtectedPage><HistoryPage /></ProtectedPage>} />
          <Route path="/historique/:day" element={<ProtectedPage><HistoryDayPage /></ProtectedPage>} />
          <Route path="/settings" element={<ProtectedPage><SettingsPage /></ProtectedPage>} />

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </FeedbackProvider>
  );
}

export default App;
