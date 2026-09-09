/**
 * Light / dark switching.
 *
 * Three states, not two: light, dark, and "follow the system". An explicit
 * choice is stamped on <html> and remembered; with no choice stored the page
 * tracks the OS preference live, including when it changes mid-session.
 */

const STORAGE_KEY = 'is-it-ai:theme';
const systemPrefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

function stored() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null; // private mode, blocked storage — fall back to the system
  }
}

export function activeTheme() {
  return document.documentElement.dataset.theme || (systemPrefersDark() ? 'dark' : 'light');
}

export function createThemeSwitch(container, onChange) {
  const apply = (choice) => {
    if (choice) document.documentElement.dataset.theme = choice;
    else delete document.documentElement.dataset.theme;

    const active = activeTheme();
    for (const button of container.querySelectorAll('[data-theme-choice]')) {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === active));
    }
    onChange?.(active);
  };

  container.addEventListener('click', (event) => {
    const button = event.target.closest('[data-theme-choice]');
    if (!button) return;
    const choice = button.dataset.themeChoice;
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      /* Not persisting is survivable; the choice still applies to this page. */
    }
    apply(choice);
  });

  // Only follow the system while the visitor has not chosen for themselves.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!stored()) apply(null);
  });

  apply(stored());
  return { activeTheme };
}
