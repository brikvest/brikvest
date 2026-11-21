import { test, expect } from "@playwright/test";

const base = "/brikvest-test-checkout/";
// These hit the actual managed sandbox backend/PGlite. No API mocks, test-mode
// switches, or fake payment successes are installed into the running app.
test("inspect synthetic reservation, create another, reload and reset with confirmation", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", req => requests.push(req.url()));
  const stateResponse = page.waitForResponse(response =>
    response.url().endsWith(`${base}api/state`) && response.request().method() === "GET");
  await page.goto(base);
  const state = await (await stateResponse).json();
  await expect(page.getByTestId("banner-test-only")).toContainText("not the live Brikvest site");
  await expect(page.getByTestId("text-property-name")).toHaveText("Brikvest Test Plot");
  if (state.setup.available) {
    await expect(page.getByTestId("section-setup")).toContainText("Hosted test checkout is ready");
    await expect(page.locator('[data-testid^="button-checkout-"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="button-checkout-"]')).toBeEnabled();
  } else {
    await expect(page.getByTestId("section-setup")).toContainText("Checkout is blocked");
    await expect(page.locator('[data-testid^="button-checkout-"]')).toHaveCount(0);
  }
  await expect(page.locator('[data-testid^="card-reservation-"]')).toHaveCount(1);
  const initialId = await page.locator('[data-testid^="card-reservation-"]').getAttribute("data-testid");
  await page.getByTestId("button-new-reservation").click();
  await expect(page.locator('[data-testid^="card-reservation-"]')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('[data-testid^="card-reservation-"]')).toHaveCount(2);
  await page.getByTestId("button-open-reset").click();
  await expect(page.getByTestId("button-confirm-reset")).toBeDisabled();
  await page.getByTestId("input-reset-phrase").fill("RESET SYNTHETIC RECORDS");
  await page.getByTestId("button-confirm-reset").click();
  await expect(page.locator('[data-testid^="card-reservation-"]')).toHaveCount(1);
  await expect(page.getByTestId("text-action-message")).toContainText("Only this session");
  expect(await page.locator('[data-testid^="card-reservation-"]').getAttribute("data-testid")).not.toBe(initialId);
  await page.getByTestId("link-help").click();
  await expect(page.getByTestId("banner-test-only")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByTestId("img-logo")).toBeVisible();
  expect(await page.getByTestId("img-logo").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(requests.filter(url => /api\.flutterwave|checkout\.flutterwave|checkout-v2\.dev-flutterwave|\/api\/(?:user|admin|payments)\//.test(url))).toEqual([]);
});

test("a forged successful return never becomes verified evidence", async ({ page }) => {
  await page.goto(base);
  await expect(page.getByTestId("text-property-name")).toBeVisible();
  const ref = "brk_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  await page.goto(`${base}dashboard?status=successful&tx_ref=${ref}&transaction_id=101`);
  await expect(page.getByText("Could not verify your return from the hosted checkout.")).toBeVisible();
  await expect(page.getByTestId("button-retry-return")).toBeVisible();
  await expect(page.getByText("Payment received — awaiting admin approval", { exact: true })).toHaveCount(0);
  await page.getByTestId("button-retry-return").click();
  await expect(page.getByText("Could not verify your return from the hosted checkout.")).toBeVisible();
  expect(page.url()).toContain(`tx_ref=${ref}`);
  await expect(page.getByTestId("banner-test-only")).toBeVisible();
});
