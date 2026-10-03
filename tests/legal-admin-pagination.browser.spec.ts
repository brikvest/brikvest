import { expect, test } from "@playwright/test";

for (const mobile of [false, true]) {
  test(`${mobile ? "mobile" : "desktop"} holding search and pagination survive refresh and tab changes without dispatching work`, async ({ page }) => {
    const origin = new URL(test.info().project.use.baseURL as string).origin;
    const writes: string[] = [];
    const unexpected: string[] = [];
    const holdings = Array.from({ length: 41 }, (_, index) => ({
      reservationId: index + 1, userName: `Investor ${index + 1}`, userEmail: `investor${index + 1}@example.test`,
      units: "1", amount: "100000", currency: "NGN", pairId: null, preparationState: "unprepared",
      signingState: "unsigned", notificationState: "not_queued", canPrepare: true, canNotify: false,
      requiresAttestation: false, canReview: false, reviewApproved: false, reviewToken: `fixture-${index}`,
      documents: [], blockers: [], jobs: [], notificationHistory: [],
    }));
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith("/api/")) return route.continue();
      if (request.method() !== "GET") { writes.push(url.pathname); return route.abort(); }
      let body: unknown = [];
      if (url.pathname === "/api/admin/me") body = { user: { id: 1, username: "Fixture Admin", role: "admin" } };
      else if (url.pathname === "/api/admin/properties") body = [{ id: 108, name: "Fixture Estate", location: "Lagos" }];
      else if (url.pathname === "/api/exchange-rates") body = { rates: { NGN: 1500, USD: 1 }, currencies: { NGN: { symbol: "₦", name: "Nigerian Naira" }, USD: { symbol: "$", name: "US Dollar" } } };
      else if (url.pathname === "/api/admin/legal/historical-holdings") {
        const search = url.searchParams.get("search") || "";
        const number = Number(url.searchParams.get("page") || 1);
        const matches = holdings.filter((h) => h.userName.toLowerCase().includes(search.toLowerCase()));
        body = { items: matches.slice((number - 1) * 20, number * 20), total: matches.length, page: number, pageSize: 20,
          propertyName: "Fixture Estate", templates: [{ id: 1, documentType: "deed_of_assignment", version: 1 }, { id: 2, documentType: "transfer_exit_rights", version: 1 }] };
      } else if (url.pathname === "/api/admin/legal/failures") body = [{ id: 1, eventType: "historical_preparation_failed", reservationId: 41,
        details: { reason: "Preparation failed before a pair existed" }, createdAt: "2026-01-01T00:00:00Z" }];
      else if (url.pathname.startsWith("/api/admin/legal/") && url.pathname !== "/api/admin/legal/templates") unexpected.push(url.pathname);
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.addInitScript(() => localStorage.setItem("admin_session_id", "fixture"));
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin");
    if (mobile) await page.locator("header").getByRole("button").first().click();
    await page.getByRole("button", { name: "Legal Documents", exact: true }).click();
    await page.getByRole("combobox", { name: "Choose property" }).click();
    await page.getByRole("option", { name: /Fixture Estate/ }).click();
    await expect(page.getByText("Page 1 of 3 · 41 holdings", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.locator("[data-holding-id='21']")).toBeVisible();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByText("Page 2 of 3 · 41 holdings", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Templates", exact: true }).click();
    await page.getByRole("tab", { name: "Investor documents", exact: true }).click();
    await expect(page.getByText("Page 2 of 3 · 41 holdings", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Search historical holdings" }).fill("Investor 2");
    await expect(page.getByText("Page 1 of 1 · 11 holdings", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Templates", exact: true }).click();
    await page.getByRole("tab", { name: "Investor documents", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Search historical holdings" })).toHaveValue("Investor 2");
    await page.getByText("Recorded failures and recovery history (1)", { exact: true }).click();
    await page.getByText(/historical preparation failed · Holding #41/).click();
    await expect(page.getByText(/Preparation failed before a pair existed/)).toBeVisible();
    await expect(page.getByText("Advanced operations", { exact: true })).toHaveCount(0);
    expect(writes).toEqual([]);
    expect(unexpected).toEqual([]);
  });
}