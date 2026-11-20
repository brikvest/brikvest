import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, mobile = false, initialFailure: { status: number; body: any } | null = null) {
  let loadFailure = initialFailure;
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
    row(904, { pairId: 1204, canPrepare: false, canNotify: true, reviewApproved: true, canReview: false, preparationState: "documents_ready", signingState: "partially_signed",
      documents: [{ id: 704, type: "deed_of_assignment", status: "investor_signed", hasUnsignedPdf: false, hasSignedPdf: true, hasCertificate: true }],
      notificationState: "sent", notificationHistory: [{ id: 1, cycleNumber: 1, status: "sent", createdAt: "2026-10-01T10:00:00Z", sentAt: "2026-10-01T10:01:00Z" }] }),
    row(905, { pairId: 1205, canPrepare: false, canNotify: false, preparationState: "investor_signed", signingState: "investor_signed", notificationState: "failed", jobs: [{ kind: "generation", status: "failed" }] }),
    row(906, { pairId: 1206, canPrepare: false, preparationState: "failed", notificationState: "uncertain", jobs: [{ kind: "generation", status: "failed" }, { kind: "notify", status: "uncertain" }] }),
    row(907, { pairId: 1207, canPrepare: false, preparationState: "failed", notificationState: "queued", jobs: [{ kind: "generation", status: "failed" }, { kind: "notify", status: "queued" }] }),
    row(908, { pairId: 1208, canPrepare: false, preparationState: "documents_ready", notificationState: "queued", jobs: [{ kind: "notify", status: "leased" }] }),
    row(909, { pairId: 1209, canPrepare: false, preparationState: "documents_ready", notificationState: "held_for_review", canReview: true,
      documents: [{ id: 901, type: "deed_of_assignment", status: "ready", hasUnsignedPdf: true }, { id: 902, type: "transfer_exit_rights", status: "ready", hasUnsignedPdf: true }],
      jobs: [{ kind: "notify", status: "blocked", lastError: "Review approval required" }] }),
    row(910, { pairId: 1210, canPrepare: false, preparationState: "queued", notificationState: "not_queued", lastError: "Renderer could not load the saved template.",
      jobs: [{ kind: "generation", status: "retry", lastError: "Renderer could not load the saved template." }] }),
    row(911, { pairId: 1211, canPrepare: false, canNotify: true, reviewApproved: true, canReview: true,
      preparationState: "documents_ready", notificationState: "queued",
      documents: [{ id: 9111, type: "deed_of_assignment", status: "awaiting_signature", hasUnsignedPdf: true },
        { id: 9112, type: "transfer_exit_rights", status: "awaiting_signature", hasUnsignedPdf: true }],
      jobs: [{ id: 9911, kind: "notify", status: "retry", cycleId: 991, retryEligible: true,
        availableAt: "2026-10-01T10:00:00Z", lastError: "APP_BASE_URL must be configured as an HTTPS application origin" }],
      notificationHistory: [{ id: 991, cycleNumber: 1, status: "queued", createdAt: "2026-10-01T10:00:00Z" }] }),
  ];
  const activeTemplates = [{ id: 31, documentType: "deed_of_assignment", version: 2 }, { id: 32, documentType: "transfer_exit_rights", version: 4 }];
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
      if (loadFailure) return json(loadFailure.body, loadFailure.status);
      const search = (url.searchParams.get("search") || "").toLowerCase();
      const matches = Number(url.searchParams.get("propertyId")) === 108 ? holdings.filter((h) => `${h.userName} ${h.userEmail}`.toLowerCase().includes(search)) : [row(2901, { userName: "South Investor" })];
      const requestedPage = Number(url.searchParams.get("page") || 1);
      const items = matches.slice((requestedPage - 1) * 20, requestedPage * 20);
      return json({ items, total: matches.length, page: requestedPage, pageSize: 20, propertyName: "North Estate", templates: activeTemplates });
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
    const review = path.match(/^\/api\/admin\/legal\/pairs\/(\d+)\/review$/);
    if (review && method === "GET") {
      const found = holdings.find((h) => h.pairId === Number(review[1]));
      if (!found) return json({ error: "Not found" }, 404);
      return json({ pairId: found.pairId, propertyId: Number(url.searchParams.get("propertyId")), reservationId: found.reservationId, investorName: found.userName, propertyName: "North Estate", approved: !!found.reviewApproved, documents: found.documents || [] });
    }
    if (/^\/api\/admin\/legal\/documents\/704\/(preview|download)$/.test(path)) return route.fulfill({ contentType: "application/pdf", body: Buffer.from("fixture signed document") });
    if (path === "/api/admin/legal/pairs/1204/resend") return json({ state: "cooldown", queued: false, message: "The prior notification ended recently. No new cycle was queued; wait one minute." });
    if (path === "/api/admin/legal/pairs/1211/recover-notification" && method === "POST") {
      Object.assign(holdings.find(h => h.reservationId === 911)!, { notificationState: "sent",
        jobs: [{ id: 9911, kind: "notify", status: "complete", cycleId: 991 }],
        notificationHistory: [{ id: 991, cycleNumber: 1, status: "sent", createdAt: "2026-10-01T10:00:00Z", sentAt: "2026-10-01T11:00:00Z" }] });
      return json({ state: "accepted", message: "The mail provider accepted this notification. No additional invitation was sent. Inbox delivery is not confirmed." });
    }
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
  return { requests, holdings, activeTemplates, card, row, setLoadFailure: (failure: typeof loadFailure) => { loadFailure = failure; } };
}

test("holdings setup failure is safe, retry recovers, and refresh/search/pagination discard obsolete actions", async ({ page }) => {
  const f = await fixture(page, false, { status: 503, body: { code: "HOLDINGS_SETUP_REQUIRED", error: "SELECT private FROM legal_documents: investor@example.test" } });
  const alert = page.getByRole("alert").filter({ hasText: "Could not load holdings" });
  await expect(alert).toContainText("database setup is incomplete");
  await expect(alert).toContainText("administrator");
  await expect(alert).not.toContainText("SELECT");
  await expect(alert).not.toContainText("investor@example.test");
  await expect(page.getByText("No confirmed holdings yet", { exact: true })).toHaveCount(0);
  f.setLoadFailure(null);
  for (let id = 920; id < 945; id++) f.holdings.push(f.row(id));
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("[data-holding-id='901']")).toBeVisible();
  await page.getByRole("checkbox", { name: "Select holding 901 for preparation" }).check();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText(/Page 2 of 2/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Review preparation", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select holding 901 for preparation" }).check();
  f.setLoadFailure({ status: 400, body: { error: "Failed query: secret credentials investor@example.test" } });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(alert).toContainText("request is invalid");
  await expect(page.getByRole("button", { name: "Review preparation", exact: true })).toHaveCount(0);
  await expect(page.locator("[data-holding-id]")).toHaveCount(0);
  f.setLoadFailure(null);
  await alert.getByRole("button", { name: "Try again" }).click();
  const search = page.getByRole("textbox", { name: "Search historical holdings" });
  await expect(search).toHaveAttribute("maxlength", "150");
  await search.fill("x".repeat(151));
  await expect(search).toHaveValue("x".repeat(150));
  await search.fill("ada@example.test");
  await expect(page.locator("[data-holding-id='901']")).toBeVisible();
  expect(f.requests.filter(r => r.method !== "GET")).toHaveLength(0);
});

test("session and unexpected load failures give safe guidance and property switching cannot retain holdings or selections", async ({ page }) => {
  const f = await fixture(page);
  await page.getByRole("checkbox", { name: "Select holding 901 for preparation" }).check();
  await page.getByRole("combobox", { name: "Choose property" }).click();
  await page.getByRole("option", { name: /South Estate/ }).click();
  await expect(page.locator("[data-holding-id='2901']")).toBeVisible();
  await expect(page.locator("[data-holding-id='901']")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review preparation", exact: true })).toHaveCount(0);
  f.setLoadFailure({ status: 401, body: { error: "private auth exception" } });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  const alert = page.getByRole("alert").filter({ hasText: "Could not load holdings" });
  await expect(alert).toContainText("Sign in again");
  f.setLoadFailure({ status: 500, body: { error: "SELECT private FROM users" } });
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(alert).toContainText("temporarily unavailable");
  await expect(alert).not.toContainText("SELECT");
  f.setLoadFailure(null);
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("[data-holding-id='2901']")).toBeVisible();
  expect(f.requests.filter(r => r.method !== "GET")).toHaveLength(0);
});

for (const mobile of [false, true]) {
  test(`${mobile ? "mobile" : "desktop"} recovers only the existing approved notification and reports provider acceptance`, async ({ page }) => {
    const f = await fixture(page, mobile);
    await page.locator("[data-holding-id='911']").getByRole("button", { name: "Review PDFs" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("APP_BASE_URL");
    await expect(dialog.getByRole("button", { name: "Resend notification", exact: true })).toHaveCount(0);
    const recover = dialog.getByRole("button", { name: "Recover existing notification", exact: true });
    await expect(recover).toBeEnabled();
    await recover.click();
    await expect(dialog.locator("[aria-live='polite']")).toContainText("mail provider accepted");
    await expect(dialog.locator("[aria-live='polite']")).toContainText("Inbox delivery is not confirmed");
    const posts = f.requests.filter(r => r.method === "POST");
    expect(posts).toEqual([{ path: "/api/admin/legal/pairs/1211/recover-notification", method: "POST",
      body: { propertyId: 108, confirmed: true, jobId: 9911, cycleId: 991 } }]);
    await expect(page.locator("[data-holding-id='911']")).toContainText("Notification accepted");
    expect(f.holdings.find(h => h.reservationId === 911)!.notificationHistory).toHaveLength(1);
  });

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
    await expect(page.getByRole("button", { name: "Review preparation", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Review preparation", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("North Estate");
    await expect(dialog).toContainText("31 · version 2");
    await expect(dialog).toContainText("32 · version 4");
    await expect(dialog).toContainText("ada@example.test");
    await expect(dialog.getByRole("button", { name: "Confirm and prepare", exact: true })).toBeDisabled();
    await dialog.getByText("I reviewed the payment record and confirm full payment.", { exact: true }).click();
    await dialog.getByLabel("Confirmed amount (NGN)").fill("100000.00");
    await dialog.getByLabel("Audit note").fill("Reviewed full payment for holding 902.");
    await expect(dialog.getByRole("button", { name: "Confirm and prepare", exact: true })).toBeEnabled();
    expect(posts()).toHaveLength(0);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(posts()).toHaveLength(0);
    await page.getByRole("button", { name: "Review preparation", exact: true }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Confirmed amount (NGN)")).toHaveValue("100000.00");
    await expect(dialog.getByLabel("Audit note")).toHaveValue("Reviewed full payment for holding 902.");
    f.holdings[0].reviewToken = "changed-after-confirmation-open";
    f.activeTemplates[0].id = 99;
    await page.getByRole("button", { name: "Confirm and prepare", exact: true }).click();
    await expect(page.locator("[aria-live='polite']")).toContainText("Payment evidence changed. Review current evidence before retrying.");
    expect(posts()).toHaveLength(1);
    expect(posts()[0].body).toMatchObject({ propertyId: 108, confirmed: true, templateIds: { deed: 31, transfer: 32 } });
    expect(posts()[0].body.holdings).toEqual([
      { reservationId: 901, reviewToken: "review-901" },
      { reservationId: 902, reviewToken: "review-902", attestation: { fullPaymentConfirmed: true, amountNaira: "100000.00", currency: "NGN", auditNote: "Reviewed full payment for holding 902." } },
    ]);
    Object.assign(f.holdings[0], { preparationState: "documents_ready", jobs: [{ kind: "generation", status: "complete" }], canNotify: true, canReview: true,
      documents: [{ id: 801, type: "deed_of_assignment", status: "ready", hasUnsignedPdf: true }, { id: 802, type: "transfer_exit_rights", status: "ready", hasUnsignedPdf: true }] });
    await expect(page.locator("[data-holding-id='901']")).toContainText("PDFs ready for review", { timeout: 12000 });
    await page.getByRole("combobox", { name: "Choose property" }).click();
    await page.getByRole("option", { name: /South Estate/ }).click();
    await expect(page.getByRole("checkbox", { name: "Select holding 902 for preparation" })).toHaveCount(0);
    expect(posts()).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}

test("partial signatures allow one manual notification while fully signed records never request signing again", async ({ page }) => {
  const f = await fixture(page);
  await expect(page.locator("[data-holding-id='906']")).toContainText("Notification outcome uncertain");
  await expect(page.locator("[data-holding-id='906']")).not.toContainText("Preparation needs attention");
  await expect(page.locator("[data-holding-id='907']")).toContainText("Notification queued");
  await expect(page.locator("[data-holding-id='908']")).toContainText("Notification processing");
  await expect(page.locator("[data-holding-id='909']")).toContainText("PDFs ready for review · notification held");
  await expect(page.locator("[data-holding-id='909']").getByRole("button", { name: "Review PDFs" })).toBeVisible();
  await expect(page.locator("[data-holding-id='910']")).toContainText("Preparation retry queued");
  await expect(page.locator("[data-holding-id='910']")).toContainText("Renderer could not load the saved template.");
  await page.locator("[data-holding-id='910']").getByRole("button", { name: "Review retry" }).click();
  await expect(page.getByRole("dialog")).toContainText("Retry processing");
  await expect(page.getByRole("dialog")).toContainText("Renderer could not load the saved template.");
   await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.locator("[data-holding-id='905']")).toContainText("Investor signed");
  const partialRow = page.locator("[data-holding-id='904']");
  const fullRow = page.locator("[data-holding-id='905']");
  await expect(fullRow.getByRole("button", { name: "Details" })).toBeVisible();
  await fullRow.getByRole("button", { name: "Details" }).click();
  await expect(page.getByRole("dialog")).toContainText("Investor signed");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Resend notification" })).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await partialRow.getByRole("button", { name: "Details" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "View signed PDF" }).click();
  await expect(page.getByRole("dialog").last().locator("iframe")).toHaveAttribute("src", /^blob:/);
  await page.getByRole("dialog").last().getByRole("button", { name: "Close" }).click();
  const certDownload = page.waitForEvent("download");
  await page.getByRole("dialog").getByRole("button", { name: "Download signing certificate" }).click();
  await certDownload;
  await page.getByText("Notification history (1)", { exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(/Accepted by mail service .*inbox delivery not confirmed/);
  await page.getByRole("dialog").getByRole("button", { name: "Resend notification" }).click();
  await expect(page.getByRole("dialog")).toContainText("The prior notification ended recently. No new cycle was queued; wait one minute.");
  expect(f.requests.filter((r) => r.path.endsWith("/resend"))).toEqual([{ path: "/api/admin/legal/pairs/1204/resend", method: "POST", body: { propertyId: 108 } }]);
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
});