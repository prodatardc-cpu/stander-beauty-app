import { useLocation, useNavigate } from 'react-router-dom';

// Goes back to the previous screen of the app, or to `fallback` when the page was opened directly
// (bookmark, new tab). Pages keep their in-progress data (e.g. the till's cart) on their own.
export const BackButton = ({ fallback, label = 'Retour' }: { fallback: string; label?: string }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const hasHistory = location.key !== 'default';
  return (
    <button type="button" className="back-button" onClick={() => (hasHistory ? navigate(-1) : navigate(fallback))}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
      {label}
    </button>
  );
};
