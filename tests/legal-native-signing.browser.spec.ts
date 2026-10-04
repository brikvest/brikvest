import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { validateSignaturePng } from "../server/legal/local-pdf-signature";

const DOCUMENT_ID = 700;
const HOLDING_ID = 506;
const OTHER_HOLDING_ID = 507;
const SIGNER_NAME = "Morgan Test Investor";
const FAKE_PASSWORD = "browser-test-password-only";
const CONSENT_TEXT = "I have read and agree to sign this investor document electronically.";

const pdfDocument = await PDFDocument.create();
const pdfPage = pdfDocument.addPage([612, 792]);
const pdfFont = await pdfDocument.embedFont(StandardFonts.Helvetica);
pdfPage.drawText("Brikvest unsigned signing test fixture", {
  x: 48,
  y: 730,
  size: 18,
  font: pdfFont,
  color: rgb(0.08, 0.12, 0.2),
});
const unsignedPdf = Buffer.from(await pdfDocument.save());
const unsignedPdfSha256 = createHash("sha256").update(unsignedPdf).digest("hex");

type SignResult = "investor_signed" | "processing" | "unauthorized";
type LegalDocument = {
  id: number;
  type: string;
  status: string;
  hasUnsignedPdf: boolean;
  hasSignedPdf: boolean;
  hasCertificate: boolean;
};

type SigningRequestSummary = {
  headerValid: boolean;
  contentTypeValid: boolean;
  challengePresent: boolean;
  passwordPresent: boolean;
  typedName: string;
  consent: boolean;
  reviewed: boolean;
  signatureMethod: "drawn" | "typed" | null;
  signaturePngPresent: boolean;
  signaturePngValid: boolean;
  consentVersion: string;
  unsignedPdfSha256: string;
};

type MockState = {
  result: SignResult;
  collisionFixture: boolean;
  documents: LegalDocument[];
  sessionRequests: number;
  signRequests: SigningRequestSummary[];
  downloads: string[];
  unexpectedPosts: string[];
  externalRequests: string[];
  externalSigningRequests: string[];
  popups: string[];
  signingHeaderProblems: string[];
};

const mockStateByPage = new WeakMap<Page, MockState>();

function jsonResponse(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(body),
  });
}

async function installApiMocks(
  page: Page,
  result: SignResult,
  options: { collisionFixture?: boolean } = {},
): Promise<MockState> {
  const state: MockState = {
    result,
    collisionFixture: options.collisionFixture === true,
    documents: [
      {
        id: DOCUMENT_ID,
        type: "deed_of_assignment",
        status: "awaiting_signature",
        hasUnsignedPdf: true,
        hasSignedPdf: false,
        hasCertificate: false,
      },
      {
        id: DOCUMENT_ID + 1,
        type: "transfer_exit_rights",
        status: "awaiting_signature",
        hasUnsignedPdf: true,
        hasSignedPdf: false,
        hasCertificate: false,
      },
    ],
    sessionRequests: 0,
    signRequests: [],
    downloads: [],
    unexpectedPosts: [],
    externalRequests: [],
    externalSigningRequests: [],
    popups: [],
    signingHeaderProblems: [],
  };

  const baseURL = new URL(test.info().project.use.baseURL as string);
  page.on("popup", (popup) => state.popups.push(popup.url()));

  // Keep the browser entirely on the supplied development origin; external APIs,
  // signing providers, fonts, and image hosts must not receive any requests.
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin !== baseURL.origin) {
      state.externalRequests.push(requestUrl.href);
      if (/sign|docusign|provider|e-?sign|adobe|hellosign|signnow|pandadoc|dropboxsign/i.test(requestUrl.href)) {
        state.externalSigningRequests.push(requestUrl.href);
      }
      await route.abort();
      return;
    }
    await route.continue();
  });

  // Register the API route before page.goto so every application API call,
  // including unexpected ones, is intercepted before it can reach the server.
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const pathname = requestUrl.pathname;
    const method = request.method().toUpperCase();
    if (requestUrl.origin !== baseURL.origin) {
      state.externalRequests.push(requestUrl.href);
      if (/sign|docusign|provider|e-?sign|adobe|hellosign|signnow|pandadoc|dropboxsign/i.test(requestUrl.href)) {
        state.externalSigningRequests.push(requestUrl.href);
      }
      await route.abort();
      return;
    }

    if (method === "POST") {
      const signingSessionMatch = pathname.match(/^\/api\/legal\/documents\/(\d+)\/signing-session$/);
      const signMatch = pathname.match(/^\/api\/legal\/documents\/(\d+)\/sign$/);
      if (signingSessionMatch && Number(signingSessionMatch[1]) === DOCUMENT_ID) {
        state.sessionRequests += 1;
        const headers = request.headers();
        if (headers["x-brikvest-signing"] !== "1") {
          state.signingHeaderProblems.push("Signing-session request did not include X-Brikvest-Signing: 1.");
        }
        if (!headers["content-type"]?.toLowerCase().includes("application/json")) {
          state.signingHeaderProblems.push("Signing-session request did not use JSON.");
        }
        try {
          if (JSON.stringify(request.postDataJSON()) !== "{}") {
            state.signingHeaderProblems.push("Signing-session request body should be an empty JSON object.");
          }
        } catch {
          state.signingHeaderProblems.push("Signing-session request body was not valid JSON.");
        }
        return jsonResponse(route, {
          documentId: DOCUMENT_ID,
          operationId: 91007,
          challengeToken: "browser-test-challenge",
          expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          unsignedPdfSha256,
          signerName: SIGNER_NAME,
          consentVersion: "native-consent-v1",
          consentText: CONSENT_TEXT,
        });
      }
      if (signMatch && Number(signMatch[1]) === DOCUMENT_ID) {
        const headers = request.headers();
        let body: Record<string, unknown> = {};
        try {
          body = request.postDataJSON() as Record<string, unknown>;
        } catch {
          state.signingHeaderProblems.push("Signature request body was not valid JSON.");
        }
        let signaturePngValid = false;
        if (typeof body.signaturePng === "string" && body.signaturePng.startsWith("data:image/png;base64,")) {
          try {
            const bytes = Buffer.from(body.signaturePng.split(",")[1], "base64");
            validateSignaturePng(bytes);
            const types: string[] = [];
            for (let offset = 8; offset < bytes.length;) {
              types.push(bytes.toString("ascii", offset + 4, offset + 8));
              offset += bytes.readUInt32BE(offset) + 12;
            }
            signaturePngValid = types.join(",") === "IHDR,IDAT,IEND";
          } catch { /* Report only validity, never signature or password bytes. */ }
        }
        if (!signaturePngValid) {
          state.signingHeaderProblems.push("Signature PNG did not pass server validation or contains metadata.");
          return jsonResponse(route, { error: "Invalid signature PNG in browser regression test." }, 400);
        }
        state.signRequests.push({
          headerValid: headers["x-brikvest-signing"] === "1",
          contentTypeValid: !!headers["content-type"]?.toLowerCase().includes("application/json"),
          challengePresent: typeof body.challengeToken === "string" && !!body.challengeToken,
          passwordPresent: typeof body.password === "string" && !!body.password,
          typedName: typeof body.typedName === "string" ? body.typedName : "",
          consent: body.consent === true,
          reviewed: body.reviewed === true,
          signatureMethod: body.signatureMethod === "typed" || body.signatureMethod === "drawn"
            ? body.signatureMethod
            : null,
          signaturePngPresent: typeof body.signaturePng === "string" && body.signaturePng.startsWith("data:image/png;base64,"),
          signaturePngValid,
          consentVersion: typeof body.consentVersion === "string" ? body.consentVersion : "",
          unsignedPdfSha256: typeof body.unsignedPdfSha256 === "string" ? body.unsignedPdfSha256 : "",
        });
        if (!headers["x-brikvest-signing"] || !headers["content-type"]?.toLowerCase().includes("application/json")) {
          state.signingHeaderProblems.push("Signature request must use JSON and X-Brikvest-Signing: 1.");
        }
        if (state.result === "unauthorized") {
          return jsonResponse(route, { error: "Password re-authentication failed. Please try again." }, 401);
        }
        if (state.result === "investor_signed") {
          state.documents = state.documents.map((document) =>
            document.id === DOCUMENT_ID
              ? { ...document, status: "investor_signed", hasSignedPdf: true, hasCertificate: true }
              : document,
          );
        }
        return jsonResponse(route, { status: state.result });
      }

      state.unexpectedPosts.push(`${method} ${pathname}`);
      return jsonResponse(route, { error: "Unexpected POST blocked by browser-test mock." }, 500);
    }

    if (method !== "GET" && method !== "HEAD") {
      state.unexpectedPosts.push(`${method} ${pathname}`);
      return jsonResponse(route, { error: "Unexpected method blocked by browser-test mock." }, 500);
    }

    if (pathname === "/api/auth/user") {
      return jsonResponse(route, {
        id: 86,
        email: "morgan.investor@example.test",
        firstName: "Morgan",
        lastName: "Test Investor",
        kycStatus: "approved",
        accountStatus: "active",
      });
    }
    if (pathname === "/api/user/reservations") {
      const reservations = [
        {
          id: HOLDING_ID,
          reservationId: HOLDING_ID,
          propertyId: 108,
          status: "converted_to_investment",
          units: 2,
          amount: "1250000",
          currency: "NGN",
          createdAt: "2025-01-15T12:00:00.000Z",
          property: {
            id: 108,
            name: "Test Garden Estate",
            location: "Lagos",
            imageUrl: "",
            isTransferable: false,
          },
        },
      ];
      if (state.collisionFixture) {
        reservations.push({
          id: OTHER_HOLDING_ID,
          reservationId: OTHER_HOLDING_ID,
          propertyId: 109,
          status: "converted_to_investment",
          units: 1,
          amount: "625000",
          currency: "NGN",
          createdAt: "2025-01-16T12:00:00.000Z",
          property: {
            id: 109,
            name: "Other Holding Estate",
            location: "Abuja",
            imageUrl: "",
            isTransferable: false,
          },
        });
      }
      return jsonResponse(route, reservations);
    }
    if (pathname === "/api/legal/holdings") {
      if (state.collisionFixture) {
        return jsonResponse(route, [
          {
            id: HOLDING_ID,
            reservationId: OTHER_HOLDING_ID,
            propertyId: 109,
            propertyName: "Other Holding Estate",
            area: 5,
            status: "documents_ready",
            documents: [{
              id: DOCUMENT_ID + 2,
              type: "other_holding_document",
              status: "awaiting_signature",
              hasUnsignedPdf: true,
              hasSignedPdf: false,
              hasCertificate: false,
            }],
          },
          {
            id: DOCUMENT_ID,
            reservationId: HOLDING_ID,
            propertyId: 108,
            propertyName: "Test Garden Estate",
            area: 10,
            status: "documents_ready",
            documents: state.documents,
          },
        ]);
      }
      return jsonResponse(route, [
        {
          id: HOLDING_ID,
          reservationId: HOLDING_ID,
          propertyId: 108,
          propertyName: "Test Garden Estate",
          area: 10,
          status: "documents_ready",
          documents: state.documents,
        },
      ]);
    }
    if (pathname === "/api/legal/documents/700/preview" && requestUrl.searchParams.get("version") === "unsigned") {
      return route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: unsignedPdf,
      });
    }
    if (pathname === "/api/legal/documents/701/preview" && requestUrl.searchParams.get("version") === "unsigned") {
      return route.fulfill({ status: 200, contentType: "application/pdf", body: unsignedPdf });
    }
    if (pathname === "/api/legal/documents/700/download") {
      state.downloads.push(requestUrl.searchParams.get("version") || "");
      return route.fulfill({ status: 200, contentType: "application/pdf", body: unsignedPdf });
    }
    if (pathname.startsWith("/api/legal/documents/") && pathname.endsWith("/download")) {
      state.downloads.push(requestUrl.searchParams.get("version") || "");
      return route.fulfill({ status: 200, contentType: "application/pdf", body: unsignedPdf });
    }
    if (pathname === "/api/exchange-rates") {
      return jsonResponse(route, {
        rates: { NGN: 1500, USD: 1 },
        currencies: { NGN: { symbol: "₦", name: "Nigerian Naira" }, USD: { symbol: "$", name: "US Dollar" } },
      });
    }
    if (pathname === "/api/user/payment-submissions" ||
        pathname === "/api/user/project-updates" ||
        pathname === "/api/user/property/108/milestones" ||
        pathname === "/api/properties/108/valuations" ||
        pathname === "/api/resale-listings/mine") {
      return jsonResponse(route, pathname === "/api/user/project-updates" ? {} : []);
    }

    // Unknown GETs are still isolated from the application server and receive a
    // harmless empty fixture. POSTs are always recorded and rejected above.
    return jsonResponse(route, []);
  });

  mockStateByPage.set(page, state);
  return state;
}

async function loadDashboard(page: Page) {
  await page.goto("/dashboard");
  await expect(page.getByText("My Property Holdings", { exact: true })).toBeVisible();
  await expect(page.locator(`#legal-documents-${HOLDING_ID}`)).toBeVisible();
  await expect(page.locator(`#legal-documents-${HOLDING_ID}`).getByRole("button", { name: "Review & sign" })).toHaveCount(2);
}

async function openReviewDialog(page: Page) {
  await page.locator(`#legal-documents-${HOLDING_ID}`).getByRole("button", { name: "Review & sign" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Review the unsigned document")).toBeVisible();
  await expect(dialog.locator("iframe")).toHaveAttribute("src", /^blob:/);
  return dialog;
}

async function continueToSign(dialog: ReturnType<Page["getByRole"]>) {
  const continueButton = dialog.getByRole("button", { name: "Continue to signing" });
  await expect(continueButton).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(dialog.getByText("Signature method")).toBeVisible();
}

async function drawWithMouse(page: Page, dialog: ReturnType<Page["getByRole"]>) {
  const canvas = dialog.getByRole("img", { name: "Draw your signature using touch, stylus, or mouse" });
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Signature canvas was not visible.");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 24, y + 15);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, y - 12, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.52, y + 18, { steps: 6 });
  await page.mouse.move(box.x + box.width * 0.78, y - 8, { steps: 6 });
  await page.mouse.move(box.x + box.width - 24, y + 8, { steps: 5 });
  await page.mouse.up();
  await expect(dialog.getByText("Add a continuous signature stroke before signing.")).toHaveCount(0);
}

async function drawWithTouch(page: Page, dialog: ReturnType<Page["getByRole"]>) {
  const canvas = dialog.getByRole("img", { name: "Draw your signature using touch, stylus, or mouse" });
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Signature canvas was not visible for touch input.");
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const y = Math.round(box.y + box.height / 2);
  const startX = Math.round(box.x + 24);
  const endX = Math.round(box.x + box.width - 24);
  const point = (x: number, offsetY: number) => ({
    x,
    y: y + offsetY,
    id: 1,
    radiusX: 2,
    radiusY: 2,
    force: 1,
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point(startX, 10)],
  });
  for (let step = 1; step <= 8; step += 1) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point(Math.round(startX + (endX - startX) * step / 8), step % 2 ? -10 : 12)],
    });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
  await expect(dialog.getByText("Add a continuous signature stroke before signing.")).toHaveCount(0);
}

async function expectNoExternalSigning(state: MockState) {
  expect(state.unexpectedPosts).toEqual([]);
  expect(state.signingHeaderProblems).toEqual([]);
  expect(state.externalSigningRequests).toEqual([]);
  expect(state.popups).toEqual([]);
}

test.describe("native investor legal signing", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 960 });
  });

  test.afterEach(async ({ page }) => {
    const state = mockStateByPage.get(page);
    if (state) await expectNoExternalSigning(state);
  });

  test("keyboard-accessible typed signature is locally rendered, name-bound, and cancellable", async ({ page }) => {
    const state = await installApiMocks(page, "investor_signed");
    await loadDashboard(page);
    const dialog = await openReviewDialog(page);

    await expect(dialog.getByRole("button", { name: "Continue to signing" })).toBeDisabled();
    const screenshotPath = resolve(process.cwd(), "screenshots", "legal-native-signing.jpg");
    await mkdir(resolve(process.cwd(), "screenshots"), { recursive: true });

    await continueToSign(dialog);
    const nameInput = dialog.getByLabel("Type your verified name exactly");
    const passwordInput = dialog.getByLabel("Re-enter your Brikvest password");
    const submit = dialog.getByRole("button", { name: "Sign and submit" });
    await expect(submit).toBeDisabled();

    const drawRadio = dialog.getByRole("radio", { name: "Draw signature" });
    const typedRadio = dialog.getByRole("radio", { name: "Use typed signature" });
    await drawRadio.focus();
    await page.keyboard.press("ArrowRight");
    await expect(typedRadio).toBeChecked();
    await expect(dialog.getByRole("button", { name: "Create typed signature" })).toBeDisabled();

    await nameInput.fill(SIGNER_NAME);
    await expect(dialog.getByRole("button", { name: "Create typed signature" })).toBeEnabled();
    await expect(submit).toBeDisabled();
    await passwordInput.fill(FAKE_PASSWORD);
    await expect(submit).toBeDisabled();

    await dialog.getByRole("button", { name: "Create typed signature" }).focus();
    await page.keyboard.press("Enter");
    const typedPreview = dialog.getByRole("img", { name: `Typed signature preview for ${SIGNER_NAME}` });
    await expect(typedPreview).toBeVisible();
    const typedInkPixels = await typedPreview.evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
      if (!pixels) return 0;
      let ink = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] > 0) ink += 1;
      }
      return ink;
    });
    expect(typedInkPixels).toBeGreaterThan(20);
    await expect(submit).toBeDisabled();

    const signMethod = dialog.getByRole("radio", { name: "Use typed signature" });
    await expect(signMethod).toBeChecked();
    await drawRadio.focus();
    await page.keyboard.press("Space");
    await expect(drawRadio).toBeChecked();
    await typedRadio.focus();
    await page.keyboard.press("Space");
    await expect(dialog.getByRole("img", { name: "Typed signature preview is empty" })).toBeVisible();
    await dialog.getByRole("button", { name: "Create typed signature" }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("img", { name: `Typed signature preview for ${SIGNER_NAME}` })).toBeVisible();
    await dialog.getByRole("img", { name: `Typed signature preview for ${SIGNER_NAME}` })
      .evaluate((canvas: HTMLCanvasElement) => {
        canvas.toDataURL = () => { throw new Error("Native PNG encoder must not be used for signing."); };
      });

    const consentChecks = dialog.getByRole("checkbox");
    await consentChecks.nth(0).check();
    await expect(submit).toBeDisabled();
    await consentChecks.nth(1).check();
    await expect(submit).toBeEnabled();

    await page.setViewportSize({ width: 1280, height: 1600 });
    await dialog.evaluate((element) => { element.scrollTop = 0; });
    await dialog.screenshot({ path: screenshotPath, type: "jpeg", quality: 85 });
    await expect(dialog.getByText("does not use a saved KYC signature image")).toBeVisible();

    // Editing the confirmed name must invalidate the already-created typed mark.
    await nameInput.fill(`${SIGNER_NAME} `);
    await expect(submit).toBeDisabled();
    await expect(dialog.getByRole("img", { name: "Typed signature preview is empty" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Create typed signature" })).toBeDisabled();
    await expect(page).toHaveURL(/\/dashboard/);
    expect(state.signRequests).toHaveLength(0);

    // Closing the dialog clears the password and local signature; a fresh session
    // must start from document review rather than retaining the previous mark.
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    const reopened = await openReviewDialog(page);
    await continueToSign(reopened);
    await expect(reopened.getByLabel("Type your verified name exactly")).toHaveValue("");
    await expect(reopened.getByLabel("Re-enter your Brikvest password")).toHaveValue("");
    await expect(reopened.getByRole("button", { name: "Sign and submit" })).toBeDisabled();
    expect(state.signRequests).toHaveLength(0);
    await expectNoExternalSigning(state);
  });

  test("typed signature can satisfy the same consent and password gates and submits its method evidence", async ({ page }) => {
    const state = await installApiMocks(page, "investor_signed");
    await loadDashboard(page);
    const dialog = await openReviewDialog(page);
    await continueToSign(dialog);

    await dialog.getByLabel("Type your verified name exactly").fill(SIGNER_NAME);
    await dialog.getByLabel("Re-enter your Brikvest password").fill(FAKE_PASSWORD);
    const submit = dialog.getByRole("button", { name: "Sign and submit" });
    await expect(submit).toBeDisabled();

    const drawRadio = dialog.getByRole("radio", { name: "Draw signature" });
    const typedRadio = dialog.getByRole("radio", { name: "Use typed signature" });
    await drawRadio.focus();
    await page.keyboard.press("ArrowRight");
    await expect(typedRadio).toBeChecked();
    await dialog.getByRole("button", { name: "Create typed signature" }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("img", { name: `Typed signature preview for ${SIGNER_NAME}` })).toBeVisible();
    await expect(submit).toBeDisabled();

    const checks = dialog.getByRole("checkbox");
    await checks.nth(0).check();
    await expect(submit).toBeDisabled();
    await checks.nth(1).check();
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(dialog.getByRole("status")).toContainText("Investor signature recorded");
    expect(state.signRequests).toHaveLength(1);
    expect(state.signRequests[0]).toMatchObject({
      headerValid: true,
      contentTypeValid: true,
      challengePresent: true,
      passwordPresent: true,
      typedName: SIGNER_NAME,
      consent: true,
      reviewed: true,
      signatureMethod: "typed",
      signaturePngPresent: true,
      signaturePngValid: true,
      consentVersion: "native-consent-v1",
      unsignedPdfSha256,
    });
    await expectNoExternalSigning(state);
  });

  test("touch-drawn signature submits JSON and shows a safe re-authentication error on 401", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await installApiMocks(page, "unauthorized");
    await loadDashboard(page);
    const dialog = await openReviewDialog(page);
    await continueToSign(dialog);

    await dialog.getByLabel("Type your verified name exactly").fill(SIGNER_NAME);
    await dialog.getByLabel("Re-enter your Brikvest password").fill(FAKE_PASSWORD);
    await expect(dialog.getByRole("button", { name: "Sign and submit" })).toBeDisabled();
    await drawWithTouch(page, dialog);
    const checkboxes = dialog.getByRole("checkbox");
    await checkboxes.nth(0).check();
    await expect(dialog.getByRole("button", { name: "Sign and submit" })).toBeDisabled();
    await checkboxes.nth(1).check();
    const submit = dialog.getByRole("button", { name: "Sign and submit" });
    await expect(submit).toBeEnabled();

    const canvas = dialog.getByRole("img", { name: "Draw your signature using touch, stylus, or mouse" });
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    expect(canvasBox!.x).toBeGreaterThanOrEqual(0);
    expect(canvasBox!.x + canvasBox!.width).toBeLessThanOrEqual(390);
    expect(canvasBox!.y).toBeGreaterThanOrEqual(0);
    expect(canvasBox!.y + canvasBox!.height).toBeLessThanOrEqual(844);
    await submit.scrollIntoViewIfNeeded();
    const submitBox = await submit.boundingBox();
    expect(submitBox).not.toBeNull();
    expect(submitBox!.y).toBeGreaterThanOrEqual(0);
    expect(submitBox!.y + submitBox!.height).toBeLessThanOrEqual(844);
    expect(submitBox!.x + submitBox!.width).toBeLessThanOrEqual(390);

    await submit.click();
    await expect(dialog.getByRole("alert")).toContainText("Password re-authentication failed. Please try again.");
    await expect(dialog.getByText("Investor signature recorded")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Sign and submit" })).toBeEnabled();
    expect(state.signRequests).toHaveLength(1);
    expect(state.signRequests[0]).toMatchObject({
      headerValid: true,
      contentTypeValid: true,
      challengePresent: true,
      passwordPresent: true,
      typedName: SIGNER_NAME,
      consent: true,
      reviewed: true,
      signatureMethod: "drawn",
      signaturePngPresent: true,
      consentVersion: "native-consent-v1",
      unsignedPdfSha256,
    });
    expect(state.documents[0].status).toBe("awaiting_signature");
    await expectNoExternalSigning(state);
  });

  test("mouse-drawn signing completes locally, removes the signed document action, and downloads its audit record", async ({ page }) => {
    const state = await installApiMocks(page, "investor_signed");
    await loadDashboard(page);
    const dialog = await openReviewDialog(page);
    await continueToSign(dialog);

    await dialog.getByLabel("Type your verified name exactly").fill(SIGNER_NAME);
    await dialog.getByLabel("Re-enter your Brikvest password").fill(FAKE_PASSWORD);
    await expect(dialog.getByRole("button", { name: "Sign and submit" })).toBeDisabled();
    await drawWithMouse(page, dialog);
    await expect(dialog.getByRole("button", { name: "Sign and submit" })).toBeDisabled();
    const checkboxes = dialog.getByRole("checkbox");
    await checkboxes.nth(0).check();
    await expect(dialog.getByRole("button", { name: "Sign and submit" })).toBeDisabled();
    await checkboxes.nth(1).check();
    await expect(dialog.getByRole("button", { name: "Sign and submit" })).toBeEnabled();
    await dialog.getByRole("button", { name: "Sign and submit" }).click();

    await expect(dialog.getByRole("status")).toContainText("Investor signature recorded");
    expect(state.signRequests).toHaveLength(1);
    expect(state.signRequests[0]).toMatchObject({
      headerValid: true,
      contentTypeValid: true,
      challengePresent: true,
      passwordPresent: true,
      typedName: SIGNER_NAME,
      consent: true,
      reviewed: true,
      signatureMethod: "drawn",
      signaturePngPresent: true,
      consentVersion: "native-consent-v1",
      unsignedPdfSha256,
    });

    const legalPanel = page.locator(`#legal-documents-${HOLDING_ID}`);
    await dialog.getByRole("status").getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    const deedRow = legalPanel.getByText("Deed of Assignment", { exact: true }).locator("xpath=../..");
    const transferRow = legalPanel.getByText("Transfer and Exit Rights Agreement", { exact: true }).locator("xpath=../..");
    await expect(deedRow.getByText("investor signed", { exact: true })).toBeVisible();
    await expect(deedRow.getByRole("button", { name: "Review & sign" })).toHaveCount(0);
    await expect(deedRow.getByRole("button", { name: "Review signed PDF" })).toHaveCount(1);
    await expect(transferRow.getByRole("button", { name: "Review & sign" })).toHaveCount(1);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      legalPanel.getByRole("button", { name: "Download signing audit record" }).click(),
    ]);
    expect(download.suggestedFilename()).toContain("signing audit record");
    expect(state.downloads).toContain("certificate");
    expect(state.documents[0]).toMatchObject({
      status: "investor_signed",
      hasSignedPdf: true,
      hasCertificate: true,
    });
    const persistedBrowserStorage = await page.evaluate(() => JSON.stringify({
      local: Object.keys(window.localStorage).map((key) => [key, window.localStorage.getItem(key)]),
      session: Object.keys(window.sessionStorage).map((key) => [key, window.sessionStorage.getItem(key)]),
    }));
    expect(persistedBrowserStorage).not.toContain(FAKE_PASSWORD);
    await expectNoExternalSigning(state);
  });

  test("investor legal documents resolve a reservation collision by reservation ID and sign only the correct pair", async ({ page }) => {
    const state = await installApiMocks(page, "investor_signed", { collisionFixture: true });
    await loadDashboard(page);
    const legalPanel = page.locator(`#legal-documents-${HOLDING_ID}`);
    await expect(legalPanel.getByText("Deed of Assignment", { exact: true })).toBeVisible();
    await expect(legalPanel.getByText("Transfer and Exit Rights Agreement", { exact: true })).toBeVisible();
    await expect(legalPanel.getByText("Other Holding Document", { exact: true })).toHaveCount(0);

    const dialog = await openReviewDialog(page);
    await expect(dialog.getByRole("heading", { name: "Sign Deed of Assignment" })).toBeVisible();
    await continueToSign(dialog);
    await dialog.getByLabel("Type your verified name exactly").fill(SIGNER_NAME);
    await dialog.getByLabel("Re-enter your Brikvest password").fill(FAKE_PASSWORD);
    await dialog.getByRole("radio", { name: "Use typed signature" }).check();
    await dialog.getByRole("button", { name: "Create typed signature" }).click();
    const consents = dialog.getByRole("checkbox");
    await consents.nth(0).check();
    await consents.nth(1).check();
    await dialog.getByRole("button", { name: "Sign and submit" }).click();

    await expect(dialog.getByRole("status")).toContainText("Investor signature recorded");
    expect(state.signRequests).toHaveLength(1);
    expect(state.signRequests[0].signatureMethod).toBe("typed");
    expect(state.unexpectedPosts).toEqual([]);
    await dialog.getByRole("status").getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
    const deedRow = legalPanel.getByText("Deed of Assignment", { exact: true }).locator("xpath=../..");
    await expect(deedRow.getByText("investor signed", { exact: true })).toBeVisible();
    await expect(deedRow.getByRole("button", { name: "Review & sign" })).toHaveCount(0);
    await expect(legalPanel.getByText("Other Holding Document", { exact: true })).toHaveCount(0);
    expect(state.documents[0]).toMatchObject({ status: "investor_signed", hasSignedPdf: true });
    await expectNoExternalSigning(state);
  });
});