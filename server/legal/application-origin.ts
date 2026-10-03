/** Shared by readiness and mail construction; never substitutes a dev origin. */
export function legalApplicationOrigin(configured: string | undefined): URL {
  let base: URL;
  try {
    base = new URL(configured || "");
  } catch {
    throw new Error("APP_BASE_URL must be configured as an HTTPS application origin");
  }
  if (base.protocol !== "https:" || base.username || base.password ||
      base.pathname !== "/" || base.search || base.hash) {
    throw new Error("APP_BASE_URL must be a clean HTTPS origin without credentials or path");
  }
  return base;
}

export function legalHoldingDashboardUrl(configured: string | undefined, reservationId: number): string {
  if (!Number.isSafeInteger(reservationId) || reservationId < 1) throw new Error("Invalid holding ID");
  const url = new URL("/dashboard", legalApplicationOrigin(configured).origin);
  url.searchParams.set("holding", String(reservationId));
  return url.toString();
}