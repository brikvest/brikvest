import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, mobile = false) {
  const requests: { path: string; method: string; body: any }[] = [];
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  const row = (reservationId: number, extra: any = {}) => ({
    reservationId, userName: "Ada Investor", userEmail: "ada@example.test", units: "2.00", amount: "100000.00", currency: "NGN",
    pairId: null, preparationState: "unprepared", signingState: "unsigned", notificationState: "not_queued",
    canPrepare: true, requiresAttestation: false, canNotify: false, blockers: [], jobs: [], notificationHistory: [],
    reviewToken: `review-${reservationId}`, ...extra,
  });
  const holdings = [
    row(901), row(902, { requiresAttestation: true }),
    row(903, { userName: "Blocked Investor", canPrepare: false, blockers: ["Approve KYC with a verified legal name and home address."] }),
    row(904, { pairId: 1204, canPrepare: false, canNotify: true, preparationState: "documents_ready", signingState: "partially_signed",
      notificationState: "sent", notificationHistory: [{ id: 1, cycleNumber: 1, status: "sent", createdAt: "2026-10-01T10:00:00Z", sentAt: "2026-10-01T10:01:00Z" }] }),
    row(905, { pairId: 1205, canPrepare: false, canNotify: false, preparationState: "investor_signed", signingState: "investor_signed" }),
  ];
  await page.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.route("**/api/**", async (route) => {
    const req = route.request(), url = new URL(req.url());
    const method = req.method(), path = url.pathname, body = method === "POST" ? req.postDataJSON() : {};
    requests.push({ path, method, body });
    const json = (data: any, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (path === "/api/admin/me") return json({ user: { id: 1, username: "isolated", role: "admin" } });
    if (path === "/api/admin/properties") return json([{ id: 108, name: "North Estate", location: "Lagos" }, { id: 209, name: "South Estate", location: "Abuja" }]);
    if (path === "/api/admin/legal/readiness") return json({ ready: true, blockers: [] });
    if (path === "/api/admin/legal/templates" || path === "/api/admin/legal/documents" || path === "/api/admin/legal/failures") return json([]);
    if (path === "/api/admin/legal/historical-holdings" && method === "GET") {
      const search = (url.searchParams.get("search") || "").toLowerCase();
      const items = Number(url.searchParams.get("propertyId")) === 108 ? holdings.filter((h) => `${h.userName} ${h.userEmail}`.toLowerCase().includes(search)) : [];
      return json({ items, total: items.length, page: 1, pageSize: 20, propertyName: "North Estate", templates: [
        { id: 31, documentType: "deed_of_assignment", version: 2 }, { id: 32, documentType: "transfer_exit_rights", version: 4 },
      ] });
    }
    if (path === "/api/admin/legal/historical-holdings/prepare" && method === "POST") {
      const results = body.holdings.map((h: any) => {
        if (h.reservationId === 902) return { reservationId: h.reservationId, state: "blocked", reason: "Payment evidence changed. Review current evidence before retrying." };
        const found = holdings.find((r) => r.reservationId === h.reservationId)!;
        Object.assign(found, { pairId: 1300, canPrepare: false, preparationState: "queued", jobs: [{ kind: "generation", status: "queued" }] });
        return { reservationId: h.reservationId, state: "queued", pairId: 1300 };
      });
      return json({ results });
    }
    if (path === "/api/admin/legal/pairs/1204/resend") return json({ state: "cooldown", queued: false, message: "The prior notification ended recently. No new cycle was queued; wait one minute." });
    if (path.startsWith("/api/admin/legal")) return json({ error: "Unexpected API blocked in isolated fixture" }, 500);
    return json([]);
  });
  await page.addInitScript(() => localStorage.setItem("admin_session_id", "fixture"));
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin");
  if (mobile) await page.locator("header").getByRole("button").first().click();
  await page.getByRole("button", { name: "Legal Documents", exact: true }).click();
  await page.getByRole("combobox", { name: "Choose property" }).click();
  await page.getByRole("option", { name: /North Estate/ }).click();
  const card = page.locator("div").filter({ has: page.getByRole("heading", { name: "Historical legal holdings", exact: true }) }).filter({ has: page.getByRole("textbox", { name: "Search historical holdings" }) }).last();
  return { requests, holdings, card };
}

for (const mobile of [false, true]) {
  test(`${mobile ? "mobile" : "desktop"} historical selection is explicit, attested, property-isolated and reports mixed outcomes`, async ({ page }) => {
    const f = await fixture(page, mobile);
    const posts = () => f.requests.filter((r) => r.method === "POST");
    await expect(page.getByRole("checkbox", { name: "Select holding 901 for preparation" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Select holding 903 for preparation" })).toBeDisabled();
    expect(posts()).toHaveLength(0);
    await page.getByRole("textbox", { name: "Search historical holdings" }).fill("ada@example.test");
    await expect(page.getByRole("checkbox", { name: "Select holding 902 for preparation" })).toBeVisible();
    expect(posts()).toHaveLength(0);
    await page.getByRole("checkbox", { name: "Select holding 901 for preparation" }).check();
    await page.getByRole("checkbox", { name: "Select holding 902 for preparation" }).check();
    await expect(page.getByRole("button", { name: "Review preparation", exact: true })).toBeDisabled();
    await page.getByText("I reviewed the record and confirm full payment.", { exact: true }).click();
    await page.getByLabel("Confirmed amount (NGN)").fill("100000.00");
    await page.getByLabel("Audit note").fill("Reviewed full payment for holding 902.");
    await page.getByRole("button", { name: "Review preparation", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("North Estate");
    await expect(dialog).toContainText("31 · version 2");
    await expect(dialog).toContainText("32 · version 4");
    await expect(dialog).toContainText("ada@example.test");
    expect(posts()).toHaveLength(0);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(posts()).toHaveLength(0);
    await page.getByRole("button", { name: "Review preparation", exact: true }).click();
    await page.getByRole("button", { name: "Confirm and prepare", exact: true }).click();
    await expect(page.locator("[aria-live='polite']").filter({ hasText: "Action results" })).toContainText("Payment evidence changed. Review current evidence before retrying.");
    expect(posts()).toHaveLength(1);
    expect(posts()[0].body).toMatchObject({ propertyId: 108, confirmed: true, templateIds: { deed: 31, transfer: 32 } });
    expect(posts()[0].body.holdings).toEqual([
      { reservationId: 901, reviewToken: "review-901" },
      { reservationId: 902, reviewToken: "review-902", attestation: { fullPaymentConfirmed: true, amountNaira: "100000.00", currency: "NGN", auditNote: "Reviewed full payment for holding 902." } },
    ]);
    Object.assign(f.holdings[0], { preparationState: "documents_ready", jobs: [{ kind: "generation", status: "complete" }], canNotify: true });
    await expect(page.getByText("documents ready", { exact: true }).first()).toBeVisible({ timeout: 12000 });
    await page.getByRole("combobox", { name: "Choose property" }).click();
    await page.getByRole("option", { name: /South Estate/ }).click();
    await expect(page.getByRole("checkbox", { name: "Select holding 902 for preparation" })).toHaveCount(0);
    expect(posts()).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}

test("partial signatures allow one manual notification while fully signed records never request signing again", async ({ page }) => {
  const f = await fixture(page);
  const partialCard = page.locator("[data-holding-id='904']");
  const fullCard = page.locator("[data-holding-id='905']");
  await expect(fullCard.getByRole("button", { name: "Send notification" })).toBeDisabled();
  await partialCard.getByText("Notification history (1)", { exact: true }).click();
  await expect(partialCard).toContainText("Sent to mail service — inbox delivery not confirmed.");
  await partialCard.getByRole("button", { name: "Send notification" }).click();
  await expect(page.locator("[aria-live='polite']").filter({ hasText: "Action results" })).toContainText("The prior notification ended recently. No new cycle was queued; wait one minute.");
  expect(f.requests.filter((r) => r.path.endsWith("/resend"))).toEqual([{ path: "/api/admin/legal/pairs/1204/resend", method: "POST", body: { propertyId: 108 } }]);
  await page.getByText("Historical legal holdings", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/historical-legal-workspace.jpg", fullPage: false });
});