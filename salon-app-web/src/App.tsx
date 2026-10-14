import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from './redux/store';
import type { User } from './types';
import { logout, setUser } from './redux/slices/authSlice';
import { apiClient } from './services/api';
import { FeedbackProvider } from './components/UI/Feedback';
import { LoginPage } from './pages/loginpage';
import { ClientsPage } from './pages/clientspage';
import { DashboardPage } from './pages/dashboardpage';
import { AppointmentsPage } from './pages/appointmentspage';
import { BoutiquePage } from './pages/boutiquepage';
import { StaffPage } from './pages/staffpage';
import { CashierPage } from './pages/cashierpage';
import { AttendancePage } from './pages/attendancepage';
import { CommissionsPage } from './pages/commissionspage';
import { ReportsPage } from './pages/reportspage';
import { SettingsPage } from './pages/settingspage';
import { LoyaltyCardPage } from './pages/loyaltycardpage';
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
  return <Layout>{children}</Layout>;
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
          <Route path="/carte/:id" element={<LoyaltyCardPage />} />

          <Route path="/dashboard" element={<ProtectedPage><DashboardPage /></ProtectedPage>} />
          <Route path="/appointments" element={<ProtectedPage><AppointmentsPage /></ProtectedPage>} />
          <Route path="/clients" element={<ProtectedPage><ClientsPage /></ProtectedPage>} />
          <Route path="/caisse" element={<ProtectedPage><CashierPage /></ProtectedPage>} />
          <Route path="/boutique" element={<ProtectedPage><BoutiquePage /></ProtectedPage>} />
          <Route path="/staff" element={<ProtectedPage><StaffPage /></ProtectedPage>} />
          <Route path="/presence" element={<ProtectedPage><AttendancePage /></ProtectedPage>} />
          <Route path="/commissions" element={<ProtectedPage><CommissionsPage /></ProtectedPage>} />
          <Route path="/reports" element={<ProtectedPage><ReportsPage /></ProtectedPage>} />
          <Route path="/settings" element={<ProtectedPage><SettingsPage /></ProtectedPage>} />

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </FeedbackProvider>
  );
}

export default App;
