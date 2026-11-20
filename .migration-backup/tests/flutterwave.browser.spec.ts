import { test, expect, type Page } from "@playwright/test";

const txRef = "brk_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const reservation = {
  id: 1, userId: 1, propertyId: 1, fullName: "Fixture Investor", email: "fixture@example.test",
  amount: "1200.10", units: "1", currency: "NGN", status: "reserved", createdAt: "2026-10-31T00:00:00Z",
  expiresAt: "2099-01-01T00:00:00Z", property: { id: 1, name: "Fixture Estate", location: "Test City", imageUrl: "", currency: "NGN", totalUnits: 10, availableSlots: 9, unitPrice: 1200.1 },
};
async function fixture(page: Page, initial?: string, replacement = false) {
  let state = initial;
  const writes: Array<{ path: string; body: any }> = [];
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  await page.addInitScript(() => localStorage.setItem("admin_session_id","isolated-admin"));
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.route("**/api/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const json = (data: any, status = 200) => route.fulfill({status,contentType:"application/json",body:JSON.stringify(data)});
    const attempt = () => ({
      id: 1, reservationId: 1, txRef, state, expectedAmount: "1200.10", expectedCurrency: "NGN",
      verifiedAmount: ["awaiting_admin","reconciliation","approved","rejected"].includes(state || "") ? "1200.10" : null,
      verifiedCurrency: "NGN", verifiedAt: ["awaiting_admin","reconciliation","approved","rejected"].includes(state || "") ? "2026-10-31T12:00:00Z" : null, transactionId: "101",
      checkoutExpiresAt: "2099-01-01T00:00:00Z",
      reason: state === "rejected" ? "Needs investigation" : null,
      reservation, property: reservation.property, user: {email:"fixture@example.test"},
      audit: [{action:"charge_verified",createdAt:"2026-10-31T12:00:00Z",reason:"Payment received"}],
    });
    const attempts = () => replacement ? [
      {...attempt(),id:2,txRef:"brk_replacement",verifiedAmount:null,verifiedCurrency:null,verifiedAt:null,state:"reconciliation",reason:"Another payment was received. Do not pay this checkout.",checkoutClosure:{status:"done",attempts:0}},
      {...attempt(),reason:"Earlier payment succeeded while a replacement checkout was open"}
    ] : state ? [attempt()] : [];
    if (req.method() !== "GET") {
      writes.push({path,body:req.headers()["content-type"]?.includes("multipart/form-data") ? { multipart: req.postData() } : req.postDataJSON()});
      if (path === "/api/payments/flutterwave/return" || /\/attempts\/1\/recheck$/.test(path)) { state = "awaiting_admin"; return json({message:"Verified"}); }
      if (path === "/api/admin/payments/flutterwave/1/approve") { state = "approved"; return json({message:"Approved"}); }
      if (path === "/api/admin/payments/flutterwave/1/reject") { state = "rejected"; return json({message:"Rejected. No refund issued."}); }
      if (path === "/api/payments/flutterwave/reservations/1/checkout") { state = "verification_pending"; return json({error:"Provider temporarily unavailable. Recheck; do not pay again."},503); }
      if (path === "/api/user/payment-submission") return json({message:"Proof received"});
      return json({message:"Fixture only"});
    }
    if (path === "/api/auth/user") return json({id:1,firstName:"Fixture",lastName:"Investor",email:"fixture@example.test",role:"investor",accountStatus:"approved",kycStatus:"approved",isActive:true});
    if (path === "/api/admin/me") return json({user:{id:1,username:"fixture-admin",role:"admin"}});
    if (path === "/api/user/reservations") return json([reservation]);
    if (path === "/api/user/stats") return json({totalInvested:0,activeInvestments:0,expectedReturns:0,currency:"NGN"});
    if (path === "/api/exchange-rates") return json({rates:{NGN:1500,USD:1},currencies:{NGN:{symbol:"₦",name:"Nigerian Naira"},USD:{symbol:"$",name:"US Dollar"}}});
    if (path === "/api/payments/flutterwave/reservations/1") return json({available:true,reason:"",amount:"1200.10",currency:"NGN",attempts:attempts()});
    if (path === "/api/payments/flutterwave/attempts") return json(attempts());
    if (path === "/api/admin/payments/flutterwave") return json(attempts());
    if (path.endsWith("/payment-instructions")) return json({method:{title:"Naira Transfer",icon:"₦",details:[{label:"Bank Name",value:"Fixture Bank"},{label:"Account Name",value:"Fixture Company"},{label:"Account Number",value:"0000000000"}]}});
    if (path === "/api/admin/stats") return json({totalProperties:1,totalReservations:1,totalInvestment:0,totalBids:0,pendingPayments:0});
    if (path === "/api/user/project-updates") return json({});
    return json([]);
  });
  return { writes, getState: () => state };
}
test("bank transfer stays available and checkout uses exact reservation currency", async ({ page }) => {
  const f = await fixture(page);
  await page.goto("/dashboard?paymentFor=1");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button",{name:"Continue to Flutterwave"})).toBeVisible();
  await expect(dialog.getByText("Exact checkout charge: 1200.10 NGN.",{exact:false})).toBeVisible();
  await expect(dialog.getByText("Fixture Bank")).toBeVisible();
  await expect(dialog.getByText("Step 2: Upload Payment Proof")).toBeVisible();
  await dialog.getByRole("button",{name:"Continue to Flutterwave"}).click();
  await expect(dialog.getByRole("alert")).toContainText("temporarily unavailable");
  expect(f.writes.find(w => w.path.endsWith("/checkout"))?.body).toEqual({});
  await expect(dialog.getByRole("button",{name:"Continue to Flutterwave"})).toHaveCount(0);
  await expect(dialog.getByText("Fixture Bank")).toHaveCount(0);
  await expect(dialog.getByRole("button",{name:"Submit Payment Proof"})).toHaveCount(0);
});
for (const state of ["initiated","verification_pending","failed"]) {
  test(`${state} hosted session blocks bank instructions and proof submission`, async ({ page }) => {
    await fixture(page,state);
    await page.goto("/dashboard?paymentFor=1");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Online checkout is unresolved or can still collect funds.",{exact:false})).toBeVisible();
    await expect(dialog.getByText("Fixture Bank")).toHaveCount(0);
    await expect(dialog.getByRole("button",{name:"Submit Payment Proof"})).toHaveCount(0);
    await expect(dialog.locator("#paymentProof")).toHaveCount(0);
  });
}
test("provider return requires server check and collected money suppresses proof/repayment", async ({ page }) => {
  const f = await fixture(page,"verification_pending");
  await page.goto(`/dashboard?flutterwaveReturn=1&tx_ref=${txRef}&transaction_id=101&status=successful&paymentFor=1`);
  await expect.poll(() => f.writes.some(w => w.path === "/api/payments/flutterwave/return")).toBe(true);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Awaiting admin approval",{exact:true})).toBeVisible();
  await expect(dialog.getByText("Step 2: Upload Payment Proof")).toHaveCount(0);
  await expect(dialog.getByRole("button",{name:"Continue to Flutterwave"})).toHaveCount(0);
  await expect(page).not.toHaveURL(/transaction_id/);
  await page.screenshot({ path: `test-results/flutterwave/awaiting-admin-${test.info().project.name}.png` });
  await dialog.getByRole("button",{name:"Check status"}).click();
  await expect.poll(() => f.writes.some(w => w.path.endsWith("/attempts/1/recheck"))).toBe(true);
});
test("bank transfer still submits uploaded proof for admin review", async ({ page }) => {
  const f = await fixture(page);
  await page.goto("/dashboard?paymentFor=1");
  const dialog = page.getByRole("dialog");
  await dialog.locator("#paymentProof").setInputFiles({name:"fixture-receipt.png",mimeType:"image/png",buffer:Buffer.from("isolated fixture")});
  await dialog.getByRole("button",{name:"Submit Payment Proof"}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Payment Proof Submitted",{exact:true})).toBeVisible();
  expect(f.writes.find(w => w.path === "/api/user/payment-submission")?.body.multipart).toContain('name="reservationId"');
  expect(f.writes.some(w => w.path.includes("flutterwave"))).toBe(false);
});
test("rejected collected money never invites another payment", async ({ page }) => {
  await fixture(page,"rejected");
  await page.goto("/dashboard?paymentFor=1");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("No refund has been issued.",{exact:false}).first()).toBeVisible();
  await expect(dialog.getByText("Step 2: Upload Payment Proof")).toHaveCount(0);
  await expect(dialog.getByRole("button",{name:"Continue to Flutterwave"})).toHaveCount(0);
});
test("late earlier success blocks replacement payment and admin approval", async ({ page }) => {
  await fixture(page,"reconciliation",true);
  await page.goto("/dashboard?paymentFor=1");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Earlier payment succeeded while a replacement checkout was open")).toBeVisible();
  await expect(dialog.getByRole("button",{name:"Continue to Flutterwave"})).toHaveCount(0);
  await expect(dialog.getByRole("button",{name:"Submit Payment Proof"})).toHaveCount(0);
  await page.goto("/admin");
  if (page.viewportSize()!.width < 768) await page.getByRole("button",{name:"Open admin menu"}).click();
  await page.getByRole("button",{name:"Payment Reviews",exact:false}).click();
  await expect(page.getByText("Hosted checkout closure: Provider confirmed disabled")).toBeVisible();
  await expect(page.getByRole("button",{name:"Approve payment",exact:true})).toHaveCount(0);
});
test("admin Payment Reviews shows verification evidence, audit and explicit approval", async ({ page }) => {
  const f = await fixture(page,"awaiting_admin");
  await page.goto("/admin");
  if (page.viewportSize()!.width < 768) await page.getByRole("button",{name:"Open admin menu"}).click();
  await page.getByRole("button",{name:"Payment Reviews",exact:false}).click();
  const section = page.locator('section[aria-labelledby="flutterwave-reviews-title"]');
  await expect(section.getByText("Provider transaction: 101")).toBeVisible();
  await expect(section.getByText("1200.10 NGN").last()).toBeVisible();
  await section.getByText("Audit history",{exact:false}).click();
  await expect(section.getByText("charge_verified",{exact:false})).toBeVisible();
  await section.getByRole("button",{name:"Approve payment",exact:true}).click();
  await expect(section.getByText("Payment approved",{exact:true})).toBeVisible();
  expect(f.writes.filter(w => w.path.endsWith("/approve"))).toHaveLength(1);
});
test("admin rejection requires reason and states no refund", async ({ page }) => {
  const f = await fixture(page,"awaiting_admin");
  await page.goto("/admin");
  if (page.viewportSize()!.width < 768) await page.getByRole("button",{name:"Open admin menu"}).click();
  await page.getByRole("button",{name:"Payment Reviews",exact:false}).click();
  const section = page.locator('section[aria-labelledby="flutterwave-reviews-title"]');
  await expect(section.getByRole("button",{name:"Reject",exact:true})).toBeDisabled();
  await section.getByRole("textbox",{name:`Rejection reason for ${txRef}`}).fill("Investigate collected charge");
  await section.getByRole("button",{name:"Reject",exact:true}).click();
  await expect(section.getByText("No refund has been issued.",{exact:false})).toBeVisible();
  expect(f.writes.find(w => w.path.endsWith("/reject"))?.body.reason).toBe("Investigate collected charge");
});
