const ISO_CURRENCY = /^[A-Z]{3}$/;

export function formatAmount(amount: number | null, currency: string | null, locale?: string): string {
  if (amount === null) return "—";
  const digits = Number.isInteger(amount) ? 0 : 2;
  if (currency && ISO_CURRENCY.test(currency)) {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        minimumFractionDigits: digits,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      // Unknown ISO code; fall through to plain formatting.
    }
  }
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: 2,
  }).format(amount);
  return currency ? `${currency}${currency.length > 1 ? " " : ""}${number}` : number;
}

/** Formats an ISO "YYYY-MM-DD" date without shifting it by the local timezone. */
export function formatDate(iso: string | null, locale?: string): string {
  if (!iso) return "—";
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

export function formatTimestamp(ms: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(ms),
  );
}

export function formatRelative(ms: number, hourUnit = "h", minuteUnit = "min"): string {
  const minutes = Math.max(1, Math.ceil((ms - Date.now()) / 60_000));
  return minutes >= 60 ? `${Math.ceil(minutes / 60)} ${hourUnit}` : `${minutes} ${minuteUnit}`;
}
