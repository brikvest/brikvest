import { expect, test, type Page } from "@playwright/test";

const base = {
  id: 1, name: "Sell date fixture", location: "Abuja", description: "An isolated property description with enough detail for administrator validation.",
  investmentDetails: "Isolated co-ownership details for this property fixture.",
  totalValue: 10000, minInvestment: 1000, totalSlots: 10, availableSlots: 10,
  totalSquareMeters: "100", unitPrice: 1000, currency: "NGN", status: "active",
  imageUrl: "/fixture.svg", sellDate: "2028-02-29", gallery: [],
};
async function fixtures(page: Page, authenticated = true) {
  const state = {
    rows: [
      { ...base },
      { ...base, id: 3, name: "Sold out estate with a long property name that wraps onto several lines", location: "A long location description in Guzape District, Federal Capital Territory, Abuja", status: "sold_out", sellDate: "2026-03-30" },
      { ...base, id: 2, name: "Without sell date", sellDate: null as string | null },
      { ...base, id: 5, name: "Available estate with a long property name that wraps onto several lines", location: "A long location description in Guzape District, Federal Capital Territory, Abuja", sellDate: "2029-01-01" },
      { ...base, id: 4, name: "Sold out without date", projectStatus: "sold_out", sellDate: null },
      { ...base, id: 6, name: "UndatedAvailablePropertyWithAnUnbrokenNameThatMustNotOverflowTheCard", location: "UnbrokenLocationDescriptionThatMustWrapWithinTheAvailableCard", sellDate: null },
    ],
    writes: [] as any[],
    reservations: [] as any[],
  };
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  // Never pass API or third-party requests through to live services.
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.route("**/api/**", async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/admin/me") return json({ user: { id: 9, username: "fixture-admin", role: "admin" } });
    if (path === "/api/auth/user") return authenticated
      ? json({ id: 5, email: "fixture@example.test", role: "investor", accountStatus: "approved" })
      : json({ message: "Unauthorized" }, 401);
    if (path === "/api/exchange-rates") return json({ rates: { NGN: 1500, USD: 1 }, currencies: { NGN: { symbol: "₦", name: "Nigerian Naira" } } });
    if (req.method() === "POST" && path === "/api/properties") {
      const data = req.postDataJSON(); state.writes.push(data);
      const row = { ...base, ...data, id: 7 }; state.rows.push(row);
      return json(row, 201);
    }
    if (req.method() === "PUT" && path.match(/^\/api\/properties\/\d+$/)) {
      const data = req.postDataJSON(); state.writes.push(data);
      const row = state.rows.find(r => r.id === Number(path.split("/").pop()))!;
      Object.assign(row, data); return json(row);
    }
    if (["/api/admin/properties", "/api/properties", "/api/properties-converted"].includes(path)) return json(state.rows);
    if (req.method() === "POST" && path === "/api/reservations") {
      const data = req.postDataJSON(); state.reservations.push(data);
      return json({ ...data, id: 1 }, 201);
    }
    if (path === "/api/statistics") return json({ totalInvested: 0, activeInvestors: 0, avgReturn: 0 });
    if (req.method() !== "GET") throw new Error(`Unexpected fixture write ${req.method()} ${path}`);
    return json([]);
  });
  return state;
}
async function propertiesTab(page: Page) {
  await expect(page.getByRole("button", { name: "View Site", exact: true })).toBeVisible();
  const propertiesButton = page.getByRole("button", { name: "Properties", exact: true });
  if (page.viewportSize()!.width < 1024) {
    await page.locator("button").filter({ has: page.locator("svg.lucide-menu") }).first().click();
  }
  await propertiesButton.click();
  // Mobile navigation overlays the main content until closed.
  if (page.viewportSize()!.width < 1024) {
    await page.locator("button").filter({ has: page.locator("svg.lucide-arrow-left") }).first().click();
  }
}
async function editFirst(page: Page) {
  await propertiesTab(page);
  await page.locator("button:visible").filter({ has: page.locator("svg.lucide-square-pen") }).first().click();
}

test("conditional primary-card placement, reload and time-zone-safe mobile/desktop display", async ({ page }) => {
  await fixtures(page);
  await page.goto("/");
  const date = page.getByTestId("property-sell-date-1");
  await expect(date).toContainText("Sell date");
  await expect(date.locator("time")).toHaveText("February 2028");
  await expect(date.locator("time")).toHaveAttribute("datetime", "2028-02-29");
  await expect(page.getByTestId("property-sell-date-2")).toHaveCount(0);
  const card = date.locator("..");
  const unitBlock = card.locator("div.grid").filter({ hasText: "Price per Unit" });
  expect(await unitBlock.evaluate(el => el.nextElementSibling?.getAttribute("data-testid"))).toBe("property-sell-date-1");
  const box = await date.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(test.info().project.use.viewport!.width);
  await page.reload();
  await expect(date.locator("time")).toHaveText("February 2028");
});

async function assertCardLayout(page: Page) {
  await expect(page.getByTestId("property-card-6")).toBeVisible();
  const cards = await page.getByTestId(/^property-card-\d+$/).evaluateAll(elements => elements.map(card => {
    const action = card.querySelector('[data-testid^="property-card-actions-"]')!;
    const details = card.querySelector('[data-testid^="property-card-details-"]')!;
    const cardRect = card.getBoundingClientRect();
    const actionRect = action.getBoundingClientRect();
    const controlRect = action.querySelector("button, div")!.getBoundingClientRect();
    const content = [...details.querySelectorAll("h3, p, time"), action];
    return {
      top: cardRect.top,
      bottom: cardRect.bottom,
      actionTop: actionRect.top,
      actionBottom: actionRect.bottom,
      controlBottom: controlRect.bottom,
      detailsBottom: details.getBoundingClientRect().bottom,
      padding: Number.parseFloat(getComputedStyle(action).paddingBottom),
      contained: content.every(el => {
        const rect = el.getBoundingClientRect();
        return rect.left >= cardRect.left && rect.right <= cardRect.right;
      }),
      titleHeight: card.querySelector("h3")!.getBoundingClientRect().height,
    };
  }));
  expect(cards).toHaveLength(6);
  const rows = new Map<number, typeof cards>();
  for (const card of cards) {
    expect(card.contained).toBe(true);
    expect(card.detailsBottom).toBeLessThanOrEqual(card.actionTop + 1);
    expect(card.padding).toBe(24);
    expect(Math.abs(card.bottom - card.actionBottom - 1)).toBeLessThan(1);
    expect(Math.abs(card.actionBottom - card.controlBottom - 24)).toBeLessThan(1);
    const top = Math.round(card.top);
    rows.set(top, [...(rows.get(top) || []), card]);
  }
  const columns = page.viewportSize()!.width >= 1024 ? 3 : page.viewportSize()!.width >= 768 ? 2 : 1;
  expect(rows.size).toBe(6 / columns);
  for (const row of rows.values()) {
    expect(row).toHaveLength(columns);
    expect(Math.max(...row.map(c => c.actionTop)) - Math.min(...row.map(c => c.actionTop))).toBeLessThan(1);
    expect(Math.max(...row.map(c => c.controlBottom)) - Math.min(...row.map(c => c.controlBottom))).toBeLessThan(1);
  }
  // These fixtures deliberately exercise wrapped words and unbroken strings.
  expect(cards[1].titleHeight).toBeGreaterThan(28);
  expect(cards[3].titleHeight).toBeGreaterThan(28);
  expect(cards[5].titleHeight).toBeGreaterThan(28);
}

test("mixed card footers align without clipping and keep reservation/details behavior", async ({ page }) => {
  const state = await fixtures(page);
  await page.goto("/");
  await assertCardLayout(page);
  await expect(page.getByTestId("property-sell-date-3").locator("time")).toHaveText("March 2026");
  await expect(page.getByTestId("property-sell-date-4")).toHaveCount(0);
  await expect(page.getByTestId("property-sell-date-6")).toHaveCount(0);
  await page.locator("#properties").screenshot({ path: test.info().outputPath("card-layout.png") });

  for (const id of [3, 4]) {
    const footer = page.getByTestId(`property-card-actions-${id}`);
    await expect(footer).toHaveText("Sold Out");
    await expect(footer.getByRole("button")).toHaveCount(0);
    await footer.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByTestId(`property-card-details-${id}`).locator("h3").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: /Reserve/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
  }

  await page.getByTestId("property-card-details-1").locator("h3").click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: base.name, exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("property-card-actions-1").getByRole("button", { name: "Reserve Ownership Slot" }).click();
  const reservation = page.getByRole("dialog");
  await expect(reservation.getByRole("heading", { name: "Reserve Ownership Slot" })).toBeVisible();
  await reservation.getByLabel("Number of Units").fill("2");
  await reservation.getByRole("button", { name: "Reserve My Slot", exact: true }).click();
  await expect.poll(() => state.reservations.length).toBe(1);
  expect(state.reservations[0]).toMatchObject({ propertyId: 1, units: "2", email: "fixture@example.test" });
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Success!" })).toBeVisible();
});

test("signed-out actions keep the same footer alignment and sign-in route", async ({ page }) => {
  const state = await fixtures(page, false);
  await page.goto("/");
  await assertCardLayout(page);
  await expect(page.getByRole("button", { name: "Reserve Ownership Slot", exact: true })).toHaveCount(0);
  for (const id of [1, 2, 5, 6]) {
    await expect(page.getByTestId(`property-card-actions-${id}`).getByRole("button", { name: "Sign In to Invest" })).toBeVisible();
  }
  await expect(page.getByTestId("property-card-actions-3").getByRole("link")).toHaveCount(0);
  await expect(page.getByTestId("property-card-actions-4").getByRole("link")).toHaveCount(0);
  await page.getByTestId("property-card-actions-2").getByRole("button", { name: "Sign In to Invest" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(state.reservations).toHaveLength(0);
});

test("admin edit hydration, unrelated edit, update, reload and clearing", async ({ page }) => {
  const state = await fixtures(page);
  await page.addInitScript(() => localStorage.setItem("admin_session_id", "isolated-fixture"));
  await page.goto("/admin");
  await editFirst(page);
  const input = page.getByTestId("admin-property-sell-date-edit");
  await expect(input).toHaveValue("2028-02-29");
  await page.getByLabel("Property Name", { exact: false }).fill("Edited fixture");
  await page.getByRole("button", { name: "Update Property", exact: true }).click();
  await expect(input).toHaveCount(0);
  expect(state.writes.at(-1).sellDate).toBe("2028-02-29");
  await page.reload(); await editFirst(page);
  await expect(input).toHaveValue("2028-02-29");
  await input.fill("2029-01-01");
  await page.getByRole("button", { name: "Update Property", exact: true }).click();
  await expect(input).toHaveCount(0);
  await page.reload(); await editFirst(page);
  await expect(input).toHaveValue("2029-01-01");
  await input.fill("");
  await page.getByRole("button", { name: "Update Property", exact: true }).click();
  await expect(input).toHaveCount(0);
  expect(state.writes.at(-1).sellDate).toBeNull();
  await page.reload(); await editFirst(page);
  await expect(input).toHaveValue("");
  await page.goto("/");
  await expect(page.getByTestId("property-sell-date-1")).toHaveCount(0);
});

test("admin create restores a date draft, saves it, and resets the optional input", async ({ page }) => {
  const state = await fixtures(page);
  await page.addInitScript(draft => {
    localStorage.setItem("admin_session_id", "isolated-fixture");
    if (!sessionStorage.getItem("draft-seeded")) {
      localStorage.setItem("property_draft", JSON.stringify(draft));
      sessionStorage.setItem("draft-seeded", "true");
    }
  }, { ...base, totalValue: "10000", totalSlots: "10", availableSlots: "10", unitLandCost: "1000", sellDate: "2028-02-29" });
  page.on("dialog", dialog => dialog.accept());
  await page.goto("/admin");
  await expect(page.getByRole("button", { name: "View Site", exact: true })).toBeVisible();
  const add = page.getByRole("button", { name: "Add Property", exact: true });
  if (page.viewportSize()!.width < 1024) await page.locator("button").filter({ has: page.locator("svg.lucide-menu") }).first().click();
  await add.click();
  const close = page.locator("button").filter({ has: page.locator("svg.lucide-arrow-left") }).first();
  if (page.viewportSize()!.width < 1024) await close.click();
  const input = page.getByTestId("admin-property-sell-date-create");
  await expect(input).toHaveValue("2028-02-29");
  await input.fill("2029-01-01");
  await page.getByRole("button", { name: /Save to Draft|Draft Saved/ }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "View Site", exact: true })).toBeVisible();
  if (page.viewportSize()!.width < 1024) await page.locator("button").filter({ has: page.locator("svg.lucide-menu") }).first().click();
  await add.click();
  if (page.viewportSize()!.width < 1024) await close.click();
  await expect(input).toHaveValue("2029-01-01");
  await page.getByRole("button", { name: "Create Property", exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0].sellDate).toBe("2029-01-01");
  await expect(input).toHaveValue("");
  expect(await page.evaluate(() => localStorage.getItem("property_draft"))).toBeNull();
  await page.goto("/");
  await expect(page.getByTestId("property-sell-date-7").locator("time")).toHaveText("January 2029");
});
