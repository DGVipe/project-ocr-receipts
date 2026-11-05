import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

/** Server-only configuration. Read lazily so `next build` works without secrets. */
export const serverEnv = {
  /** Shared with the Convex deployment; authorizes write mutations. */
  get convexServerSecret() {
    return required("CONVEX_SERVER_SECRET");
  },
  /**
   * Dev-only: artificial delay (ms) before the page shell resolves, to inspect
   * the loading skeleton. Ignored in production builds.
   */
  get skeletonDelayMs() {
    if (process.env.NODE_ENV === "production") return 0;
    const ms = Number(process.env.SKELETON_DELAY_MS);
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  },
};
