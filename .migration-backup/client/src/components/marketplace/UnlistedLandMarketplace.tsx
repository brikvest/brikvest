import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, Bell, CheckCircle2, Clock3, Copy, FileText, HandCoins, MapPin, Plus, Send, ShieldCheck, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/hooks/useCurrency";
import { queryClient } from "@/lib/queryClient";

type LandAsset = {
  id: number;
  name: string;
  location: string;
  description: string;
  propertyType: string;
  imageUrl: string;
  totalLandArea: string | null;
  ownershipUnit: string;
  sqmPerUnit: number;
  unitPrecision: string;
  availableUnits: string;
  availableAreaSqm: string;
  currency: string;
  ownerCount: number;
};

type OwnerPosition = {
  ownerReference: string;
  positionToken: string;
  totalOwned: string;
  totalOwnedSqm: string;
  availableToReceiveOffers: string;
  availableToReceiveOffersSqm: string;
  sqmPerUnit: number;
  unitPrecision: string;
  isOwn: boolean;
  currency: string;
};

type Offer = {
  id: number;
  reference: string;
  role: "buyer" | "seller";
  propertyName: string;
  propertyLocation: string;
  units: string;
  quantitySqm: string;
  sqmPerUnit: number;
  unitPrecision: string;
  purchasePrice: string;
  transactionFee: string;
  totalPayment: string;
  currency: string;
  status: string;
  paymentDeadline: string | null;
  rejectionReason: string | null;
  createdAt: string;
  events: Array<{
    id: number;
    action: string;
    actor: string;
    units: string;
    quantitySqm: string;
    purchasePrice: string;
    transactionFee: string;
    totalPayment: string;
    details: string;
    createdAt: string;
  }>;
};

function displayNumber(value: number | string) {
  return (Number(value) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function landQuantityLabel(units: number | string, areaSqm: number | string, sqmPerUnit = 5) {
  const unitCount = Number(units) || 0;
  const area = areaSqm === undefined || areaSqm === null
    ? unitCount * sqmPerUnit
    : Number(areaSqm) || 0;
  return `${displayNumber(area)} sqm (${displayNumber(unitCount)} ${unitCount === 1 ? "unit" : "units"})`;
}

function readablePropertyDescription(description: string) {
  if (typeof DOMParser === "undefined") {
    return description
      .replace(/<[^>]*>/g, " ")
      .replace(/[<>]/g, "")
      .replace(/\bco[\s-]*own\b/gi, "own")
      .replace(/\s+/g, " ")
      .trim();
  }
  const parsed = new DOMParser().parseFromString(description, "text/html");
  return (parsed.body.textContent || "")
    .replace(/[<>]/g, "")
    .replace(/\bco[\s-]*own\b/gi, "own")
    .replace(/\s+/g, " ")
    .trim();
}

async function requestJson(url: string, options?: RequestInit) {
  const response = await fetch(url, { credentials: "include", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Marketplace request failed");
  return data;
}

function formatDeadline(deadline: string | null, now: number) {
  if (!deadline) return null;
  const remaining = Math.max(0, new Date(deadline).getTime() - now);
  const totalSeconds = Math.floor(remaining / 1000);
  return {
    expired: remaining <= 0,
    text: `${String(Math.floor(totalSeconds / 3600)).padStart(2, "0")}:${String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`,
  };
}

const STATUS_LABELS: Record<string, string> = {
  awaiting_seller_response: "Awaiting Seller Response",
  awaiting_buyer_response: "Counteroffer Received",
  payment_pending: "Payment Pending",
  payment_under_review: "Payment Under Review",
  payment_verified: "Payment Verified",
  transfer_pending: "Transfer Pending",
  completed: "Completed",
  declined: "Declined",
  expired: "Expired — Payment Deadline Missed",
  payment_rejected: "Payment Rejected",
  cancelled: "Cancelled",
};

function statusTone(status: string) {
  if (status === "completed") return "bg-green-100 text-green-800";
  if (status === "payment_pending" || status === "payment_rejected") return "bg-amber-100 text-amber-800";
  if (status === "payment_under_review" || status === "payment_verified" || status === "transfer_pending") return "bg-blue-100 text-blue-800";
  if (status === "declined" || status === "expired" || status === "cancelled") return "bg-slate-100 text-slate-600";
  return "bg-violet-100 text-violet-800";
}

export function UnlistedLandMarketplace() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { formatCurrency, convertAmount } = useCurrency();
  const [selectedProperty, setSelectedProperty] = useState<LandAsset | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<OwnerPosition | null>(null);
  const [offerAllOwners, setOfferAllOwners] = useState(false);
  const [offerDialogOpen, setOfferDialogOpen] = useState(false);
  const [offerUnits, setOfferUnits] = useState("");
  const [offerPrice, setOfferPrice] = useState("");
  const [counterOffer, setCounterOffer] = useState<{ offer: Offer; units: string; price: string } | null>(null);
  const [paymentOffer, setPaymentOffer] = useState<Offer | null>(null);
  const [bankReference, setBankReference] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [now, setNow] = useState(Date.now());
  const [expandedOfferId, setExpandedOfferId] = useState<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const { data: land = [], isLoading: landLoading, error: landError } = useQuery<LandAsset[]>({
    queryKey: ["/api/marketplace/unlisted-land"],
    queryFn: () => requestJson("/api/marketplace/unlisted-land"),
  });

  const { data: owners = [], isLoading: ownersLoading } = useQuery<OwnerPosition[]>({
    queryKey: ["/api/marketplace/unlisted-land", selectedProperty?.id, "owners"],
    queryFn: () => requestJson(`/api/marketplace/unlisted-land/${selectedProperty!.id}/owners`),
    enabled: !!selectedProperty,
  });

  const { data: offers = [], isLoading: offersLoading } = useQuery<Offer[]>({
    queryKey: ["/api/marketplace/offers/mine"],
    queryFn: () => requestJson("/api/marketplace/offers/mine"),
  });

  useEffect(() => {
    const requestedId = Number(new URLSearchParams(window.location.search).get("offer"));
    if (!Number.isSafeInteger(requestedId) || requestedId <= 0 || !offers.some((offer) => offer.id === requestedId)) return;
    setExpandedOfferId(requestedId);
    window.setTimeout(() => document.getElementById(`marketplace-offer-${requestedId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  }, [offers]);

  const { data: notifications = [] } = useQuery<any[]>({
    queryKey: ["/api/marketplace/notifications/mine"],
    queryFn: () => requestJson("/api/marketplace/notifications/mine"),
    refetchInterval: 60_000,
  });

  const { data: paymentInstructions, isLoading: instructionsLoading } = useQuery<any>({
    queryKey: ["/api/marketplace/offers", paymentOffer?.id, "payment-instructions"],
    queryFn: () => requestJson(`/api/marketplace/offers/${paymentOffer!.id}/payment-instructions`),
    enabled: !!paymentOffer,
    retry: false,
  });

  const offerMutation = useMutation({
    mutationFn: (payload: { positionToken: string; units: string; purchasePrice: string }) =>
      requestJson("/api/marketplace/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: async (result: any) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/marketplace/unlisted-land"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marketplace/offers/mine"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marketplace/notifications/mine"] }),
      ]);
      toast({ title: "Offer submitted", description: `${result.reference} is awaiting the seller's response. No payment timer has started.` });
      setOfferDialogOpen(false);
      setOfferUnits("");
      setOfferPrice("");
    },
    onError: (error: Error) => toast({ title: "Offer not submitted", description: error.message, variant: "destructive" }),
  });

  const broadcastOfferMutation = useMutation({
    mutationFn: (payload: { propertyId: number; units: string; purchasePrice: string }) =>
      requestJson("/api/marketplace/offers/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: async (result: any) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/marketplace/unlisted-land"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marketplace/offers/mine"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marketplace/notifications/mine"] }),
      ]);
      const deliverySummary = !result.allSellerAlertsDeliveredOrQueued
        ? `${result.sellerAlertRecoveryFailures} seller alert${result.sellerAlertRecoveryFailures === 1 ? "" : "s"} could not be delivered or queued for retry.`
        : result.sellerAlertsQueuedForRetry > 0
          ? `${result.sellerAlertsQueuedForRetry} seller alert${result.sellerAlertsQueuedForRetry === 1 ? "" : "s"} could not send immediately and ${result.sellerAlertsQueuedForRetry === 1 ? "was" : "were"} queued for retry.`
          : "Seller alerts were sent.";
      toast({
        title: result.allSellerAlertsDeliveredOrQueued ? "Offers sent to eligible owners" : "Offers sent with an alert issue",
        description: `${result.sentCount} separate offer${result.sentCount === 1 ? "" : "s"} sent. ${result.skippedCount} position${result.skippedCount === 1 ? " was" : "s were"} skipped. ${deliverySummary}`,
      });
      setOfferDialogOpen(false);
      setSelectedProperty(null);
      setSelectedPosition(null);
      setOfferAllOwners(false);
      setOfferUnits("");
      setOfferPrice("");
    },
    onError: (error: Error) => toast({ title: "Offers not sent", description: error.message, variant: "destructive" }),
  });

  const responseMutation = useMutation({
    mutationFn: ({ id, action, units, purchasePrice }: { id: number; action: string; units?: string; purchasePrice?: string }) =>
      requestJson(`/api/marketplace/offers/${id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, units, purchasePrice }),
      }),
    onSuccess: async (result: any) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/marketplace/offers/mine"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marketplace/notifications/mine"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marketplace/unlisted-land"] }),
      ]);
      toast({
        title: result.status === "payment_pending" ? "Offer accepted" : result.status === "declined" ? "Offer declined" : "Counteroffer sent",
        description: result.status === "payment_pending" ? "The buyer now has one hour to submit payment proof." : undefined,
      });
      setCounterOffer(null);
    },
    onError: (error: Error) => toast({ title: "Offer response failed", description: error.message, variant: "destructive" }),
  });

  const receiptMutation = useMutation({
    mutationFn: async () => {
      if (!paymentOffer || !receipt) throw new Error("Choose your payment receipt first");
      const formData = new FormData();
      formData.append("bankReference", bankReference);
      formData.append("paymentProof", receipt);
      const response = await fetch(`/api/marketplace/offers/${paymentOffer.id}/payment`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Receipt upload failed");
      return data;
    },
    onSuccess: async (result: any) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/marketplace/offers/mine"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marketplace/notifications/mine"] }),
      ]);
      toast({ title: "Payment proof submitted", description: result.message });
      setPaymentOffer(null);
      setBankReference("");
      setReceipt(null);
    },
    onError: (error: Error) => toast({ title: "Receipt not submitted", description: error.message, variant: "destructive" }),
  });

  const markReadMutation = useMutation({
    mutationFn: (id: number) => requestJson(`/api/marketplace/notifications/${id}/read`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/marketplace/notifications/mine"] }),
  });

  const preview = useMemo(() => {
    const price = Number(offerPrice);
    if (!Number.isFinite(price) || price <= 0) return null;
    const fee = Math.round(price * 0.02 * 100) / 100;
    return { price, fee, total: price + fee };
  }, [offerPrice]);

  const submitOffer = () => {
    if (!offerUnits || !offerPrice) return;
    if (offerAllOwners && selectedProperty) {
      broadcastOfferMutation.mutate({
        propertyId: selectedProperty.id,
        units: offerUnits,
        purchasePrice: offerPrice,
      });
      return;
    }
    if (!selectedPosition) return;
    offerMutation.mutate({ positionToken: selectedPosition.positionToken, units: offerUnits, purchasePrice: offerPrice });
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: "Copied", description: "Copied to clipboard." });
    } catch {
      toast({ title: "Could not copy", description: "Select and copy the text manually.", variant: "destructive" });
    }
  };

  const amount = (value: string | number, currency: string) =>
    formatCurrency(convertAmount(Number(value), currency || "NGN"));
  const offerCurrency = selectedPosition?.currency || selectedProperty?.currency || "NGN";
  const maxBroadcastUnits = Math.max(
    0,
    ...owners
      .filter((position) => !position.isOwn && (position.currency || "NGN") === offerCurrency)
      .map((position) => Number(position.availableToReceiveOffers) || 0),
  );
  const broadcastRecipientCount = owners.filter(
    (position) =>
      !position.isOwn &&
      Number(position.availableToReceiveOffers) >= Number(offerUnits) &&
      (position.currency || "NGN") === offerCurrency,
  ).length;
  const offerStep = selectedPosition?.unitPrecision || selectedProperty?.unitPrecision || "1.00";
  const offerMaxUnits = offerAllOwners ? maxBroadcastUnits : selectedPosition?.availableToReceiveOffers;

  return (
    <div className="space-y-8">
      <Card className="border-blue-200 bg-blue-50/60">
        <CardContent className="flex items-start gap-3 p-4 sm:p-5">
          <HandCoins className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
          <p className="text-sm leading-6 text-blue-950">
            Explore existing land holdings and submit purchase offers directly to owners, even when their land is not listed for sale.
          </p>
        </CardContent>
      </Card>

      <section aria-labelledby="unlisted-land-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="unlisted-land-heading" className="text-xl font-bold text-slate-900">Unlisted Land</h2>
            <p className="mt-1 text-sm text-slate-600">Owner identities stay private. Available quantities exclude listed and reserved units.</p>
          </div>
        </div>
        {landError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">Unlisted holdings could not be loaded. Refresh the page to try again.</p>}
        {landLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((key) => <div key={key} className="h-64 animate-pulse rounded-xl bg-slate-100" />)}</div>
        ) : land.length === 0 ? (
          <Card><CardContent className="p-10 text-center text-sm text-slate-600">No transferable unlisted holdings are currently available to receive offers.</CardContent></Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {land.map((asset) => (
              <Card key={asset.id} className="overflow-hidden border-slate-200">
                {asset.imageUrl && <img src={asset.imageUrl} alt="" className="h-40 w-full object-cover" />}
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">{asset.name}</CardTitle>
                  <p className="flex items-center gap-1.5 text-sm text-slate-500"><MapPin className="h-4 w-4" />{asset.location}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="line-clamp-2 text-sm text-slate-600">{readablePropertyDescription(asset.description)}</p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-md bg-slate-50 p-2.5">
                      <p className="text-xs text-slate-500">Total land area</p>
                      <p className="font-semibold">{asset.totalLandArea ? `${Number(asset.totalLandArea).toLocaleString()} sqm` : "Not listed"}</p>
                    </div>
                    <div className="rounded-md bg-slate-50 p-2.5">
                      <p className="text-xs text-slate-500">Available to offer on</p>
                      <p className="font-semibold">{landQuantityLabel(asset.availableUnits, asset.availableAreaSqm, asset.sqmPerUnit)}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{asset.ownerCount} current owner position{asset.ownerCount === 1 ? "" : "s"}</span>
                    <span>Min step: {displayNumber(asset.unitPrecision)} units ({displayNumber(Number(asset.unitPrecision) * asset.sqmPerUnit)} sqm)</span>
                  </div>
                  <Button className="w-full" variant="outline" onClick={() => setSelectedProperty(asset)}>
                    View anonymous owner positions
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="my-marketplace-offers" className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 id="my-marketplace-offers" className="text-xl font-bold text-slate-900">My Offers & Transactions</h2>
            <p className="mt-1 text-sm text-slate-600">Offers, negotiation history, payment deadlines, and transfer progress.</p>
          </div>
          {offers.some((offer) => offer.status === "awaiting_buyer_response" || offer.status === "awaiting_seller_response") && (
            <Badge variant="outline">{offers.filter((offer) => offer.status === "awaiting_buyer_response" || offer.status === "awaiting_seller_response").length} awaiting response</Badge>
          )}
        </div>
        {offersLoading ? (
          <p className="py-6 text-center text-sm text-slate-500">Loading your transactions…</p>
        ) : offers.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-sm text-slate-600">Your unlisted-land offers and completed transactions will appear here.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {offers.map((offer) => {
              const countdown = formatDeadline(offer.paymentDeadline, now);
              const isMyTurn = offer.role === "seller"
                ? offer.status === "awaiting_seller_response"
                : offer.status === "awaiting_buyer_response";
              return (
                <Card key={offer.id} id={`marketplace-offer-${offer.id}`} className="overflow-hidden">
                  <CardContent className="space-y-4 p-4 sm:p-5">
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-slate-900">{offer.propertyName}</h3>
                          <Badge className={statusTone(offer.status)}>{STATUS_LABELS[offer.status] || offer.status}</Badge>
                          <Badge variant="outline">{offer.role === "buyer" ? "Buyer" : "Seller"}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">Ref {offer.reference} · {offer.propertyLocation}</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => setExpandedOfferId(expandedOfferId === offer.id ? null : offer.id)}>
                        {expandedOfferId === offer.id ? "Hide history" : "View history"}
                      </Button>
                    </div>

                    <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <div className="rounded-md bg-slate-50 p-2.5"><p className="text-xs text-slate-500">Quantity</p><p className="font-medium">{landQuantityLabel(offer.units, offer.quantitySqm, offer.sqmPerUnit)}</p></div>
                      <div className="rounded-md bg-slate-50 p-2.5"><p className="text-xs text-slate-500">Land price</p><p className="font-medium">{amount(offer.purchasePrice, offer.currency)}</p></div>
                      <div className="rounded-md bg-slate-50 p-2.5"><p className="text-xs text-slate-500">Brikvest fee (2%)</p><p className="font-medium">{amount(offer.transactionFee, offer.currency)}</p></div>
                      <div className="rounded-md bg-blue-50 p-2.5"><p className="text-xs text-blue-700">Total buyer payment</p><p className="font-semibold text-blue-900">{amount(offer.totalPayment, offer.currency)}</p></div>
                    </div>

                    {offer.status === "payment_pending" && countdown && (
                      <div className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm ${countdown.expired ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                        <span className="flex items-center gap-2"><Clock3 className="h-4 w-4" />{countdown.expired ? "Payment deadline passed" : "Time remaining to submit payment proof"}</span>
                        {!countdown.expired && <strong aria-live="off" className="font-mono text-base">{countdown.text}</strong>}
                      </div>
                    )}
                    {offer.status === "payment_rejected" && offer.rejectionReason && (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><strong>Payment issue:</strong> {offer.rejectionReason}</div>
                    )}
                    {offer.status === "payment_under_review" && (
                      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">Receipt received. Brikvest must verify the full amount before ownership can be transferred.</div>
                    )}
                    {offer.status === "payment_verified" && (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">Funds are verified. Transfer is pending the buyer's approved KYC and administrator authorization.</div>
                    )}
                    {offer.status === "expired" && (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">The reserved quantity has been released. Submit a new offer if you still want to proceed.</div>
                    )}

                    {isMyTurn && (
                      <div className="flex flex-wrap gap-2 border-t pt-3">
                        <Button size="sm" onClick={() => responseMutation.mutate({ id: offer.id, action: "accept" })} disabled={responseMutation.isPending}>
                          <CheckCircle2 className="mr-1.5 h-4 w-4" />Accept terms
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setCounterOffer({ offer, units: offer.units, price: offer.purchasePrice })}>
                          <Plus className="mr-1.5 h-4 w-4" />Counteroffer
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => responseMutation.mutate({ id: offer.id, action: "decline" })} disabled={responseMutation.isPending}>
                          <XCircle className="mr-1.5 h-4 w-4" />Decline
                        </Button>
                      </div>
                    )}

                    {offer.role === "buyer" && ["payment_pending", "payment_rejected"].includes(offer.status) && countdown && !countdown.expired && (
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                        <p className="text-xs text-slate-500">Your payment includes the land price plus Brikvest's 2% fee. Receipt submission does not approve payment.</p>
                        <Button size="sm" onClick={() => setPaymentOffer(offer)}><FileText className="mr-1.5 h-4 w-4" />Upload payment proof</Button>
                      </div>
                    )}

                    {offer.role === "buyer" && ["payment_under_review", "payment_verified"].includes(offer.status) && (user as any)?.kycStatus !== "approved" && (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                        <span><strong>KYC Verification Required – Ownership Transfer Pending.</strong> Your payment deadline is not extended. Complete KYC from your account dashboard before transfer approval.</span>
                      </div>
                    )}

                    {expandedOfferId === offer.id && (
                      <div className="space-y-3 border-t pt-3">
                        <h4 className="text-sm font-semibold text-slate-800">Negotiation & audit history</h4>
                        {offer.events.length === 0 ? <p className="text-xs text-slate-500">No history is available.</p> : (
                          <ol className="space-y-2">
                            {offer.events.map((event) => (
                              <li key={event.id} className="rounded-md border border-slate-100 bg-slate-50 p-3 text-xs">
                                <div className="flex flex-wrap justify-between gap-2">
                                  <span className="font-medium text-slate-800">{event.action.replaceAll("_", " ")} · {event.actor}</span>
                                  <time className="text-slate-500">{new Date(event.createdAt).toLocaleString()}</time>
                                </div>
                                <p className="mt-1 text-slate-600">{event.details}</p>
                                <p className="mt-1 text-slate-500">{landQuantityLabel(event.units, event.quantitySqm, offer.sqmPerUnit)} · price {amount(event.purchasePrice, offer.currency)} · fee {amount(event.transactionFee, offer.currency)} · total {amount(event.totalPayment, offer.currency)}</p>
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="marketplace-notifications" className="space-y-3">
        <h2 id="marketplace-notifications" className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Bell className="h-5 w-5" />Marketplace notifications</h2>
        {notifications.length === 0 ? <p className="text-sm text-slate-500">No marketplace notifications yet.</p> : (
          <div className="space-y-2">
            {notifications.slice(0, 5).map((notification: any) => (
              <button
                key={notification.id}
                type="button"
                onClick={() => !notification.readAt && markReadMutation.mutate(notification.id)}
                className={`w-full rounded-lg border p-3 text-left ${notification.readAt ? "border-slate-200 bg-white" : "border-blue-200 bg-blue-50"}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <strong className="text-sm text-slate-900">{notification.title}</strong>
                  <time className="text-xs text-slate-500">{new Date(notification.createdAt).toLocaleDateString()}</time>
                </span>
                <span className="mt-1 block text-sm text-slate-600">{notification.message}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <Dialog open={!!selectedProperty} onOpenChange={(open) => { if (!open) { setSelectedProperty(null); setSelectedPosition(null); } }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedProperty?.name} — Anonymous Owners</DialogTitle>
            <DialogDescription>{selectedProperty?.location}. Owner identities are hidden from other users.</DialogDescription>
          </DialogHeader>
          {ownersLoading ? <p className="py-6 text-center text-sm text-slate-500">Loading available owner positions…</p> : (
            <div className="space-y-3">
              {owners.some((position) => !position.isOwn && Number(position.availableToReceiveOffers) > 0 && (position.currency || "NGN") === (selectedProperty?.currency || "NGN")) && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-blue-950">Send one offer to every eligible owner. Each owner responds independently.</p>
                    <Button
                      size="sm"
                      onClick={() => {
                        setOfferAllOwners(true);
                        setSelectedPosition(null);
                        setOfferUnits("");
                        setOfferPrice("");
                        setOfferDialogOpen(true);
                      }}
                    >
                      <Send className="mr-1.5 h-4 w-4" />Send to all owners
                    </Button>
                  </div>
                </div>
              )}
              {owners.map((position) => (
                <div key={position.positionToken} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-slate-900">{position.ownerReference}</p>
                    <p className="mt-1 text-sm text-slate-600">Total ownership: {landQuantityLabel(position.totalOwned, position.totalOwnedSqm, position.sqmPerUnit)}</p>
                    <p className="text-sm text-slate-600">Available to receive offers: {landQuantityLabel(position.availableToReceiveOffers, position.availableToReceiveOffersSqm, position.sqmPerUnit)}</p>
                  </div>
                  {position.isOwn ? (
                    <Badge variant="outline">Your holding</Badge>
                  ) : (
                    <Button
                      size="sm"
                      disabled={Number(position.availableToReceiveOffers) <= 0}
                      onClick={() => {
                        setOfferAllOwners(false);
                        setSelectedPosition(position);
                        setOfferUnits("");
                        setOfferPrice("");
                        setOfferDialogOpen(true);
                      }}
                    >
                      Make an Offer
                    </Button>
                  )}
                </div>
              ))}
              {owners.length === 0 && <p className="py-5 text-center text-sm text-slate-500">No eligible owner positions are available.</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={offerDialogOpen} onOpenChange={setOfferDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{offerAllOwners ? "Send an Offer to All Owners" : "Make an Offer"}</DialogTitle>
            <DialogDescription>
              {offerAllOwners
                ? `${selectedProperty?.name}. The same terms will be sent as separate offers to eligible anonymous owners.`
                : `${selectedProperty?.name} · ${selectedPosition?.ownerReference}. The seller sees your offer without receiving your personal contact details.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              {offerAllOwners ? (
                <p>Eligible positions for this quantity: <strong>{broadcastRecipientCount}</strong></p>
              ) : (
                <p>Available position: <strong>{selectedPosition && landQuantityLabel(selectedPosition.availableToReceiveOffers, selectedPosition.availableToReceiveOffersSqm, selectedPosition.sqmPerUnit)}</strong></p>
              )}
              <p className="mt-1 text-slate-500">Each unit represents 5 sqm. No payment timer starts until both parties accept the same terms.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="offer-quantity">Quantity (5 sqm units)</Label>
              <Input id="offer-quantity" type="number" min={offerStep} step={offerStep} max={offerMaxUnits} value={offerUnits} onChange={(event) => setOfferUnits(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="offer-price">{offerAllOwners ? "Total purchase price per owner" : "Proposed total purchase price"} ({offerCurrency})</Label>
              <Input id="offer-price" type="number" min="0.01" step="0.01" value={offerPrice} onChange={(event) => setOfferPrice(event.target.value)} />
            </div>
            {preview && (
              <div className="space-y-1 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm">
                <div className="flex justify-between"><span>Purchase price</span><strong>{amount(preview.price, offerCurrency)}</strong></div>
                <div className="flex justify-between"><span>Brikvest fee (2%)</span><strong>{amount(preview.fee, offerCurrency)}</strong></div>
                <div className="flex justify-between border-t border-blue-200 pt-1 font-semibold"><span>Total buyer payment per owner</span><strong>{amount(preview.total, offerCurrency)}</strong></div>
              </div>
            )}
            {offerAllOwners && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                <p>Each owner receives a separate offer. If several owners accept, each accepted offer is a separate purchase with its own one-hour payment window.</p>
                {preview && broadcastRecipientCount > 0 && (
                  <p className="mt-2 font-medium">If all {broadcastRecipientCount} eligible owners accept, the total payment could be {amount(preview.total * broadcastRecipientCount, offerCurrency)}.</p>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOfferDialogOpen(false)}>Cancel</Button>
              <Button onClick={submitOffer} disabled={offerMutation.isPending || broadcastOfferMutation.isPending || !offerUnits || !offerPrice || (offerAllOwners && broadcastRecipientCount === 0)}>
                <Send className="mr-1.5 h-4 w-4" />{offerMutation.isPending || broadcastOfferMutation.isPending ? "Submitting…" : offerAllOwners ? "Send Offers" : "Review & Submit"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!counterOffer} onOpenChange={(open) => { if (!open) setCounterOffer(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Submit a Counteroffer</DialogTitle>
            <DialogDescription>{counterOffer?.offer.propertyName} · Reference {counterOffer?.offer.reference}</DialogDescription>
          </DialogHeader>
          {counterOffer && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Quantity (5 sqm units)</Label>
                <Input type="number" min={counterOffer.offer.unitPrecision} step={counterOffer.offer.unitPrecision} value={counterOffer.units} onChange={(event) => setCounterOffer({ ...counterOffer, units: event.target.value })} />
                <p className="text-xs text-slate-500">Current quantity: {landQuantityLabel(counterOffer.offer.units, counterOffer.offer.quantitySqm, counterOffer.offer.sqmPerUnit)}</p>
              </div>
              <div className="space-y-2"><Label>Total purchase price ({counterOffer.offer.currency})</Label><Input type="number" min="0.01" step="0.01" value={counterOffer.price} onChange={(event) => setCounterOffer({ ...counterOffer, price: event.target.value })} /></div>
              {Number(counterOffer.price) > 0 && (
                <div className="rounded-lg bg-blue-50 p-3 text-sm">
                  <p>Brikvest fee (2%): <strong>{amount(Number(counterOffer.price) * 0.02, counterOffer.offer.currency)}</strong></p>
                  <p>Total buyer payment: <strong>{amount(Number(counterOffer.price) * 1.02, counterOffer.offer.currency)}</strong></p>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setCounterOffer(null)}>Cancel</Button>
                <Button disabled={responseMutation.isPending || !counterOffer.units || !counterOffer.price} onClick={() => responseMutation.mutate({ id: counterOffer.offer.id, action: "counter", units: counterOffer.units, purchasePrice: counterOffer.price })}>Send Counteroffer</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!paymentOffer} onOpenChange={(open) => { if (!open) setPaymentOffer(null); }}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pay Brikvest and upload proof</DialogTitle>
            <DialogDescription>Transfer the complete amount to Brikvest. Uploading proof does not approve payment or transfer ownership.</DialogDescription>
          </DialogHeader>
          {paymentOffer && (
            <div className="space-y-4">
              {instructionsLoading ? <p className="text-sm text-slate-500">Loading payment details…</p> : paymentInstructions ? (
                <>
                  <div className="space-y-2 rounded-lg border bg-slate-50 p-3 text-sm">
                    <div className="flex justify-between"><span>Land purchase price</span><strong>{amount(paymentInstructions.purchasePrice, paymentOffer.currency)}</strong></div>
                    <div className="flex justify-between"><span>Brikvest fee (2%)</span><strong>{amount(paymentInstructions.transactionFee, paymentOffer.currency)}</strong></div>
                    <div className="flex justify-between border-t pt-2 font-semibold"><span>Total to transfer</span><strong>{amount(paymentInstructions.totalPayment, paymentOffer.currency)}</strong></div>
                    <p className="pt-1 text-xs text-slate-500">Reference: <span className="font-mono">{paymentInstructions.paymentReference}</span></p>
                    <p className="text-xs text-slate-500">Deadline: {new Date(paymentInstructions.paymentDeadline).toLocaleString()}</p>
                  </div>
                  <div className="space-y-2 rounded-lg border p-3">
                    <p className="font-medium text-slate-900">{paymentInstructions.method?.title || "Brikvest bank details"}</p>
                    {paymentInstructions.method?.details?.map((detail: any) => (
                      <div key={`${detail.label}-${detail.value}`} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-slate-500">{detail.label}</span>
                        <span className="text-right font-medium">{detail.value}</span>
                        <Button size="icon" variant="ghost" aria-label={`Copy ${detail.label}`} onClick={() => copy(detail.value)}><Copy className="h-4 w-4" /></Button>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertCircle className="mr-2 inline h-4 w-4" />Payment instructions are unavailable. The payment deadline may have passed.</div>
              )}

              {(user as any)?.kycStatus !== "approved" && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <strong>KYC Verification Required – Ownership Transfer Pending.</strong> You may submit proof before KYC is approved. KYC processing does not extend the one-hour payment deadline.
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="offer-bank-reference">Bank transfer reference</Label>
                <Input id="offer-bank-reference" value={bankReference} onChange={(event) => setBankReference(event.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="offer-receipt">Payment receipt (JPEG, PNG, WEBP, or PDF; max 10MB)</Label>
                <Input id="offer-receipt" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" onChange={(event) => setReceipt(event.target.files?.[0] || null)} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setPaymentOffer(null)}>Close</Button>
                <Button onClick={() => receiptMutation.mutate()} disabled={receiptMutation.isPending || !receipt || !bankReference.trim() || !paymentInstructions}>
                  {receiptMutation.isPending ? "Uploading…" : "Submit proof"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}