import { create } from 'zustand';
import { persist } from 'zustand/middleware';
export type Theme = 'light' | 'dark' | 'system';
type ThemeState = { theme: Theme; setTheme: (theme: Theme) => void };
export const useTheme = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'light',
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'event-confirm-theme', partialize: (state) => ({ theme: state.theme }) },
  ),
);
