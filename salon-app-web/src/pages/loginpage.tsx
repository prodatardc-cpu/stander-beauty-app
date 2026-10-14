import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../redux/store';
import type { User } from '../types';
import { setUser } from '../redux/slices/authSlice';
import { apiClient, getApiError } from '../services/api';
import { ThemeToggle } from '../components/Common/ThemeToggle';

export const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { data } = await apiClient.post<{ user: User; token: string }>(
        '/auth/login',
        { email, password }
      );
      dispatch(setUser(data));
      navigate('/dashboard', { replace: true });
    } catch (requestError) {
      setError(getApiError(requestError, 'E-mail ou mot de passe incorrect.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <aside className="auth-visual" aria-label="Univers du salon">
        <img
          src="https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1800&q=85"
          alt="Coiffeuse au travail dans un salon lumineux"
          fetchPriority="high"
        />
        <div className="auth-visual-shade" />
        <div className="auth-visual-copy">
          <p className="auth-visual-kicker">L'ESPACE DU SALON</p>
          <h2>Le quotidien,<br />avec plus de légèreté.</h2>
          <p>Un lieu pour prendre soin de l’équipe, des rendez-vous et de chaque détail.</p>
        </div>
      </aside>

      <main className="auth-panel">
        <div className="auth-card">
          <div className="auth-brand-row">
            <Link to="/login" className="auth-wordmark" aria-label="Stander Beauty">
              <img className="studio-monogram" src="/salon-mark.svg" alt="" />
              <span className="auth-brand-copy">
                <strong>Stander Beauty</strong>
                <small>Bunglon Cript</small>
              </span>
            </Link>
            <ThemeToggle />
          </div>
          <p className="auth-eyebrow">RAVI DE VOUS REVOIR</p>
          <h1 className="auth-title">Bon retour.</h1>
          <p className="auth-intro">Connectez-vous pour retrouver votre espace de travail.</p>
          {error && <p role="alert" className="auth-error">{error}</p>}
          <form onSubmit={handleLogin} className="auth-form">
            <label className="auth-field">
              Adresse e-mail
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label className="auth-field">
              Mot de passe
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={loading} className="auth-submit">
              {loading ? 'Connexion…' : 'Se connecter'}
            </button>
          </form>
          <p className="auth-switch">
            Pas encore d’accès ? Demandez à l’administrateur du salon de vous créer un compte.
          </p>
        </div>
      </main>
    </div>
  );
};