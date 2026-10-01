import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeSuppliedLegalTemplate, validateLegalTemplate } from "../server/legal/templates";
import type { LegalDocumentType } from "../server/legal/templates";

const root = process.cwd();
const outputDir = path.join(root, "server", "legal", "template-assets");
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
  await writeFile(path.join(outputDir, item.output), normalized, { mode: 0o600 });
  console.log(
    `Normalized ${item.documentType} v1 (${validation.totalPlaceholders} fields; ` +
      `${Object.keys(validation.placeholderCounts).length} distinct field names).`,
  );
}
