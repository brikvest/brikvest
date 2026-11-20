import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeSuppliedLegalTemplate, validateLegalTemplate } from "../server/legal/templates";
import type { LegalDocumentType } from "../server/legal/templates";

const root = process.cwd();
// Never regenerate retained/bundled versions in place. Produce separate review
// copies for an explicit new property upload, with write-once output files.
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--output-dir" || !args[1]) {
  throw new Error("Supply --output-dir <fresh review directory>; historical template assets must not be overwritten.");
}
const outputDir = path.resolve(args[1]);
const historicalDir = path.join(root, "server", "legal", "template-assets");
if (outputDir === historicalDir || outputDir.startsWith(historicalDir + path.sep)) {
  throw new Error("Historical template assets must not be overwritten; choose a separate review directory.");
}
const sources: Array<{ documentType: LegalDocumentType; source: string; output: string }> = [
  {
    documentType: "deed_of_assignment",
    source: "attached_assets/DEED_OF_ASSIGNMENT_BRIKVEST_1790828516010.docx",
    output: "deed_of_assignment_v1.docx",
  },
  {
    documentType: "transfer_exit_rights",
    source: "attached_assets/TRANSFER_AND_EXIT_RIGHT_AGREEMENT_1790828516011.docx",
    output: "transfer_exit_rights_v1.docx",
  },
];

await mkdir(outputDir, { recursive: true });
for (const item of sources) {
  const source = await readFile(path.join(root, item.source));
  const normalized = normalizeSuppliedLegalTemplate(source);
  const validation = validateLegalTemplate(normalized, item.documentType);
  await writeFile(path.join(outputDir, item.output), normalized, { mode: 0o600, flag: "wx" });
  console.log(
    `Normalized ${item.documentType} v1 (${validation.totalPlaceholders} fields; ` +
      `${Object.keys(validation.placeholderCounts).length} distinct field names).`,
  );
}
