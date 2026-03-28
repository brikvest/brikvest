import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Building2, Tag, Gavel, ArrowLeft, Clock, Users, TrendingUp, DollarSign, MapPin, AlertCircle, CheckCircle } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useState, useEffect } from "react";
import { useCurrency } from "@/hooks/useCurrency";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import brikvest_logo from "@/assets/brikvest-logo.png";

export default function Marketplace() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { formatCurrency, convertAmount } = useCurrency();
  const { toast } = useToast();
  const [selectedListing, setSelectedListing] = useState<any>(null);
  const [bidAmount, setBidAmount] = useState("");
  const [bidDialogOpen, setBidDialogOpen] = useState(false);
  const [buyDialogOpen, setBuyDialogOpen] = useState(false);

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/marketplace/listings"] });
      toast({ title: "Purchase initiated!", description: "You have 48 hours to complete payment." });
      setBuyDialogOpen(false);
    },
    onError: (error: any) => {
      toast({ title: "Purchase failed", description: error?.message || "Failed to buy", variant: "destructive" });
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
                      <Badge className={listing.sellingType === "bidding" ? "bg-purple-600" : "bg-green-600"}>
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

                    {!isSeller && (
                      <div>
                        {listing.sellingType === "fixed_price" ? (
                          <Button
                            className="w-full bg-green-600 hover:bg-green-700 text-white"
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
              <span>After confirming, you will have <strong>48 hours</strong> to complete payment. If payment is not received, the purchase will be cancelled.</span>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setBuyDialogOpen(false)}>Cancel</Button>
              <Button
                className="bg-green-600 hover:bg-green-700 text-white"
                disabled={buyMutation.isPending}
                onClick={() => {
                  buyMutation.mutate(selectedListing.id);
                }}
              >
                {buyMutation.isPending ? "Processing..." : "Confirm Purchase"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
