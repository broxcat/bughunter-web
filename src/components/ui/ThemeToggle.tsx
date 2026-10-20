"use client";

import * as React from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "theme";

// Tiny external store over the <html data-theme> attribute, so the component
// reads the real DOM theme (set by the no-flash script before hydration)
// without setState-in-effect. useSyncExternalStore is the sanctioned way to
// read external state and keep SSR/hydration consistent.
const listeners = new Set<() => void>();

function readTheme(): Theme {
  try {
    return document.documentElement.getAttribute("data-theme") === "dark"
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function applyTheme(next: Theme): void {
  try {
    document.documentElement.setAttribute("data-theme", next);
  } catch {
    /* no-op: document unavailable */
  }
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* no-op: storage blocked / unavailable */
  }
  listeners.forEach((fn) => fn());
}

/**
 * Sun/moon theme switcher. Toggles `data-theme` on <html> and persists the
 * choice in localStorage (both wrapped in try/catch so blocked storage or SSR
 * never throws). The initial paint is handled by the inline no-flash script in
 * layout.tsx; this button only flips the theme on click afterwards.
 */
export function ThemeToggle(): React.JSX.Element {
  const theme = React.useSyncExternalStore(
    subscribe,
    readTheme,
    () => "light" as Theme,
  );
  const isDark = theme === "dark";
  const label = isDark ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      onClick={() => applyTheme(isDark ? "light" : "dark")}
      className="ui-btn"
      data-variant="ghost"
      data-size="sm"
      aria-label={label}
      title={label}
      suppressHydrationWarning
    >
      {isDark ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

function SunIcon(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
