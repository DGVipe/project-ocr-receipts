import type { Locale } from "./messages";

// The choice is kept in a cookie (not only localStorage) so the server can read
// it and render the page in the right language from the first byte.
export const LOCALE_COOKIE = "locale";

export function parseLocale(value: string | null | undefined): Locale | null {
  return value === "en" || value === "es" ? value : null;
}

/** Spanish for an `Accept-Language` led by es-*, English otherwise. Mirrors the client's `navigator.language` check. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  return header?.trim().toLowerCase().startsWith("es") ? "es" : "en";
}
