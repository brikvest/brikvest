import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const adminSource = fs.readFileSync(
  path.resolve(process.cwd(), "client/src/pages/admin.tsx"),
  "utf8",
);
const homeSource = fs.readFileSync(
  path.resolve(process.cwd(), "client/src/pages/home.tsx"),
  "utf8",
);

describe("property due diligence document UI", () => {
  it("manages the single document from property create and edit workflows", () => {
    expect(adminSource).toContain('data-testid="due-diligence-document-control"');
    expect(adminSource).toContain('data-testid="edit-due-diligence-document-control"');
    expect(adminSource).toContain("Upload due diligence document");
    expect(adminSource).toContain("Replace due diligence document");
    expect(adminSource).toContain(">Preview</a>");
    expect(adminSource).toContain(">Download</a>");
  });

  it("removes the standalone property checklist administration", () => {
    expect(adminSource).not.toContain('selectedTab === "verification"');
    expect(adminSource).not.toContain("Property Verification Management");
    expect(adminSource).not.toContain("Verification checklist updated");
    expect(adminSource).not.toContain("Proof Photos (Optional)");
  });

  it("shows only the document customer state and hides the section when absent", () => {
    expect(homeSource).toContain("selectedProperty.dueDiligenceDocumentUrl &&");
    expect(homeSource).toContain('data-testid="due-diligence-document-section"');
    expect(homeSource).toContain("Review the due diligence document provided for this property.");
    expect(homeSource).not.toContain("Property Verification Checklist");
    expect(homeSource).not.toContain("Verification Progress");
    expect(homeSource).not.toContain("Verification checklist is being configured");
    expect(homeSource).not.toContain("selectedPropertyVerification");
  });
});