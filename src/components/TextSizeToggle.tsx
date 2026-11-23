"use client";

import { useSyncExternalStore } from "react";
import { LARGE_TEXT_CLASS, LARGE_TEXT_KEY } from "@/lib/text-size";

/**
 * "Larger text" toggle. The source of truth is the class on <html>, set
 * before first paint by LARGE_TEXT_SCRIPT. The server always renders the
 * button as not pressed; useSyncExternalStore swaps in the real state right
 * after hydration, so there is no hydration mismatch.
 */

const CHANGE_EVENT = "carepool:text-size";

function isLarge(): boolean {
  return document.documentElement.classList.contains(LARGE_TEXT_CLASS);
}

function subscribe(onChange: () => void): () => void {
  // Another tab changed the setting: follow it.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== LARGE_TEXT_KEY) return;
    document.documentElement.classList.toggle(LARGE_TEXT_CLASS, e.newValue === "1");
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function TextSizeToggle() {
  const large = useSyncExternalStore(subscribe, isLarge, () => false);

  function toggle() {
    const next = !isLarge();
    document.documentElement.classList.toggle(LARGE_TEXT_CLASS, next);
    try {
      if (next) localStorage.setItem(LARGE_TEXT_KEY, "1");
      else localStorage.removeItem(LARGE_TEXT_KEY);
    } catch {
      // Storage is blocked: the choice still applies until the page is reloaded.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={large}
      data-testid="large-text-toggle"
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold print:hidden ${
        large ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-card text-muted hover:border-accent hover:text-ink"
      }`}
    >
      <span aria-hidden className="font-serif leading-none">
        A<span className="text-lg">A</span>
      </span>
      Larger text
    </button>
  );
}
