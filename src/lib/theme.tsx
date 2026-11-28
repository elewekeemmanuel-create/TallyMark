import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

export interface ThemePalette {
  bg: string;
  bgSecondary: string;
  surfacePrimary: string;
  surfaceSecondary: string;
  ink: string;
  inkMuted: string;
  border: string;
  borderSubtle: string;
  emerald: string;
  emeraldHover: string;
  emeraldBright: string;
  mint: string;
  mintSoft: string;
  mintBorder: string;
  metaThemeColor: string;
}

export const TALLYMARK_THEME: Record<Theme, ThemePalette> = {
  light: {
    bg: '#FFFFFF',
    bgSecondary: '#F5F7F8',
    surfacePrimary: '#FFFFFF',
    surfaceSecondary: '#F5F7F8',
    ink: '#111827',
    inkMuted: '#6B7280',
    border: '#E5E7EB',
    borderSubtle: '#F1F3F5',
    emerald: '#064E3B',
    emeraldHover: '#04392B',
    emeraldBright: '#047857',
    mint: '#6EE7B7',
    mintSoft: '#ECFDF5',
    mintBorder: '#A7F3D0',
    metaThemeColor: '#064E3B',
  },
  dark: {
    bg: '#0B0F0E',
    bgSecondary: '#111715',
    surfacePrimary: '#131917',
    surfaceSecondary: '#1A221F',
    ink: '#F3F4F6',
    inkMuted: '#9CA3AF',
    border: '#232D29',
    borderSubtle: '#1A221F',
    emerald: '#064E3B',
    emeraldHover: '#04392B',
    emeraldBright: '#10B981',
    mint: '#6EE7B7',
    mintSoft: 'rgba(110, 231, 183, 0.12)',
    mintBorder: 'rgba(110, 231, 183, 0.25)',
    metaThemeColor: '#0B0F0E',
  },
};

interface ThemeContextValue {
  theme: Theme;
  tokens: ThemePalette;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  tokens: TALLYMARK_THEME.light,
  toggleTheme: () => {},
  setTheme: () => {},
});

const STORAGE_KEY = 'tallymark_theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {
      // ignore
    }
    return 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    const palette = TALLYMARK_THEME[theme];

    root.classList.toggle('dark', theme === 'dark');
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', palette.metaThemeColor);
    }

    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  const toggleTheme = useCallback(
    () => setThemeState((prev) => (prev === 'light' ? 'dark' : 'light')),
    []
  );

  return (
    <ThemeContext.Provider value={{ theme, tokens: TALLYMARK_THEME[theme], toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
