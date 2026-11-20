import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { encodeSignaturePixels, signatureCanvasDataUrl } from "../client/src/lib/signature-png";
import { validateSignaturePng } from "../server/legal/local-pdf-signature";

function signaturePixels(width = 320, height = 100) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let x = 20; x < width - 20; x++) {
    const y = Math.floor(height / 2 + Math.sin(x / 8) * 15);
    for (let dy = 0; dy < 3; dy++) {
      const offset = ((y + dy) * width + x) * 4;
      pixels.set([17, 24, 39, 255], offset);
    }
  }
  return pixels;
}

describe("portable browser signature PNG export", () => {
  it("preserves canvas pixels and emits only the server-supported image chunks", () => {
    const pixels = signaturePixels();
    const bytes = Buffer.from(encodeSignaturePixels(320, 100, pixels));
    expect(validateSignaturePng(bytes)).toMatchObject({ width: 320, height: 100 });
    expect(PNG.sync.read(bytes).data).toEqual(Buffer.from(pixels));
    const types: string[] = [];
    for (let offset = 8; offset < bytes.length;) {
      types.push(bytes.toString("ascii", offset + 4, offset + 8));
      offset += bytes.readUInt32BE(offset) + 12;
    }
    expect(types).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(encodeSignaturePixels(320, 100, pixels)).toEqual(new Uint8Array(bytes));
  });

  it("does not use the native browser encoder, even if that encoder throws", () => {
    const canvas = {
      width: 320, height: 100,
      getContext: () => ({ getImageData: () => ({ data: signaturePixels() }) }),
      toDataURL: () => { throw new Error("Native export must not be used"); },
    } as unknown as HTMLCanvasElement;
    const url = signatureCanvasDataUrl(canvas);
    expect(url).toMatch(/^data:image\/png;base64,/);
    expect(validateSignaturePng(Buffer.from(url.split(",")[1], "base64"))).toMatchObject({
      width: 320, height: 100,
    });
  });

  it("keeps blank-signature rejection and bounds decoded image allocation", () => {
    expect(() => encodeSignaturePixels(1601, 100, new Uint8Array())).toThrow(/1600/);
    expect(() => encodeSignaturePixels(320, 100, new Uint8Array(2))).toThrow(/1600/);
    const blank = encodeSignaturePixels(320, 100, new Uint8ClampedArray(320 * 100 * 4));
    expect(() => validateSignaturePng(Buffer.from(blank))).toThrow(/blank/);
    const largest = encodeSignaturePixels(1600, 600, signaturePixels(1600, 600));
    expect(validateSignaturePng(Buffer.from(largest))).toMatchObject({ width: 1600, height: 600 });
  });
});