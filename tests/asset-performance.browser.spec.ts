import { expect, test, type Page } from "@playwright/test";

async function fixtures(page: Page) {
  const first = { id: 33, name: "Gilmore Yard", location: "Abuja", currency: "NGN", totalValue: 16250000, totalSlots: 50 };
  const second = { id: 34, name: "Lily Crest Gardens", location: "Abuja", currency: "NGN",
    totalValue: 10000000, totalSlots: 100, unitLandCost: 100000, unitAgentFees: 0, unitDueDiligenceCost: 0, unitServiceCharge: 0 };
  const holding = (id: number, property: typeof first, units: string, amount: string, status = "converted_to_investment") =>
    ({ id, propertyId: property.id, property, userId: 901, units, amount, currency: "NGN",
      status, createdAt: "2025-10-15T12:00:00Z", fullName: "Fixture Investor", email: "investor@example.test" });
  const valuation = (id: number, propertyId: number, valuationDate: string, raw: number, basis: number, reportUrl: string | null = null) =>
    ({ id, propertyId, valuationDate, currentValue: String(raw), rawAssetValue: String(raw),
      investorBasisValue: String(basis), reportUrl });
  const state = {
    holdings: [
      holding(1, first, "2", "650000"),
      holding(2, first, "1", "325000"),
      holding(3, second, "4", "400000"),
      holding(4, { ...first, id: 99, name: "Pending property" }, "1", "325000", "reserved"),
    ],
    valuations: {
      33: [valuation(1, 33, "2025-10-01T00:00:00Z", 12500000, 16250000),
        valuation(2, 33, "2026-10-19T00:00:00Z", 18000000, 19500000, "/fixture-report.pdf")],
      34: [valuation(3, 34, "2025-10-01T00:00:00Z", 10000000, 10000000),
        valuation(4, 34, "2026-10-19T00:00:00Z", 15000000, 15000000, "/fixture-report.pdf")],
    } as Record<number, any[]>,
    failProperty: null as number | null,
    requests: [] as string[],
    writes: [] as string[],
    reportRequests: [] as number[],
  };
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  // Isolated fixtures: neither unexpected APIs nor third-party traffic reach live services.
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    state.requests.push(path);
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() !== "GET") {
      state.writes.push(`${request.method()} ${path}`);
      return json({ message: "Fixture write blocked" }, 405);
    }
    if (path === "/api/auth/user") return json({ id: 901, firstName: "Fixture", email: "investor@example.test",
      role: "investor", accountStatus: "approved", kycStatus: "approved", preferredCurrency: "NGN" });
    if (path === "/api/user/reservations") return json(state.holdings);
    if (path === "/api/exchange-rates") return json({ rates: { NGN: 1500, USD: 1 },
      currencies: { NGN: { symbol: "₦", name: "Nigerian Naira" }, USD: { symbol: "$", name: "US Dollar" } } });
    const match = path.match(/^\/api\/properties\/(\d+)\/valuations$/);
    if (match) return Number(match[1]) === state.failProperty
      ? json({ message: "Temporary fixture failure" }, 500)
      : json(state.valuations[Number(match[1])] || []);
    const report = path.match(/^\/api\/properties\/(\d+)\/valuation-report$/);
    if (report) {
      state.reportRequests.push(Number(report[1]));
      return json({ message: "No fixture report available" }, 404);
    }
    return json([]);
  });
  return state;
}

test("overall graphs remain while each asset has isolated land and investor performance", async ({ page }) => {
  const state = await fixtures(page);
  await page.goto("/dashboard");
  await expect(page.getByTestId("card-current-value")).toContainText("Current Portfolio Value");
  await expect(page.getByTestId("card-current-value")).toContainText("1,770,000");
  await expect(page.getByTestId("card-total-invested")).toContainText("Purchase Amount");
  await expect(page.getByTestId("card-total-invested")).toContainText("1,375,000");
  for (const card of ["card-current-value", "card-total-invested"]) {
    const value = page.getByTestId(card).locator("p").nth(1);
    expect(await value.evaluate(element =>
      element.getBoundingClientRect().height <= parseFloat(getComputedStyle(element).lineHeight) + 1)).toBe(true);
  }
  await page.screenshot({ path: `${test.info().outputDir}/portfolio-summary.png` });
  const overall = page.getByRole("region", { name: "Overall portfolio performance" });
  const assets = page.getByRole("region", { name: "Performance by asset" });
  const charts = assets.getByTestId("asset-performance-charts");
  await expect(overall.getByRole("button", { name: "View Valuation Report" })).toHaveCount(0);
  await expect(charts.getByRole("button", { name: "View Valuation Report" })).toBeVisible();
  await expect(overall).toContainText("1,375,000");
  await expect(overall).toContainText("1,770,000");
  await expect(overall).toContainText("+46.1% overall");
  await expect(overall.getByTestId("owned-land-valuation-latest")).toContainText("1,680,000");
  await expect(assets.getByRole("heading", { name: "Gilmore Yard", exact: true })).toBeVisible();
  await expect(charts).toContainText("Land Valuation");
  await expect(charts).toContainText("Current Value");
  await expect(charts).toContainText("975,000");
  await expect(charts).toContainText("1,170,000");
  await expect(charts).toContainText("+44.0% overall");
  await expect(charts.getByTestId("owned-land-valuation-latest")).toContainText("1,080,000");
  const landInfo = charts.getByRole("button", { name: "About Land Valuation" });
  await landInfo.click();
  const info = page.getByRole("dialog");
  await expect(info).toContainText("your owned units");
  await expect(info).toContainText("Acquisition fees are excluded");
  await expect(info).toContainText("investor-basis property valuations since purchase");
  await expect(info).toContainText("Neither is a guaranteed selling price");
  await info.screenshot({ path: test.info().outputPath("valuation-info.png") });
  const infoBounds = await info.boundingBox();
  expect(infoBounds!.x).toBeGreaterThanOrEqual(0);
  expect(infoBounds!.x + infoBounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.keyboard.press("Escape");
  await expect(info).toHaveCount(0);
  await expect(landInfo).toBeFocused();
  const currentInfo = charts.getByRole("button", { name: "About Current Value" });
  await currentInfo.focus();
  await page.keyboard.press("Enter");
  await expect(info).toContainText("recorded purchase basis");
  await page.keyboard.press("Escape");
  await expect(currentInfo).toBeFocused();
  await expect(charts).not.toContainText("400,000");
  await expect(charts.locator(".recharts-responsive-container")).toHaveCount(2);
  const select = assets.getByRole("combobox", { name: "Choose an asset" });
  await select.click();
  // Multiple purchases of one property produce one asset; pending holdings are excluded.
  await expect(page.getByRole("option")).toHaveCount(2);
  await expect(page.getByRole("option", { name: "Pending property" })).toHaveCount(0);
  await page.getByRole("option", { name: "Lily Crest Gardens", exact: true }).click();
  await expect(assets.getByRole("heading", { name: "Lily Crest Gardens", exact: true })).toBeVisible();
  await expect(charts).toContainText("400,000");
  await expect(charts).toContainText("600,000");
  await expect(charts).toContainText("+50.0% overall");
  await expect(charts.getByTestId("owned-land-valuation-latest")).toContainText("600,000");
  await expect(charts).not.toContainText("975,000");
  await expect(overall).toContainText("1,770,000");
  await expect(charts.locator("svg.recharts-surface")).toHaveCount(2);
  await expect(charts.locator(".recharts-area-curve")).toHaveCount(3);
  for (const surface of await charts.locator("svg.recharts-surface").all()) {
    await expect(surface).toBeVisible();
    expect(await surface.locator(".recharts-cartesian-axis-tick").count()).toBeGreaterThan(0);
  }
  const summary = charts.getByText("Purchase Amount", { exact: true }).locator("..").locator("..");
  const summaryBoxes = await summary.locator(":scope > div").evaluateAll(elements =>
    elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        textFits: element.scrollWidth <= element.clientWidth };
    }));
  expect(summaryBoxes).toHaveLength(3);
  for (let index = 1; index < summaryBoxes.length; index++) {
    const previous = summaryBoxes[index - 1], current = summaryBoxes[index];
    expect(current.left >= previous.right || current.top >= previous.bottom).toBe(true);
  }
  expect(summaryBoxes.every(box => box.textFits)).toBe(true);
  const gradients = await page.locator("linearGradient").evaluateAll(elements => elements.map(element => element.id));
  expect(new Set(gradients).size).toBe(gradients.length);
  // Capture the graphs before opening a report tab changes browser focus.
  await charts.scrollIntoViewIfNeeded();
  await charts.screenshot({ path: test.info().outputPath("owned-land-and-current.png") });
  const popup = page.waitForEvent("popup");
  await charts.getByRole("button", { name: "View Valuation Report" }).click();
  const reportTab = await popup;
  await expect.poll(() => state.reportRequests).toEqual([34]);
  await reportTab.close().catch(() => {});
  await expect(page.getByText("No report available", { exact: true })).toBeVisible();
  // Both chart scopes share cached property queries rather than refetching on each selection.
  expect(state.requests.filter(path => path === "/api/properties/33/valuations")).toHaveLength(1);
  expect(state.requests.filter(path => path === "/api/properties/34/valuations")).toHaveLength(1);
  await charts.scrollIntoViewIfNeeded();
  await assets.screenshot({ path: test.info().outputPath("asset-performance.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(state.writes).toEqual([]);
});

test("summary never substitutes zero for loading or failed valuations", async ({ page }) => {
  const state = await fixtures(page);
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/properties/33/valuations", async route => {
    await waiting;
    await route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"Fixture failure"}' });
  });
  await page.goto("/dashboard");
  const current = page.getByTestId("card-current-value");
  await expect(current).toContainText("Loading…");
  await expect(current).not.toContainText("₦0.00");
  await expect(page.getByTestId("card-total-invested")).toContainText("1,375,000");
  release();
  await expect(current).toContainText("Value unavailable");
  await expect(current).not.toContainText("₦0.00");
  await page.unroute("**/api/properties/33/valuations");
  await current.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(current).toContainText("1,770,000");
  expect(state.writes).toEqual([]);
});

test("missing ownership totals do not turn land valuation into the entire land or a fake zero", async ({ page }) => {
  const state = await fixtures(page);
  state.holdings.forEach(holding => { holding.property.totalSlots = 0; });
  await page.goto("/dashboard");
  const overall = page.getByTestId("overall-portfolio-performance");
  const land = overall.getByTestId("owned-land-valuation-chart");
  await expect(land.getByRole("status")).toContainText("valid ownership totals are missing");
  await expect(land.getByTestId("owned-land-valuation-latest")).toHaveCount(0);
  await expect(land).not.toContainText("33,000,000");
  await expect(land).not.toContainText("Latest land valuation: ₦0.00");
  await expect(page.getByTestId("card-current-value")).toContainText("1,770,000");
  expect(state.writes).toEqual([]);
});

test("summary uses invested basis without valuations and shows genuine empty totals", async ({ page }) => {
  const state = await fixtures(page);
  state.valuations = {};
  await page.goto("/dashboard");
  await expect(page.getByTestId("card-current-value")).toContainText("1,375,000");
  await expect(page.getByTestId("card-total-invested")).toContainText("1,375,000");
  state.holdings = [];
  await page.reload();
  await expect(page.getByTestId("card-current-value")).toContainText("₦0.00");
  await expect(page.getByTestId("card-total-invested")).toContainText("₦0.00");
  expect(state.writes).toEqual([]);
});

test("assets without valuations show an honest empty state and keyboard selection remains usable", async ({ page }) => {
  const state = await fixtures(page);
  state.valuations[34] = [];
  await page.goto("/dashboard");
  const assets = page.getByRole("region", { name: "Performance by asset" });
  const select = assets.getByRole("combobox", { name: "Choose an asset" });
  await select.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(assets.getByRole("heading", { name: "Lily Crest Gardens", exact: true })).toBeVisible();
  await expect(assets).toContainText("Performance data will appear here once property valuations are recorded.");
  await expect(assets.locator(".recharts-responsive-container")).toHaveCount(0);
  await select.click();
  await page.getByRole("option", { name: "Gilmore Yard", exact: true }).click();
  await expect(assets).toContainText("1,170,000");
  expect(state.writes).toEqual([]);
});

test("a valuation request failure is not shown as zero and can be retried", async ({ page }) => {
  const state = await fixtures(page);
  state.failProperty = 33;
  await page.goto("/dashboard");
  const assets = page.getByRole("region", { name: "Performance by asset" });
  await expect(assets.getByRole("alert")).toContainText("Could not load performance data");
  await expect(assets).not.toContainText("No confirmed investments");
  state.failProperty = null;
  await assets.getByRole("button", { name: "Retry performance data" }).click();
  await expect(assets).toContainText("1,170,000");
  await expect(assets.getByRole("alert")).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

test("a single owned asset works without duplicate options and an empty portfolio has no asset section", async ({ page }) => {
  const state = await fixtures(page);
  state.holdings = state.holdings.filter(holding => holding.propertyId === 33);
  await page.goto("/dashboard");
  const assets = page.getByRole("region", { name: "Performance by asset" });
  await expect(assets).toContainText("975,000");
  await assets.getByRole("combobox", { name: "Choose an asset" }).click();
  await expect(page.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Escape");
  state.holdings = [];
  await page.reload();
  await expect(page.getByTestId("asset-performance-section")).toHaveCount(0);
  await expect(page.getByTestId("overall-portfolio-performance")).toHaveCount(0);
  expect(state.writes).toEqual([]);
});
