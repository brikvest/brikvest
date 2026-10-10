import { expect, test, type Page } from "@playwright/test";

const socials = [
  ["Instagram", "https://www.instagram.com/brik.vest/"],
  ["TikTok", "https://www.tiktok.com/@brikvest"],
  ["LinkedIn", "https://www.linkedin.com/company/brikvest"],
] as const;

async function fixtures(page: Page, listingState = "ready", authenticated = false) {
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  await page.route("**/*", route => {
    return new URL(route.request().url()).origin === origin ? route.continue() : route.abort();
  });
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({
      status, contentType: "application/json", body: JSON.stringify(body),
    });
    if (route.request().method() !== "GET") throw new Error("Unexpected API write in footer test");
    if (path === "/api/auth/user") return json(authenticated ? {
      id: 1, firstName: "Fixture", role: "investor", accountStatus: "approved",
    } : null);
    if (path === "/api/exchange-rates") return json({
      rates: { NGN: 1500, USD: 1 },
      currencies: { NGN: { symbol: "₦", name: "Nigerian Naira" } },
    });
    if (path === "/api/public/listing/footer-fixture") {
      if (listingState === "loading") return new Promise<void>(() => {});
      if (listingState === "missing") return json({ message: "Not found" }, 404);
      return json({
        id: 1, propertyId: 1, propertyName: "Fixture land", propertyLocation: "Abuja",
        sellingType: "fixed", status: "active", currency: "NGN", units: 2,
        askingPrice: "60000", createdAt: "2026-01-01T00:00:00Z", sellerName: "Fixture seller",
      });
    }
    return json([]);
  });
}

function contrast(foreground: string, background: string) {
  const luminance = (color: string) => {
    const values = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(n => {
      const v = n / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  };
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

for (const [name, path] of [
  ["home", "/"], ["about", "/about"], ["listing", "/listing/footer-fixture"],
  ["pricing", "/developer/pricing"],
] as const) {
  test(`${name} footer keeps social destinations, accessibility and responsive layout`, async ({ page }) => {
    await fixtures(page);
    await page.goto(path);
    const footer = page.locator("footer");
    await expect(footer).toHaveCount(1);
    await footer.scrollIntoViewIfNeeded();
    await expect(footer).toContainText("Brikvest. All rights reserved.");
    const links = footer.locator('a[target="_blank"]');
    await expect(links).toHaveCount(3);
    for (const [index, [platform, url]] of socials.entries()) {
      const link = links.nth(index);
      await expect(link).toHaveAccessibleName(new RegExp(platform));
      await expect(link).toHaveAttribute("href", url);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", /noopener/);
      await expect(link).toHaveAttribute("rel", /noreferrer/);
      await expect(link.locator("svg")).toHaveAttribute("aria-hidden", "true");
      await expect(link).toBeVisible();
      const box = (await link.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      expect(box.height).toBeGreaterThanOrEqual(40);
      const colors = await link.evaluate(el => {
        let parent: Element | null = el;
        let bg = "rgb(255, 255, 255)";
        while (parent) {
          const c = getComputedStyle(parent).backgroundColor;
          if (c !== "rgba(0, 0, 0, 0)" && c !== "transparent") { bg = c; break; }
          parent = parent.parentElement;
        }
        return { fg: getComputedStyle(el).color, bg };
      });
      expect(contrast(colors.fg, colors.bg)).toBeGreaterThanOrEqual(4.5);
    }
    // Reach each link via keyboard, not programmatic focus alone.
    await links.first().focus();
    await page.keyboard.press("Shift+Tab");
    for (let index = 0; index < socials.length; index++) {
      await page.keyboard.press("Tab");
      const link = links.nth(index);
      await expect(link).toBeFocused();
      expect(await link.evaluate(el => el.matches(":focus-visible"))).toBe(true);
      expect(await link.evaluate(el => {
        const css = getComputedStyle(el);
        return css.boxShadow !== "none" || (css.outlineStyle !== "none" && parseFloat(css.outlineWidth) > 0);
      })).toBe(true);
    }
    expect(await footer.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    if (name === "home") await expect(footer.getByTestId("link-footer-developer-login")).toHaveAttribute("href", "/developer/login");
    if (name === "pricing") {
      for (const [label, destination] of [["Home", "/"], ["About", "/about"], ["Developer sign-in", "/developer/login"]]) {
        await expect(footer.getByRole("link", { name: label, exact: true })).toHaveAttribute("href", destination);
      }
    }
    await footer.screenshot({ path: `test-results/footer-socials/${test.info().project.name}-${name}.png` });
  });
}

for (const state of ["loading", "missing"]) {
  test(`listing ${state} state still has no footer`, async ({ page }) => {
    await fixtures(page, state);
    await page.goto("/listing/footer-fixture");
    await expect(page.getByText(state === "loading" ? "Loading listing..." : "Listing Not Found", { exact: true })).toBeVisible();
    await expect(page.locator("footer")).toHaveCount(0);
  });
}

test("embedded dashboard property browsing still has no public footer", async ({ page }) => {
  await fixtures(page, "ready", true);
  await page.goto("/dashboard?section=properties");
  await expect(page.getByRole("heading", { name: "Land Listings", exact: true })).toBeVisible();
  await expect(page.locator("footer")).toHaveCount(0);
});
