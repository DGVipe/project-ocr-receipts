// Copies the Tesseract.js worker, WebAssembly core and language data from
// node_modules into public/tesseract, so the browser loads them from this site
// instead of a CDN. Runs before `next dev` and `next build`.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "tesseract");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "core"), { recursive: true });
mkdirSync(join(out, "lang"), { recursive: true });

cpSync(join(pkgDir("tesseract.js"), "dist", "worker.min.js"), join(out, "worker.min.js"));

// LSTM-only builds (the OCR uses OEM 1). The worker picks one by CPU features.
for (const file of [
  "tesseract-core-relaxedsimd-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-lstm.wasm.js",
]) {
  cpSync(join(pkgDir("tesseract.js-core"), file), join(out, "core", file));
}

for (const lang of ["eng", "spa"]) {
  cpSync(
    join(pkgDir(`@tesseract.js-data/${lang}`), "4.0.0_best_int", `${lang}.traineddata.gz`),
    join(out, "lang", `${lang}.traineddata.gz`),
  );
}

console.log("Copied Tesseract.js assets to public/tesseract");
