"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { LOCALE_COOKIE, parseLocale } from "./locale";
import { MESSAGES, type Locale, type Messages } from "./messages";

const CHANGE_EVENT = "locale-change";

function savedLocale(): Locale | null {
  const fromCookie = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`))?.[1];
  return parseLocale(fromCookie);
}

function detectLocale(): Locale {
  const saved = savedLocale();
  if (saved) return saved;
  // Default to the device's language: Spanish for any es-*, English otherwise.
  return navigator.language?.toLowerCase().startsWith("es") ? "es" : "en";
}

function subscribe(cb: () => void) {
  window.addEventListener(CHANGE_EVENT, cb);
  return () => window.removeEventListener(CHANGE_EVENT, cb);
}

type I18n = { locale: Locale; t: Messages; setLocale: (l: Locale) => void };
const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({
  children,
  initialLocale = "en",
}: {
  children: React.ReactNode;
  /** The locale the server picked (saved cookie, else Accept-Language). Used for the server render and hydration. */
  initialLocale?: Locale;
}) {
  // The server (and first hydration pass) renders `initialLocale`, so the first
  // paint is already in the right language. The client check below only matters
  // if it disagrees with the server (e.g. navigator.language vs Accept-Language).
  const locale = useSyncExternalStore(subscribe, detectLocale, () => initialLocale);

  const setLocale = useCallback((next: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
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
