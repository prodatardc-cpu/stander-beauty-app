import { useLayoutEffect, useState } from 'react';

type ColorTheme = 'dark' | 'light';
type ThemeToggleProps = { className?: string };

const themeStorageKey = 'salon-color-theme';

const readTheme = (): ColorTheme =>
  localStorage.getItem(themeStorageKey) === 'light' ? 'light' : 'dark';

export const ThemeToggle = ({ className = '' }: ThemeToggleProps) => {
  const [theme, setTheme] = useState<ColorTheme>(readTheme);
  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  return (
    <button
      type="button"
      className={`theme-toggle ${className}`.trim()}
      aria-label={`Passer en mode ${nextTheme === 'light' ? 'clair' : 'sombre'}`}
      aria-pressed={theme === 'dark'}
      title={`Passer en mode ${nextTheme === 'light' ? 'clair' : 'sombre'}`}
      onClick={() => setTheme(nextTheme)}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {theme === 'dark' ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
          </>
        ) : (
          <path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8 8.5 8.5 0 1 0 20.2 15.4Z" />
        )}
      </svg>
      <span className="sr-only">Mode {nextTheme === 'light' ? 'clair' : 'sombre'}</span>
    </button>
  );
};
