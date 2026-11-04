"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { MESSAGES, type Locale, type Messages } from "./messages";

const STORAGE_KEY = "locale";
const CHANGE_EVENT = "locale-change";

function detectLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "en" || saved === "es") return saved;
  // Default to the device's language: Spanish for any es-*, English otherwise.
  return navigator.language?.toLowerCase().startsWith("es") ? "es" : "en";
}

function subscribe(cb: () => void) {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

type I18n = { locale: Locale; t: Messages; setLocale: (l: Locale) => void };
const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // The server (and first hydration pass) renders English, then the real locale applies.
  const locale = useSyncExternalStore(subscribe, detectLocale, () => "en" as Locale);

  const setLocale = useCallback((next: Locale) => {
    localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const value = useMemo(() => ({ locale, t: MESSAGES[locale], setLocale }), [locale, setLocale]);

  // Keep <html lang> and the tab title in sync with the chosen language.
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = MESSAGES[locale].appName;
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

export type { Locale, Messages };
