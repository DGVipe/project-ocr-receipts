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
};
