"use client";

import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";

export const THEME_KEY = "paytag-theme";

/**
 * The inline script that runs before first paint.
 *
 * Without it the page renders in the default (light) palette for one frame and
 * then flips — a white flash on every navigation for anyone who chose dark.
 * It is deliberately tiny and wrapped in try/catch: a browser with site data
 * blocked throws on localStorage access, and a theme preference is never worth
 * taking the page down for.
 */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}`;

// --- a tiny store, so every toggle instance and the DOM stay in agreement ---

const listeners = new Set<() => void>();

function read(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "dark" || v === "light") return v;
  } catch {
    /* site data blocked — fall through to system */
  }
  return "system";
}

function write(next: Theme) {
  try {
    if (next === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, next);
  } catch {
    /* not persisted; the current page still switches */
  }
  // Removing the attribute hands control back to prefers-color-scheme.
  if (next === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const OPTIONS: { value: Theme; label: string; title: string }[] = [
  { value: "light", label: "Light", title: "Always light" },
  { value: "dark", label: "Dark", title: "Always dark" },
  { value: "system", label: "Auto", title: "Follow the system setting" },
];

export default function ThemeToggle() {
  // Server snapshot is "system": the markup rendered on the server cannot know
  // the choice, and the inline script has already applied it to the DOM by the
  // time this hydrates.
  const theme = useSyncExternalStore(subscribe, read, () => "system" as Theme);

  return (
    <div className="segmented" role="group" aria-label="Color theme">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-pressed={theme === o.value}
          onClick={() => write(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
