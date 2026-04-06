import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Building2, Tag, Gavel, ArrowLeft, Clock, Users, DollarSign, MapPin, CheckCircle, Upload, CreditCard, Copy, Banknote, XCircle, Loader2, TrendingUp, FileText, Download, Eye } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useState, useEffect, useRef } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useCurrency } from "@/hooks/useCurrency";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import brikvest_logo from "@/assets/brikvest-logo.png";

const paymentMethods: Record<string, any> = {
  NGN: {
    title: "Naira Transfer (Nigeria)",
    icon: "₦",
    details: [
      { label: "Bank Name", value: "Zenith Bank" },
      { label: "Account Name", value: "Brikvest Limited" },
      { label: "Account Number", value: "1310320691" },
    ]
  },
  USD: {
    title: "USD Transfer (U.S. Bank / Wire)",
    icon: "$",
    details: [
      { label: "Beneficiary Name", value: "Charles Giadom" },
      { label: "Address", value: "2100 North Central Road" },
      { label: "Account Number", value: "483106622433" },
      { label: "Routing Number", value: "026009593" },
    ],
    alternative: {
      title: "Or via Zelle",
      details: [
        { label: "Name", value: "Charles Giadom" },
        { label: "Phone", value: "+1 (646) 204-4536" },
      ]
    }
  },
  GBP: {
    title: "GBP Transfer (United Kingdom)",
    icon: "£",
    details: [
      { label: "Beneficiary Name", value: "Charles Giadom" },
      { label: "Sort Code", value: "04-00-75" },
      { label: "Account Number", value: "67385923" },
      { label: "Bank / Address", value: "Revolut Ltd, 30 South Colonnade, E14 5HX, London, United Kingdom" },
    ]
  }
};

export default function Marketplace() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { formatCurrency, convertAmount } = useCurrency();
  const { toast } = useToast();
  const [selectedListing, setSelectedListing] = useState<any>(null);
  const [bidAmount, setBidAmount] = useState("");
  const [bidDialogOpen, setBidDialogOpen] = useState(false);
  const [buyDialogOpen, setBuyDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentListing, setPaymentListing] = useState<any>(null);
  const [bankReference, setBankReference] = useState("");
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [propertyDetailOpen, setPropertyDetailOpen] = useState(false);
  const [detailPropertyId, setDetailPropertyId] = useState<number | null>(null);
  const [detailListing, setDetailListing] = useState<any>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation(`/login?redirect=${encodeURIComponent('/marketplace')}`);
    }
  }, [isLoading, isAuthenticated, setLocation]);

  const { data: listings = [], isLoading: listingsLoading } = useQuery<any[]>({
    queryKey: ["/api/marketplace/listings"],
    enabled: isAuthenticated,
  });

  const { data: myBids = [] } = useQuery<any[]>({
    queryKey: ["/api/resale-bids/mine"],
    enabled: isAuthenticated,
  });

  const { data: wonListings = [] } = useQuery<any[]>({
    queryKey: ["/api/resale-listings/won"],
    enabled: isAuthenticated,
  });

  const { data: myResalePayments = [] } = useQuery<any[]>({
    queryKey: ["/api/resale-payments/mine"],
    enabled: isAuthenticated,
  });

  const { data: propertyValuations = [], isLoading: valuationsLoading } = useQuery<any[]>({
    queryKey: ["/api/properties", detailPropertyId, "valuations-public"],
    queryFn: async () => {
      const res = await fetch(`/api/properties/${detailPropertyId}/valuations-public`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!detailPropertyId && propertyDetailOpen,
  });

  const appreciationChartData = (() => {
    if (!propertyValuations.length) return [];
    const sorted = [...propertyValuations].sort(
      (a, b) => new Date(a.valuationDate).getTime() - new Date(b.valuationDate).getTime()
    );
    return sorted.map(v => ({
      date: new Date(v.valuationDate).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      value: Number(v.rawAssetValue || v.currentValue),
      appreciation: v.appreciationPercentage ? `${v.appreciationPercentage}%` : null,
    }));
  })();

  const overallAppreciation = (() => {
    if (appreciationChartData.length < 2) return null;
    const first = appreciationChartData[0].value;
    const last = appreciationChartData[appreciationChartData.length - 1].value;
    if (first === 0) return null;
    return ((last - first) / first * 100).toFixed(1);
  })();

  const { data: listingDetail, isLoading: detailLoading } = useQuery<any>({
    queryKey: ["/api/marketplace/listings", selectedListing?.id],
    queryFn: async () => {
      const res = await fetch(`/api/marketplace/listings/${selectedListing.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load listing");
      return res.json();
    },
    enabled: !!selectedListing?.id && (bidDialogOpen || buyDialogOpen),
  });

  const bidMutation = useMutation({
    mutationFn: async ({ listingId, amount }: { listingId: number; amount: string }) => {
      return apiRequest("POST", `/api/marketplace/listings/${listingId}/bid`, { amount });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/listings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/resale-bids/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/listings", selectedListing?.id] });
      toast({ title: "Bid placed!", description: "Your bid has been submitted successfully." });
      setBidDialogOpen(false);
      setBidAmount("");
    },
    onError: (error: any) => {
      toast({ title: "Bid failed", description: error?.message || "Failed to place bid", variant: "destructive" });
    },
  });

  const buyMutation = useMutation({
    mutationFn: async (listingId: number) => {
      return apiRequest("POST", `/api/marketplace/listings/${listingId}/buy`);
    },
    onSuccess: (_, listingId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/listings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/resale-listings/won"] });
      toast({ title: "Purchase initiated!", description: "Please complete payment within 48 hours." });
      setBuyDialogOpen(false);
      const listing = listings.find((l: any) => l.id === listingId);
      if (listing) {
        setPaymentListing({ ...listing, status: "awaiting_payment", winnerId: user?.id });
        setPaymentDialogOpen(true);
      }
    },
    onError: (error: any) => {
      toast({ title: "Purchase failed", description: error?.message || "Failed to buy", variant: "destructive" });
    },
  });

  const paymentMutation = useMutation({
    mutationFn: async ({ listingId, bankRef, file }: { listingId: number; bankRef: string; file: File | null }) => {
      const formData = new FormData();
      formData.append("listingId", String(listingId));
      if (bankRef) formData.append("bankReference", bankRef);
      if (file) formData.append("paymentProof", file);
      const res = await fetch("/api/resale-payments", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to submit payment");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/resale-payments/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/listings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/resale-listings/mine"] });
      toast({ title: "Payment submitted!", description: "Your payment is pending admin verification." });
      setPaymentDialogOpen(false);
      setBankReference("");
      setPaymentProofFile(null);
    },
    onError: (error: any) => {
      toast({ title: "Submission failed", description: error?.message || "Failed to submit payment", variant: "destructive" });
    },
  });

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-pulse text-slate-400">Loading...</div>
      </div>
    );
  }

  const activeBidsMap = new Map<number, any>();
  myBids.forEach((bid: any) => {
    if (bid.status === "active" && (!activeBidsMap.has(bid.listingId) || parseFloat(bid.amount) > parseFloat(activeBidsMap.get(bid.listingId).amount))) {
      activeBidsMap.set(bid.listingId, bid);
    }
  });

  const pendingPaymentListingIds = new Set(
    myResalePayments.filter((p: any) => p.status === "pending_verification").map((p: any) => p.listingId)
  );

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied!", description: `${text} copied to clipboard` });
  };

  const getPaymentAmount = (listing: any) => {
    if (listing.sellingType === "fixed_price") {
      return parseFloat(listing.askingPrice || 0);
    }
    if (listing.highestBidAmount) {
      return parseFloat(listing.highestBidAmount);
    }
    const wonBid = myBids.find((b: any) => b.listingId === listing.id && b.status === "won");
    if (wonBid) return parseFloat(wonBid.amount);
    return parseFloat(listing.askingPrice || 0);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard">
              <Button variant="ghost" size="sm" className="text-slate-600">
                <ArrowLeft className="h-4 w-4 mr-1" />
                Dashboard
              </Button>
            </Link>
            <div className="h-6 w-px bg-slate-200" />
            <img src={brikvest_logo} alt="Brikvest" className="h-7" />
            <h1 className="text-xl font-bold text-slate-900">Marketplace</h1>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">Resale Marketplace</h2>
          <p className="text-slate-600 mt-1">Browse and purchase units from existing investors</p>
        </div>

        {/* Awaiting Payment Section */}
        {(() => {
          if (wonListings.length === 0) return null;
          const filteredListings = wonListings;

          return (
            <Card className="mb-8 border-orange-200 bg-orange-50/50">
              <CardHeader className="border-b border-orange-200">
                <CardTitle className="text-lg flex items-center gap-2 text-orange-800">
                  <CreditCard className="h-5 w-5" />
                  Pending Payments ({filteredListings.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="space-y-3">
                  {filteredListings.map((listing: any) => {
                    const hasPendingPayment = pendingPaymentListingIds.has(listing.id);
                    const paymentAmount = getPaymentAmount(listing);
                    const deadline = listing.paymentDeadline ? new Date(listing.paymentDeadline) : null;
                    const isExpired = deadline && deadline < new Date();
                    const rejectedPayment = myResalePayments.find(
                      (p: any) => p.listingId === listing.id && p.status === "rejected"
                    );

                    return (
                      <div key={listing.id} className="bg-white border border-orange-200 rounded-lg p-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold text-slate-900">{listing.propertyName || `Property #${listing.propertyId}`}</p>
                            <p className="text-sm text-slate-600">
                              {listing.units} units — {formatCurrency(convertAmount(paymentAmount, listing.currency || 'NGN'))}
                            </p>
                            {deadline && !isExpired && (
                              <p className="text-xs text-orange-600 mt-1 flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                Payment due by {deadline.toLocaleDateString()} at {deadline.toLocaleTimeString()}
                              </p>
                            )}
                            {isExpired && (
                              <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                                <XCircle className="h-3 w-3" />
                                Payment deadline has passed
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {hasPendingPayment ? (
                              <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                Pending Verification
                              </Badge>
                            ) : rejectedPayment ? (
                              <div className="flex flex-col items-end gap-1">
                                <Badge className="bg-red-100 text-red-700 border-red-300">
                                  Payment Rejected
                                </Badge>
                                {rejectedPayment.rejectionReason && (
                                  <p className="text-xs text-red-600">{rejectedPayment.rejectionReason}</p>
                                )}
                                {!isExpired && (
                                  <Button
                                    size="sm"
                                    className="bg-orange-600 hover:bg-orange-700 text-white"
                                    onClick={() => {
                                      setPaymentListing(listing);
                                      setBankReference("");
                                      setPaymentProofFile(null);
                                      setPaymentDialogOpen(true);
                                    }}
                                  >
                                    <Banknote className="h-3.5 w-3.5 mr-1" />
                                    Retry Payment
                                  </Button>
                                )}
                              </div>
                            ) : !isExpired ? (
                              <Button
                                size="sm"
                                className="bg-orange-600 hover:bg-orange-700 text-white"
                                onClick={() => {
                                  setPaymentListing(listing);
                                  setBankReference("");
                                  setPaymentProofFile(null);
                                  setPaymentDialogOpen(true);
                                }}
                              >
                                <Banknote className="h-3.5 w-3.5 mr-1" />
                                Make Payment
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {listingsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => (
              <Card key={i} className="animate-pulse">
                <div className="h-48 bg-slate-200 rounded-t-lg" />
                <CardContent className="p-4 space-y-3">
                  <div className="h-5 bg-slate-200 rounded w-3/4" />
                  <div className="h-4 bg-slate-200 rounded w-1/2" />
                  <div className="h-10 bg-slate-200 rounded" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : listings.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Building2 className="h-16 w-16 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">No listings available</h3>
              <p className="text-slate-600 mb-6">Check back later for new resale opportunities</p>
              <Link href="/dashboard">
                <Button className="bg-blue-600 hover:bg-blue-700 text-white">Back to Dashboard</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {listings.map((listing: any) => {
              const myBid = activeBidsMap.get(listing.id);
              const isSeller = listing.sellerId === user?.id;

              return (
                <Card key={listing.id} className="overflow-hidden hover:shadow-lg transition-shadow duration-200">
                  <div className="h-48 bg-gradient-to-br from-blue-100 to-blue-50 relative">
                    {listing.propertyImageUrl ? (
                      <img src={listing.propertyImageUrl} alt={listing.propertyName} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Building2 className="h-16 w-16 text-blue-300" />
                      </div>
                    )}
                    <div className="absolute top-3 left-3">
                      <Badge className={listing.sellingType === "bidding" ? "bg-purple-600" : "bg-blue-600"}>
                        {listing.sellingType === "bidding" ? (
                          <><Gavel className="h-3 w-3 mr-1" /> Auction</>
                        ) : (
                          <><Tag className="h-3 w-3 mr-1" /> Fixed Price</>
                        )}
                      </Badge>
                    </div>
                    {isSeller && (
                      <div className="absolute top-3 right-3">
                        <Badge className="bg-amber-500">Your Listing</Badge>
                      </div>
                    )}
                  </div>

                  <CardContent className="p-4">
                    <h3 className="font-bold text-slate-900 text-lg mb-1">{listing.propertyName}</h3>
                    {listing.propertyLocation && (
                      <p className="text-sm text-slate-500 flex items-center gap-1 mb-3">
                        <MapPin className="h-3.5 w-3.5" /> {listing.propertyLocation}
                      </p>
                    )}

                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-slate-50 rounded-lg p-2.5">
                        <p className="text-xs text-slate-500">Units</p>
                        <p className="font-bold text-slate-900">{listing.units}</p>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-2.5">
                        <p className="text-xs text-slate-500">
                          {listing.sellingType === "fixed_price" ? "Price" : "Current Bid"}
                        </p>
                        <p className="font-bold text-blue-600 text-sm">
                          {listing.sellingType === "fixed_price" 
                            ? formatCurrency(convertAmount(parseFloat(listing.askingPrice || 0), listing.currency || 'NGN'))
                            : listing.highestBidAmount 
                              ? formatCurrency(convertAmount(parseFloat(listing.highestBidAmount), listing.currency || 'NGN'))
                              : "No bids yet"
                          }
                        </p>
                      </div>
                    </div>

                    {listing.sellingType === "bidding" && (
                      <div className="flex items-center gap-3 text-xs text-slate-500 mb-3">
                        <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {listing.bidCount} bid{listing.bidCount !== 1 ? "s" : ""}</span>
                        {listing.minimumPrice && (
                          <span>Reserve: {formatCurrency(convertAmount(parseFloat(listing.minimumPrice), listing.currency || 'NGN'))}</span>
                        )}
                      </div>
                    )}

                    {myBid && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 mb-3 text-sm">
                        <p className="text-blue-800 font-medium">Your bid: {formatCurrency(convertAmount(parseFloat(myBid.amount), listing.currency || 'NGN'))}</p>
                      </div>
                    )}

                    <p className="text-xs text-slate-400 mb-3">Seller: {listing.sellerName}</p>

                    <Button
                      variant="outline"
                      className="w-full mb-2 text-blue-700 border-blue-200 hover:bg-blue-50"
                      onClick={() => {
                        setDetailListing(listing);
                        setDetailPropertyId(listing.propertyId);
                        setPropertyDetailOpen(true);
                      }}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      View Property Details
                    </Button>

                    {!isSeller && (
                      <div>
                        {listing.sellingType === "fixed_price" ? (
                          <Button
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                            onClick={() => {
                              setSelectedListing(listing);
                              setBuyDialogOpen(true);
                            }}
                          >
                            <DollarSign className="h-4 w-4 mr-2" />
                            Buy Now
                          </Button>
                        ) : (
                          <Button
                            className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                            onClick={() => {
                              setSelectedListing(listing);
                              setBidAmount("");
                              setBidDialogOpen(true);
                            }}
                          >
                            <Gavel className="h-4 w-4 mr-2" />
                            Place Bid
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* My Active Bids */}
        {myBids.length > 0 && (
          <Card className="mt-8">
            <CardHeader className="border-b border-slate-200">
              <CardTitle className="text-lg flex items-center gap-2">
                <Gavel className="h-5 w-5 text-purple-600" />
                My Bids
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="space-y-3">
                {myBids.map((bid: any) => {
                  const statusColors: Record<string, string> = {
                    active: "bg-green-100 text-green-700",
                    outbid: "bg-amber-100 text-amber-700",
                    won: "bg-blue-100 text-blue-700",
                    lost: "bg-red-100 text-red-700",
                  };
                  return (
                    <div key={bid.id} className="flex items-center justify-between border border-slate-200 rounded-lg p-3">
                      <div>
                        <p className="font-semibold text-slate-900">{bid.propertyName}</p>
                        <p className="text-sm text-slate-600">
                          {formatCurrency(convertAmount(parseFloat(bid.amount), bid.currency || 'NGN'))}
                          {" — "}
                          {new Date(bid.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Badge className={statusColors[bid.status] || "bg-slate-100 text-slate-600"}>
                        {bid.status === "active" ? "Leading" : bid.status.charAt(0).toUpperCase() + bid.status.slice(1)}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Bid Dialog */}
      <Dialog open={bidDialogOpen} onOpenChange={setBidDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gavel className="h-5 w-5 text-purple-600" />
              Place a Bid
            </DialogTitle>
            <DialogDescription>
              {selectedListing?.propertyName} — {selectedListing?.units} units
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {detailLoading ? (
              <div className="text-center py-4 text-slate-400">Loading listing details...</div>
            ) : (
              <>
                <div className="bg-slate-50 rounded-lg p-3 space-y-1 text-sm">
                  {listingDetail?.minimumPrice && (
                    <p>Reserve price: <span className="font-semibold">{selectedListing?.currency} {parseFloat(listingDetail.minimumPrice).toLocaleString()}</span></p>
                  )}
                  {listingDetail?.highestBidAmount && (
                    <p>Current highest bid: <span className="font-semibold text-blue-600">{selectedListing?.currency} {parseFloat(listingDetail.highestBidAmount).toLocaleString()}</span></p>
                  )}
                  <p>{listingDetail?.bidCount || 0} bid{(listingDetail?.bidCount || 0) !== 1 ? "s" : ""} so far</p>
                </div>

                {listingDetail?.bids && listingDetail.bids.length > 0 && (
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-500 uppercase tracking-wide">Recent Bids</Label>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {listingDetail.bids.slice(0, 5).map((bid: any) => (
                        <div key={bid.id} className="flex justify-between text-sm bg-slate-50 rounded px-3 py-1.5">
                          <span className="text-slate-600">{bid.bidderName}</span>
                          <span className="font-medium">{selectedListing?.currency} {parseFloat(bid.amount).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Your Bid Amount ({selectedListing?.currency}) *</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Enter your bid"
                    value={bidAmount}
                    onChange={(e) => setBidAmount(e.target.value)}
                  />
                  {listingDetail?.highestBidAmount && (
                    <p className="text-xs text-slate-500">Must be higher than {selectedListing?.currency} {parseFloat(listingDetail.highestBidAmount).toLocaleString()}</p>
                  )}
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <Button variant="outline" onClick={() => setBidDialogOpen(false)}>Cancel</Button>
                  <Button
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                    disabled={bidMutation.isPending}
                    onClick={() => {
                      if (!bidAmount || parseFloat(bidAmount) <= 0) {
                        toast({ title: "Invalid bid", description: "Please enter a valid amount", variant: "destructive" });
                        return;
                      }
                      bidMutation.mutate({ listingId: selectedListing.id, amount: bidAmount });
                    }}
                  >
                    {bidMutation.isPending ? "Placing..." : "Place Bid"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Buy Confirmation Dialog */}
      <Dialog open={buyDialogOpen} onOpenChange={setBuyDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-green-600" />
              Confirm Purchase
            </DialogTitle>
            <DialogDescription>
              You are about to purchase units in {selectedListing?.propertyName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-600">Property</span>
                <span className="font-semibold">{selectedListing?.propertyName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Units</span>
                <span className="font-semibold">{selectedListing?.units}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Price</span>
                <span className="font-bold text-green-700">
                  {selectedListing && formatCurrency(convertAmount(parseFloat(selectedListing.askingPrice || 0), selectedListing.currency || 'NGN'))}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Seller</span>
                <span>{selectedListing?.sellerName}</span>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 flex items-start gap-2">
              <Clock className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>After confirming, you will need to transfer the payment to our bank account and confirm it within <strong>48 hours</strong>.</span>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setBuyDialogOpen(false)}>Cancel</Button>
              <Button
                className="bg-blue-600 hover:bg-blue-700 text-white"
                disabled={buyMutation.isPending}
                onClick={() => {
                  buyMutation.mutate(selectedListing.id);
                }}
              >
                {buyMutation.isPending ? "Processing..." : "Confirm & View Payment Details"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Payment Dialog - Bank Details + I've Made Payment */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="h-5 w-5 text-orange-600" />
              Complete Payment
            </DialogTitle>
            <DialogDescription>
              Transfer the exact amount to Brikvest's bank account below
            </DialogDescription>
          </DialogHeader>

          {paymentListing && (
            <div className="space-y-5 mt-2">
              {/* Amount To Pay */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
                <p className="text-sm text-blue-600 mb-1">Amount to Pay</p>
                <p className="text-3xl font-bold text-blue-800">
                  {paymentListing.currency || "NGN"} {getPaymentAmount(paymentListing).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-blue-500 mt-1">
                  {paymentListing.units} units in {paymentListing.propertyName || `Property #${paymentListing.propertyId}`}
                </p>
              </div>

              {/* Bank Details */}
              {(() => {
                const currency = paymentListing.currency || "NGN";
                const method = paymentMethods[currency] || paymentMethods.NGN;

                return (
                  <div className="space-y-3">
                    <h4 className="font-semibold text-slate-900 flex items-center gap-2">
                      <CreditCard className="h-4 w-4" />
                      {method.title}
                    </h4>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg divide-y divide-slate-200">
                      {method.details.map((detail: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between px-4 py-3">
                          <div>
                            <p className="text-xs text-slate-500">{detail.label}</p>
                            <p className="font-medium text-slate-900">{detail.value}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(detail.value)}
                            className="text-blue-600 hover:text-blue-700 h-8"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>

                    {method.alternative && (
                      <div className="mt-3">
                        <h5 className="text-sm font-medium text-slate-700 mb-2">{method.alternative.title}</h5>
                        <div className="bg-slate-50 border border-slate-200 rounded-lg divide-y divide-slate-200">
                          {method.alternative.details.map((detail: any, idx: number) => (
                            <div key={idx} className="flex items-center justify-between px-4 py-3">
                              <div>
                                <p className="text-xs text-slate-500">{detail.label}</p>
                                <p className="font-medium text-slate-900">{detail.value}</p>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => copyToClipboard(detail.value)}
                                className="text-blue-600 hover:text-blue-700 h-8"
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Payment Deadline */}
              {paymentListing.paymentDeadline && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 flex items-start gap-2">
                  <Clock className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>
                    Complete payment by <strong>{new Date(paymentListing.paymentDeadline).toLocaleDateString()}</strong> at <strong>{new Date(paymentListing.paymentDeadline).toLocaleTimeString()}</strong>
                  </span>
                </div>
              )}

              <div className="border-t border-slate-200 pt-4">
                <h4 className="font-semibold text-slate-900 mb-3">After making your transfer:</h4>
                <div className="space-y-3">
                  <div>
                    <Label>Bank Reference / Transaction ID</Label>
                    <Input
                      placeholder="Enter your transfer reference number"
                      value={bankReference}
                      onChange={(e) => setBankReference(e.target.value)}
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label>Payment Proof (optional)</Label>
                    <p className="text-xs text-slate-500 mb-2">Upload a screenshot or receipt of your bank transfer</p>
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={(e) => setPaymentProofFile(e.target.files?.[0] || null)}
                    />
                    <Button
                      variant="outline"
                      className="w-full border-dashed"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      {paymentProofFile ? paymentProofFile.name : "Choose file (JPEG, PNG, PDF)"}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setPaymentDialogOpen(false)}
                >
                  I'll Pay Later
                </Button>
                <Button
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={paymentMutation.isPending}
                  onClick={() => {
                    if (!bankReference.trim()) {
                      toast({ title: "Reference required", description: "Please enter your bank transfer reference number", variant: "destructive" });
                      return;
                    }
                    paymentMutation.mutate({
                      listingId: paymentListing.id,
                      bankRef: bankReference,
                      file: paymentProofFile,
                    });
                  }}
                >
                  {paymentMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Submitting...</>
                  ) : (
                    <><CheckCircle className="h-4 w-4 mr-2" /> I've Made Payment</>
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Property Detail Dialog with Valuation Graph */}
      <Dialog open={propertyDetailOpen} onOpenChange={setPropertyDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Building2 className="h-5 w-5 text-blue-600" />
              {detailListing?.propertyName || "Property Details"}
            </DialogTitle>
            {detailListing?.propertyLocation && (
              <DialogDescription className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {detailListing.propertyLocation}
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="space-y-5 mt-2">
            {detailListing?.propertyImageUrl && (
              <div className="rounded-lg overflow-hidden">
                <img
                  src={detailListing.propertyImageUrl}
                  alt={detailListing.propertyName}
                  className="w-full h-48 object-cover"
                />
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-0.5">Units for Sale</p>
                <p className="font-bold text-slate-900">{detailListing?.units}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-0.5">Listing Type</p>
                <p className="font-bold text-slate-900 flex items-center gap-1">
                  {detailListing?.sellingType === "bidding" ? (
                    <><Gavel className="h-3.5 w-3.5 text-purple-600" /> Auction</>
                  ) : (
                    <><Tag className="h-3.5 w-3.5 text-green-600" /> Fixed Price</>
                  )}
                </p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-0.5">
                  {detailListing?.sellingType === "fixed_price" ? "Asking Price" : "Highest Bid"}
                </p>
                <p className="font-bold text-blue-600">
                  {detailListing?.sellingType === "fixed_price"
                    ? formatCurrency(convertAmount(parseFloat(detailListing?.askingPrice || 0), detailListing?.currency || "NGN"))
                    : detailListing?.highestBidAmount
                      ? formatCurrency(convertAmount(parseFloat(detailListing.highestBidAmount), detailListing?.currency || "NGN"))
                      : "No bids yet"
                  }
                </p>
              </div>
            </div>

            {valuationsLoading ? (
              <div className="bg-slate-50 rounded-lg p-8 text-center">
                <Loader2 className="h-6 w-6 text-slate-400 animate-spin mx-auto mb-2" />
                <p className="text-sm text-slate-500">Loading valuation data...</p>
              </div>
            ) : appreciationChartData.length > 0 ? (
              <Card className="border border-green-200">
                <CardHeader className="pb-2 border-b border-green-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-green-600" />
                        Land Appreciation
                      </CardTitle>
                      <p className="text-xs text-slate-500 mt-0.5">Property value trend based on official valuations</p>
                    </div>
                    {overallAppreciation && (
                      <Badge variant="outline" className={`${Number(overallAppreciation) >= 0 ? 'text-green-700 border-green-300 bg-green-50' : 'text-red-700 border-red-300 bg-red-50'}`}>
                        {Number(overallAppreciation) >= 0 ? '+' : ''}{overallAppreciation}% overall
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={appreciationChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorMarketplaceValue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="date" stroke="#64748b" style={{ fontSize: '11px' }} />
                        <YAxis stroke="#64748b" style={{ fontSize: '11px' }} tickFormatter={(v) => `₦${(v / 1000000).toFixed(1)}M`} />
                        <Tooltip
                          contentStyle={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                          formatter={(value: any) => [`₦${Number(value).toLocaleString()}`, 'Property Value']}
                          labelStyle={{ color: '#334155', fontWeight: 600 }}
                        />
                        <Area type="monotone" dataKey="value" stroke="#22c55e" strokeWidth={2} fillOpacity={1} fill="url(#colorMarketplaceValue)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  {propertyValuations.length > 0 && (
                    <div className="mt-4 pt-3 border-t border-slate-100">
                      <p className="text-xs text-slate-500 uppercase tracking-wide mb-2 font-medium">Valuation History</p>
                      <div className="space-y-1.5 max-h-32 overflow-y-auto">
                        {[...propertyValuations]
                          .sort((a: any, b: any) => new Date(b.valuationDate).getTime() - new Date(a.valuationDate).getTime())
                          .map((v: any) => (
                            <div key={v.id} className="flex items-center justify-between text-sm bg-slate-50 rounded px-3 py-2">
                              <span className="text-slate-600">
                                {new Date(v.valuationDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              </span>
                              <div className="flex items-center gap-3">
                                <span className="font-semibold text-slate-900">₦{Number(v.rawAssetValue || v.currentValue).toLocaleString()}</span>
                                {v.appreciationPercentage && (
                                  <Badge variant="outline" className={`text-xs ${Number(v.appreciationPercentage) >= 0 ? 'text-green-700 border-green-300' : 'text-red-700 border-red-300'}`}>
                                    {Number(v.appreciationPercentage) >= 0 ? '+' : ''}{v.appreciationPercentage}%
                                  </Badge>
                                )}
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="bg-slate-50 rounded-lg p-6 text-center">
                <TrendingUp className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No valuation data available for this property yet</p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                className="flex-1 text-blue-700 border-blue-200 hover:bg-blue-50"
                onClick={async () => {
                  if (!detailPropertyId) return;
                  try {
                    const res = await fetch(`/api/properties/${detailPropertyId}/valuation-report-public`);
                    if (res.status === 404) {
                      toast({ title: "No report available", description: "A valuation report has not been uploaded yet for this property." });
                      return;
                    }
                    if (!res.ok) throw new Error('Failed to fetch report');
                    const data = await res.json();
                    window.open(data.url, '_blank');
                  } catch (error: any) {
                    toast({ title: "Error", description: error.message, variant: "destructive" });
                  }
                }}
              >
                <FileText className="h-4 w-4 mr-2" />
                View Valuation Report
              </Button>
              <Button
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                onClick={() => setPropertyDetailOpen(false)}
              >
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
