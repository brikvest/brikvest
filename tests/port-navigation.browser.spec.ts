import { expect, test } from "@playwright/test";

test("existing public and sign-in URLs render without application errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  // Even an unexpected request cannot reach business data. The managed API
  // behind these browser fixtures is itself the write-rejecting fixture API.
  await page.route("**/api/**", route => {
    const path = new URL(route.request().url()).pathname;
    let status = 200, data: unknown = [];
    if (path === "/api/auth/user") { status = 401; data = { message: "Authentication required" }; }
    else if (path === "/api/exchange-rates") data = { rates: { NGN: 1 }, currencies: { NGN: { symbol: "₦", name: "Naira" } } };
    else if (route.request().method() !== "GET") { status = 503; data = { message: "No writes allowed" }; }
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
  });
  for (const path of [
    "/", "/about", "/faqs", "/login", "/reset-password", "/marketplace",
    "/developer/login", "/developer/signup", "/developer/pricing",
    "/contractor/login", "/contractor/signup", "/admin",
  ]) {
    await page.goto(path);
    await expect(page.locator("#root")).not.toBeEmpty();
    await expect(page.getByText("Replit Agent is building...", { exact: true })).toHaveCount(0);
    expect(errors, path).toEqual([]);
  }
});
