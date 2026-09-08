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

describe("unit cost transparency UI wiring", () => {
  it("places the editor immediately after property description with comparison and mismatch controls", () => {
    const descriptionIndex = adminSource.indexOf("{/* Property Description */}");
    const transparencyIndex = adminSource.indexOf(
      "{/* Informational unit-cost transparency; independent from reservation pricing. */}",
    );
    const currencyIndex = adminSource.indexOf(
      "{/* Currency Selector */}",
      transparencyIndex,
    );

    expect(descriptionIndex).toBeGreaterThan(-1);
    expect(transparencyIndex).toBeGreaterThan(descriptionIndex);
    expect(currencyIndex).toBeGreaterThan(transparencyIndex);
    expect(adminSource).toContain('data-testid="admin-minimum-investment-comparison"');
    expect(adminSource).toContain('data-testid="admin-unit-cost-mismatch"');
    expect(adminSource).toContain("disabled={!matches}");
  });

  it("reuses the customer panel in property details and the reservation dialog", () => {
    const reservationDialogIndex = homeSource.indexOf(
      "<Dialog open={investmentModalOpen}",
    );
    const propertyDetailPanelIndex = homeSource.lastIndexOf(
      "<UnitCostBreakdownPanel",
    );
    const reservationPanelIndex = homeSource.indexOf(
      "<UnitCostBreakdownPanel",
      reservationDialogIndex,
    );

    expect(reservationDialogIndex).toBeGreaterThan(-1);
    expect(reservationPanelIndex).toBeGreaterThan(reservationDialogIndex);
    expect(propertyDetailPanelIndex).toBeGreaterThan(reservationPanelIndex);
  });
});