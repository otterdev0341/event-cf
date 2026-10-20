import { useEffect } from 'react';
import { useTheme } from '../stores/theme';
export function ThemeProvider() {
  const theme = useTheme((s) => s.theme);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (preference.matches ? 'dark' : 'light') : theme;
    };
    apply();
    preference.addEventListener('change', apply);
    return () => preference.removeEventListener('change', apply);
  }, [theme]);
  return null;
}
