export const MARKETPLACE_PAYMENT_WINDOW_MS = 60 * 60 * 1000;
export const RESALE_SQUARE_METERS_PER_UNIT = 5;

export function resaleUnitsToSquareMeters(units: number): number {
  if (!Number.isFinite(units)) return 0;
  return Math.round((units * RESALE_SQUARE_METERS_PER_UNIT + Number.EPSILON) * 100) / 100;
}

type ResaleBroadcastPosition = {
  property: { id: number };
  reservation: { id: number; userId: number | null; currency?: string | null };
  availableUnits: number;
};

type ResaleBroadcastOffer = {
  buyerId: number;
  sellerReservationId: number;
  status: string;
};

export function getEligibleResaleBroadcastPositions<T extends ResaleBroadcastPosition>(
  positions: T[],
  offers: ResaleBroadcastOffer[],
  buyerId: number,
  propertyId: number,
  requestedUnits: number,
  currency: string,
): T[] {
  const activeStatuses = new Set([
    "awaiting_seller_response",
    "awaiting_buyer_response",
    "payment_pending",
    "payment_rejected",
    "payment_under_review",
    "payment_verified",
    "transfer_pending",
  ]);
  const alreadyOfferedReservations = new Set(
    offers
      .filter((offer) => offer.buyerId === buyerId && activeStatuses.has(offer.status))
      .map((offer) => offer.sellerReservationId),
  );

  return positions.filter(
    (position) =>
      position.property.id === propertyId &&
      position.reservation.userId !== buyerId &&
      position.availableUnits >= requestedUnits &&
      (position.reservation.currency || currency) === currency &&
      !alreadyOfferedReservations.has(position.reservation.id),
  );
}

export function parseMoneyMinor(value: unknown): number | null {
  const input = String(value ?? "").trim();
  const match = input.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const whole = Number(match[1]);
  if (!Number.isSafeInteger(whole)) return null;
  const fraction = match[2] || "";
  const firstTwoDigits = (fraction + "00").slice(0, 2);
  let minor = whole * 100 + Number(firstTwoDigits);
  if (!Number.isSafeInteger(minor)) return null;
  if (fraction.length > 2 && Number(fraction[2]) >= 5) minor += 1;
  if (!Number.isSafeInteger(minor)) return null;
  return minor;
}

export function formatMoneyMinor(value: number): string {
  const whole = Math.floor(value / 100);
  const fraction = String(value % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

export function calculateResalePaymentTerms(purchasePrice: unknown) {
  const priceMinor = parseMoneyMinor(purchasePrice);
  if (priceMinor === null || priceMinor <= 0) return null;
  const feeMinor = Math.round(priceMinor * 2 / 100);
  return {
    purchasePrice: formatMoneyMinor(priceMinor),
    transactionFee: formatMoneyMinor(feeMinor),
    totalPayment: formatMoneyMinor(priceMinor + feeMinor),
  };
}

export function createMarketplacePaymentDeadline(startedAt: Date = new Date()): Date {
  return new Date(startedAt.getTime() + MARKETPLACE_PAYMENT_WINDOW_MS);
}

export function getAvailableResaleUnits(ownedUnits: number, listedUnits: number, reservedOfferUnits: number): number {
  const available = ownedUnits - listedUnits - reservedOfferUnits;
  return Math.round((Math.max(0, available) + Number.EPSILON) * 100) / 100;
}

export function canAccessResaleReceipt(userId: number, buyerId: number, sellerId: number): boolean {
  return userId === buyerId || userId === sellerId;
}

export function assertResaleTransferPreconditions(
  paymentStatus: string,
  buyerKycStatus: string | null | undefined,
  expectedPaymentStatus: string,
): void {
  if (paymentStatus !== expectedPaymentStatus) {
    throw new Error("Only submitted payment proof can be reviewed");
  }
  if (buyerKycStatus !== "approved") {
    throw new Error("Buyer KYC must be approved before ownership transfer");
  }
}