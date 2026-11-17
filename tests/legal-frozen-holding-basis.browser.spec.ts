import { expect, test } from "@playwright/test";

test("portfolio totals, cards and performance retain recorded principal after property costs change", async ({ page }) => {
  let land = 900;
  const basis = {
    version: 1, units: "1", currency: "NGN", landAmount: "800.00", agentFees: "100.00",
    dueDiligenceFees: "50.00", serviceCharges: "50.00", acquisitionAmount: "1000.00",
    confirmedAt: "2026-01-01T00:00:00Z", confirmedByAdminId: 1,
    source: "payment_submission", sourceId: 1,
  };
  const unexpectedWrites: string[] = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (!["GET", "HEAD"].includes(route.request().method())) {
      unexpectedWrites.push(path);
      return route.fulfill({ status: 409, json: { error: "Writes prohibited in isolated browser fixture" } });
    }
    let body: unknown = [];
    if (path === "/api/auth/user") body = {
      id: 1, email: "basis@example.test", firstName: "Basis", lastName: "Investor",
      kycStatus: "approved", accountStatus: "active",
    };
    if (path === "/api/exchange-rates") body = {
      rates: { NGN: 1500, USD: 1 },
      currencies: { NGN: { symbol: "₦", name: "Nigerian Naira" }, USD: { symbol: "$", name: "US Dollar" } },
    };
    if (path === "/api/user/project-updates") body = {};
    if (path === "/api/user/reservations") body = [
      { id: 1, propertyId: 1, status: "converted_to_investment", units: "1", amount: "1000",
        currency: "NGN", createdAt: "2026-01-01T00:00:00Z", costBasis: basis, landPrincipalAmount: "999",
        property: { id: 1, name: "Recorded Basis Estate", location: "Abuja", currency: "NGN",
          unitLandCost: land, unitAgentFees: 0, unitDueDiligenceCost: 50, unitServiceCharge: 50,
          totalValue: land * 100, totalUnits: 100 } },
      { id: 2, propertyId: 1, status: "converted_to_investment", units: "1", amount: "1000",
        currency: "NGN", createdAt: "2026-01-01T00:00:00Z", costBasis: null,
        property: { id: 1, name: "Unclassified Historic Estate", location: "Abuja", currency: "NGN",
          unitLandCost: 800, unitAgentFees: 100, unitDueDiligenceCost: 50, unitServiceCharge: 50, totalUnits: 100 } },
    ];
    if (path === "/api/properties/1/valuations") body = [
      { id: 1, propertyId: 1, valuationDate: "2025-12-01", rawAssetValue: "80000", currentValue: "80000", investorBasisValue: "80000" },
      { id: 2, propertyId: 1, valuationDate: "2026-02-01", rawAssetValue: "88000", currentValue: "88000", investorBasisValue: "88000" },
    ];
    await route.fulfill({ status: 200, json: body });
  });
  const check = async () => {
    await expect(page.getByText("Land value unavailable for 1 holding(s); excluded from this total.")).toBeVisible();
    await expect(page.getByTestId("card-current-value")).toContainText("₦880");
    await expect(page.getByTestId("card-total-invested")).toContainText("₦2,000");
    const recorded = page.getByText("Recorded Basis Estate", { exact: true }).locator("xpath=ancestor::div[contains(@class,'border')][1]");
    await expect(recorded).toContainText("₦800");
    await expect(recorded).toContainText("Total paid including fees: ₦1,000");
    await expect(page.getByText("Not recorded", { exact: true })).toBeVisible();
    // Main's raw owned-land chart and fee-inclusive purchase reference remain
    // independent of historical purchase-cost classification.
    const overall = page.getByTestId("overall-portfolio-performance");
    await expect(overall.getByTestId("owned-land-valuation-latest")).toContainText("1,760");
    await expect(overall.getByTestId("purchase-amount-reference")).toContainText("2,000");
  };
  await page.goto("/dashboard");
  await check();
  land = 2000;
  await page.reload();
  await check();
  expect(unexpectedWrites).toEqual([]);
});