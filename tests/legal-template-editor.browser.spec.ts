import { expect, test, type Page, type Route } from "@playwright/test";

test.setTimeout(35000);
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
async function fixture(page: Page) {
  const requests: { path: string; method: string; body: any }[] = [];
  const templates = [
    { id: 73, propertyId: 34, documentType: "deed_of_assignment", version: 1, active: true, validationStatus: "valid", createdAt: "2026-01-01" },
    { id: 75, propertyId: 34, documentType: "transfer_exit_rights", version: 1, active: true, validationStatus: "valid", createdAt: "2026-01-01" },
  ];
  const state = { failSave: false, failLoad: false };
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const body = method === "POST" ? request.postDataJSON() : undefined;
    requests.push({ path, method, body });
    if (path === "/api/admin/me") return json(route, { user: { id: 9, username: "isolated-admin", role: "admin" } });
    if (path === "/api/admin/properties") return json(route, [{ id: 34, name: "LilyCrest Gardens", location: "Lagos" }]);
    if (path === "/api/exchange-rates") return json(route, { rates: { NGN: 1500, USD: 1 }, currencies: { NGN: { symbol: "₦", name: "Naira" } } });
    if (path === "/api/admin/legal/readiness") return json(route, { ready: true, blockers: [] });
    if (path === "/api/admin/legal/historical-holdings") return json(route, {
      items: [], total: 0, page: 1, pageSize: 20, propertyName: "LilyCrest Gardens",
      templates: templates.filter(template => template.active),
    });
    if (path === "/api/admin/legal/templates") return json(route, url.searchParams.get("propertyId") === "34" ? templates : []);
    if (/\/templates\/\d+\/fields$/.test(path)) return json(route, { fields: [], issues: [] });
    if (/\/templates\/\d+\/editor$/.test(path)) {
      const sourceId = Number(path.split("/")[5]);
      const source = templates.find(template => template.id === sourceId)!;
      if (method === "GET") {
        if (state.failLoad) return json(route, { error: "Temporary source access failed" }, 503);
        return json(route, {
          templateId: sourceId, propertyId: 34, documentType: source.documentType, version: source.version,
          sourceSha256: "a".repeat(64), sections: [{ id: "word/document.xml", name: "Document", paragraphs: [
            { id: "word/document.xml:0", text: source.documentType === "deed_of_assignment" ? "Original deed wording." : "Original agreement wording.", editable: true, tokens: [] },
            { id: "word/document.xml:1", text: "Granted to {{USER_FULL_NAME}} at {{USER_HOME_ADDRESS}}.", editable: true, tokens: ["{{USER_FULL_NAME}}", "{{USER_HOME_ADDRESS}}"] },
            { id: "word/document.xml:2", text: "Retained signature image.", editable: false, reason: "Protected signature image", tokens: [] },
          ] }],
        });
      }
      if (state.failSave) return json(route, { error: "The source is no longer available.", failure: {
        code: "EDITOR_SOURCE_UNAVAILABLE", stage: "save", summary: "The source is no longer available.",
        issues: [], nextAction: "Reopen the source version. No template was changed.",
      } }, 409);
      templates.push({ ...source, id: 74, version: 2, active: false });
      return json(route, { id: 74, propertyId: 34, documentType: source.documentType, version: 2, validationStatus: "valid" }, 201);
    }
    // Never permit unexpected fixture requests to reach a real backend.
    return json(route, []);
  });
  await page.addInitScript(() => localStorage.setItem("admin_session_id", "isolated-browser-admin"));
  await page.goto("/admin");
  if (page.viewportSize()!.width < 640) await page.locator("header").getByRole("button").first().click();
  await page.getByRole("button", { name: "Legal Documents", exact: true }).click();
  await page.getByRole("combobox", { name: "Choose property" }).click();
  await page.getByRole("option", { name: /LilyCrest Gardens/ }).click();
  await page.getByRole("tab", { name: "Templates", exact: true }).click();
  return { requests, state };
}
const openEditor = async (page: Page, index = 0) => {
  await page.getByRole("button", { name: "Edit wording", exact: true }).nth(index).click();
  await expect(page.getByRole("textbox", { name: "Paragraph 1", exact: true })).toBeVisible();
};

for (const mobile of [false, true]) {
  test(`${mobile ? "mobile" : "desktop"} edits a deed in the admin app and saves only changed paragraphs as an inactive draft`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const data = await fixture(page);
    await openEditor(page);
    const dialog = page.getByRole("dialog").first();
    const save = dialog.getByRole("button", { name: "Save as new draft" });
    await expect(save).toBeDisabled();
    await expect(page.getByRole("textbox", { name: "Paragraph 3" })).toHaveAttribute("readonly", "");
    await page.getByRole("textbox", { name: "Paragraph 1", exact: true }).fill("Updated deed wording.\nNew clause.");
    await expect(save).toBeEnabled();
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await page.screenshot({ path: `/tmp/legal-editor-${mobile ? "mobile" : "desktop"}.png` });
    await save.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Uploaded · not active · Version 2", { exact: true })).toBeVisible();
    const writes = data.requests.filter(request => request.method === "POST");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ path: "/api/admin/legal/templates/73/editor", body: {
      propertyId: 34, sourceSha256: "a".repeat(64),
      changes: [{ id: "word/document.xml:0", text: "Updated deed wording.\nNew clause." }],
    } });
    expect(data.requests.some(request => /download|activate|approve-send/.test(request.path))).toBe(false);
  });
}

test("protects automatic fields, retains failed edits and confirms discard", async ({ page }) => {
  const data = await fixture(page);
  await openEditor(page);
  const second = page.getByRole("textbox", { name: "Paragraph 2", exact: true });
  const save = page.getByRole("button", { name: "Save as new draft" });
  await second.fill("Missing investor fields.");
  await expect(save).toBeDisabled();
  await second.fill("{{USER_HOME_ADDRESS}} then {{USER_FULL_NAME}}.");
  await expect(save).toBeDisabled();
  await second.fill("Granted to {{USER_FULL_NAME}} at {{USER_HOME_ADDRESS}}.");
  await page.getByRole("textbox", { name: "Paragraph 1", exact: true }).fill("Keep this unsaved wording.");
  data.state.failSave = true;
  await save.click();
  await expect(page.getByRole("textbox", { name: "Paragraph 1", exact: true })).toHaveValue("Keep this unsaved wording.");
  await expect(page.getByRole("alert")).toContainText("The source is no longer available.");
  await page.getByRole("button", { name: "Cancel editing", exact: true }).click();
  await expect(page.getByRole("dialog").last()).toContainText("Leave wording unsaved?");
  await page.getByRole("button", { name: "Continue editing" }).click();
  await expect(page.getByRole("textbox", { name: "Paragraph 1", exact: true })).toHaveValue("Keep this unsaved wording.");
  await page.getByRole("button", { name: "Cancel editing", exact: true }).click();
  await page.getByRole("button", { name: "Discard edits and close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(data.requests.filter(request => request.method === "POST")).toHaveLength(1);
});

test("loads and edits the agreement separately from the deed", async ({ page }) => {
  const data = await fixture(page);
  await openEditor(page, 1);
  await expect(page.getByRole("textbox", { name: "Paragraph 1", exact: true })).toHaveValue("Original agreement wording.");
  await page.getByRole("textbox", { name: "Paragraph 1", exact: true }).fill("Updated transfer agreement wording.");
  await page.getByRole("button", { name: "Save as new draft" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(data.requests.find(request => request.method === "POST")!.path).toBe("/api/admin/legal/templates/75/editor");
});

test("offers retry after a source-load failure without losing the selected property", async ({ page }) => {
  const data = await fixture(page);
  data.state.failLoad = true;
  await page.getByRole("button", { name: "Edit wording", exact: true }).first().click();
  const retry = page.getByRole("button", { name: /Retry loading/ });
  await expect(retry).toBeVisible();
  data.state.failLoad = false;
  await retry.click();
  await expect(page.getByRole("textbox", { name: "Paragraph 1", exact: true })).toHaveValue("Original deed wording.");
  expect(data.requests.filter(request => request.path.endsWith("/73/editor"))).toHaveLength(2);
});