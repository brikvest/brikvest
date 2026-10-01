import { expect, test, type Page, type Route } from "@playwright/test";

type AdminBrowserState = {
  retryRequests: string[];
  activateRequests: number[];
  unexpectedPosts: string[];
  externalRequests: string[];
};

function jsonResponse(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(body),
  });
}

async function installAdminApiMocks(page: Page): Promise<AdminBrowserState> {
  const state: AdminBrowserState = {
    retryRequests: [],
    activateRequests: [],
    unexpectedPosts: [],
    externalRequests: [],
  };
  const baseURL = new URL(test.info().project.use.baseURL as string);

  // Block every external origin, and intercept every API call before navigating
  // so this browser test cannot reach application data or mutate the live DB.
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin !== baseURL.origin) {
      state.externalRequests.push(requestUrl.href);
      await route.abort();
      return;
    }
    await route.continue();
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const pathname = requestUrl.pathname;
    const method = request.method().toUpperCase();
    if (requestUrl.origin !== baseURL.origin) {
      state.externalRequests.push(requestUrl.href);
      await route.abort();
      return;
    }

    if (method === "POST") {
      const activationMatch = pathname.match(/^\/api\/admin\/legal\/templates\/(\d+)\/activate$/);
      if (activationMatch && [31, 32].includes(Number(activationMatch[1]))) {
        state.activateRequests.push(Number(activationMatch[1]));
        return jsonResponse(route, { message: "Legal template activated." });
      }
      const retryMatch = pathname.match(/^\/api\/admin\/legal\/pairs\/(\d+)\/retry$/);
      if (retryMatch && Number(retryMatch[1]) === 1200) {
        state.retryRequests.push(pathname);
        return jsonResponse(route, { message: "Document generation retry queued." });
      }
      state.unexpectedPosts.push(`${method} ${pathname}`);
      return jsonResponse(route, { error: "Unexpected POST blocked by browser-test mock." }, 500);
    }
    if (method !== "GET" && method !== "HEAD") {
      state.unexpectedPosts.push(`${method} ${pathname}`);
      return jsonResponse(route, { error: "Unexpected method blocked by browser-test mock." }, 500);
    }

    if (pathname === "/api/admin/me") {
      return jsonResponse(route, { user: { id: 9, username: "legal-admin-test", role: "admin" } });
    }
    if (pathname === "/api/admin/properties") return jsonResponse(route, [{ id: 108, name: "Awaiting Templates Estate", location: "Lagos" }]);
    if (pathname === "/api/admin/developer-onboarding" ||
        pathname === "/api/admin/kyc/submissions" ||
        pathname === "/api/reservations/all" ||
        pathname === "/api/admin/legal/failures") {
      return jsonResponse(route, []);
    }
    if (pathname === "/api/exchange-rates") {
      return jsonResponse(route, {
        rates: { NGN: 1500, USD: 1 },
        currencies: { NGN: { symbol: "₦", name: "Nigerian Naira" }, USD: { symbol: "$", name: "US Dollar" } },
      });
    }
    if (pathname === "/api/admin/legal/templates") {
      return jsonResponse(route, [
        { id: 31, documentType: "deed_of_assignment", version: 1, active: state.activateRequests.includes(31), validationStatus: "valid", createdAt: "2025-02-01T00:00:00.000Z" },
        { id: 32, documentType: "transfer_exit_rights", version: 1, active: state.activateRequests.includes(32), validationStatus: "valid", createdAt: "2025-02-01T00:00:00.000Z" },
      ]);
    }
    if (pathname === "/api/admin/legal/documents") {
      return jsonResponse(route, [{
        id: 1200,
        reservationId: 450,
        propertyId: 108,
        propertyName: "Awaiting Templates Estate",
        userName: "Morgan Test Investor",
        userEmail: "morgan.investor@example.test",
        status: "awaiting_templates",
        documents: [],
      }]);
    }
    if (pathname === "/api/admin/legal/readiness") {
      return jsonResponse(route, { ready: false, blockers: ["Activate valid deed and transfer templates."] });
    }

    // Isolate other dashboard GETs too; no route falls through to the app server.
    return jsonResponse(route, []);
  });

  await page.addInitScript(() => {
    window.localStorage.setItem("admin_session_id", "browser-test-admin-session-only");
  });
  return state;
}

test("admin can filter awaiting_templates pairs and retry after activating templates", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 960 });
  const state = await installAdminApiMocks(page);
  await page.goto("/admin");
  await expect(page.getByRole("button", { name: "Legal Documents" })).toBeVisible();
  await page.getByRole("button", { name: "Legal Documents" }).click();
  await expect(page.getByText("Generated document pairs", { exact: true })).toBeVisible();

  const statusFilter = page.getByRole("combobox", { name: "Filter by pair status" });
  await statusFilter.click();
  await page.getByRole("option", { name: "awaiting templates", exact: true }).click();

  const pairCard = page.getByText("Pair #1200").locator("xpath=../../..");
  await expect(pairCard).toContainText("Awaiting Templates Estate");
  await expect(pairCard).toContainText("Activate valid deed and transfer templates first, then retry document generation for this pair.");
  await expect(pairCard.getByRole("button", { name: "Retry after activation" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Activate version" })).toHaveCount(2);

  await page.getByRole("button", { name: "Activate version" }).nth(0).click();
  await expect.poll(() => state.activateRequests).toContain(31);
  await expect(page.getByRole("button", { name: "Activate version" })).toHaveCount(1);
  await page.getByRole("button", { name: "Activate version" }).click();
  await expect.poll(() => state.activateRequests).toEqual([31, 32]);
  await pairCard.getByRole("button", { name: "Retry after activation" }).click();
  await expect.poll(() => state.retryRequests).toEqual(["/api/admin/legal/pairs/1200/retry"]);
  expect(state.unexpectedPosts).toEqual([]);
  expect(state.externalRequests.every((url) => {
    const requestUrl = new URL(url);
    return requestUrl.hostname === "replit.com" && requestUrl.pathname === "/public/js/replit-dev-banner.js";
  })).toBe(true);
});