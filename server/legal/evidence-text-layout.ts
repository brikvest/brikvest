import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";

type EvidenceTextLayoutOptions = {
  document: PDFDocument;
  firstPage: PDFPage;
  regularFont: PDFFont;
  boldFont: PDFFont;
  margin: number;
  startY: number;
};

const BODY_COLOR = rgb(0.12, 0.16, 0.22);
const MUTED_COLOR = rgb(0.35, 0.4, 0.47);
const LINE_HEIGHT = 12;
const FONT_SIZE = 9;

function safeUnicodeText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
}

function wrapEvidenceText(
  text: string,
  firstLineWidth: number,
  followingLineWidth: number,
  font: PDFFont,
): string[] {
  const normalized = safeUnicodeText(text);
  if (!normalized) return [""];
  const words = normalized.split(" ");
  const lines: string[] = [];
  let line = "";

  const lineWidth = (lineIndex: number) =>
    lineIndex === 0 ? firstLineWidth : followingLineWidth;
  const canDraw = (value: string, lineIndex: number) =>
    font.widthOfTextAtSize(value, FONT_SIZE) <= lineWidth(lineIndex);

  for (const word of words) {
    let remainder = word;
    while (remainder) {
      const next = line ? `${line} ${remainder}` : remainder;
      if (canDraw(next, lines.length)) {
        line = next;
        remainder = "";
        continue;
      }

      if (line) {
        lines.push(line);
        line = "";
        continue;
      }

      // A single token can be longer than the whole printable line. Split by
      // Unicode code point, without dropping or substituting any characters.
      let chunk = "";
      let consumed = 0;
      for (const character of Array.from(remainder)) {
        const candidate = chunk + character;
        if (!canDraw(candidate, lines.length)) break;
        chunk = candidate;
        consumed += character.length;
      }
      if (!chunk) {
        throw new Error("A Unicode character cannot fit in the evidence PDF text area.");
      }
      lines.push(chunk);
      remainder = remainder.slice(consumed);
    }
  }

  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

/**
 * Deterministic, flowing layout for the local-signing evidence record. Text is
 * measured with the exact embedded font; long unbroken tokens are wrapped by
 * Unicode code point, and every page reserves room for its footer.
 */
export class EvidenceTextLayout {
  private readonly document: PDFDocument;
  private readonly regularFont: PDFFont;
  private readonly boldFont: PDFFont;
  private readonly margin: number;
  private readonly pageWidth: number;
  private readonly pageHeight: number;
  private readonly pages: PDFPage[];
  private page: PDFPage;
  private y: number;

  constructor(options: EvidenceTextLayoutOptions) {
    this.document = options.document;
    this.regularFont = options.regularFont;
    this.boldFont = options.boldFont;
    this.margin = options.margin;
    this.page = options.firstPage;
    this.pages = [options.firstPage];
    this.pageWidth = options.firstPage.getWidth();
    this.pageHeight = options.firstPage.getHeight();
    this.y = options.startY;
  }

  drawField(label: string, value: string): void {
    const labelText = `${safeUnicodeText(label)}:`;
    const labelWidth = this.boldFont.widthOfTextAtSize(labelText, FONT_SIZE);
    const valueX = this.margin + labelWidth + 6;
    const contentRight = this.pageWidth - this.margin;
    const continuationX = this.margin + 10;
    const firstValueWidth = contentRight - valueX;
    const continuationWidth = contentRight - continuationX;
    if (firstValueWidth < 24 || continuationWidth < 24) {
      throw new Error("The local signing evidence field label is too wide for its page.");
    }

    const lines = wrapEvidenceText(
      value,
      firstValueWidth,
      continuationWidth,
      this.regularFont,
    );
    this.ensureSpace(LINE_HEIGHT);
    this.page.drawText(labelText, {
      x: this.margin,
      y: this.y,
      size: FONT_SIZE,
      font: this.boldFont,
      color: BODY_COLOR,
    });
    this.page.drawText(lines[0], {
      x: valueX,
      y: this.y,
      size: FONT_SIZE,
      font: this.regularFont,
      color: BODY_COLOR,
    });
    this.y -= LINE_HEIGHT;

    for (const line of lines.slice(1)) {
      this.drawLine(line, continuationX);
    }
    this.y -= 5;
  }

  drawSection(title: string, body: string): void {
    const continuationX = this.margin + 8;
    const bodyWidth = this.pageWidth - this.margin - continuationX;
    const lines = wrapEvidenceText(body, bodyWidth, bodyWidth, this.regularFont);

    // Keep the section heading with at least its first body line.
    this.ensureSpace(LINE_HEIGHT * 2 + 2);
    this.page.drawText(safeUnicodeText(title), {
      x: this.margin,
      y: this.y,
      size: FONT_SIZE,
      font: this.boldFont,
      color: BODY_COLOR,
    });
    this.y -= 14;

    for (const line of lines) {
      this.drawLine(line, continuationX);
    }
    this.y -= 8;
  }

  finish(): void {
    for (let index = 0; index < this.pages.length; index += 1) {
      const pageLabel = `Page ${index + 1} of ${this.pages.length}`;
      const width = this.regularFont.widthOfTextAtSize(pageLabel, 8);
      this.pages[index].drawText(pageLabel, {
        x: this.pageWidth - this.margin - width,
        y: 24,
        size: 8,
        font: this.regularFont,
        color: MUTED_COLOR,
      });
    }
  }

  private drawLine(text: string, x: number): void {
    this.ensureSpace(LINE_HEIGHT);
    this.page.drawText(text, {
      x,
      y: this.y,
      size: FONT_SIZE,
      font: this.regularFont,
      color: BODY_COLOR,
    });
    this.y -= LINE_HEIGHT;
  }

  private ensureSpace(requiredHeight: number): void {
    if (this.y - requiredHeight >= 48) return;

    this.page = this.document.addPage([this.pageWidth, this.pageHeight]);
    this.pages.push(this.page);
    const continuationTitle = "BRIKVEST — LOCAL IN-APP SIGNING RECORD (CONTINUED)";
    this.page.drawText(continuationTitle, {
      x: this.margin,
      y: this.pageHeight - 42,
      size: FONT_SIZE,
      font: this.regularFont,
      color: MUTED_COLOR,
    });
    this.y = this.pageHeight - 64;
  }
}