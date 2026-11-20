import { zlibSync } from "fflate";

const MAX_BYTES = 512 * 1024;
const PNG_HEADER = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length + 12);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  result.set(Array.from(type, character => character.charCodeAt(0)), 4);
  result.set(data, 8);
  let crc = 0xffffffff;
  for (let index = 4; index < result.length - 4; index++) {
    crc ^= result[index];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0);
  return result;
}

/** Encode only 8-bit RGBA pixels, without browser-specific ancillary chunks. */
export function encodeSignaturePixels(
  width: number,
  height: number,
  pixels: Uint8ClampedArray | Uint8Array,
): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
      width < 2 || height < 2 || width > 1600 || height > 600 ||
      pixels.length !== width * height * 4) {
    throw new Error("The signature canvas must be no larger than 1600×600 pixels.");
  }
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8;
  header[9] = 6; // RGBA, with no interlacing.
  const rowBytes = width * 4;
  const scanlines = new Uint8Array((rowBytes + 1) * height);
  for (let row = 0; row < height; row++) {
    // Filter type 0, followed by the canvas's exact RGBA pixels.
    scanlines.set(pixels.subarray(row * rowBytes, (row + 1) * rowBytes),
      row * (rowBytes + 1) + 1);
  }
  const png = concat([PNG_HEADER, chunk("IHDR", header),
    chunk("IDAT", zlibSync(scanlines)), chunk("IEND", new Uint8Array())]);
  if (png.length > MAX_BYTES) {
    throw new Error("The signature image exceeds 512 KB. Clear it and draw a simpler signature.");
  }
  return png;
}

export function signatureCanvasDataUrl(canvas: HTMLCanvasElement): string {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The signature canvas is unavailable. Reopen the signing window.");
  const { width, height } = canvas;
  // Do not call toDataURL/toBlob: native encoders can add platform-specific
  // PNG chunks. Read the same visible pixels for drawn and typed signatures.
  const png = encodeSignaturePixels(width, height,
    context.getImageData(0, 0, width, height).data);
  let binary = "";
  for (let offset = 0; offset < png.length; offset += 8192) {
    binary += String.fromCharCode(...png.subarray(offset, offset + 8192));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}