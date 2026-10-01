import { expect, test, type Page, type Route } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

type Template = { id: number; propertyId: number | null; documentType: string; version: number; active: boolean; validationStatus: string; createdAt: string };
type RequestRecord = { path: string; method: string; propertyId: number; body: any; query: string };
type Fixture = {
  requests: RequestRecord[];
  unexpected: string[];
  templates: Template[];
  delays: Map<string, number>;
  pending: Set<string>;
};
const properties = [{ id: 108, name: "North Estate", location: "Lagos" }, { id: 209, name: "South Estate", location: "Abuja" }];
const template = (id: number, propertyId: number | null, documentType: string, active = false, version = 1): Template =>
  ({ id, propertyId, documentType, active, version, validationStatus: "valid", createdAt: "2026-01-01T00:00:00Z" });
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function installMocks(page: Page): Promise<Fixture> {
  const fixture: Fixture = {
    requests: [], unexpected: [], delays: new Map(), pending: new Set(),
    templates: [template(31, 108, "deed_of_assignment"), template(32, 108, "transfer_exit_rights"),
      template(41, 209, "deed_of_assignment", true), template(42, 209, "transfer_exit_rights", true),
      template(40, 209, "deed_of_assignment", false, 2), template(90, null, "deed_of_assignment", false, 9)],
  };
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("Isolated legal review fixture - not for execution");
  const pdfBytes = Buffer.from(await pdf.save());
  // No API request can fall through to the application, even unexpected calls.
  // External origins are blocked too; no live database, mail or provider access.
  await page.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== origin) return route.abort();
    return route.continue();
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    const path = url.pathname;
    const method = request.method();
    let body: any = {};
    if (method === "POST") {
      if (request.headers()["content-type"]?.includes("multipart")) {
        const multipart = request.postData() || "";
        body = {
          propertyId: Number(multipart.match(/name="propertyId"\r\n\r\n(\d+)/)?.[1]),
          documentType: multipart.match(/name="documentType"\r\n\r\n([a-z_]+)/)?.[1],
          hasFile: multipart.includes('filename="north-v2.docx"'),
        };
      } else body = request.postDataJSON() || {};
    }
    const propertyId = Number(url.searchParams.get("propertyId") || body.propertyId || 0);
    fixture.requests.push({ path, method, propertyId, body, query: url.search });
    const delay = fixture.delays.get(`${method} ${path}`) || 0;
    // Snapshot list/metadata before delaying, simulating an old in-flight response.
    const snapshot = fixture.templates.map((item) => ({ ...item }));
    if (delay) {
      fixture.pending.add(`${method} ${path}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      fixture.pending.delete(`${method} ${path}`);
    }
    if (path === "/api/admin/me") return json(route, { user: { id: 9, username: "fixture-admin", role: "admin" } });
    if (path === "/api/admin/properties") return json(route, properties);
    if (path === "/api/exchange-rates") return json(route, { rates: { NGN: 1500, USD: 1 }, currencies: { NGN: { symbol: "₦", name: "Nigerian Naira" }, USD: { symbol: "$", name: "US Dollar" } } });
    if (path === "/api/admin/legal/readiness") return json(route, { ready: true, blockers: [] });
    if (path === "/api/admin/legal/templates" && method === "GET") return json(route, snapshot.filter((item) => url.searchParams.has("unassigned") ? item.propertyId === null : item.propertyId === propertyId));
    if (path === "/api/admin/legal/templates" && method === "POST" && body.propertyId === 108 && body.hasFile) {
      const uploaded = template(33, 108, body.documentType, false, 2);
      fixture.templates.push(uploaded);
      return json(route, uploaded, 201);
    }
    const templateMatch = path.match(/^\/api\/admin\/legal\/templates\/(\d+)\/(activate|assign|fields|preview|download)$/);
    if (templateMatch) {
      const current = fixture.templates.find((item) => item.id === Number(templateMatch[1]));
      const inspected = snapshot.find((item) => item.id === Number(templateMatch[1]));
      const operation = templateMatch[2];
      if (!current || !inspected) return json(route, { error: "Fixture template not found" }, 404);
      const unassigned = url.searchParams.get("unassigned") === "true" && current.propertyId === null;
      if (operation === "assign" && method === "POST" && current.propertyId === null && body.confirmed === true && properties.some((item) => item.id === propertyId)) {
        current.propertyId = propertyId;
        return json(route, { message: "Ownership assigned without activation." });
      }
      if (!unassigned && current.propertyId !== propertyId) {
        fixture.unexpected.push(`Foreign template ${path} ${propertyId}`);
        return json(route, { error: "Wrong property" }, 404);
      }
      if (operation === "activate" && method === "POST") {
        fixture.templates.filter((item) => item.propertyId === propertyId && item.documentType === current.documentType).forEach((item) => item.active = item.id === current.id);
        return json(route, { message: "Activated for future generation only." });
      }
      if (operation === "fields") return json(route, { fields: [{
        token: inspected.propertyId === 209 ? "USER_HOME_ADDRESS" : "USER_FULL_NAME",
        label: inspected.propertyId === 209 ? "South verified address" : inspected.id === 33 ? "North draft identity" : "North verified identity",
        meaning: "Populated from verified investor records", source: "Approved KYC", format: "Verified text", count: 2,
      }], issues: [] });
      if (operation === "preview" || operation === "download") return route.fulfill({ contentType: operation === "preview" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document", body: operation === "preview" ? pdfBytes : Buffer.from("isolated-word-download") });
    }
    if (path === "/api/admin/legal/documents") return json(route, propertyId === 108 ? [{
      id: 1200, reservationId: 450, propertyId, userName: "North Investor", userEmail: "north@example.test", status: "awaiting_templates", documents: [],
    }] : [{
      id: 2200, reservationId: 550, propertyId, userName: "South Investor", userEmail: "south@example.test", status: "investor_signed",
      deedTemplateId: 41, transferTemplateId: 42, documents: [{ id: 501, type: "deed_of_assignment", status: "investor_signed", hasUnsignedPdf: true, hasSignedPdf: true, hasCertificate: true }],
    }]);
    if (path === "/api/admin/legal/failures") return json(route, []);
    const pair = path.match(/^\/api\/admin\/legal\/pairs\/(1200|2200)\/(retry|resend|audit)$/);
    if (pair && propertyId === (pair[1] === "1200" ? 108 : 209)) return json(route, pair[2] === "audit" ? [{ eventType: "local_signing_completed", evidence: "retained-fixture-hash" }] : { message: "Background processing queued; delivery is not confirmed." });
    if (/^\/api\/admin\/legal\/documents\/501\/(preview|download)$/.test(path) && propertyId === 209) return route.fulfill({ contentType: url.searchParams.get("version") === "docx" ? "application/octet-stream" : "application/pdf", body: pdfBytes });
    if (path.startsWith("/api/admin/legal")) {
      fixture.unexpected.push(`${method} ${path} ${url.search}`);
      return json(route, { error: "Unexpected legal request blocked" }, 500);
    }
    if (!["GET", "HEAD"].includes(method)) fixture.unexpected.push(`${method} ${path}`);
    return json(route, []);
  });
  await page.addInitScript(() => window.localStorage.setItem("admin_session_id", "isolated-browser-admin"));
  return fixture;
}

async function openWorkspace(page: Page, mobile = false) {
  await page.goto("/admin");
  if (mobile) await page.locator("header").getByRole("button").first().click();
  await page.getByRole("button", { name: "Legal Documents", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Legal documents", exact: true })).toBeVisible();
}
async function chooseProperty(page: Page, name: string) {
  await page.getByRole("combobox", { name: "Choose property" }).click();
  await page.getByRole("option", { name: new RegExp(name) }).click();
  await expect(page.getByRole("heading", { name: `Upload to ${name}`, exact: true })).toBeVisible();
}
async function closeDialog(page: Page) {
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
}

test("readiness retains font infrastructure failures regardless of template wording", async ({ page }) => {
  await installMocks(page);
  const detail = "Fontconfig unavailable; per-template font verification cannot run.";
  await page.route("**/api/admin/legal/readiness", (route) => json(route, {
    ready: false,
    checks: [{ id: "document-fonts", ready: false, detail }],
    blockers: [detail],
  }));
  await openWorkspace(page);
  await page.getByText("Infrastructure readiness", { exact: false }).first().click();
  await expect(page.getByText(detail, { exact: true })).toBeVisible();
  await expect(page.getByText("No infrastructure blockers reported.", { exact: true })).toHaveCount(0);
});

for (const mobile of [false, true]) {
  test(`${mobile ? "mobile" : "desktop"} property templates, draft/live fields, retry, legacy ownership and retained evidence`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const fixture = await installMocks(page);
    await openWorkspace(page, mobile);
    await expect(page.getByText("Choose a property to begin", { exact: true })).toBeVisible();
    await chooseProperty(page, "North Estate");
    const north = page.getByRole("article").filter({ hasText: "North Investor" });
    await expect(north.getByRole("button", { name: "Retry after activation" })).toBeDisabled();
    await page.getByRole("button", { name: "Inspect fields", exact: true }).first().click();
    await expect(page.getByText("Draft · not live", { exact: true })).toBeVisible();
    await expect(page.getByText("North verified identity", { exact: true })).toBeVisible();
    await page.getByLabel("New Word version").setInputFiles({ name: "north-v2.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("Mock-only upload; never sent to server") });
    await page.getByRole("button", { name: "Upload & validate" }).click();
    await expect(page.getByText("North draft identity", { exact: true })).toBeVisible();
    const upload = fixture.requests.find((item) => item.path === "/api/admin/legal/templates" && item.method === "POST");
    expect(upload?.body).toMatchObject({ propertyId: 108, documentType: "deed_of_assignment", hasFile: true });
    await page.getByRole("button", { name: "Preview PDF", exact: true }).first().click();
    await expect(page.getByRole("dialog")).toContainText("North Estate");
    await expect(page.getByRole("dialog").locator("iframe")).toHaveAttribute("src", /^blob:/);
    await closeDialog(page);
    await page.getByRole("button", { name: "Activate v2", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Existing document pairs keep their original template pins");
    await page.getByRole("button", { name: "Confirm activation" }).click();
    await expect(page.getByText("Live template", { exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: "Activate v1", exact: true }).first().click();
    await page.getByRole("button", { name: "Confirm activation" }).click();
    await expect(north.getByRole("button", { name: "Retry after activation" })).toBeEnabled();
    await north.getByRole("button", { name: "Retry after activation" }).click();
    await expect.poll(() => fixture.requests.some((item) => item.path.endsWith("/1200/retry") && item.body.propertyId === 108)).toBe(true);
    await expect(page.getByText("Retry queued", { exact: true }).first()).toBeVisible();
    await page.getByText("Advanced operations", { exact: true }).click();
    await page.getByText("Unassigned legacy templates · explicit destination required", { exact: true }).click();
    await page.getByRole("button", { name: "Assign to North Estate", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Destination: North Estate");
    await page.getByRole("button", { name: "Confirm this destination" }).click();
    await expect.poll(() => fixture.templates.find((item) => item.id === 90)?.propertyId).toBe(108);
    expect(fixture.templates.find((item) => item.id === 90)?.active).toBe(false);
    await chooseProperty(page, "South Estate");
    await expect(page.getByText("South verified address", { exact: true })).toHaveCount(2);
    await expect(page.getByText("North verified identity", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("New Word version")).toHaveValue("");
    await page.screenshot({ path: test.info().outputPath(`${mobile ? "mobile" : "desktop"}-property-workspace.png`), fullPage: true });
    const south = page.getByRole("article").filter({ hasText: "South Investor" });
    await south.getByRole("button", { name: "Resend email" }).click();
    await expect(page.getByText("Email queued", { exact: true }).first()).toBeVisible();
    await south.getByRole("button", { name: "Signed PDF", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("South Estate");
    await closeDialog(page);
    for (const label of ["Signed", "DOCX", "Signing audit record"]) {
      const downloaded = page.waitForEvent("download");
      await south.getByRole("button", { name: label, exact: true }).click();
      await downloaded;
    }
    await south.getByText("Approval, pinned versions & audit", { exact: true }).click();
    await south.getByRole("button", { name: "View audit trail" }).click();
    await expect(page.getByRole("dialog")).toContainText("retained-fixture-hash");
    await closeDialog(page);
    expect(fixture.unexpected).toEqual([]);
    expect(fixture.requests.filter((item) => item.path.includes("/501/")).every((item) => item.propertyId === 209)).toBe(true);
    expect(fixture.requests.filter((item) => item.path.endsWith("/activate")).every((item) => item.body.propertyId === 108)).toBe(true);
    if (mobile) expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("switching properties fences delayed list, field, preview and upload results", async ({ page }) => {
  const fixture = await installMocks(page);
  await openWorkspace(page);
  fixture.delays.set("GET /api/admin/legal/templates", 5000);
  await chooseProperty(page, "North Estate");
  await chooseProperty(page, "South Estate");
  expect(fixture.pending.has("GET /api/admin/legal/templates")).toBe(true);
  await expect(page.getByText("South verified address", { exact: true })).toHaveCount(2);
  await expect(page.getByText("North Investor", { exact: true })).toHaveCount(0);
  fixture.delays.clear();
  await chooseProperty(page, "North Estate");
  fixture.delays.set("GET /api/admin/legal/templates/31/fields", 5000);
  await page.getByRole("button", { name: "Inspect fields", exact: true }).first().click();
  await expect.poll(() => fixture.pending.has("GET /api/admin/legal/templates/31/fields")).toBe(true);
  await chooseProperty(page, "South Estate");
  expect(fixture.pending.has("GET /api/admin/legal/templates/31/fields")).toBe(true);
  await page.waitForTimeout(5200);
  await expect(page.getByText("North verified identity", { exact: true })).toHaveCount(0);
  fixture.delays.clear();
  await chooseProperty(page, "North Estate");
  fixture.delays.set("GET /api/admin/legal/templates/31/preview", 5000);
  await page.getByRole("button", { name: "Preview PDF", exact: true }).first().click();
  await expect.poll(() => fixture.requests.some((item) => item.path.endsWith("/31/preview"))).toBe(true);
  await chooseProperty(page, "South Estate");
  expect(fixture.pending.has("GET /api/admin/legal/templates/31/preview")).toBe(true);
  await page.waitForTimeout(5200);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  fixture.delays.clear();
  await chooseProperty(page, "North Estate");
  fixture.delays.set("POST /api/admin/legal/templates", 5000);
  await page.getByLabel("New Word version").setInputFiles({ name: "north-v2.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("Delayed mock upload") });
  await page.getByRole("button", { name: "Upload & validate" }).click();
  await expect.poll(() => fixture.pending.has("POST /api/admin/legal/templates")).toBe(true);
  await chooseProperty(page, "South Estate");
  expect(fixture.pending.has("POST /api/admin/legal/templates")).toBe(true);
  await page.waitForTimeout(5200);
  await expect(page.getByText("Template uploaded · not active", { exact: true })).toHaveCount(0);
  await expect(page.getByText("North draft identity", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("New Word version")).toHaveValue("");
  expect(fixture.unexpected).toEqual([]);
});

test("pending activation retains its confirmed destination until completion", async ({ page }) => {
  const fixture = await installMocks(page);
  await openWorkspace(page);
  await chooseProperty(page, "North Estate");
  fixture.delays.set("POST /api/admin/legal/templates/31/activate", 3000);
  await page.getByRole("button", { name: "Activate v1", exact: true }).first().click();
  await page.getByRole("button", { name: "Confirm activation" }).click();
  await expect.poll(() => fixture.pending.has("POST /api/admin/legal/templates/31/activate")).toBe(true);
  await page.keyboard.press("Escape");
  // Busy confirmation cannot be dismissed and accidentally retargeted.
  await expect(page.getByRole("dialog")).toContainText("Activate for North Estate?");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Cancel" })).toBeDisabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(fixture.templates.find((item) => item.id === 31)?.active).toBe(true);
  expect(fixture.requests.find((item) => item.path.endsWith("/31/activate"))?.body).toEqual({ propertyId: 108 });
  await chooseProperty(page, "South Estate");
  await expect(page.getByText("South verified address", { exact: true })).toHaveCount(2);
  await expect(page.getByText("North verified identity", { exact: true })).toHaveCount(0);
  expect(fixture.unexpected).toEqual([]);
});