import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyAssigneeSignaturePosition } from "../server/legal/converter";

// Isolated extractor fixtures exercise the public final-PDF validator without
// touching the database, storage, backend or source legal uploads.
type Word = { text: string; x: number; y: number; width: number };
const line = (text: string, y: number, x = 60): Word[] =>
  text.split(" ").map((text) => {
    const word = { text, x, y, width: text.length * 5 };
    x += word.width + 5;
    return word;
  });
const candidate = (y = 200): Word[] => [
  ...line("SIGNED SEALED AND DELIVERED", y),
  ...line("By the within-named ASSIGNEE", y + 25),
  ...line("Ada Lovelace", y + 50),
];
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) =>
  rmSync(directory, { recursive: true, force: true })));

async function verify(pages: Word[][], name = "Ada Lovelace") {
  const directory = mkdtempSync(path.join(tmpdir(), "legal-boundary-fixture-"));
  directories.push(directory);
  const bbox = `<html><body>${pages.map((words) =>
    `<page width="612" height="792">${words.map((word) =>
      `<word xMin="${word.x}" yMin="${word.y}" xMax="${word.x + word.width}" yMax="${word.y + 12}">${word.text}</word>`
    ).join("")}</page>`).join("")}</body></html>`;
  const fixture = path.join(directory, "bbox.html");
  const extractor = path.join(directory, "extractor");
  writeFileSync(fixture, bbox);
  writeFileSync(extractor, `#!/bin/sh\ncat '${fixture}'\n`, { mode: 0o700 });
  chmodSync(extractor, 0o700);
  return verifyAssigneeSignaturePosition(Buffer.from(`%PDF-1.7\n${"fixture\n".repeat(20)}`), {
    assigneeFullName: name, templateVersionId: "isolated-draft",
    pdftotextPath: extractor,
  });
}

describe("assignee section boundaries in final PDF coordinates", () => {
  it.each(["WITNESS", "WITNESSES", "ASSIGNOR", "NOTARY", "COMMISSIONER"])(
    "allows a separate %s section after the complete printed name", async (label) => {
      await expect(verify([[...candidate(), ...line(label, 300)]]))
        .resolves.toMatchObject({ pageNumber: 1, anchorText: "Ada Lovelace" });
    },
  );
  it("allows separate assignor sections before and after the candidate", async () => {
    await expect(verify([[
      ...line("SIGNED SEALED AND DELIVERED", 80),
      ...line("By the ASSIGNOR", 105),
      ...candidate(),
      ...line("SIGNED SEALED AND DELIVERED", 320),
      ...line("By the ASSIGNOR", 345),
    ]])).resolves.toMatchObject({ pageNumber: 1 });
  });
  it("uses coordinates when a later witness is extracted before the candidate", async () => {
    await expect(verify([[...line("WITNESS", 320), ...candidate()]]))
      .resolves.toMatchObject({ pageNumber: 1 });
  });
  it.each([215, 240, 255])("rejects interfering labels at y=%s even extracted later", async (y) => {
    await expect(verify([[...candidate(), ...line("WITNESS", y)]]))
      .rejects.toMatchObject({ kind: "layout" });
  });
  it.each([200, 225, 250])("rejects side-by-side other-party labels at y=%s", async (y) => {
    await expect(verify([[...candidate(), ...line("ASSIGNOR", y, 430)]]))
      .rejects.toMatchObject({ kind: "layout" });
  });
  it("rejects a textually intervening assignor despite noninterfering coordinates", async () => {
    const words = candidate();
    words.splice(4, 0, ...line("ASSIGNOR", 100));
    await expect(verify([words])).rejects.toMatchObject({ kind: "layout" });
  });
  it("rejects duplicate eligible anchors", async () => {
    await expect(verify([[...candidate(), ...candidate(350)]]))
      .rejects.toMatchObject({ kind: "layout" });
  });
  it("rejects a missing or reordered name", async () => {
    await expect(verify([candidate()], "Different Person")).rejects.toMatchObject({ kind: "layout" });
    await expect(verify([[...candidate().slice(0, -2), ...line("Lovelace Ada", 250)]]))
      .rejects.toMatchObject({ kind: "layout" });
  });
  it("bounds interference by the bottom of a wrapped complete name", async () => {
    const wrapped = [...candidate().slice(0, -2), ...line("Ada", 250), ...line("Lovelace", 270)];
    await expect(verify([[...wrapped, ...line("WITNESS", 310)]]))
      .resolves.toMatchObject({ height: 38 });
    await expect(verify([[...wrapped, ...line("WITNESS", 270, 430)]]))
      .rejects.toMatchObject({ kind: "layout" });
  });
  it("rejects reversed and distant name fragments", async () => {
    for (const y of [230, 400]) {
      await expect(verify([[
        ...candidate().slice(0, -2), ...line("Ada", 250), ...line("Lovelace", y),
      ]])).rejects.toMatchObject({ kind: "layout" });
    }
  });
  it("rejects a name extracted after a phrase but printed above it", async () => {
    await expect(verify([[...candidate().slice(0, -2), ...line("Ada Lovelace", 180)]]))
      .rejects.toMatchObject({ kind: "layout" });
  });
  it.each([false, true])("accepts safe page breaks (phrase before break: %s)", async (before) => {
    const heading = line("SIGNED SEALED AND DELIVERED", 650);
    const phrase = line("By the within-named ASSIGNEE", before ? 680 : 60);
    await expect(verify([
      [...heading, ...(before ? phrase : [])],
      [...(before ? [] : phrase), ...line("Ada Lovelace", 100), ...line("WITNESS", 150)],
    ])).resolves.toMatchObject({ pageNumber: 2, signatureHeadingPageNumber: 1 });
  });
  it("rejects unsafe page breaks with trailing text or an intervening section", async () => {
    for (const label of ["Unrelated", "WITNESS"]) {
      await expect(verify([
        [...line("SIGNED SEALED AND DELIVERED", 650), ...line(label, 700)],
        [...line("By the within-named ASSIGNEE", 60), ...line("Ada Lovelace", 100)],
      ])).rejects.toMatchObject({ kind: "layout" });
    }
  });
  it("rejects a full name split across pages", async () => {
    await expect(verify([
      [...line("SIGNED SEALED AND DELIVERED", 650), ...line("By the within-named ASSIGNEE", 680), ...line("Ada", 710)],
      line("Lovelace", 60),
    ])).rejects.toMatchObject({ kind: "layout" });
  });
});