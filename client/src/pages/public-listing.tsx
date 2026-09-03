import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, MapPin, Tag, Gavel, Clock, Users, ArrowRight, ArrowLeft, Share2, TrendingUp, FileText, Loader2 } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import brikvest_logo from "@/assets/brikvest-logo.png";

const getCurrencySymbol = (c: string) => {
  switch (c) {
    case "NGN": return "₦";
    case "USD": return "$";
    case "GBP": return "£";
    default: return c;
  }
};

export default function PublicListing() {
  const [, params] = useRoute("/listing/:shareToken");
  const shareToken = params?.shareToken;

  const { data: listing, isLoading, error } = useQuery<any>({
    queryKey: ["/api/public/listing", shareToken],
    queryFn: async () => {
      const res = await fetch(`/api/public/listing/${shareToken}`);
      if (!res.ok) throw new Error("Listing not found");
      return res.json();
    },
    enabled: !!shareToken,
  });

  const propertyId = listing?.propertyId;
  const { data: propertyValuations = [], isLoading: valuationsLoading } = useQuery<any[]>({
    queryKey: ["/api/properties", propertyId, "valuations-public"],
    queryFn: async () => {
      const res = await fetch(`/api/properties/${propertyId}/valuations-public`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!propertyId,
  });

  const appreciationChartData = (() => {
    if (!propertyValuations.length) return [];
    const sorted = [...propertyValuations].sort(
      (a, b) => new Date(a.valuationDate).getTime() - new Date(b.valuationDate).getTime()
    );
    return sorted.map(v => ({
      date: new Date(v.valuationDate).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      value: Number(v.rawAssetValue || v.currentValue),
    }));
  })();

  const overallAppreciation = (() => {
    if (appreciationChartData.length < 2) return null;
    const first = appreciationChartData[0].value;
    const last = appreciationChartData[appreciationChartData.length - 1].value;
    if (first === 0) return null;
    return ((last - first) / first * 100).toFixed(1);
  })();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="animate-pulse text-slate-500">Loading listing...</div>
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="p-8 text-center">
            <div className="text-6xl mb-4">🔍</div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">Listing Not Found</h2>
            <p className="text-slate-600 mb-6">This listing may have been removed or is no longer available.</p>
            <Link href="/">
              <Button>Visit Brikvest</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isAuction = listing.sellingType === "bidding";
  const isSold = listing.status === "sold";
  const currSym = getCurrencySymbol(listing.currency);

  const formatPrice = (val: string | number) => {
    return `${currSym}${parseFloat(String(val)).toLocaleString()}`;
  };

  const timeLeft = listing.biddingEndsAt
    ? (() => {
        const diff = new Date(listing.biddingEndsAt).getTime() - Date.now();
        if (diff <= 0) return "Ended";
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        if (days > 0) return `${days}d ${hours}h left`;
        if (hours > 0) return `${hours}h ${mins}m left`;
        return `${mins}m left`;
      })()
    : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/">
            <div className="flex items-center gap-2 cursor-pointer">
              <img src={brikvest_logo} alt="Brikvest" className="h-8 w-8" />
              <span className="font-bold text-lg text-blue-700">Brikvest</span>
            </div>
          </Link>
          <Link href="/login">
            <Button size="sm">Sign In to Participate</Button>
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-6">
          <Button
            variant="ghost"
            className="text-slate-600 hover:text-blue-700 hover:bg-blue-50 -ml-2"
            onClick={() => window.history.length > 1 ? window.history.back() : window.location.href = '/'}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </div>
        <div className="grid lg:grid-cols-5 gap-8">
          <div className="lg:col-span-3 space-y-6">
            {listing.propertyImageUrl && (
              <div className="rounded-xl overflow-hidden shadow-lg">
                <img
                  src={listing.propertyImageUrl}
                  alt={listing.propertyName}
                  className="w-full h-64 sm:h-80 object-cover"
                />
              </div>
            )}

            <div>
              <div className="flex items-start gap-3 mb-2">
                <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">{listing.propertyName}</h1>
                {isSold && <Badge variant="secondary" className="bg-blue-100 text-blue-700">Sold</Badge>}
              </div>
              {listing.propertyLocation && (
                <p className="flex items-center gap-1 text-slate-600 mb-4">
                  <MapPin className="h-4 w-4" />
                  {listing.propertyLocation}
                </p>
              )}
              {listing.propertyDescription && (
                <div className="prose prose-sm text-slate-700 max-w-none" dangerouslySetInnerHTML={{ __html: listing.propertyDescription }} />
              )}
            </div>

            <Card>
              <CardContent className="p-5">
                <h3 className="font-semibold text-slate-900 mb-3">Listing Details</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-slate-500">Units Available</span>
                    <p className="font-semibold text-slate-900">{listing.units}</p>
                  </div>
                  <div>
                    <span className="text-slate-500">Listing Type</span>
                    <p className="font-semibold text-slate-900 flex items-center gap-1">
                      {isAuction ? <><Gavel className="h-4 w-4 text-amber-600" /> Auction</> : <><Tag className="h-4 w-4 text-emerald-600" /> Fixed Price</>}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Property Type</span>
                    <p className="font-semibold text-slate-900 capitalize">{listing.propertyType || "Real Estate"}</p>
                  </div>
                  <div>
                    <span className="text-slate-500">Listed</span>
                    <p className="font-semibold text-slate-900">{new Date(listing.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {listing.developer && (
              <Card data-testid="card-developer-info">
                <CardContent className="p-5">
                  <h3 className="font-semibold text-slate-900 mb-3">About the Developer</h3>
                  <div className="flex items-start gap-4">
                    {listing.developer.companyLogoUrl ? (
                      <img
                        src={listing.developer.companyLogoUrl}
                        alt={listing.developer.companyName || "Developer logo"}
                        className="h-14 w-14 rounded-lg object-contain bg-slate-50 border border-slate-200 p-1 flex-shrink-0"
                        data-testid="img-developer-logo"
                      />
                    ) : (
                      <div className="h-14 w-14 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center flex-shrink-0">
                        <Building2 className="h-6 w-6 text-slate-400" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900" data-testid="text-developer-name">{listing.developer.companyName}</p>
                      {listing.developer.companyRegistration && (
                        <p className="text-xs text-slate-500 mb-1" data-testid="text-developer-rc">RC Number: {listing.developer.companyRegistration}</p>
                      )}
                      {listing.developer.companyDescription && (
                        <p className="text-sm text-slate-600 whitespace-pre-line" data-testid="text-developer-description">{listing.developer.companyDescription}</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {valuationsLoading ? (
              <div className="bg-white rounded-xl p-8 text-center shadow-sm">
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
                          <linearGradient id="colorPublicValue" x1="0" y1="0" x2="0" y2="1">
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
                        <Area type="monotone" dataKey="value" stroke="#22c55e" strokeWidth={2} fillOpacity={1} fill="url(#colorPublicValue)" />
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
            ) : null}

            {propertyId && (
              <Button
                variant="outline"
                className="w-full text-blue-700 border-blue-200 hover:bg-blue-50"
                onClick={async () => {
                  const newTab = window.open('about:blank', '_blank');
                  try {
                    const res = await fetch(`/api/properties/${propertyId}/valuation-report-public`);
                    if (res.status === 404) {
                      newTab?.close();
                      alert("No valuation report has been uploaded for this property yet.");
                      return;
                    }
                    if (!res.ok) {
                      newTab?.close();
                      alert("Unable to load the report. Please try again.");
                      return;
                    }
                    const data = await res.json();
                    if (newTab) { newTab.location.href = data.url; } else if (data.url) { window.location.href = data.url; }
                  } catch {
                    newTab?.close();
                    alert("Something went wrong. Please try again.");
                  }
                }}
              >
                <FileText className="h-4 w-4 mr-2" />
                View Valuation Report
              </Button>
            )}
          </div>

          <div className="lg:col-span-2 space-y-4">
            <Card className="border-2 border-blue-200 shadow-lg">
              <CardContent className="p-6">
                {isAuction ? (
                  <>
                    <div className="text-sm text-slate-500 mb-1">Current Highest Bid</div>
                    <div className="text-3xl font-bold text-slate-900 mb-2">
                      {listing.highestBidAmount ? formatPrice(listing.highestBidAmount) : "No bids yet"}
                    </div>
                    {listing.minimumPrice && (
                      <p className="text-sm text-slate-500 mb-3">Reserve: {formatPrice(listing.minimumPrice)}</p>
                    )}
                    <div className="flex items-center gap-4 text-sm text-slate-600 mb-4">
                      <span className="flex items-center gap-1"><Users className="h-4 w-4" /> {listing.bidCount} bid{listing.bidCount !== 1 ? "s" : ""}</span>
                      {timeLeft && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {timeLeft}
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-sm text-slate-500 mb-1">Price</div>
                    <div className="text-3xl font-bold text-slate-900 mb-4">
                      {listing.askingPrice ? formatPrice(listing.askingPrice) : "Contact seller"}
                    </div>
                  </>
                )}

                {!isSold ? (
                  <div className="space-y-3">
                    <Link href={`/login?redirect=/marketplace`}>
                      <Button className="w-full bg-blue-600 hover:bg-blue-700" size="lg">
                        {isAuction ? "Sign In to Place a Bid" : "Sign In to Buy"}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </Link>
                    <p className="text-xs text-center text-slate-500">
                      Join Brikvest to participate. All transactions happen securely on-platform.
                    </p>
                  </div>
                ) : (
                  <div className="bg-blue-50 rounded-lg p-4 text-center">
                    <p className="text-blue-700 font-semibold">This listing has been sold</p>
                    <Link href="/">
                      <Button variant="outline" className="mt-3" size="sm">Browse Other Opportunities</Button>
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <h3 className="font-semibold text-slate-900 mb-2">Why Brikvest?</h3>
                <ul className="space-y-2 text-sm text-slate-600">
                  <li className="flex items-start gap-2">
                    <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold">✓</div>
                    Fractional real estate from ₦30,000
                  </li>
                  <li className="flex items-start gap-2">
                    <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold">✓</div>
                    KYC-verified members only
                  </li>
                  <li className="flex items-start gap-2">
                    <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold">✓</div>
                    Admin-reviewed transfers
                  </li>
                  <li className="flex items-start gap-2">
                    <div className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold">✓</div>
                    Ownership certificates issued
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-5">
                <h3 className="font-semibold text-slate-900 mb-2">Seller</h3>
                <p className="text-slate-600">{listing.sellerName}</p>
                <p className="text-xs text-slate-400 mt-1">Verified Brikvest member</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <footer className="bg-white border-t border-slate-200 mt-12">
        <div className="max-w-5xl mx-auto px-4 py-6 text-center text-sm text-slate-500">
          © {new Date().getFullYear()} Brikvest. All rights reserved. All transactions are managed and verified on the Brikvest platform.
        </div>
      </footer>
    </div>
  );
}
