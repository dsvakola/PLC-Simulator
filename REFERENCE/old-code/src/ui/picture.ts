// Turns the exported circuit drawing into a PNG or JPEG at a chosen
// resolution, and records that resolution inside the file so printing and
// word processors show it at the right size.

/** Draws `svg` (sized in drawing units, 100 = 1 inch) at `dpi` dots per inch. */
export async function rasterise(svg: string, width: number, height: number, dpi: number, format: "png" | "jpg"): Promise<Uint8Array> {
  const scale = dpi / 100;
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  if (w > 16000 || h > 16000) throw new Error("The circuit is too big for this resolution. Please choose a lower one.");
  const img = new Image();
  img.decoding = "async";
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("The circuit picture could not be drawn."));
  });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The circuit picture could not be drawn.");
  if (format === "jpg") {
    // JPEG has no see-through parts: use a white page.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, format === "jpg" ? "image/jpeg" : "image/png", 0.95));
  if (!blob) throw new Error("The circuit picture could not be made. Please choose a lower resolution.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return format === "jpg" ? jpegWithDpi(bytes, dpi) : pngWithDpi(bytes, dpi);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Adds a pHYs chunk (pixels per metre) right after the PNG header chunk. */
function pngWithDpi(png: Uint8Array, dpi: number): Uint8Array {
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const v = new DataView(chunk.buffer);
  v.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  v.setUint32(8, ppm);
  v.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  v.setUint32(17, crc32(chunk.subarray(4, 17)));
  const at = 8 + 25; // signature + IHDR chunk
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, at), 0);
  out.set(chunk, at);
  out.set(png.subarray(at), at + chunk.length);
  return out;
}

/** Sets the dots-per-inch fields of the JFIF header, if there is one. */
function jpegWithDpi(jpg: Uint8Array, dpi: number): Uint8Array {
  const isJfif = jpg[2] === 0xff && jpg[3] === 0xe0 && jpg[6] === 0x4a && jpg[7] === 0x46 && jpg[8] === 0x49 && jpg[9] === 0x46;
  if (!isJfif) return jpg;
  const v = new DataView(jpg.buffer, jpg.byteOffset, jpg.byteLength);
  jpg[13] = 1; // unit: dots per inch
  v.setUint16(14, dpi);
  v.setUint16(16, dpi);
  return jpg;
}
