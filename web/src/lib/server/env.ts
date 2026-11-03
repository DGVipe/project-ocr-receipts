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
  /** Base URL of the pytesseract service, e.g. https://receipt-ocr.onrender.com */
  get ocrServiceUrl() {
    return required("OCR_SERVICE_URL").replace(/\/+$/, "");
  },
  get ocrApiKey() {
    return required("OCR_API_KEY");
  },
};
