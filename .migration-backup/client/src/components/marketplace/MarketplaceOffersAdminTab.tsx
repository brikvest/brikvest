import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle, Clock3, Download, FileText, ShieldCheck, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type AdminTabProps = {
  authenticatedRequest: (url: string, options?: any) => Promise<any>;
};

function displayStatus(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function quantityLabel(units: number | string, areaSqm: number | string, sqmPerUnit = 5) {
  const count = Number(units) || 0;
  const area = Number(areaSqm) || count * sqmPerUnit;
  const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return `${format(area)} sqm (${format(count)} ${count === 1 ? "unit" : "units"})`;
}

export function MarketplaceOffersAdminTab({ authenticatedRequest }: AdminTabProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [reviewInput, setReviewInput] = useState<Record<number, { amount: string; reason: string }>>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: offers = [], isLoading, error } = useQuery<any[]>({
    queryKey: ["/api/admin/marketplace-offers"],
    queryFn: () => authenticatedRequest("/api/admin/marketplace-offers"),
    refetchInterval: 60_000,
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, action }: { id: number; action: "approve" | "reject" }) => {
      const values = reviewInput[id] || { amount: "", reason: "" };
      return authenticatedRequest(`/api/admin/marketplace-offers/${id}/review-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          amountReceived: values.amount,
          rejectionReason: values.reason,
        }),
      });
    },
    onSuccess: async (result: any) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/admin/marketplace-offers"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marketplace/offers/mine"] }),
      ]);
      toast({ title: "Payment review saved", description: result?.message });
    },
    onError: (error: Error) => toast({ title: "Review failed", description: error.message, variant: "destructive" }),
  });

  const transferMutation = useMutation({
    mutationFn: (id: number) => authenticatedRequest(`/api/admin/marketplace-offers/${id}/complete-transfer`, { method: "POST" }),
    onSuccess: async (result: any) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/admin/marketplace-offers"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marketplace/offers/mine"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/marketplace/unlisted-land"] }),
      ]);
      toast({ title: "Ownership transfer processed", description: result?.message });
    },
    onError: (error: Error) => toast({ title: "Transfer blocked", description: error.message, variant: "destructive" }),
  });

  const openReceipt = async (offerId: number) => {
    const sessionId = localStorage.getItem("admin_session_id");
    const response = await fetch(`/api/admin/marketplace-offers/${offerId}/receipt`, {
      headers: { Authorization: `Bearer ${sessionId || ""}` },
    });
    if (!response.ok) {
      toast({ title: "Receipt unavailable", description: "The receipt could not be opened.", variant: "destructive" });
      return;
    }
    const blobUrl = URL.createObjectURL(await response.blob());
    window.open(blobUrl, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  };

  if (isLoading) return <p className="py-12 text-center text-slate-500">Loading direct marketplace offers…</p>;
  if (error) return <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">Could not load marketplace offers. Refresh to retry.</p>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Direct Offers & Transfers</h2>
        <p className="mt-1 text-sm text-slate-600">Review anonymous-owner negotiations, confirm funds received, check KYC, and authorize transfers.</p>
      </div>
      {offers.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-slate-600">No unlisted-land offers have been submitted.</CardContent></Card>
      ) : offers.map((offer: any) => (
        <Card key={offer.id} className="overflow-hidden">
          <CardContent className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-slate-900">{offer.propertyName}</h3>
                  <Badge variant="outline">{displayStatus(offer.status)}</Badge>
                  <Badge variant="outline">{offer.reference}</Badge>
                </div>
                <p className="mt-1 text-xs text-slate-500">{offer.propertyLocation} · Last updated {new Date(offer.updatedAt).toLocaleString()}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setExpandedId(expandedId === offer.id ? null : offer.id)}>
                {expandedId === offer.id ? "Hide history" : "View history"}
              </Button>
            </div>

            <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-md bg-slate-50 p-3"><p className="text-xs text-slate-500">Buyer</p><p className="font-medium">{offer.buyerName}</p><p className="text-xs text-slate-500">{offer.buyerEmail}</p></div>
              <div className="rounded-md bg-slate-50 p-3"><p className="text-xs text-slate-500">Seller</p><p className="font-medium">{offer.sellerName}</p><p className="text-xs text-slate-500">{offer.sellerEmail}</p></div>
              <div className="rounded-md bg-slate-50 p-3"><p className="text-xs text-slate-500">Buyer KYC</p><p className="font-medium">{offer.buyerKycStatus}</p></div>
              <div className="rounded-md bg-slate-50 p-3"><p className="text-xs text-slate-500">Quantity</p><p className="font-medium">{quantityLabel(offer.units, offer.quantitySqm, offer.sqmPerUnit)}</p></div>
              <div className="rounded-md border border-slate-200 p-3"><p className="text-xs text-slate-500">Land purchase price</p><p className="font-semibold">{offer.currency} {Number(offer.purchasePrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></div>
              <div className="rounded-md border border-slate-200 p-3"><p className="text-xs text-slate-500">Brikvest fee (2%)</p><p className="font-semibold">{offer.currency} {Number(offer.transactionFee).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></div>
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3"><p className="text-xs text-blue-700">Total expected</p><p className="font-semibold text-blue-900">{offer.currency} {Number(offer.totalPayment).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p></div>
              {offer.paymentDeadline && <div className="rounded-md bg-amber-50 p-3"><p className="flex items-center gap-1 text-xs text-amber-700"><Clock3 className="h-3.5 w-3.5" /> Payment deadline</p><p className="font-medium text-amber-900">{new Date(offer.paymentDeadline).toLocaleString()}</p></div>}
            </div>

            {offer.bankReference && <p className="text-sm"><span className="text-slate-500">Bank transfer reference:</span> <span className="font-mono font-medium">{offer.bankReference}</span></p>}
            {offer.proofUrl && (
              <Button size="sm" variant="outline" onClick={() => void openReceipt(offer.id)}>
                <Download className="mr-1.5 h-4 w-4" />Open private payment receipt
              </Button>
            )}
            {offer.status === "payment_under_review" && (
              <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="flex items-start gap-2 text-sm text-amber-950"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Verify the actual funds received in Brikvest's bank account. Do not approve based only on the uploaded receipt.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1"><Label htmlFor={`received-${offer.id}`}>Actual amount received ({offer.currency})</Label><Input id={`received-${offer.id}`} inputMode="decimal" value={reviewInput[offer.id]?.amount ?? ""} onChange={(event) => setReviewInput({ ...reviewInput, [offer.id]: { amount: event.target.value, reason: reviewInput[offer.id]?.reason || "" } })} placeholder={`Expected ${offer.totalPayment}`} /></div>
                  <div className="space-y-1"><Label htmlFor={`reason-${offer.id}`}>Rejection reason (if rejecting)</Label><Textarea id={`reason-${offer.id}`} rows={2} value={reviewInput[offer.id]?.reason ?? ""} onChange={(event) => setReviewInput({ ...reviewInput, [offer.id]: { amount: reviewInput[offer.id]?.amount || "", reason: event.target.value } })} /></div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={reviewMutation.isPending || !reviewInput[offer.id]?.amount} onClick={() => reviewMutation.mutate({ id: offer.id, action: "approve" })}>
                    <CheckCircle className="mr-1.5 h-4 w-4" />Verify exact amount received
                  </Button>
                  <Button size="sm" variant="destructive" disabled={reviewMutation.isPending || !reviewInput[offer.id]?.reason?.trim()} onClick={() => reviewMutation.mutate({ id: offer.id, action: "reject" })}>
                    <XCircle className="mr-1.5 h-4 w-4" />Reject proof
                  </Button>
                </div>
              </div>
            )}
            {offer.status === "payment_verified" && (
              <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <p className="flex items-start gap-2 text-sm text-emerald-950">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                  {offer.buyerKycStatus === "approved"
                    ? "Payment is verified and buyer KYC is approved. The transfer below will atomically update both portfolios and certificates."
                    : `Payment is verified, but buyer KYC is ${offer.buyerKycStatus}. Do not transfer until KYC is approved.`}
                </p>
                <Button size="sm" disabled={transferMutation.isPending || offer.buyerKycStatus !== "approved"} onClick={() => transferMutation.mutate(offer.id)}>
                  <CheckCircle className="mr-1.5 h-4 w-4" />{transferMutation.isPending ? "Transferring…" : "Authorize ownership transfer"}
                </Button>
              </div>
            )}
            {offer.status === "completed" && (
              <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">Transfer completed {offer.transferCompletedAt ? new Date(offer.transferCompletedAt).toLocaleString() : ""}. Transfer reference: {offer.reference}.</p>
            )}
            {expandedId === offer.id && (
              <div className="space-y-2 border-t pt-3">
                <h4 className="text-sm font-semibold">Complete offer and audit history</h4>
                {offer.events?.length ? offer.events.map((event: any) => (
                  <div key={event.id} className="rounded-md bg-slate-50 p-3 text-xs">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-medium">{event.action.replaceAll("_", " ")} · {event.actorType}{event.actorId ? ` #${event.actorId}` : ""}</span>
                      <time>{new Date(event.createdAt).toLocaleString()}</time>
                    </div>
                    <p className="mt-1 text-slate-600">{event.details}</p>
                    <p className="mt-1 text-slate-500">{quantityLabel(event.units, event.quantitySqm, offer.sqmPerUnit)} · price {offer.currency} {event.purchasePrice} · fee {offer.currency} {event.transactionFee} · total {offer.currency} {event.totalPayment}</p>
                  </div>
                )) : <p className="text-xs text-slate-500">No event history.</p>}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}