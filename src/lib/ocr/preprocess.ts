/**
 * Grayscale image operations used to prepare a receipt photo for Tesseract.
 *
 * Phone photos of receipts have shadows, small text and faded thermal print,
 * and no single preprocessing works best for all of them, so
 * `preprocessVariants` yields several differently-preprocessed versions and
 * the caller stops as soon as it has what it needs. The operations mirror
 * Pillow's (autocontrast, MaxFilter, GaussianBlur, SHARPEN).
 *
 * Pure functions on pixel arrays, so they can be tested in Node.
 */

export type GrayImage = { width: number; height: number; data: Uint8ClampedArray };

function blank(width: number, height: number): GrayImage {
  return { width, height, data: new Uint8ClampedArray(width * height) };
}

/** Preprocessed versions of the image, most generally useful first. */
export function* preprocessVariants(base: GrayImage): Generator<GrayImage> {
  const flat = autocontrast(removeShadows(base), 1);
  // 1. Shadow-free, black and white: best on most thermal receipts.
  yield otsuThreshold(flat);
  // 2. Shadow-free grayscale: keeps faint or dot-matrix strokes binarization breaks.
  yield sharpen(flat);
  // 3. Untouched grayscale: for when shadow removal eats light print.
  yield sharpen(autocontrast(base, 1));
}

/**
 * Flatten uneven lighting: subtract an estimate of the paper's brightness.
 *
 * The background is estimated on a small copy: a max filter erases the dark
 * text, a blur smooths it. Paper becomes white everywhere, so shadows across
 * the receipt no longer swallow the print.
 */
export function removeShadows(img: GrayImage): GrayImage {
  const small = downscale(img, Math.max(Math.floor(img.width / 4), 1), Math.max(Math.floor(img.height / 4), 1));
  const bg = upscaleBilinear(gaussianBlur(maxFilter(small, 3), 8), img.width, img.height);
  const out = blank(img.width, img.height);
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = 255 - Math.max(bg.data[i] - img.data[i], 0);
  }
  return out;
}

/** Pillow's `ImageOps.autocontrast`: stretch so `cutoff`% of pixels clip at each end. */
export function autocontrast(img: GrayImage, cutoff: number): GrayImage {
  const h = histogram(img);
  const n = img.data.length;
  let cut = Math.floor((n * cutoff) / 100);
  for (let lo = 0; lo < 256 && cut > 0; lo++) {
    const take = Math.min(cut, h[lo]);
    h[lo] -= take;
    cut -= take;
  }
  cut = Math.floor((n * cutoff) / 100);
  for (let hi = 255; hi >= 0 && cut > 0; hi--) {
    const take = Math.min(cut, h[hi]);
    h[hi] -= take;
    cut -= take;
  }
  let lo = 0;
  while (lo < 255 && !h[lo]) lo++;
  let hi = 255;
  while (hi > 0 && !h[hi]) hi--;

  const lut = new Uint8ClampedArray(256);
  if (hi <= lo) {
    for (let i = 0; i < 256; i++) lut[i] = i;
  } else {
    const scale = 255 / (hi - lo);
    const offset = -lo * scale;
    for (let i = 0; i < 256; i++) lut[i] = Math.trunc(i * scale + offset);
  }
  return mapPixels(img, lut);
}

/** Binarize at the threshold that best separates ink from paper (Otsu's method). */
export function otsuThreshold(img: GrayImage): GrayImage {
  const hist = histogram(img);
  const total = img.data.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let wBg = 0;
  let sumBg = 0;
  let bestVar = -1;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wBg += hist[t];
    if (!wBg) continue;
    const wFg = total - wBg;
    if (!wFg) break;
    sumBg += t * hist[t];
    const meanBg = sumBg / wBg;
    const meanFg = (sumAll - sumBg) / wFg;
    const variance = wBg * wFg * (meanBg - meanFg) ** 2;
    if (variance > bestVar) {
      bestVar = variance;
      threshold = t;
    }
  }
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = i > threshold ? 255 : 0;
  return mapPixels(img, lut);
}

/** Pillow's `ImageFilter.SHARPEN` (3x3 kernel; border pixels are copied). */
export function sharpen(img: GrayImage): GrayImage {
  const { width: w, height: h, data: src } = img;
  const out = { width: w, height: h, data: new Uint8ClampedArray(src) };
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const ring =
        src[i - w - 1] + src[i - w] + src[i - w + 1] + src[i - 1] + src[i + 1] + src[i + w - 1] + src[i + w] + src[i + w + 1];
      out.data[i] = Math.round((32 * src[i] - 2 * ring) / 16);
    }
  }
  return out;
}

function histogram(img: GrayImage): number[] {
  const h = new Array<number>(256).fill(0);
  for (const v of img.data) h[v]++;
  return h;
}

function mapPixels(img: GrayImage, lut: Uint8ClampedArray): GrayImage {
  const out = blank(img.width, img.height);
  for (let i = 0; i < out.data.length; i++) out.data[i] = lut[img.data[i]];
  return out;
}

/** Shrink by averaging the source pixels that fall in each output pixel. */
function downscale(img: GrayImage, width: number, height: number): GrayImage {
  const out = blank(width, height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * img.height) / height);
    const y1 = Math.max(Math.floor(((y + 1) * img.height) / height), y0 + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * img.width) / width);
      const x1 = Math.max(Math.floor(((x + 1) * img.width) / width), x0 + 1);
      let sum = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) sum += img.data[sy * img.width + sx];
      }
      out.data[y * width + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

function upscaleBilinear(img: GrayImage, width: number, height: number): GrayImage {
  const out = blank(width, height);
  const { width: sw, height: sh, data: src } = img;
  for (let y = 0; y < height; y++) {
    const fy = Math.min(Math.max(((y + 0.5) * sh) / height - 0.5, 0), sh - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, sh - 1);
    const wy = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(Math.max(((x + 0.5) * sw) / width - 0.5, 0), sw - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, sw - 1);
      const wx = fx - x0;
      const top = src[y0 * sw + x0] * (1 - wx) + src[y0 * sw + x1] * wx;
      const bottom = src[y1 * sw + x0] * (1 - wx) + src[y1 * sw + x1] * wx;
      out.data[y * width + x] = top * (1 - wy) + bottom * wy;
    }
  }
  return out;
}

/** Separable max filter over a (2r+1)² window, like Pillow's `MaxFilter(2r+1)`. */
function maxFilter(img: GrayImage, r: number): GrayImage {
  const { width: w, height: h } = img;
  const pass = (src: Uint8ClampedArray, horizontal: boolean) => {
    const out = new Uint8ClampedArray(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let m = 0;
        for (let k = -r; k <= r; k++) {
          const sx = horizontal ? Math.min(Math.max(x + k, 0), w - 1) : x;
          const sy = horizontal ? y : Math.min(Math.max(y + k, 0), h - 1);
          m = Math.max(m, src[sy * w + sx]);
        }
        out[y * w + x] = m;
      }
    }
    return out;
  };
  return { width: w, height: h, data: pass(pass(img.data, true), false) };
}

/** Gaussian blur with standard deviation `sigma`, approximated by three box blurs. */
function gaussianBlur(img: GrayImage, sigma: number): GrayImage {
  // Box widths whose three passes approximate the Gaussian (Kovesi's method).
  const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let wl = Math.floor(ideal);
  if (wl % 2 === 0) wl--;
  const m = Math.round((12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4));
  let data: Float32Array = Float32Array.from(img.data);
  for (let i = 0; i < 3; i++) {
    const r = ((i < m ? wl : wl + 2) - 1) / 2;
    data = boxBlur(boxBlur(data, img.width, img.height, r, true), img.width, img.height, r, false);
  }
  return { width: img.width, height: img.height, data: Uint8ClampedArray.from(data) };
}

function boxBlur(src: Float32Array, w: number, h: number, r: number, horizontal: boolean): Float32Array {
  const out = new Float32Array(src.length);
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const at = (line: number, k: number) =>
    horizontal ? line * w + Math.min(Math.max(k, 0), w - 1) : Math.min(Math.max(k, 0), h - 1) * w + line;
  for (let line = 0; line < lines; line++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[at(line, k)];
    for (let k = 0; k < len; k++) {
      out[at(line, k)] = sum / (2 * r + 1);
      sum += src[at(line, k + r + 1)] - src[at(line, k - r)];
    }
  }
  return out;
}
