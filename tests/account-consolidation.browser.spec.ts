import { expect, test, type Page } from "@playwright/test";

async function fixtures(page: Page, blocked = false, retry = false) {
  const submissions: any[] = [];
  await page.addInitScript(() => localStorage.setItem("admin_session_id", "disposable-admin-fixture"));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/admin/me") return json({ user: { id: 7, username: "Disposable admin", role: "admin" } });
    if (path === "/api/auth/user") return json({ message: "Unauthorized" }, 401);
    if (path === "/api/exchange-rates") return json({ rates: { NGN: 1500, USD: 1 }, currencies: {} });
    if (path === "/api/admin/account-consolidations/preview") {
      const identity = { firstName: "Disposable", lastName: "Investor", kycFullName: "Disposable Investor",
        kycStatus: "approved", kycDateOfBirth: "1980-01-01", kycIdType: "passport", kycIdNumber: "••••1234", isActive: true, emailVerified: true };
      return json({
        source: { ...identity, id: 1, email: "source@example.test" },
        destination: { ...identity, id: 2, email: "destination@example.test" },
        holdings: [
          { id: 10, user_id: 1, property_id: 9, full_name: "Original owner", email: "old@example.test", units: "3.2", amount: "1008000", currency: "NGN", unit_price_snapshot: "315000", status: "converted_to_investment" },
          { id: 11, user_id: 2, property_id: 9, full_name: "Destination owner", email: "destination@example.test", units: "1", amount: "315000", currency: "NGN", unit_price_snapshot: "315000", status: "converted_to_investment" },
        ],
        certificates: [{ id: 20, reservation_id: 10, certificate_number: "CERT-DISPOSABLE", owner_name: "Original owner", verification_token: "unchanged-token" }],
        blockers: blocked ? ["Verified identity conflict: kyc id number."] : [],
        previewToken: "a".repeat(64),
      });
    }
    if (path === "/api/admin/account-consolidations") {
      submissions.push(route.request().postDataJSON());
      if (retry && submissions.length === 1) return json({ message: "Consolidation is unavailable. Retry the same request." }, 503);
      return json({ auditId: 123, sourceId: 1, destinationId: 2, holdingIds: [10] });
    }
    // No request can reach a backend; fixtures fail on unexpected writes.
    if (route.request().method() !== "GET") throw new Error(`Unexpected fixture write ${path}`);
    return json([]);
  });
  await page.goto("/admin");
  const lookup = page.getByRole("button", { name: "User Portfolio", exact: true });
  if (page.viewportSize()!.width < 1024) await page.locator("button").filter({ has: page.locator("svg.lucide-menu") }).first().click();
  await lookup.click();
  if (page.viewportSize()!.width < 1024) await page.locator("button").filter({ has: page.locator("svg.lucide-arrow-left") }).first().click();
  await page.getByLabel("Source account ID", { exact: true }).fill("1");
  await page.getByLabel("Destination account ID", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Review accounts" }).click();
  await expect(page.getByRole("heading", { name: "Linked holdings" })).toBeVisible();
  return submissions;
}
test("reviews identities, preserves destination holdings, requires explicit evidence and safely retries", async ({ page }) => {
  const submissions = await fixtures(page, false, true);
  await expect(page.getByText("Source #1 — move", { exact: true })).toBeVisible();
  await expect(page.getByText("Destination #2 — unchanged", { exact: true })).toBeVisible();
  await expect(page.getByText("CERT-DISPOSABLE", { exact: true })).toBeVisible();
  const submit = page.getByRole("button", { name: "Consolidate accounts", exact: true });
  await expect(submit).toBeDisabled();
  await page.locator("#identity-verified").click();
  await page.getByLabel(/Verification note/).fill("Reviewed approved disposable identity records.");
  await page.locator("#consolidation-confirmation").fill("CONSOLIDATE 1 INTO 2");
  await submit.click();
  await expect(page.getByRole("alert").filter({ hasText: "unavailable" })).toBeVisible();
  await page.getByRole("button", { name: "Retry same request", exact: true }).click();
  await expect(page.getByText(/Audit reference: 123/)).toBeVisible();
  expect(submissions).toHaveLength(2);
  expect(submissions[0]).toEqual(submissions[1]);
});
test("conflicting identity blocks authorization and changing IDs discards preview", async ({ page }) => {
  await fixtures(page, true);
  await expect(page.getByRole("heading", { name: "This consolidation is blocked" })).toBeVisible();
  await expect(page.locator("#identity-verified")).toHaveCount(0);
  await page.getByLabel("Source account ID", { exact: true }).fill("3");
  await expect(page.getByRole("heading", { name: "Linked holdings" })).toHaveCount(0);
});
