import { expect, test, type Page } from "@playwright/test";
import { faqSections } from "../client/src/data/faqs";

async function fixtures(page: Page, authenticated = false) {
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  await page.route("**/*", route =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  await page.route("**/api/**", route => {
    if (route.request().method() !== "GET") throw new Error("FAQ tests must never write data");
    const path = new URL(route.request().url()).pathname;
    const body = path === "/api/auth/user" ? (authenticated ? {
      id: 1, firstName: "Fixture", role: "investor", accountStatus: "approved",
    } : null) : path === "/api/exchange-rates" ? {
      rates: { NGN: 1500, USD: 1 }, currencies: { NGN: { symbol: "₦", name: "Nigerian Naira" } },
    } : [];
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
}

test("direct public load, refresh, keyboard accordions and complete responsive content", async ({ page }) => {
  await fixtures(page);
  await page.goto("/faqs");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Frequently Asked Questions");
  const main = page.locator("main");
  const buttons = main.getByRole("button");
  await expect(buttons).toHaveCount(18);
  const first = buttons.first();
  await first.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(first).toBeFocused();
  expect(await first.evaluate(el => getComputedStyle(el).boxShadow !== "none")).toBe(true);
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(`[id="${await first.getAttribute("aria-controls")}"]`)).toBeVisible();
  await page.keyboard.press("Space");
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("ArrowDown");
  await expect(buttons.nth(1)).toBeFocused();
  for (const section of faqSections) {
    await expect(main.getByRole("heading", { level: 2, name: section.title, exact: true })).toBeVisible();
    for (const item of section.items) {
      const trigger = main.getByRole("button", { name: item.question, exact: true });
      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      const answer = page.locator(`[id="${await trigger.getAttribute("aria-controls")}"]`);
      await expect(answer).toHaveText(item.answer);
    }
  }
  await expect(main.locator('a[href="mailto:info@brikvest.net"]')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("faqs.png"), fullPage: true });
});

for (const authenticated of [false, true]) {
  test(`shared navigation keeps FAQs, Properties and account controls working (${authenticated ? "signed in" : "signed out"})`, async ({ page }) => {
    await fixtures(page, authenticated);
    await page.goto("/about");
    await page.locator("footer").scrollIntoViewIfNeeded();
    const mobile = page.viewportSize()!.width < 768;
    const openMenu = async () => {
      if (mobile) await page.getByTestId("button-mobile-menu").click();
    };
    const faqLink = () => page.getByTestId(mobile ? "link-mobile-faqs" : "link-faqs");
    const drawer = page.getByTestId("drawer-mobile-menu");
    await openMenu();
    await faqLink().click();
    await expect(page).toHaveURL(/\/faqs$/);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    if (mobile) await expect(drawer).toHaveAttribute("aria-hidden", "true");
    await openMenu();
    await expect(faqLink()).toBeVisible();
    if (authenticated) {
      if (mobile) {
        await expect(page.getByTestId("link-mobile-dashboard")).toHaveAttribute("href", "/dashboard");
        await expect(page.getByTestId("button-mobile-logout")).toBeVisible();
      } else {
        await page.getByTestId("button-user-menu").click();
        await expect(page.getByTestId("menu-item-portfolio")).toHaveAttribute("href", "/dashboard");
        await expect(page.getByTestId("menu-item-signout")).toBeVisible();
        await page.keyboard.press("Escape");
      }
    } else {
      await expect(page.getByTestId(mobile ? "button-mobile-signin" : "button-sign-in")).toBeVisible();
    }
    await page.getByTestId(mobile ? "link-mobile-properties" : "link-properties").click();
    await expect(page).toHaveURL(/\/\?section=properties$/);
    if (mobile) await expect(drawer).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator("#properties")).toBeInViewport();
    await openMenu();
    await faqLink().click();
    await expect(page).toHaveURL(/\/faqs$/);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    if (!authenticated) {
      await openMenu();
      await page.getByTestId(mobile ? "button-mobile-signin" : "button-sign-in").click();
      await expect(page).toHaveURL(/\/login$/);
    }
  });
}
