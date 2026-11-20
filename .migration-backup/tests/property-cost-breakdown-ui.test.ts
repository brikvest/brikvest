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
const dashboardSource = fs.readFileSync(
  path.resolve(process.cwd(), "client/src/pages/dashboard.tsx"),
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

describe("reservation success dialog", () => {
  it("keeps the complete success state centered", () => {
    expect(homeSource).toContain(
      'className="max-w-md text-center"\n          data-testid="reservation-success-dialog"',
    );
    expect(homeSource).toContain(
      '<DialogHeader className="text-center sm:text-center">',
    );
    expect(homeSource).toContain(
      'className="text-slate-600 text-center mb-6"',
    );
    expect(homeSource).toContain(
      'className="bg-blue-600 hover:bg-blue-700 mx-auto"',
    );
  });

  it("explains the successful reservation, 24-hour release, and email follow-up", () => {
    expect(homeSource).toContain(
      "Your ownership slot was reserved successfully.",
    );
    expect(homeSource).toContain(
      "It will be held for 24 hours only and then released",
    );
    expect(homeSource).toContain(
      "We’ll contact you by email with instructions.",
    );
    expect(homeSource).toContain("View My Portfolio");
    expect(homeSource).toContain("setLocation(dashboardReturnPath)");
  });
});

describe("investor payment modal", () => {
  it("uses the 24-hour reservation window without a separate payment timer", () => {
    expect(dashboardSource).toContain(
      "Your reservation remains valid for 24 hours from creation.",
    );
    expect(dashboardSource).toContain("Step 2: Upload Payment Proof");
    expect(dashboardSource).toContain("Submit Payment Proof");
    expect(dashboardSource).not.toContain("PAYMENT_TIMER_DURATION");
    expect(dashboardSource).not.toContain("brikvest_payment_timer_");
    expect(dashboardSource).not.toContain("Session timer ended");
    expect(dashboardSource).not.toContain("Time remaining to complete payment");
  });
});