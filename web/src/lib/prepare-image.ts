const MAX_SIDE = 2400;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const PASSTHROUGH_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Downscales and re-encodes the photo as JPEG in the browser. Phone photos
 * are often 5–12 MB, which exceeds Vercel's request limit, and OCR doesn't
 * need more than ~2400px on the long side anyway. Also normalizes EXIF
 * rotation and formats like HEIC on browsers that can decode them.
 */
export async function prepareImage(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.fillStyle = "#fff"; // flatten transparent PNGs onto white
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    if (!blob) throw new Error("Encoding failed");
    const name = file.name.replace(/\.[^.]+$/, "") || "receipt";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
  } catch {
    // Browser couldn't decode it; send the original if the server can take it.
    if (PASSTHROUGH_TYPES.has(file.type) && file.size <= MAX_UPLOAD_BYTES) return file;
    throw new Error("This image format isn't supported. Try a JPEG or PNG photo.");
  }
}
