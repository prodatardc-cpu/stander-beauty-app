import { useDispatch } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
import { logout } from '../../redux/slices/authSlice';
import { useCurrentUser } from '../../hooks/useAuth';
import { roleLabels } from '../../utils/format';
import { ThemeToggle } from '../Common/ThemeToggle';
import { pageTitles } from './sidebar';

export const Navbar = () => {
  const user = useCurrentUser();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const today = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

  const signOut = () => {
    dispatch(logout());
    navigate('/login', { replace: true });
  };

  return (
    <header className="studio-topbar">
      <div className="topbar-title">
        <p className="topbar-caption">{pageTitles[pathname] ?? 'Stander Beauty'}</p>
        <span className="topbar-date">{today}</span>
      </div>
      <div className="topbar-account">
        <ThemeToggle />
        <span className="account-monogram" aria-hidden="true">
          {user?.email?.slice(0, 1).toUpperCase() ?? 'S'}
        </span>
        <span className="account-details">
          <span className="account-email">{user?.email ?? 'Compte salon'}</span>
          <span className="account-role">{user ? roleLabels[user.role] : '—'}</span>
        </span>
        <button type="button" className="signout-button" onClick={signOut}>Déconnexion</button>
      </div>
    </header>
  );
};
