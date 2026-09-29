import type { Express } from "express";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { and, desc, eq, gt, inArray, lte, or } from "drizzle-orm";
import {
  adminUsers,
  investmentReservations,
  ownershipCertificates,
  properties,
  resaleListings,
  resaleMarketplaceOfferEvents,
  resaleMarketplaceOffers,
  resaleMarketplaceNotifications,
  resalePayments,
  users,
} from "@shared/schema";
import { db } from "./db";
import { storage } from "./storage";
import { upload, uploadToObjectStorage } from "./cloudinary";
import { objectStorageClient } from "./objectStorage";
import { getPaymentInstructions } from "./paymentInstructions";
import { sendMarketplaceOfferEmail } from "./resaleEmails";
import {
  assertResaleTransferPreconditions,
  calculateResalePaymentTerms,
  canAccessResaleReceipt,
  createMarketplacePaymentDeadline,
  formatMoneyMinor,
  getAvailableResaleUnits,
  parseMoneyMinor,
} from "./resaleMarketplacePolicy";

export { calculateResalePaymentTerms } from "./resaleMarketplacePolicy";

const RESERVED_OFFER_STATUSES = new Set([
  "payment_pending",
  "payment_rejected",
  "payment_under_review",
  "payment_verified",
  "transfer_pending",
]);
const RESERVED_LISTING_STATUSES = new Set(["pending_review", "approved", "awaiting_payment"]);

type AuthOptions = {
  requireApprovedUser: any;
  requireAdminAuth: any;
};

function userDisplayName(user: any): string {
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.email || "Brikvest user";
}

function roundUnits(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parsePositiveUnits(value: unknown): number | null {
  const input = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(input)) return null;
  const units = Number(input);
  return Number.isFinite(units) && units > 0 ? roundUnits(units) : null;
}

function formatUnits(value: number): string {
  return value.toFixed(2);
}

function getUnitPrecision(property: any): number {
  const precision = Number(property?.unitPrecision || 0.01);
  return Number.isFinite(precision) && precision > 0 ? precision : 0.01;
}

function alignsWithUnitPrecision(units: number, property: any): boolean {
  const precisionHundredths = Math.max(1, Math.round(getUnitPrecision(property) * 100));
  const unitsHundredths = Math.round(units * 100);
  return unitsHundredths % precisionHundredths === 0;
}

function positionToken(reservationId: number, propertyId: number): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required to issue anonymous owner positions");
  const payload = Buffer.from(`${reservationId}:${propertyId}`).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function readPositionToken(token: unknown): { reservationId: number; propertyId: number } | null {
  if (typeof token !== "string") return null;
  const [payload, signature, extra] = token.split(".");
  const secret = process.env.SESSION_SECRET;
  if (!secret || !payload || !signature || extra) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const [reservationIdText, propertyIdText, trailing] = Buffer.from(payload, "base64url").toString().split(":");
    const reservationId = Number(reservationIdText);
    const propertyId = Number(propertyIdText);
    if (trailing || !Number.isSafeInteger(reservationId) || !Number.isSafeInteger(propertyId)) return null;
    return { reservationId, propertyId };
  } catch {
    return null;
  }
}

function offerHoldsUnits(offer: any, now: Date, excludeOfferId?: number): boolean {
  if (offer.id === excludeOfferId || !RESERVED_OFFER_STATUSES.has(offer.status)) return false;
  if (offer.status === "payment_pending" || offer.status === "payment_rejected") {
    return !!offer.paymentDeadline && new Date(offer.paymentDeadline).getTime() > now.getTime();
  }
  return true;
}

function getAvailableUnits(
  reservation: any,
  listings: any[],
  offers: any[],
  now: Date,
  excludeOfferId?: number,
): number {
  const owned = Number(reservation?.units || 0);
  const listedUnits = listings
    .filter((listing) => listing.reservationId === reservation.id && RESERVED_LISTING_STATUSES.has(listing.status))
    .reduce((sum, listing) => sum + Number(listing.units || 0), 0);
  const reservedOfferUnits = offers
    .filter((offer) => offer.sellerReservationId === reservation.id && offerHoldsUnits(offer, now, excludeOfferId))
    .reduce((sum, offer) => sum + Number(offer.units || 0), 0);
  return getAvailableResaleUnits(owned, listedUnits, reservedOfferUnits);
}

async function readMarketplaceSnapshot() {
  const [reservations, listings, offers, allProperties] = await Promise.all([
    storage.getAllReservations(),
    storage.getAllResaleListings(),
    db.select().from(resaleMarketplaceOffers),
    storage.getProperties(),
  ]);
  const propertyById = new Map(allProperties.map((property) => [property.id, property]));
  const now = new Date();
  const holdings = reservations
    .filter((reservation) => reservation.status === "converted_to_investment" && !!reservation.userId)
    .map((reservation) => {
      const property = propertyById.get(reservation.propertyId);
      if (!property || !property.isTransferable || property.projectStatus === "archived" || property.status === "archived") return null;
      const availableUnits = getAvailableUnits(reservation, listings, offers, now);
      if (availableUnits <= 0) return null;
      return { reservation, property, availableUnits };
    })
    .filter(Boolean) as Array<{ reservation: any; property: any; availableUnits: number }>;
  return { reservations, listings, offers, allProperties, holdings, now };
}

async function notifyMarketplaceUser(userId: number, offerId: number, title: string, message: string) {
  await db.insert(resaleMarketplaceNotifications).values({ userId, offerId, title, message });
}

async function notifyAdmins(offer: any, propertyName: string, title: string, message: string) {
  const admins = await db
    .select({ email: adminUsers.email })
    .from(adminUsers)
    .where(and(eq(adminUsers.isActive, true)));
  const offerUrl = `https://brikvest.net/marketplace?offer=${offer.id}`;
  for (const admin of admins) {
    if (!admin.email) continue;
    try {
      await sendMarketplaceOfferEmail({
        to: admin.email,
        recipientName: "Brikvest Admin",
        subject: `${title} — ${offer.reference}`,
        heading: title,
        message,
        propertyName,
        reference: offer.reference,
        offerId: offer.id,
      });
    } catch (error) {
      console.error("[MARKETPLACE-OFFER] Admin email failed:", error);
    }
  }
  return offerUrl;
}

async function streamMarketplaceReceipt(proofUrl: string, res: any) {
  const match = proofUrl.match(/^\/api\/documents\/resale-payment-proofs\/([A-Za-z0-9._-]+)$/);
  if (!match) return res.status(404).json({ message: "Receipt not found" });
  const privateDir = process.env.PRIVATE_OBJECT_DIR || "";
  const bucketName = privateDir.split("/").filter(Boolean)[0];
  if (!bucketName) return res.status(500).json({ message: "Receipt storage is unavailable" });
  const filename = match[1];
  const file = objectStorageClient.bucket(bucketName).file(`.private/resale-payment-proofs/${filename}`);
  const [exists] = await file.exists();
  if (!exists) return res.status(404).json({ message: "Receipt not found" });
  const [metadata] = await file.getMetadata();
  res.set({
    "Content-Type": metadata.contentType || "application/octet-stream",
    "Content-Disposition": `inline; filename="${filename}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  file.createReadStream().on("error", (error: Error) => {
    console.error("[MARKETPLACE-OFFER] Receipt stream failed:", error);
    if (!res.headersSent) res.status(500).end();
  }).pipe(res);
}

async function recordOfferEvent(
  executor: any,
  offer: any,
  action: string,
  actorType: string,
  actorId: number | null,
  details: string,
  terms?: { units?: string; purchasePrice?: string; transactionFee?: string; totalPayment?: string },
) {
  await executor.insert(resaleMarketplaceOfferEvents).values({
    offerId: offer.id,
    actorType,
    actorId,
    action,
    units: terms?.units ?? offer.units,
    purchasePrice: terms?.purchasePrice ?? offer.purchasePrice,
    transactionFee: terms?.transactionFee ?? offer.transactionFee,
    totalPayment: terms?.totalPayment ?? offer.totalPayment,
    details,
  });
}

function visibleOffer(offer: any, currentUserId: number, property?: any, events: any[] = []) {
  const role = offer.buyerId === currentUserId ? "buyer" : "seller";
  return {
    id: offer.id,
    reference: offer.reference,
    role,
    propertyId: offer.propertyId,
    propertyName: property?.name || "Land holding",
    propertyLocation: property?.location || "",
    units: offer.units,
    purchasePrice: offer.purchasePrice,
    transactionFee: offer.transactionFee,
    totalPayment: offer.totalPayment,
    currency: offer.currency,
    status: offer.status,
    paymentDeadline: offer.paymentDeadline,
    bankReference: role === "buyer" ? offer.bankReference : null,
    proofSubmitted: !!offer.proofUrl,
    rejectionReason: role === "buyer" ? offer.rejectionReason : null,
    paymentSubmittedAt: offer.paymentSubmittedAt,
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt,
    events: events.map((event) => ({
      id: event.id,
      action: event.action,
      actor: event.actorId === currentUserId ? "You" : event.actorType === "system" ? "Brikvest" : "Brikvest Member",
      units: event.units,
      purchasePrice: event.purchasePrice,
      transactionFee: event.transactionFee,
      totalPayment: event.totalPayment,
      details: event.details,
      createdAt: event.createdAt,
    })),
  };
}

async function expireMarketplaceOffer(offer: any, now = new Date()) {
  const [expired] = await db.update(resaleMarketplaceOffers)
    .set({
      status: "expired",
      rejectionReason: "Payment deadline missed. Submit a new offer to try again.",
      updatedAt: now,
    })
    .where(and(
      eq(resaleMarketplaceOffers.id, offer.id),
      inArray(resaleMarketplaceOffers.status, ["payment_pending", "payment_rejected"]),
      lte(resaleMarketplaceOffers.paymentDeadline, now),
    ))
    .returning();
  if (!expired) return false;
  await recordOfferEvent(
    db,
    expired,
    "payment_deadline_expired",
    "system",
    null,
    "The one-hour payment deadline passed before proof of payment was submitted. A new offer is required.",
  );
  const [property, buyer, seller] = await Promise.all([
    storage.getProperty(expired.propertyId),
    storage.getUser(expired.buyerId),
    storage.getUser(expired.sellerId),
  ]);
  const propertyName = property?.name || "your land holding";
  const message = `Offer ${expired.reference} expired after its one-hour payment window. The reserved quantity is available again; the buyer must submit a new offer.`;
  await Promise.all([
    notifyMarketplaceUser(expired.buyerId, expired.id, "Offer expired", message),
    notifyMarketplaceUser(expired.sellerId, expired.id, "Offer expired", message),
  ]);
  for (const recipient of [buyer, seller]) {
    if (!recipient?.email) continue;
    try {
      await sendMarketplaceOfferEmail({
        to: recipient.email,
        recipientName: userDisplayName(recipient),
        subject: `Marketplace offer expired — ${expired.reference}`,
        heading: "Payment deadline missed",
        message,
        propertyName,
        reference: expired.reference,
        offerId: expired.id,
      });
    } catch (error) {
      console.error("[MARKETPLACE-OFFER] Expiry email failed:", error);
    }
  }
  return true;
}

export async function processExpiredMarketplaceOffers() {
  const now = new Date();
  const candidates = await db.select().from(resaleMarketplaceOffers).where(and(
    inArray(resaleMarketplaceOffers.status, ["payment_pending", "payment_rejected"]),
    lte(resaleMarketplaceOffers.paymentDeadline, now),
  ));
  for (const offer of candidates) {
    try {
      await expireMarketplaceOffer(offer, now);
    } catch (error) {
      console.error(`[MARKETPLACE-OFFER] Failed to expire offer ${offer.reference}:`, error);
    }
  }
}

async function getAvailableUnitsInTransaction(tx: any, reservationId: number, now: Date, excludeOfferId?: number) {
  const [reservation] = await tx.select().from(investmentReservations)
    .where(eq(investmentReservations.id, reservationId))
    .limit(1);
  if (!reservation) return { reservation: null, availableUnits: 0 };
  const [listings, offers] = await Promise.all([
    tx.select().from(resaleListings).where(eq(resaleListings.reservationId, reservationId)),
    tx.select().from(resaleMarketplaceOffers).where(eq(resaleMarketplaceOffers.sellerReservationId, reservationId)),
  ]);
  return {
    reservation,
    availableUnits: getAvailableUnits(reservation, listings, offers, now, excludeOfferId),
  };
}

export async function createResaleListingSafely(listingData: any) {
  return db.transaction(async (tx) => {
    const [reservation] = await tx.select().from(investmentReservations)
      .where(eq(investmentReservations.id, listingData.reservationId))
      .limit(1)
      .for("update");
    if (!reservation || reservation.userId !== listingData.sellerId || reservation.status !== "converted_to_investment") {
      throw new Error("Only the current owner can list confirmed holdings");
    }
    const property = await storage.getProperty(reservation.propertyId);
    if (!property || !property.isTransferable) throw new Error("This property does not allow unit transfers");
    const requested = parsePositiveUnits(listingData.units);
    if (!requested || !alignsWithUnitPrecision(requested, property)) throw new Error("Enter a valid quantity for this property's unit precision");
    const { availableUnits } = await getAvailableUnitsInTransaction(tx, reservation.id, new Date());
    if (requested > availableUnits) {
      throw new Error(`Only ${formatUnits(availableUnits)} units are available after existing listings and accepted offers`);
    }
    const [created] = await tx.insert(resaleListings).values(listingData).returning();
    return created;
  });
}

export async function completeListedResaleTransfer(paymentId: number, adminId: number, amountReceived: unknown) {
  const receivedMinor = parseMoneyMinor(amountReceived);
  if (receivedMinor === null) throw new Error("Enter the actual amount received");
  return db.transaction(async (tx) => {
    const [payment] = await tx.select().from(resalePayments)
      .where(eq(resalePayments.id, paymentId))
      .limit(1)
      .for("update");
    if (!payment) throw new Error("Payment not found");
    if (payment.status === "approved") return { payment, alreadyCompleted: true as const };
    const [buyer] = await tx.select().from(users).where(eq(users.id, payment.buyerId)).limit(1);
    assertResaleTransferPreconditions(payment.status, buyer?.kycStatus, "pending_verification");

    const [listing] = await tx.select().from(resaleListings)
      .where(eq(resaleListings.id, payment.listingId))
      .limit(1)
      .for("update");
    if (!listing || listing.status !== "awaiting_payment" || listing.winnerId !== payment.buyerId) {
      throw new Error("The listing is not awaiting this buyer's payment");
    }
    const expectedMinor = parseMoneyMinor(payment.totalPayment) || parseMoneyMinor(payment.amount);
    if (expectedMinor === null || receivedMinor !== expectedMinor) {
      throw new Error(`Actual amount received must equal ${payment.currency} ${payment.totalPayment && Number(payment.totalPayment) > 0 ? payment.totalPayment : payment.amount}`);
    }
    const [sellerReservation] = await tx.select().from(investmentReservations)
      .where(eq(investmentReservations.id, listing.reservationId))
      .limit(1)
      .for("update");
    if (!sellerReservation || sellerReservation.status !== "converted_to_investment" || sellerReservation.userId !== listing.sellerId) {
      throw new Error("Seller ownership could not be verified");
    }
    const [property] = await tx.select().from(properties)
      .where(eq(properties.id, listing.propertyId))
      .limit(1);
    if (!property || !property.isTransferable) throw new Error("This property is no longer transferable");

    const soldUnits = Number(listing.units);
    const currentUnits = Number(sellerReservation.units);
    if (!Number.isFinite(soldUnits) || soldUnits <= 0 || soldUnits > currentUnits) {
      throw new Error("Seller no longer owns the units in this listing");
    }
    const remainingUnits = roundUnits(currentUnits - soldUnits);
    const purchasePrice = parseMoneyMinor(payment.amount);
    if (purchasePrice === null) throw new Error("The recorded purchase price is invalid");
    const buyerName = userDisplayName(buyer);
    const [buyerReservation] = await tx.insert(investmentReservations).values({
      propertyId: listing.propertyId,
      userId: payment.buyerId,
      fullName: buyerName,
      email: buyer.email,
      phone: buyer.phone || "Not provided",
      units: formatUnits(soldUnits),
      amount: formatMoneyMinor(purchasePrice),
      currency: payment.currency || listing.currency,
      unitPriceSnapshot: (Number(formatMoneyMinor(purchasePrice)) / soldUnits).toFixed(2),
      status: "converted_to_investment",
      funnelStage: "confirmed",
      expiresAt: null,
    }).returning();

    await tx.update(investmentReservations)
      .set({
        units: formatUnits(remainingUnits),
        status: remainingUnits <= 0 ? "sold_via_resale" : "converted_to_investment",
        updatedAt: new Date(),
      })
      .where(eq(investmentReservations.id, sellerReservation.id));

    const [sellerCertificate] = await tx.select().from(ownershipCertificates)
      .where(eq(ownershipCertificates.reservationId, sellerReservation.id))
      .limit(1);
    if (sellerCertificate) {
      const previousAmount = parseMoneyMinor(sellerCertificate.amount) ?? 0;
      const remainingAmount = currentUnits > 0 ? Math.max(0, Math.round(previousAmount * remainingUnits / currentUnits)) : 0;
      await tx.update(ownershipCertificates)
        .set({ units: formatUnits(remainingUnits), amount: formatMoneyMinor(remainingAmount) })
        .where(eq(ownershipCertificates.id, sellerCertificate.id));
    }

    const reference = listing.paymentReference || `LIST-${listing.id}-PAY-${payment.id}`;
    await tx.insert(ownershipCertificates).values({
      reservationId: buyerReservation.id,
      certificateNumber: `CERT-RESALE-${reference}`,
      verificationToken: randomUUID(),
      ownerName: buyerName,
      propertyName: property.name,
      propertyLocation: property.location,
      units: formatUnits(soldUnits),
      amount: formatMoneyMinor(purchasePrice),
      currency: payment.currency || listing.currency,
      issuedByAdminId: adminId,
    });

    const [updatedPayment] = await tx.update(resalePayments)
      .set({
        status: "approved",
        reviewedByAdminId: adminId,
        reviewedAt: new Date(),
      })
      .where(and(
        eq(resalePayments.id, paymentId),
        eq(resalePayments.status, "pending_verification"),
      ))
      .returning();
    if (!updatedPayment) throw new Error("Payment was already reviewed");
    const [updatedListing] = await tx.update(resaleListings)
      .set({ status: "sold", updatedAt: new Date() })
      .where(and(
        eq(resaleListings.id, listing.id),
        eq(resaleListings.status, "awaiting_payment"),
      ))
      .returning();
    if (!updatedListing) throw new Error("Listing transfer was already processed");
    return { payment: updatedPayment, listing: updatedListing, property, buyer, buyerReservation, alreadyCompleted: false as const };
  });
}

export function registerMarketplaceOfferRoutes(app: Express, auth: AuthOptions) {
  app.get("/api/resale-payments/:id/receipt", auth.requireApprovedUser, async (req: any, res) => {
    try {
      const paymentId = Number(req.params.id);
      const [payment] = await db.select().from(resalePayments)
        .where(eq(resalePayments.id, paymentId)).limit(1);
      if (!payment) return res.status(404).json({ message: "Payment not found" });
      const [listing] = await db.select().from(resaleListings)
        .where(eq(resaleListings.id, payment.listingId)).limit(1);
      if (!listing) return res.status(404).json({ message: "Listing not found" });
      if (!canAccessResaleReceipt(Number(req.user.id), payment.buyerId, listing.sellerId)) {
        return res.status(403).json({ message: "You cannot view this receipt" });
      }
      if (!payment.proofUrl) return res.status(404).json({ message: "Receipt not found" });
      return await streamMarketplaceReceipt(payment.proofUrl, res);
    } catch (error) {
      console.error("[MARKETPLACE-OFFER] Listed receipt access failed:", error);
      res.status(500).json({ message: "Failed to load receipt" });
    }
  });

  app.get("/api/admin/resale-payments/:id/receipt", auth.requireAdminAuth, async (req: any, res) => {
    try {
      const paymentId = Number(req.params.id);
      const [payment] = await db.select().from(resalePayments)
        .where(eq(resalePayments.id, paymentId)).limit(1);
      if (!payment?.proofUrl) return res.status(404).json({ message: "Receipt not found" });
      return await streamMarketplaceReceipt(payment.proofUrl, res);
    } catch (error) {
      console.error("[MARKETPLACE-OFFER] Listed admin receipt access failed:", error);
      res.status(500).json({ message: "Failed to load receipt" });
    }
  });

  app.get("/api/marketplace/offers/:id/receipt", auth.requireApprovedUser, async (req: any, res) => {
    try {
      const offerId = Number(req.params.id);
      const [offer] = await db.select().from(resaleMarketplaceOffers)
        .where(eq(resaleMarketplaceOffers.id, offerId)).limit(1);
      if (!offer) return res.status(404).json({ message: "Offer not found" });
      if (!canAccessResaleReceipt(Number(req.user.id), offer.buyerId, offer.sellerId)) {
        return res.status(403).json({ message: "You cannot view this receipt" });
      }
      if (!offer.proofUrl) return res.status(404).json({ message: "Receipt not found" });
      return await streamMarketplaceReceipt(offer.proofUrl, res);
    } catch (error) {
      console.error("[MARKETPLACE-OFFER] Receipt access failed:", error);
      res.status(500).json({ message: "Failed to load receipt" });
    }
  });

  app.get("/api/admin/marketplace-offers/:id/receipt", auth.requireAdminAuth, async (req: any, res) => {
    try {
      const offerId = Number(req.params.id);
      const [offer] = await db.select().from(resaleMarketplaceOffers)
        .where(eq(resaleMarketplaceOffers.id, offerId)).limit(1);
      if (!offer?.proofUrl) return res.status(404).json({ message: "Receipt not found" });
      return await streamMarketplaceReceipt(offer.proofUrl, res);
    } catch (error) {
      console.error("[MARKETPLACE-OFFER] Admin receipt access failed:", error);
      res.status(500).json({ message: "Failed to load receipt" });
    }
  });

  app.get("/api/marketplace/unlisted-land", auth.requireApprovedUser, async (_req: any, res) => {
    try {
      const { holdings } = await readMarketplaceSnapshot();
      const groups = new Map<number, { property: any; positions: Array<{ reservation: any; availableUnits: number }> }>();
      for (const holding of holdings) {
        let group = groups.get(holding.property.id);
        if (!group) {
          group = { property: holding.property, positions: [] };
          groups.set(holding.property.id, group);
        }
        group.positions.push({ reservation: holding.reservation, availableUnits: holding.availableUnits });
      }
      res.json(Array.from(groups.values()).map(({ property, positions }) => ({
        id: property.id,
        name: property.name,
        location: property.location,
        description: property.description,
        propertyType: property.propertyType || "land",
        imageUrl: property.imageUrl,
        totalLandArea: property.totalSquareMeters,
        ownershipUnit: "sqm",
        unitPrecision: property.unitPrecision,
        availableUnits: formatUnits(positions.reduce((sum: number, row: { reservation: any; availableUnits: number }) => sum + row.availableUnits, 0)),
        ownerCount: positions.length,
      })));
    } catch (error) {
      console.error("[MARKETPLACE-OFFER] Failed to load unlisted land:", error);
      res.status(500).json({ message: "Failed to load unlisted land" });
    }
  });

  app.get("/api/marketplace/unlisted-land/:propertyId/owners", auth.requireApprovedUser, async (req: any, res) => {
    try {
      const propertyId = Number(req.params.propertyId);
      if (!Number.isSafeInteger(propertyId) || propertyId <= 0) return res.status(400).json({ message: "Invalid land listing" });
      const { holdings } = await readMarketplaceSnapshot();
      const positions = holdings
        .filter((holding) => holding.property.id === propertyId)
        .sort((a, b) => a.reservation.id - b.reservation.id);
      res.json(positions.map(({ reservation, availableUnits }, index) => ({
        ownerReference: `Owner ${String(index + 1).padStart(3, "0")}`,
        positionToken: positionToken(reservation.id, propertyId),
        totalOwned: formatUnits(Number(reservation.units)),
        availableToReceiveOffers: formatUnits(availableUnits),
        isOwn: reservation.userId === req.user.id,
        currency: reservation.currency || "NGN",
      })));
    } catch (error) {
      console.error("[MARKETPLACE-OFFER] Failed to load anonymous owners:", error);
      res.status(500).json({ message: "Failed to load owner positions" });
    }
  });

  app.post("/api/marketplace/offers", auth.requireApprovedUser, async (req: any, res) => {
    try {
      const buyer = req.user as any;
      const position = readPositionToken(req.body?.positionToken);
      if (!position) return res.status(400).json({ message: "Select a valid anonymous owner position" });
      const units = parsePositiveUnits(req.body?.units);
      const terms = calculateResalePaymentTerms(req.body?.purchasePrice);
      if (!units || !terms) return res.status(400).json({ message: "Enter a valid quantity and purchase price" });

      const { holdings, listings, offers } = await readMarketplaceSnapshot();
      const holding = holdings.find((row) => row.reservation.id === position.reservationId && row.property.id === position.propertyId);
      if (!holding) return res.status(404).json({ message: "This land holding is no longer available for offers" });
      if (holding.reservation.userId === buyer.id) return res.status(400).json({ message: "You cannot make an offer on your own holding" });
      if (!alignsWithUnitPrecision(units, holding.property)) return res.status(400).json({ message: `Quantity must be in increments of ${getUnitPrecision(holding.property)}` });
      const availableUnits = getAvailableUnits(holding.reservation, listings, offers, new Date());
      if (units > availableUnits) return res.status(400).json({ message: `Only ${formatUnits(availableUnits)} units are currently available to receive offers` });

      const reference = `BV-${Date.now().toString(36).toUpperCase()}-${randomBytes(4).toString("hex").toUpperCase()}`;
      const [created] = await db.transaction(async (tx) => {
        const [lockedReservation] = await tx.select().from(investmentReservations)
          .where(eq(investmentReservations.id, position.reservationId))
          .limit(1)
          .for("update");
        if (!lockedReservation || lockedReservation.userId === buyer.id || lockedReservation.status !== "converted_to_investment") {
          throw new Error("This owner position is no longer eligible");
        }
        const current = await getAvailableUnitsInTransaction(tx, lockedReservation.id, new Date());
        const property = await storage.getProperty(position.propertyId);
        if (!property || !property.isTransferable || units > current.availableUnits || !alignsWithUnitPrecision(units, property)) {
          throw new Error("The requested quantity is no longer available");
        }
        const [offer] = await tx.insert(resaleMarketplaceOffers).values({
          reference,
          sellerReservationId: lockedReservation.id,
          propertyId: position.propertyId,
          sellerId: lockedReservation.userId!,
          buyerId: buyer.id,
          units: formatUnits(units),
          purchasePrice: terms.purchasePrice,
          transactionFee: terms.transactionFee,
          totalPayment: terms.totalPayment,
          currency: lockedReservation.currency || "NGN",
          status: "awaiting_seller_response",
        }).returning();
        await recordOfferEvent(
          tx,
          offer,
          "offer_submitted",
          "buyer",
          buyer.id,
          "Buyer submitted an offer. The one-hour payment window starts only after both parties agree.",
        );
        return [offer];
      });

      const [seller, property] = await Promise.all([
        storage.getUser(created.sellerId),
        storage.getProperty(created.propertyId),
      ]);
      const title = "New land purchase offer";
      const message = `A buyer has submitted offer ${created.reference} for ${created.units} sqm of your ${property?.name || "land holding"}. No payment deadline starts until you and the buyer agree.`;
      await notifyMarketplaceUser(created.sellerId, created.id, title, message);
      if (seller?.email) {
        try {
          await sendMarketplaceOfferEmail({
            to: seller.email,
            recipientName: userDisplayName(seller),
            subject: `New purchase offer — ${created.reference}`,
            heading: "New purchase offer received",
            message,
            propertyName: property?.name || "Land holding",
            reference: created.reference,
            offerId: created.id,
            rows: [
              ["Quantity requested", `${created.units} sqm`],
              ["Proposed price", `${created.currency} ${created.purchasePrice}`],
            ],
          });
        } catch (emailError) {
          console.error("[MARKETPLACE-OFFER] Seller email failed:", emailError);
        }
      }
      res.status(201).json({ id: created.id, reference: created.reference, status: created.status });
    } catch (error: any) {
      const status = /no longer|not eligible|no longer available/i.test(error?.message || "") ? 409 : 500;
      if (status === 500) console.error("[MARKETPLACE-OFFER] Failed to submit offer:", error);
      res.status(status).json({ message: status === 409 ? error.message : "Failed to submit offer" });
    }
  });

  app.get("/api/marketplace/offers/mine", auth.requireApprovedUser, async (req: any, res) => {
    try {
      const currentUserId = Number(req.user.id);
      const offers = await db.select().from(resaleMarketplaceOffers)
        .where(or(
          eq(resaleMarketplaceOffers.buyerId, currentUserId),
          eq(resaleMarketplaceOffers.sellerId, currentUserId),
        ))
        .orderBy(desc(resaleMarketplaceOffers.updatedAt));
      if (!offers.length) return res.json([]);
      const ids = offers.map((offer) => offer.id);
      const [events, allProperties] = await Promise.all([
        db.select().from(resaleMarketplaceOfferEvents)
          .where(inArray(resaleMarketplaceOfferEvents.offerId, ids))
          .orderBy(desc(resaleMarketplaceOfferEvents.createdAt)),
        storage.getProperties(),
      ]);
      const propertyById = new Map(allProperties.map((property) => [property.id, property]));
      const eventsByOffer = new Map<number, any[]>();
      for (const event of events) {
        const list = eventsByOffer.get(event.offerId) || [];
        list.push(event);
        eventsByOffer.set(event.offerId, list);
      }
      res.json(offers.map((offer) => visibleOffer(
        offer,
        currentUserId,
        propertyById.get(offer.propertyId),
        eventsByOffer.get(offer.id) || [],
      )));
    } catch (error) {
      console.error("[MARKETPLACE-OFFER] Failed to load user's offers:", error);
      res.status(500).json({ message: "Failed to load marketplace offers" });
    }
  });

  app.get("/api/marketplace/notifications/mine", auth.requireApprovedUser, async (req: any, res) => {
    try {
      const notifications = await db.select().from(resaleMarketplaceNotifications)
        .where(eq(resaleMarketplaceNotifications.userId, Number(req.user.id)))
        .orderBy(desc(resaleMarketplaceNotifications.createdAt))
        .limit(50);
      res.json(notifications.map(({ userId: _userId, ...notification }) => notification));
    } catch (error) {
      console.error("[MARKETPLACE-OFFER] Failed to load notifications:", error);
      res.status(500).json({ message: "Failed to load marketplace notifications" });
    }
  });

  app.post("/api/marketplace/notifications/:id/read", auth.requireApprovedUser, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid notification" });
      const [updated] = await db.update(resaleMarketplaceNotifications)
        .set({ readAt: new Date() })
        .where(and(
          eq(resaleMarketplaceNotifications.id, id),
          eq(resaleMarketplaceNotifications.userId, Number(req.user.id)),
        ))
        .returning({ id: resaleMarketplaceNotifications.id });
      if (!updated) return res.status(404).json({ message: "Notification not found" });
      res.json({ success: true });
    } catch (error) {
      console.error("[MARKETPLACE-OFFER] Failed to mark notification read:", error);
      res.status(500).json({ message: "Failed to update notification" });
    }
  });

  app.post("/api/marketplace/offers/:id/respond", auth.requireApprovedUser, async (req: any, res) => {
    try {
      const offerId = Number(req.params.id);
      const currentUser = req.user as any;
      const action = String(req.body?.action || "");
      if (!Number.isSafeInteger(offerId) || offerId <= 0) return res.status(400).json({ message: "Invalid offer" });
      if (!["accept", "counter", "decline"].includes(action)) return res.status(400).json({ message: "Choose accept, counter, or decline" });
      const units = action === "counter" ? parsePositiveUnits(req.body?.units) : null;
      const terms = action === "counter" ? calculateResalePaymentTerms(req.body?.purchasePrice) : null;
      if (action === "counter" && (!units || !terms)) return res.status(400).json({ message: "Enter a valid counteroffer quantity and price" });

      const outcome = await db.transaction(async (tx) => {
        const [offer] = await tx.select().from(resaleMarketplaceOffers)
          .where(eq(resaleMarketplaceOffers.id, offerId))
          .limit(1)
          .for("update");
        if (!offer) throw new Error("Offer not found");
        const isSeller = offer.sellerId === currentUser.id;
        const isBuyer = offer.buyerId === currentUser.id;
        if (!isSeller && !isBuyer) throw new Error("You are not a participant in this offer");
        const expectedStatus = offer.status === "awaiting_seller_response"
          ? (isSeller ? "awaiting_seller_response" : null)
          : offer.status === "awaiting_buyer_response"
            ? (isBuyer ? "awaiting_buyer_response" : null)
            : null;
        if (!expectedStatus) throw new Error("This offer is not waiting for your response");
        const [lockedReservation] = await tx.select().from(investmentReservations)
          .where(eq(investmentReservations.id, offer.sellerReservationId))
          .limit(1)
          .for("update");
        if (!lockedReservation || lockedReservation.userId !== offer.sellerId || lockedReservation.status !== "converted_to_investment") {
          throw new Error("Seller ownership could not be verified");
        }

        let updated: any;
        if (action === "decline") {
          [updated] = await tx.update(resaleMarketplaceOffers)
            .set({ status: "declined", updatedAt: new Date() })
            .where(eq(resaleMarketplaceOffers.id, offer.id))
            .returning();
          await recordOfferEvent(tx, updated, "offer_declined", isSeller ? "seller" : "buyer", currentUser.id, "Offer declined.");
        } else if (action === "counter") {
          const property = await storage.getProperty(offer.propertyId);
          if (!property || !alignsWithUnitPrecision(units!, property)) throw new Error(`Quantity must be in increments of ${getUnitPrecision(property)}`);
          const availability = await getAvailableUnitsInTransaction(tx, offer.sellerReservationId, new Date(), offer.id);
          if (!availability.reservation || units! > availability.availableUnits) {
            throw new Error(`Only ${formatUnits(availability.availableUnits)} units are currently available`);
          }
          [updated] = await tx.update(resaleMarketplaceOffers)
            .set({
              units: formatUnits(units!),
              purchasePrice: terms!.purchasePrice,
              transactionFee: terms!.transactionFee,
              totalPayment: terms!.totalPayment,
              status: isSeller ? "awaiting_buyer_response" : "awaiting_seller_response",
              updatedAt: new Date(),
            })
            .where(eq(resaleMarketplaceOffers.id, offer.id))
            .returning();
          await recordOfferEvent(
            tx,
            updated,
            "counteroffer_submitted",
            isSeller ? "seller" : "buyer",
            currentUser.id,
            "Counteroffer submitted. The payment window has not started.",
          );
        } else {
          const now = new Date();
          const availability = await getAvailableUnitsInTransaction(tx, offer.sellerReservationId, now, offer.id);
          const property = await storage.getProperty(offer.propertyId);
          if (!availability.reservation || availability.reservation.userId !== offer.sellerId ||
              availability.reservation.status !== "converted_to_investment" ||
              !property?.isTransferable || Number(offer.units) > availability.availableUnits) {
            throw new Error("The agreed quantity is no longer available");
          }
          const deadline = createMarketplacePaymentDeadline(now);
          [updated] = await tx.update(resaleMarketplaceOffers)
            .set({ status: "payment_pending", paymentDeadline: deadline, updatedAt: now })
            .where(eq(resaleMarketplaceOffers.id, offer.id))
            .returning();
          await recordOfferEvent(
            tx,
            updated,
            "offer_accepted",
            isSeller ? "seller" : "buyer",
            currentUser.id,
            `Both parties agreed. The one-hour payment deadline is ${deadline.toISOString()}.`,
          );
        }
        return { offer: updated, isSeller };
      });

      const recipientId = outcome.isSeller ? outcome.offer.buyerId : outcome.offer.sellerId;
      const recipient = await storage.getUser(recipientId);
      const property = await storage.getProperty(outcome.offer.propertyId);
      const message = action === "decline"
        ? `Offer ${outcome.offer.reference} for ${property?.name || "land"} was declined.`
        : action === "counter"
          ? `A counteroffer was submitted for ${property?.name || "land"}: ${outcome.offer.units} sqm at ${outcome.offer.currency} ${outcome.offer.purchasePrice}, plus a 2% Brikvest fee.`
          : `Offer ${outcome.offer.reference} was accepted. Pay ${outcome.offer.currency} ${outcome.offer.totalPayment} within one hour and submit payment proof.`;
      const title = action === "decline" ? "Offer declined" : action === "counter" ? "Counteroffer received" : "Offer accepted";
      await notifyMarketplaceUser(recipientId, offerId, title, message);
      if (recipient?.email) {
        try {
          await sendMarketplaceOfferEmail({
            to: recipient.email,
            recipientName: userDisplayName(recipient),
            subject: `${title} — ${outcome.offer.reference}`,
            heading: title,
            message,
            propertyName: property?.name || "Land holding",
            reference: outcome.offer.reference,
            offerId,
            rows: [
              ["Quantity", `${outcome.offer.units} sqm`],
              ["Agreed / counter price", `${outcome.offer.currency} ${outcome.offer.purchasePrice}`],
              ["Brikvest fee (2%)", `${outcome.offer.currency} ${outcome.offer.transactionFee}`],
              ["Total buyer payment", `${outcome.offer.currency} ${outcome.offer.totalPayment}`],
              ...(outcome.offer.paymentDeadline ? [["Payment deadline", new Date(outcome.offer.paymentDeadline).toLocaleString()] as [string, string]] : []),
            ],
          });
        } catch (emailError) {
          console.error("[MARKETPLACE-OFFER] Response email failed:", emailError);
        }
      }
      res.json({ id: outcome.offer.id, reference: outcome.offer.reference, status: outcome.offer.status, paymentDeadline: outcome.offer.paymentDeadline });
    } catch (error: any) {
      const message = error?.message || "";
      const status = /not found/i.test(message) ? 404 : /not a participant|not waiting|not available|increments/i.test(message) ? 409 : 500;
      if (status === 500) console.error("[MARKETPLACE-OFFER] Failed to process response:", error);
      res.status(status).json({ message: status === 500 ? "Failed to process offer response" : message });
    }
  });

  app.get("/api/marketplace/offers/:id/payment-instructions", auth.requireApprovedUser, async (req: any, res) => {
    try {
      const offerId = Number(req.params.id);
      const userId = Number(req.user.id);
      const [offer] = await db.select().from(resaleMarketplaceOffers)
        .where(eq(resaleMarketplaceOffers.id, offerId)).limit(1);
      if (!offer) return res.status(404).json({ message: "Offer not found" });
      if (offer.buyerId !== userId) return res.status(403).json({ message: "Only the buyer can view payment instructions" });
      if (!["payment_pending", "payment_rejected"].includes(offer.status)) {
        return res.status(400).json({ message: "This offer is not awaiting payment" });
      }
      if (!offer.paymentDeadline || new Date(offer.paymentDeadline) <= new Date()) {
        await expireMarketplaceOffer(offer);
        return res.status(400).json({ message: "Payment deadline has passed. Submit a new offer to try again." });
      }
      res.json({
        currency: offer.currency,
        method: getPaymentInstructions(offer.currency),
        purchasePrice: offer.purchasePrice,
        transactionFee: offer.transactionFee,
        totalPayment: offer.totalPayment,
        paymentReference: offer.reference,
        paymentDeadline: offer.paymentDeadline,
      });
    } catch (error) {
      console.error("[MARKETPLACE-OFFER] Failed to load payment instructions:", error);
      res.status(500).json({ message: "Failed to load payment instructions" });
    }
  });

  app.post("/api/marketplace/offers/:id/payment", auth.requireApprovedUser, upload.single("paymentProof"), async (req: any, res) => {
    try {
      const offerId = Number(req.params.id);
      const buyerId = Number(req.user.id);
      const file = req.file;
      if (!file) return res.status(400).json({ message: "Upload the bank transfer receipt to submit proof of payment" });
      const allowedTypes = ["image/jpeg", "image/png", "image/jpg", "image/webp", "application/pdf"];
      if (!allowedTypes.includes(file.mimetype)) return res.status(400).json({ message: "Only JPEG, PNG, WEBP, or PDF payment receipts are allowed" });
      if (file.size > 10 * 1024 * 1024) return res.status(400).json({ message: "Payment receipt must be 10MB or smaller" });

      const [offer] = await db.select().from(resaleMarketplaceOffers)
        .where(eq(resaleMarketplaceOffers.id, offerId)).limit(1);
      if (!offer) return res.status(404).json({ message: "Offer not found" });
      if (offer.buyerId !== buyerId) return res.status(403).json({ message: "Only the buyer can submit payment proof" });
      if (!["payment_pending", "payment_rejected"].includes(offer.status)) return res.status(400).json({ message: "This offer is not accepting payment proof" });
      const submittedAt = new Date();
      if (!offer.paymentDeadline || submittedAt.getTime() >= new Date(offer.paymentDeadline).getTime()) {
        await expireMarketplaceOffer(offer, submittedAt);
        return res.status(400).json({ message: "The one-hour payment deadline has passed. Submit a new offer to try again." });
      }
      const bankReference = String(req.body?.bankReference || "").trim();
      if (!bankReference) return res.status(400).json({ message: "Enter the bank transfer reference number" });

      const uploadedProof = await uploadToObjectStorage(file.buffer, file.originalname, file.mimetype, "resale-payment-proofs");
      const proofUrl = uploadedProof.url;
      const proofType = file.mimetype === "application/pdf" ? "pdf" : "image";
      const [updated] = await db.update(resaleMarketplaceOffers)
        .set({
          status: "payment_under_review",
          bankReference,
          proofUrl,
          proofType,
          paymentSubmittedAt: submittedAt,
          rejectionReason: null,
          updatedAt: submittedAt,
        })
        .where(and(
          eq(resaleMarketplaceOffers.id, offerId),
          eq(resaleMarketplaceOffers.buyerId, buyerId),
          inArray(resaleMarketplaceOffers.status, ["payment_pending", "payment_rejected"]),
          gt(resaleMarketplaceOffers.paymentDeadline, submittedAt),
        ))
        .returning();
      // Keep the deadline and transaction status checks in the update itself so
      // concurrent uploads cannot overwrite a review or submit after expiry.
      if (!updated) {
        return res.status(409).json({ message: "Offer status changed while the receipt was uploading. Reload the marketplace and check its status." });
      }
      await recordOfferEvent(db, updated, "payment_proof_submitted", "buyer", buyerId, "Payment proof submitted before the one-hour deadline.");
      const [property] = await Promise.all([storage.getProperty(updated.propertyId)]);
      const adminMessage = `Payment proof was submitted for ${updated.reference}. Review the receipt and confirm that the full total of ${updated.currency} ${updated.totalPayment} has reached Brikvest.`;
      await notifyAdmins(updated, property?.name || "Land holding", "Marketplace payment needs review", adminMessage);
      const sellerMessage = `The buyer submitted payment proof for offer ${updated.reference}. The land quantity remains reserved while Brikvest reviews the transfer.`;
      await notifyMarketplaceUser(updated.sellerId, updated.id, "Payment proof submitted", sellerMessage);
      res.json({ message: "Payment proof submitted. Brikvest will verify the funds before any land transfer.", status: updated.status });
    } catch (error: any) {
      console.error("[MARKETPLACE-OFFER] Failed to submit payment proof:", error);
      res.status(500).json({ message: "Failed to submit payment proof" });
    }
  });

  app.get("/api/admin/marketplace-offers", auth.requireAdminAuth, async (_req: any, res) => {
    try {
      const offers = await db.select().from(resaleMarketplaceOffers).orderBy(desc(resaleMarketplaceOffers.updatedAt));
      const rows = await Promise.all(offers.map(async (offer) => {
        const [property, buyer, seller, events] = await Promise.all([
          storage.getProperty(offer.propertyId),
          storage.getUser(offer.buyerId),
          storage.getUser(offer.sellerId),
          db.select().from(resaleMarketplaceOfferEvents)
            .where(eq(resaleMarketplaceOfferEvents.offerId, offer.id))
            .orderBy(desc(resaleMarketplaceOfferEvents.createdAt)),
        ]);
        return {
          ...offer,
          propertyName: property?.name || "Unknown",
          propertyLocation: property?.location || "",
          buyerName: userDisplayName(buyer),
          buyerEmail: buyer?.email || "",
          buyerKycStatus: buyer?.kycStatus || "unknown",
          sellerName: userDisplayName(seller),
          sellerEmail: seller?.email || "",
          events,
        };
      }));
      res.json(rows);
    } catch (error) {
      console.error("[MARKETPLACE-OFFER] Admin offer query failed:", error);
      res.status(500).json({ message: "Failed to load marketplace offers" });
    }
  });

  app.post("/api/admin/marketplace-offers/:id/review-payment", auth.requireAdminAuth, async (req: any, res) => {
    try {
      const offerId = Number(req.params.id);
      const adminId = Number(req.user.userId);
      const action = String(req.body?.action || "");
      if (!Number.isSafeInteger(offerId) || offerId <= 0) return res.status(400).json({ message: "Invalid offer" });
      if (!["approve", "reject"].includes(action)) return res.status(400).json({ message: "Choose approve or reject" });
      const [offer] = await db.select().from(resaleMarketplaceOffers)
        .where(eq(resaleMarketplaceOffers.id, offerId)).limit(1);
      if (!offer) return res.status(404).json({ message: "Offer not found" });
      if (offer.status !== "payment_under_review") return res.status(409).json({ message: "Only submitted payment proof can be reviewed" });

      let rejectionReason: string | null = null;
      if (action === "approve") {
        const amountReceived = parseMoneyMinor(req.body?.amountReceived);
        const expected = parseMoneyMinor(offer.totalPayment);
        if (amountReceived === null || expected === null || amountReceived !== expected) {
          return res.status(400).json({ message: `Enter the exact amount received: ${offer.currency} ${offer.totalPayment}` });
        }
      } else {
        rejectionReason = String(req.body?.rejectionReason || "").trim();
        if (!rejectionReason) return res.status(400).json({ message: "Provide a reason for rejecting payment proof" });
      }

      const nextStatus = action === "approve" ? "payment_verified" : "payment_rejected";
      const [updated] = await db.update(resaleMarketplaceOffers)
        .set({
          status: nextStatus,
          rejectionReason,
          paymentReviewedByAdminId: adminId,
          paymentReviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(
          eq(resaleMarketplaceOffers.id, offerId),
          eq(resaleMarketplaceOffers.status, "payment_under_review"),
        ))
        .returning();
      if (!updated) return res.status(409).json({ message: "Offer payment was already reviewed" });
      await recordOfferEvent(
        db,
        updated,
        action === "approve" ? "payment_verified" : "payment_rejected",
        "admin",
        adminId,
        action === "approve"
          ? `Administrator confirmed receipt of ${updated.currency} ${updated.totalPayment}. Ownership transfer still requires buyer KYC approval and a separate admin action.`
          : `Payment proof rejected: ${rejectionReason}`,
      );
      const [buyer, seller, property] = await Promise.all([
        storage.getUser(updated.buyerId),
        storage.getUser(updated.sellerId),
        storage.getProperty(updated.propertyId),
      ]);
      const message = action === "approve"
        ? `Brikvest verified payment for offer ${updated.reference}. Ownership transfer is pending the buyer's KYC approval and administrator authorization.`
        : `Payment proof for offer ${updated.reference} was rejected: ${rejectionReason}. Submit corrected proof before the deadline if it is still active.`;
      const title = action === "approve" ? "Payment verified" : "Payment proof rejected";
      await Promise.all([
        notifyMarketplaceUser(updated.buyerId, updated.id, title, message),
        notifyMarketplaceUser(updated.sellerId, updated.id, title, message),
      ]);
      for (const recipient of [buyer, seller]) {
        if (!recipient?.email) continue;
        try {
          await sendMarketplaceOfferEmail({
            to: recipient.email,
            recipientName: userDisplayName(recipient),
            subject: `${title} — ${updated.reference}`,
            heading: title,
            message,
            propertyName: property?.name || "Land holding",
            reference: updated.reference,
            offerId: updated.id,
            rows: [
              ["Purchase price", `${updated.currency} ${updated.purchasePrice}`],
              ["Brikvest fee", `${updated.currency} ${updated.transactionFee}`],
              ["Total payment", `${updated.currency} ${updated.totalPayment}`],
            ],
          });
        } catch (emailError) {
          console.error("[MARKETPLACE-OFFER] Payment review email failed:", emailError);
        }
      }
      if (action === "reject" && (!updated.paymentDeadline || new Date(updated.paymentDeadline) <= new Date())) {
        await expireMarketplaceOffer(updated);
      }
      res.json({ message: action === "approve" ? "Payment verified. Buyer KYC and administrator transfer approval are still required." : "Payment proof rejected.", status: updated.status });
    } catch (error) {
      console.error("[MARKETPLACE-OFFER] Payment review failed:", error);
      res.status(500).json({ message: "Failed to review marketplace payment" });
    }
  });

  app.post("/api/admin/marketplace-offers/:id/complete-transfer", auth.requireAdminAuth, async (req: any, res) => {
    try {
      const offerId = Number(req.params.id);
      const adminId = Number(req.user.userId);
      if (!Number.isSafeInteger(offerId) || offerId <= 0) return res.status(400).json({ message: "Invalid offer" });
      const result = await db.transaction(async (tx) => {
        const [offer] = await tx.select().from(resaleMarketplaceOffers)
          .where(eq(resaleMarketplaceOffers.id, offerId))
          .limit(1)
          .for("update");
        if (!offer) throw new Error("Offer not found");
        if (offer.status === "completed") return { offer, alreadyCompleted: true };
        if (offer.status !== "payment_verified") throw new Error("Payment must be verified before transfer");
        const [reservation] = await tx.select().from(investmentReservations)
          .where(eq(investmentReservations.id, offer.sellerReservationId))
          .limit(1)
          .for("update");
        if (!reservation || reservation.status !== "converted_to_investment" || reservation.userId !== offer.sellerId) {
          throw new Error("Seller ownership could not be verified");
        }
        const [buyer] = await tx.select().from(users).where(eq(users.id, offer.buyerId)).limit(1);
        assertResaleTransferPreconditions(offer.status, buyer?.kycStatus, "payment_verified");
        const [property] = await tx.select().from(properties).where(eq(properties.id, offer.propertyId)).limit(1);
        if (!property || !property.isTransferable) throw new Error("This property is no longer transferable");

        const availability = await getAvailableUnitsInTransaction(tx, reservation.id, new Date(), offer.id);
        const transferredUnits = Number(offer.units);
        if (transferredUnits <= 0 || transferredUnits > availability.availableUnits) {
          throw new Error("Reserved units are no longer available for transfer");
        }

        const remainingUnits = roundUnits(Number(reservation.units) - transferredUnits);
        if (remainingUnits < 0) throw new Error("Seller no longer owns the agreed quantity");
        const buyerName = userDisplayName(buyer);
        const unitPrice = transferredUnits > 0 ? (Number(offer.purchasePrice) / transferredUnits).toFixed(2) : "0.00";
        const [buyerReservation] = await tx.insert(investmentReservations).values({
          propertyId: offer.propertyId,
          userId: offer.buyerId,
          fullName: buyerName,
          email: buyer.email,
          phone: buyer.phone || "Not provided",
          units: formatUnits(transferredUnits),
          amount: offer.purchasePrice,
          currency: offer.currency,
          unitPriceSnapshot: unitPrice,
          status: "converted_to_investment",
          funnelStage: "confirmed",
          expiresAt: null,
        }).returning();

        await tx.update(investmentReservations)
          .set({
            units: formatUnits(remainingUnits),
            status: remainingUnits <= 0 ? "sold_via_resale" : "converted_to_investment",
            updatedAt: new Date(),
          })
          .where(eq(investmentReservations.id, reservation.id));

        const [sellerCertificate] = await tx.select().from(ownershipCertificates)
          .where(eq(ownershipCertificates.reservationId, reservation.id)).limit(1);
        if (sellerCertificate) {
          const oldAmountMinor = parseMoneyMinor(sellerCertificate.amount) ?? 0;
          const proportionalRemaining = Number(reservation.units) > 0
            ? Math.max(0, Math.round(oldAmountMinor * remainingUnits / Number(reservation.units)))
            : 0;
          await tx.update(ownershipCertificates)
            .set({
              units: formatUnits(remainingUnits),
              amount: formatMoneyMinor(proportionalRemaining),
            })
            .where(eq(ownershipCertificates.id, sellerCertificate.id));
        }

        const certificateNumber = `CERT-RESALE-${offer.reference}`;
        await tx.insert(ownershipCertificates).values({
          reservationId: buyerReservation.id,
          certificateNumber,
          verificationToken: randomUUID(),
          ownerName: buyerName,
          propertyName: property.name,
          propertyLocation: property.location,
          units: formatUnits(transferredUnits),
          amount: offer.purchasePrice,
          currency: offer.currency,
          issuedByAdminId: adminId,
        });

        const [updated] = await tx.update(resaleMarketplaceOffers)
          .set({
            status: "completed",
            transferCompletedByAdminId: adminId,
            transferCompletedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(
            eq(resaleMarketplaceOffers.id, offerId),
            eq(resaleMarketplaceOffers.status, "payment_verified"),
          ))
          .returning();
        if (!updated) throw new Error("Offer transfer was already processed");
        await recordOfferEvent(
          tx,
          updated,
          "ownership_transfer_completed",
          "admin",
          adminId,
          `Administrator completed transfer of ${formatUnits(transferredUnits)} units. Land price ${updated.currency} ${updated.purchasePrice}; Brikvest fee ${updated.currency} ${updated.transactionFee}; total received ${updated.currency} ${updated.totalPayment}.`,
        );
        return { offer: updated, property, buyer, sellerReservation: reservation, alreadyCompleted: false };
      });

      if (result.alreadyCompleted) return res.json({ message: "Transfer was already completed.", status: "completed" });
      if (!result.property) throw new Error("Land details are unavailable for this transfer");
      const [seller] = await Promise.all([storage.getUser(result.offer.sellerId)]);
      const completionMessage = `The purchase of ${result.offer.units} sqm at ${result.property.name} is complete. Brikvest recorded the purchase price and 2% transaction fee separately.`;
      await Promise.all([
        notifyMarketplaceUser(result.offer.buyerId, result.offer.id, "Ownership transfer completed", completionMessage),
        notifyMarketplaceUser(result.offer.sellerId, result.offer.id, "Ownership transfer completed", completionMessage),
      ]);
      for (const recipient of [result.buyer, seller]) {
        if (!recipient?.email) continue;
        try {
          await sendMarketplaceOfferEmail({
            to: recipient.email,
            recipientName: userDisplayName(recipient),
            subject: `Land transfer completed — ${result.offer.reference}`,
            heading: "Ownership transfer completed",
            message: completionMessage,
            propertyName: result.property.name,
            reference: result.offer.reference,
            offerId: result.offer.id,
            rows: [
              ["Quantity", `${result.offer.units} sqm`],
              ["Purchase price", `${result.offer.currency} ${result.offer.purchasePrice}`],
              ["Brikvest fee (2%)", `${result.offer.currency} ${result.offer.transactionFee}`],
              ["Total payment", `${result.offer.currency} ${result.offer.totalPayment}`],
            ],
          });
        } catch (emailError) {
          console.error("[MARKETPLACE-OFFER] Transfer completion email failed:", emailError);
        }
      }
      res.json({ message: "Ownership transfer completed and recorded.", status: "completed" });
    } catch (error: any) {
      const message = error?.message || "";
      const status = /not found/i.test(message) ? 404 : /must be approved|verified|no longer|could not be verified|no longer transferable|already processed|reserved units/i.test(message) ? 409 : 500;
      if (status === 500) console.error("[MARKETPLACE-OFFER] Transfer failed:", error);
      res.status(status).json({ message: status === 500 ? "Failed to complete ownership transfer" : message });
    }
  });

  let expiryIntervalStarted = false;
  if (!expiryIntervalStarted) {
    expiryIntervalStarted = true;
    void processExpiredMarketplaceOffers();
    setInterval(() => void processExpiredMarketplaceOffers(), 30 * 1000);
  }
}