import type { Worker } from "tesseract.js";
import { analyze, combine, isConfident, type Evidence, type ReceiptData } from "./parser.ts";
import { preprocessVariants, type GrayImage } from "./preprocess.ts";

// Served from this site by scripts/copy-tesseract-assets.mjs, never a CDN.
const ASSETS = "/tesseract";
const LANGS = ["eng", "spa"];

// Receipt text OCRs best at roughly 30 px x-height, so scale the long side to this.
const TARGET_LONG_SIDE = 3200;
const MAX_UPSCALE = 3;
// Time budget for all passes together. The first pass always runs to the end;
// later passes are skipped once less than MIN_PASS_MS of the budget is left.
const BUDGET_MS = 30_000;
const MIN_PASS_MS = 3_000;

let engine: Promise<Worker> | null = null;

/**
 * Starts (once) a Tesseract worker. The first call downloads the WebAssembly
 * core and the eng+spa language data (~9 MB, then cached by the browser).
 */
export function loadOcrEngine(): Promise<Worker> {
  if (!engine) {
    engine = (async () => {
      const { createWorker, OEM, PSM } = await import("tesseract.js");
      const worker = await createWorker(LANGS, OEM.LSTM_ONLY, {
        workerPath: `${ASSETS}/worker.min.js`,
        corePath: `${ASSETS}/core`,
        langPath: `${ASSETS}/lang`,
        workerBlobURL: false,
      });
      // PSM 4: a single column of text of variable sizes, which suits receipts.
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_COLUMN });
      return worker;
    })();
    engine.catch(() => {
      engine = null; // let the next scan retry
    });
  }
  return engine;
}

/** Runs OCR on the photo in this browser and extracts store, date and total. */
export async function scanReceipt(file: File): Promise<ReceiptData> {
  const base = await loadGray(file);
  let worker: Worker;
  try {
    worker = await loadOcrEngine();
  } catch {
    throw new Error("The OCR engine couldn't be loaded. Check your connection and try again.");
  }

  const start = performance.now();
  const evidence: Evidence[] = [];
  for (const variant of preprocessVariants(base)) {
    if (evidence.length > 0 && performance.now() - start > BUDGET_MS - MIN_PASS_MS) break;
    const { data } = await worker.recognize(toCanvas(variant));
    evidence.push(analyze(data.text));
    if (isConfident(evidence)) break;
  }
  return combine(evidence);
}

/** Decodes the photo upright (EXIF rotation), grayscale, scaled to a good size for Tesseract. */
async function loadGray(file: File): Promise<GrayImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This image format isn't supported. Try a JPEG or PNG photo.");
  }
  const scale = Math.min(TARGET_LONG_SIDE / Math.max(bitmap.width, bitmap.height), MAX_UPSCALE);
  const ratio = Math.abs(scale - 1) > 0.05 ? scale : 1;
  const width = Math.round(bitmap.width * ratio);
  const height = Math.round(bitmap.height * ratio);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Your browser can't process images here.");
  ctx.fillStyle = "#fff"; // flatten transparent PNGs onto white
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const rgba = ctx.getImageData(0, 0, width, height).data;
  const data = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    // ITU-R 601 luma, as Pillow's convert("L"). The typed array rounds it.
    data[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
  }
  return { width, height, data };
}

function toCanvas(img: GrayImage): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const rgba = new ImageData(img.width, img.height);
  for (let i = 0, p = 0; i < img.data.length; i++, p += 4) {
    rgba.data[p] = rgba.data[p + 1] = rgba.data[p + 2] = img.data[i];
    rgba.data[p + 3] = 255;
  }
  canvas.getContext("2d")!.putImageData(rgba, 0, 0);
  return canvas;
}
