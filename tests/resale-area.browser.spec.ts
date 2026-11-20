import { expect, test } from "@playwright/test";
import { resaleAreaSqm } from "../shared/resale-area";

test("buyers see the offered land area on public cards, P2P cards, details and purchase review", async ({page}) => {
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  const listings = [10, 20, 5].map((units, i) => ({
    id: i + 1, propertyId: 33, units: units.toFixed(2), propertyName: `Fixture Land ${i + 1}`,
    propertyLocation: "Abuja", currency: "NGN", askingPrice: "3500000", sellingType: "fixed_price",
    status: "active", sellerId: 2, sellerName: "Fixture Seller", shareToken: `fixture-${i}`,
    areaSqm: resaleAreaSqm(units, {totalSquareMeters: i === 2 ? null : "350", totalSlots: 70}),
  }));
  const writes: string[] = [];
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.route("**/api/**", route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({status, contentType:"application/json", body:JSON.stringify(body)});
    if (request.method() !== "GET") { writes.push(path); return json({message:"Fixture writes forbidden"}, 405); }
    if (path === "/api/auth/user") return json({id:901, firstName:"Fixture", fullName:"Fixture Investor", email:"fixture@example.test",
      accountStatus:"approved", kycStatus:"approved", role:"investor", preferredCurrency:"NGN"});
    if (path === "/api/exchange-rates") return json({rates:{NGN:1500,USD:1}, currencies:{NGN:{symbol:"₦",name:"Nigerian Naira"},USD:{symbol:"$",name:"US Dollar"}}});
    if (path === "/api/marketplace/listings-public" || path === "/api/marketplace/listings") return json(listings);
    return json([]);
  });
  await page.goto("/?tab=p2p");
  await expect(page.getByTestId("resale-area")).toHaveText(["50 sqm", "100 sqm", "Area not recorded"]);
  await page.getByTestId("resale-area").first().scrollIntoViewIfNeeded();
  await page.screenshot({path:test.info().outputPath("public-p2p-area.png")});
  await page.goto("/marketplace");
  await expect(page.getByTestId("resale-area")).toHaveText(["50 sqm", "100 sqm", "Area not recorded"]);
  await page.getByRole("button", {name:"View Property Details", exact:true}).first().click();
  await expect(page.getByTestId("resale-detail-area")).toHaveText("50 sqm");
  await page.keyboard.press("Escape");
  await page.getByRole("button", {name:"Buy Now", exact:true}).first().click();
  await expect(page.getByRole("dialog")).toContainText("10.00 · 50 sqm");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(writes).toEqual([]);
});
