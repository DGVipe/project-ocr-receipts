// Central place to tune how much data the app accepts.

/** Length of the rolling rate-limit window. */
export const WINDOW_MS = 60 * 60 * 1000; // 1 hour

/** Scans one browser (anonymous user) may start per window. */
export const USER_SCANS_PER_WINDOW = 5;

/** Scans one IP address may start per window (covers cookie-clearing). */
export const IP_SCANS_PER_WINDOW = 15;

/** Scans one user may have in flight at the same time. */
export const MAX_CONCURRENT_SCANS_PER_USER = 1;

/** A pending scan older than this is considered abandoned. */
export const PENDING_SCAN_TIMEOUT_MS = 2 * 60 * 1000;

/** Receipts a single user may store in total. */
export const MAX_RECEIPTS_PER_USER = 25;

/** Receipts the whole database may hold. New scans are rejected beyond this. */
export const MAX_TOTAL_RECEIPTS = 1000;

/** Page size for the "all receipts" modal. */
export const LIST_PAGE_SIZE = 20;
