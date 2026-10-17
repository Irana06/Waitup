import type { Theme } from '../lib/theme.ts';

export function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  return (
    <div className="seg" role="group" aria-label="Tema">
      <button type="button" aria-pressed={theme === 'light'} onClick={() => onChange('light')}>
        Terang
      </button>
      <button type="button" aria-pressed={theme === 'dark'} onClick={() => onChange('dark')}>
        Gelap
      </button>
    </div>
  );
}
