import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, getApiErrorMessage, queryClient } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CheckCircle, MapPin, Clock, Users, Shield, Lock, TrendingUp, Award, FileText, Download, ExternalLink, User, Gavel, Tag, Building2, DollarSign, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Property, InsertInvestmentReservation } from "@shared/schema";
import { getCustomerPropertyStatusLabel, isPropertySoldOut } from "@shared/propertyAvailability";
import brikvest_logo from "@/assets/brikvest-logo.png";
import { PropertyMediaCarousel } from "@/components/PropertyMediaCarousel";
import { useCurrency, useConvertedProperties } from "@/hooks/useCurrency";
import { UnitCostBreakdownPanel } from "@/components/UnitCostBreakdownPanel";
import { InvestorHeader } from "@/components/InvestorHeader";

export interface HomeProps {
  /** Render the investor property experience inside the authenticated dashboard shell. */
  embedded?: boolean;
  dashboardReturnPath?: string;
  params?: Record<string, string | undefined>;
}

export function PropertyBrowsingContent({ embedded = false, dashboardReturnPath = "/dashboard" }: HomeProps = {}) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { user, isAuthenticated } = useAuth();
  const { formatCurrency: formatCurrencyFromHook, userCurrency, convertAmount } = useCurrency();
  const [investmentModalOpen, setInvestmentModalOpen] = useState(false);
  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [propertyDetailModalOpen, setPropertyDetailModalOpen] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [propertiesTab, setPropertiesTab] = useState<"properties" | "resale">("properties");

  // Form states
  const [investmentForm, setInvestmentForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    units: "",
    unitTypeLabel: "",
  });

  useEffect(() => {
    if (isAuthenticated && user) {
      const userData = user as any;
      setInvestmentForm(prev => ({
        ...prev,
        fullName: `${userData.firstName || ''} ${userData.lastName || ''}`.trim(),
        email: userData.email || '',
        phone: userData.phone || ''
      }));
    }
  }, [isAuthenticated, user]);

  // Fetch properties with currency conversion (only when authenticated - membership required)
  const { data: properties = [], isLoading: propertiesLoading } = useConvertedProperties();
  const { formatCurrency: currencyFormatter } = useCurrency();

  // Fetch live statistics
  const { data: stats } = useQuery<{
    totalInvested: number;
    activeInvestors: number;
    avgReturn: number;
  }>({
    queryKey: ["/api/statistics"],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: resaleListings = [], isLoading: resaleLoading } = useQuery<any[]>({
    queryKey: ["/api/marketplace/listings-public"],
    enabled: propertiesTab === "resale",
  });


  // Investment reservation mutation
  const investmentMutation = useMutation({
    mutationFn: async (data: InsertInvestmentReservation) => {
      return await apiRequest("/api/reservations", {
        method: "POST",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      queryClient.invalidateQueries({ queryKey: ["/api/statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reservations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/reservations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/payment-submissions"] });
      setInvestmentModalOpen(false);
      setSuccessMessage(
        "Your ownership slot was reserved successfully. It will be held for 24 hours only and then released if you do not complete the next steps. We’ll contact you by email with instructions.",
      );
      setSuccessModalOpen(true);
      setInvestmentForm({
        fullName: "",
        email: "",
        phone: "",
        units: "",
        unitTypeLabel: "",
      });
    },
    onError: (error) => {
      toast({
        title: "Unable to reserve that quantity",
        description: getApiErrorMessage(
          error,
          "We couldn't reserve your ownership units. Please choose a smaller quantity or try again.",
        ),
        variant: "destructive",
      });
    },
  });

  const handleInvestmentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProperty) return;
    if (isPropertySoldOut(selectedProperty)) {
      toast({
        title: "Sold Out",
        description: "This property is no longer available for reservation.",
        variant: "destructive",
      });
      setInvestmentModalOpen(false);
      return;
    }

    const units = parseFloat(investmentForm.units);
    
    // Use original property price (not converted for display)
    const cfgUnitTypes: Array<{ label: string; quantity: number; price: number }> =
      Array.isArray((selectedProperty as any).unitTypes) ? (selectedProperty as any).unitTypes : [];
    const chosenType = investmentForm.unitTypeLabel
      ? cfgUnitTypes.find(t => String(t.label) === investmentForm.unitTypeLabel)
      : null;

    // Require a selection whenever the property has multiple unit types,
    // even if they share a price — attribution by label is the only way to
    // keep the unit-mix chart accurate.
    if (cfgUnitTypes.length > 1 && !chosenType) {
      toast({
        title: "Pick a unit type",
        description: "Please select which unit type you'd like to reserve.",
        variant: "destructive",
      });
      return;
    }

    const originalUnitPrice = chosenType
      ? Number(chosenType.price)
      : ((selectedProperty as any).originalUnitPrice || selectedProperty.unitPrice || selectedProperty.minInvestment || 0);
    const originalCurrency = (selectedProperty as any).originalCurrency || selectedProperty.currency || 'NGN';
    const amount = units * originalUnitPrice;

    const reservationData: InsertInvestmentReservation = {
      propertyId: selectedProperty.id,
      fullName: investmentForm.fullName,
      email: investmentForm.email,
      phone: investmentForm.phone,
      units: investmentForm.units,
      amount: amount.toString(),
      unitPriceSnapshot: originalUnitPrice.toString(),
      currency: originalCurrency,
      status: 'reserved',
      unitTypeLabel: chosenType ? chosenType.label : undefined,
    };

    investmentMutation.mutate(reservationData);
  };

  const openInvestmentModal = (property: Property) => {
    if (isPropertySoldOut(property)) return;
    setSelectedProperty(property);
    
    // Pre-fill form with user data if authenticated
    if (isAuthenticated && user) {
      const userData = user as any;
      setInvestmentForm({
        fullName: `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.email,
        email: userData.email,
        phone: (user as any).phone || "",
        units: "",
        unitTypeLabel: "",
      });
    }
    
    setInvestmentModalOpen(true);
  };

  const openPropertyDetailModal = (property: Property) => {
    setSelectedProperty(property);
    setPropertyDetailModalOpen(true);
  };

  const formatCurrency = (amount: number) => currencyFormatter(amount);

  const formatCompactCurrency = (amount: number) => {
    if (amount >= 1000000000) {
      const billions = amount / 1000000000;
      return billions % 1 === 0 ? `₦${billions}B` : `₦${billions.toFixed(1)}B`;
    } else if (amount >= 1000000) {
      const millions = amount / 1000000;
      return millions % 1 === 0 ? `₦${millions}M` : `₦${millions.toFixed(1)}M`;
    } else if (amount >= 1000) {
      const thousands = amount / 1000;
      return thousands % 1 === 0 ? `₦${thousands}K` : `₦${thousands.toFixed(1)}K`;
    } else {
      return `₦${amount}`;
    }
  };

  const getBadgeInfo = (badge: string | null) => {
    switch (badge) {
      case 'partnered':
        return {
          label: 'Partnered',
          color: 'bg-green-100 text-green-800 border-green-200',
          icon: Shield,
          description: 'Verified partnership with land owner'
        };
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {!embedded && <InvestorHeader />}

      {!embedded && (
      <>
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-blue-50 to-slate-100 text-slate-800 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight mb-6">
                Co-own land with{" "}
                <span className="text-blue-600">fractional ownership.</span>
              </h1>
              <p className="text-xl text-slate-600 mb-8 leading-relaxed">
                Co-own verified land, grow your real estate portfolio, and trade seamlessly in our peer-to-peer marketplace
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button 
                  onClick={() => document.getElementById('properties')?.scrollIntoView({ behavior: 'smooth' })}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 text-lg font-semibold"
                >
                  Browse Properties
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
                  className="border-2 border-blue-600 text-blue-600 bg-transparent hover:bg-blue-600 hover:text-white px-8 py-4 text-lg font-semibold"
                >
                  Learn More
                </Button>
              </div>
              <div className="flex items-center mt-8 space-x-8">
                <div className="text-center">
                  <div className="text-2xl font-bold text-slate-800">
                    {stats ? formatCompactCurrency(stats.totalInvested) + "+" : "₦90.8M+"}
                  </div>
                  <div className="text-slate-500 text-sm">Total Invested</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-slate-800">
                    {stats ? `${stats.activeInvestors}+` : "22+"}
                  </div>
                  <div className="text-slate-500 text-sm">Active Investors</div>
                </div>
              </div>
            </div>
            <div className="lg:text-right">
              <img 
                src="https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&h=600" 
                alt="Modern luxury real estate investment property" 
                className="rounded-2xl shadow-2xl w-full h-auto"
              />
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">How It Works</h2>
            <p className="text-xl text-slate-600 max-w-3xl mx-auto">
              Simple, transparent, and secure real estate investing in three easy steps
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="bg-blue-600 text-white w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 text-2xl font-bold">
                1
              </div>
              <h3 className="text-xl font-semibold mb-4">Browse Properties</h3>
              <p className="text-slate-600">
                Explore our curated selection of premium real estate investments with detailed analytics and projections.
              </p>
            </div>
            <div className="text-center">
              <div className="bg-green-600 text-white w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 text-2xl font-bold">
                2
              </div>
              <h3 className="text-xl font-semibold mb-4">Acquire a Fraction</h3>
              <p className="text-slate-600">
                Purchase fractional ownership of premium real estate properties starting from ₦30,000. Own a piece of high-value real estate.
              </p>
            </div>
            <div className="text-center">
              <div className="bg-yellow-500 text-white w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 text-2xl font-bold">
                3
              </div>
              <h3 className="text-xl font-semibold mb-4">Start Trading (coming soon)</h3>
              <p className="text-slate-600">
                Trade your property fractions on our secondary marketplace. Buy and sell ownership stakes with other investors for liquidity.
              </p>
            </div>
          </div>
        </div>
      </section>

      </>
      )}

      {/* Properties Section */}
      <section id="properties" className="py-20 bg-white scroll-mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              Investment Opportunities
            </h2>
            <p className="text-xl text-slate-600 max-w-3xl mx-auto">
              Explore primary property listings and secondary market resale opportunities
            </p>
          </div>

          <div className="flex justify-center mb-10">
            <div className="inline-flex bg-slate-100 rounded-xl p-1.5 gap-1">
              <button
                onClick={() => setPropertiesTab("properties")}
                className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center gap-2 ${
                  propertiesTab === "properties"
                    ? "bg-white text-blue-700 shadow-sm"
                    : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
                }`}
              >
                <Building2 className="h-4 w-4" />
                Properties
              </button>
              <button
                onClick={() => setPropertiesTab("resale")}
                className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 flex items-center gap-2 ${
                  propertiesTab === "resale"
                    ? "bg-white text-purple-700 shadow-sm"
                    : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
                }`}
              >
                <Gavel className="h-4 w-4" />
                P2P Marketplace
                {resaleListings.length > 0 && (
                  <span className="bg-purple-100 text-purple-700 text-xs font-bold px-2 py-0.5 rounded-full">
                    {resaleListings.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {propertiesTab === "properties" && (
            <>
          {propertiesLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {[...Array(6)].map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <div className="h-48 bg-slate-200 rounded-t-lg" />
                  <CardContent className="p-6">
                    <div className="h-4 bg-slate-200 rounded mb-2" />
                    <div className="h-3 bg-slate-200 rounded mb-4 w-2/3" />
                    <div className="grid grid-cols-2 gap-4 mb-6">
                      <div className="h-3 bg-slate-200 rounded" />
                      <div className="h-3 bg-slate-200 rounded" />
                      <div className="h-3 bg-slate-200 rounded" />
                      <div className="h-3 bg-slate-200 rounded" />
                    </div>
                    <div className="h-10 bg-slate-200 rounded" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {properties.map((property: any) => (
                <Card key={property.id} className="overflow-hidden border border-slate-200 hover:shadow-xl transition-shadow cursor-pointer">
                  <div onClick={() => openPropertyDetailModal(property)}>
                    <div className="relative">
                      <img 
                        src={property.imageUrl || (property.gallery && property.gallery.length > 0 ? property.gallery[0] : '')} 
                        alt={property.name}
                        className="w-full h-48 object-cover"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTQgMTZMOC41ODU3OSAxMS40MTQyQzguOTc2MzEgMTEuMDIzNyA5LjYwOTQ4IDExLjAyMzcgMTAgMTEuNDE0MkwxNiAxNk0xNCAxNEwxNS41ODU4IDEyLjQxNDJDMTUuOTc2MyAxMi4wMjM3IDE2LjQwOTUgMTIuMDIzNyAxNyAxMi40MTQyTDIwIDE2TTZIMThDMTkuMTA0NiAxOCAyMCAxNy4xMDQ2IDIwIDE2VjhDMjAgNi44OTU0MyAxOS4xMDQ2IDYgMTggNkg2QzQuODk1NDMgNiA0IDYuODk1NDMgNCA4VjE2QzQgMTcuMTA0NiA0Ljg5NTQzIDE4IDYgMThaIiBzdHJva2U9IiNBMUE1QjAiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+Cjwvc3ZnPgo=';
                          target.alt = 'No image available';
                          target.className = 'w-full h-48 object-contain bg-slate-200 p-8';
                        }}
                      />
                      {property.badge && (() => {
                        const badgeInfo = getBadgeInfo(property.badge);
                        if (!badgeInfo) return null;
                        const IconComponent = badgeInfo.icon;
                        return (
                          <div className="absolute top-3 left-3">
                            <div className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${badgeInfo.color}`}>
                              <IconComponent className="w-3 h-3 mr-1" />
                              {badgeInfo.label}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                    <CardContent className="p-6">
                      <div className="mb-4">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-xl font-semibold">{property.name}</h3>
                          {isPropertySoldOut(property) && (
                            <Badge data-testid={`sold-out-card-badge-${property.id}`} variant="destructive">
                              Sold Out
                            </Badge>
                          )}
                        </div>
                        <p className="text-slate-600 text-sm flex items-center">
                          <MapPin className="w-4 h-4 mr-1" />
                          {property.location}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
                        <div>
                          <span className="text-slate-600">Price per Unit</span>
                          <div className="font-semibold text-green-600">{formatCurrency(property.unitPrice || property.minInvestment)}</div>
                          <span className="text-xs text-slate-500">(minimum investment)</span>
                        </div>
                        <div>
                          <span className="text-slate-600">Unit Size</span>
                          <div className="font-semibold">{property.totalSquareMeters && property.totalSlots ? `${(parseFloat(property.totalSquareMeters) / property.totalSlots).toFixed(1)} sqm` : '—'}</div>
                        </div>
                      </div>

                    </CardContent>
                  </div>
                  <CardContent className="px-6 pb-6">
                    {isPropertySoldOut(property) ? (
                      <div className="w-full rounded-md bg-red-50 px-4 py-2 text-center font-medium text-red-700">
                        Sold Out
                      </div>
                    ) : isAuthenticated ? (
                      <Button 
                        onClick={(e) => {
                          e.stopPropagation();
                          openInvestmentModal(property);
                        }}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        Reserve Ownership Slot
                      </Button>
                    ) : (
                      <Link href="/login">
                        <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                          Sign In to Invest
                        </Button>
                      </Link>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
            </>
          )}

          {propertiesTab === "resale" && (
            <>
              {resaleLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {[1, 2, 3].map(i => (
                    <Card key={i} className="animate-pulse">
                      <div className="h-48 bg-slate-200 rounded-t-lg" />
                      <CardContent className="p-6 space-y-3">
                        <div className="h-5 bg-slate-200 rounded w-3/4" />
                        <div className="h-4 bg-slate-200 rounded w-1/2" />
                        <div className="h-10 bg-slate-200 rounded" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : resaleListings.length === 0 ? (
                <div className="text-center py-16">
                  <div className="w-20 h-20 bg-purple-50 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Gavel className="h-10 w-10 text-purple-300" />
                  </div>
                  <h3 className="text-xl font-semibold text-slate-900 mb-2">No resale listings yet</h3>
                  <p className="text-slate-600 max-w-md mx-auto">
                    The secondary market is empty right now. Check back later for resale opportunities from existing investors.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {resaleListings.map((listing: any) => {
                    const timeLeft = listing.sellingType === "bidding" && listing.biddingEndsAt
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
                      <Link key={listing.id} href={isAuthenticated ? "/marketplace" : (listing.shareToken ? `/listing/${listing.shareToken}` : "/login")}>
                        <Card className="overflow-hidden border border-slate-200 hover:shadow-xl transition-all duration-200 cursor-pointer group">
                          <div className="h-48 bg-gradient-to-br from-purple-50 to-blue-50 relative">
                            {listing.propertyImageUrl ? (
                              <img src={listing.propertyImageUrl} alt={listing.propertyName} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Building2 className="h-16 w-16 text-purple-200" />
                              </div>
                            )}
                            <div className="absolute top-3 left-3">
                              <Badge className={`${listing.sellingType === "bidding" ? "bg-purple-600 hover:bg-purple-600" : "bg-blue-600 hover:bg-blue-600"} text-white`}>
                                {listing.sellingType === "bidding" ? (
                                  <><Gavel className="h-3 w-3 mr-1" /> Auction</>
                                ) : (
                                  <><Tag className="h-3 w-3 mr-1" /> Fixed Price</>
                                )}
                              </Badge>
                            </div>
                            {timeLeft && (
                              <div className="absolute top-3 right-3">
                                <Badge variant="secondary" className={`${timeLeft === "Ended" ? "bg-red-100 text-red-700" : "bg-white/90 text-slate-700"} backdrop-blur-sm`}>
                                  <Clock className="h-3 w-3 mr-1" />
                                  {timeLeft}
                                </Badge>
                              </div>
                            )}
                          </div>
                          <CardContent className="p-6">
                            <h3 className="text-lg font-bold text-slate-900 mb-1 group-hover:text-purple-700 transition-colors">
                              {listing.propertyName}
                            </h3>
                            {listing.propertyLocation && (
                              <p className="text-sm text-slate-500 flex items-center gap-1 mb-4">
                                <MapPin className="h-3.5 w-3.5" /> {listing.propertyLocation}
                              </p>
                            )}
                            <div className="grid grid-cols-2 gap-3 mb-4">
                              <div className="bg-slate-50 rounded-lg p-3">
                                <p className="text-xs text-slate-500 mb-0.5">Units Available</p>
                                <p className="font-bold text-slate-900">{listing.units}</p>
                              </div>
                              <div className="bg-slate-50 rounded-lg p-3">
                                <p className="text-xs text-slate-500 mb-0.5">
                                  {listing.sellingType === "fixed_price" ? "Price" : "Highest Bid"}
                                </p>
                                <p className="font-bold text-blue-600 text-sm">
                                  {listing.sellingType === "fixed_price"
                                    ? formatCurrencyFromHook(convertAmount(parseFloat(listing.askingPrice || 0), listing.currency || "NGN"))
                                    : listing.highestBidAmount
                                      ? formatCurrencyFromHook(convertAmount(parseFloat(listing.highestBidAmount), listing.currency || "NGN"))
                                      : "No bids yet"
                                  }
                                </p>
                              </div>
                            </div>
                            {listing.sellingType === "bidding" && (
                              <div className="flex items-center gap-3 text-xs text-slate-500 mb-4">
                                <span className="flex items-center gap-1">
                                  <Users className="h-3.5 w-3.5" /> {listing.bidCount} bid{listing.bidCount !== 1 ? "s" : ""}
                                </span>
                              </div>
                            )}
                            <div className="flex items-center justify-between">
                              <p className="text-xs text-slate-400">Seller: {listing.sellerName}</p>
                              <span className="text-purple-600 text-sm font-medium flex items-center gap-1 group-hover:gap-2 transition-all">
                                View <ArrowRight className="h-3.5 w-3.5" />
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </section>


      {!embedded && (
      <>
      {/* Trust & Security Section */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">Rigorous Due Diligence & Verification</h2>
            <p className="text-xl text-slate-600 max-w-3xl mx-auto">Every property undergoes comprehensive verification to ensure your investment security</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Shield className="text-blue-600 w-8 h-8" />
              </div>
              <h3 className="font-semibold mb-2">Ownership Verification</h3>
              <p className="text-slate-600 text-sm">We verify all land ownership documents and legal titles before listing</p>
            </div>
            <div className="text-center">
              <div className="bg-green-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Lock className="text-green-600 w-8 h-8" />
              </div>
              <h3 className="font-semibold mb-2">Land Survey & Inspection</h3>
              <p className="text-slate-600 text-sm">Professional surveys and physical inspections with photographic evidence</p>
            </div>
            <div className="text-center">
              <div className="bg-yellow-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <TrendingUp className="text-yellow-600 w-8 h-8" />
              </div>
              <h3 className="font-semibold mb-2">9-Point Verification</h3>
              <p className="text-slate-600 text-sm">Comprehensive checklist covering zoning, infrastructure, payments & legal compliance</p>
            </div>
            <div className="text-center">
              <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="text-blue-600 w-8 h-8" />
              </div>
              <h3 className="font-semibold mb-2">Complete Transparency</h3>
              <p className="text-slate-600 text-sm">View verification progress, photos, and documentation for every property</p>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="py-20 bg-gradient-to-br from-blue-50 to-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">What Our Investors Say</h2>
            <p className="text-slate-600 max-w-2xl mx-auto">
              Join thousands of investors who are building wealth through fractional real estate ownership
            </p>
          </div>
          <div className="flex gap-6 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide md:grid md:grid-cols-2 lg:grid-cols-3 md:overflow-x-visible md:pb-0">
            <div className="bg-white rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col min-w-[300px] md:min-w-0 snap-start">
              <div className="flex items-center gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <svg key={i} className="w-5 h-5 text-yellow-400 fill-current" viewBox="0 0 20 20">
                    <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z"/>
                  </svg>
                ))}
              </div>
              <p className="text-slate-600 mb-6 italic flex-grow">
                "I liked how straightforward the process was. With just a couple of clicks, I could own land in Nigeria all the way from abroad. I'm really looking forward to seeing how far this can go."
              </p>
              <div className="flex items-center gap-3 mt-auto">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-blue-600 font-semibold text-sm">IO</span>
                </div>
                <p className="font-semibold text-slate-900">Ilerioluwa O.</p>
              </div>
            </div>

            <div className="bg-white rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col min-w-[300px] md:min-w-0 snap-start">
              <div className="flex items-center gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <svg key={i} className="w-5 h-5 text-yellow-400 fill-current" viewBox="0 0 20 20">
                    <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z"/>
                  </svg>
                ))}
              </div>
              <p className="text-slate-600 mb-6 italic flex-grow">
                "What I really like about Brikvest is how much the barrier to entry has been reduced. I started off investing in Abuja, but now I'm also looking to own assets in Lagos. With this low entry point, diversifying my risk in real estate has become a lot easier."
              </p>
              <div className="flex items-center gap-3 mt-auto">
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-green-600 font-semibold text-sm">CO</span>
                </div>
                <p className="font-semibold text-slate-900">Chukwudi O.</p>
              </div>
            </div>

            <div className="bg-white rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col min-w-[300px] md:min-w-0 snap-start">
              <div className="flex items-center gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <svg key={i} className="w-5 h-5 text-yellow-400 fill-current" viewBox="0 0 20 20">
                    <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z"/>
                  </svg>
                ))}
              </div>
              <p className="text-slate-600 mb-6 italic flex-grow">
                "The fact that I don't have to go through the stress of due diligence makes Brikvest a no-brainer for me. Being able to open the app, see an asset I like, and just acquire it — it almost feels like shopping on Amazon."
              </p>
              <div className="flex items-center gap-3 mt-auto">
                <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-purple-600 font-semibold text-sm">QG</span>
                </div>
                <p className="font-semibold text-slate-900">Queenet G.</p>
              </div>
            </div>

            <div className="bg-white rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col min-w-[300px] md:min-w-0 snap-start">
              <div className="flex items-center gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <svg key={i} className="w-5 h-5 text-yellow-400 fill-current" viewBox="0 0 20 20">
                    <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z"/>
                  </svg>
                ))}
              </div>
              <p className="text-slate-600 mb-6 italic flex-grow">
                "The transparency is what made the difference for me. As investors, we have access to all the title documents, which makes the whole process more reliable and gives us confidence."
              </p>
              <div className="flex items-center gap-3 mt-auto">
                <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-orange-600 font-semibold text-sm">US</span>
                </div>
                <p className="font-semibold text-slate-900">Unekwu S.</p>
              </div>
            </div>

            <div className="bg-white rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col min-w-[300px] md:min-w-0 snap-start">
              <div className="flex items-center gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <svg key={i} className="w-5 h-5 text-yellow-400 fill-current" viewBox="0 0 20 20">
                    <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z"/>
                  </svg>
                ))}
              </div>
              <p className="text-slate-600 mb-6 italic flex-grow">
                "I like Brikvest a lot. I think it's a very interesting initiative, and I'd love to see it expand globally. I want to be able to make strategic bets on regions that have real estate upside, and Brikvest makes that possible."
              </p>
              <div className="flex items-center gap-3 mt-auto">
                <div className="w-10 h-10 bg-teal-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-teal-600 font-semibold text-sm">SA</span>
                </div>
                <p className="font-semibold text-slate-900">Sani A.</p>
              </div>
            </div>

            <div className="bg-white rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col min-w-[300px] md:min-w-0 snap-start">
              <div className="flex items-center gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <svg key={i} className="w-5 h-5 text-yellow-400 fill-current" viewBox="0 0 20 20">
                    <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z"/>
                  </svg>
                ))}
              </div>
              <p className="text-slate-600 mb-6 italic flex-grow">
                "The low barrier to entry really stands out for me. Also, I can easily review years of asset performance and access all the data I need before making an investment."
              </p>
              <div className="flex items-center gap-3 mt-auto">
                <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-indigo-600 font-semibold text-sm">IA</span>
                </div>
                <p className="font-semibold text-slate-900">Ikendai A.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
            <div className="col-span-1 md:col-span-2">
              <div className="flex items-center mb-4">
                <img 
                  src={brikvest_logo} 
                  alt="Brikvest Logo" 
                  className="h-10 w-auto filter brightness-0 invert"
                />
              </div>
              <p className="text-slate-300 mb-6 max-w-md">
                Making real estate investment accessible to everyone through fractional ownership and professional management.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <ul className="space-y-2">
                <li><Link href="/about" className="text-slate-300 hover:text-white transition-colors">About Us</Link></li>
                <li><a href="#" className="text-slate-300 hover:text-white transition-colors">How It Works</a></li>
                <li><a href="#" className="text-slate-300 hover:text-white transition-colors">Security</a></li>
                <li><a href="#" className="text-slate-300 hover:text-white transition-colors">Careers</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">For Developers</h4>
              <ul className="space-y-2">
                <li>
                  <Link
                    href="/developer/login"
                    className="text-slate-300 hover:text-white transition-colors"
                    data-testid="link-footer-developer-login"
                  >
                    Developer sign in
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Legal</h4>
              <ul className="space-y-2">
                <li><a href="#" className="text-slate-300 hover:text-white transition-colors">Terms of Service</a></li>
                <li><a href="#" className="text-slate-300 hover:text-white transition-colors">Privacy Policy</a></li>
                <li><a href="#" className="text-slate-300 hover:text-white transition-colors">Risk Disclosure</a></li>
                <li><a href="#" className="text-slate-300 hover:text-white transition-colors">Contact</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-800 mt-12 pt-8 text-center">
            <p className="text-slate-400">&copy; {new Date().getFullYear()} Brikvest. All rights reserved. Investment opportunities subject to terms and conditions.</p>
          </div>
        </div>
      </footer>
      </>
      )}

      {/* Investment Modal */}
      <Dialog open={investmentModalOpen} onOpenChange={setInvestmentModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reserve Ownership Slot</DialogTitle>
            <DialogDescription>
              Fill out the form below to reserve your ownership slot. No payment required at this time.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleInvestmentSubmit} className="space-y-6">
            {selectedProperty && (
              <UnitCostBreakdownPanel property={selectedProperty} formatAmount={formatCurrency} />
            )}
            {!isAuthenticated && (
              <>
                <div>
                  <Label htmlFor="fullName">Full Name *</Label>
                  <Input
                    id="fullName"
                    type="text"
                    required
                    value={investmentForm.fullName}
                    onChange={(e) => setInvestmentForm(prev => ({ ...prev, fullName: e.target.value }))}
                    placeholder="Enter your full name"
                  />
                </div>
                <div>
                  <Label htmlFor="email">Email Address *</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={investmentForm.email}
                    onChange={(e) => setInvestmentForm(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="Enter your email"
                  />
                </div>
                <div>
                  <Label htmlFor="phone">Phone Number *</Label>
                  <Input
                    id="phone"
                    type="tel"
                    required
                    value={investmentForm.phone}
                    onChange={(e) => setInvestmentForm(prev => ({ ...prev, phone: e.target.value }))}
                    placeholder="Enter your phone number"
                  />
                </div>
              </>
            )}
            {(() => {
              const cfg: Array<{ label: string; quantity: number; price: number }> =
                Array.isArray((selectedProperty as any)?.unitTypes) ? (selectedProperty as any).unitTypes : [];
              if (cfg.length <= 1) return null;
              const originalCurrency = (selectedProperty as any)?.originalCurrency || selectedProperty?.currency || "NGN";
              return (
                <div>
                  <Label htmlFor="unit-type">Unit type *</Label>
                  <Select
                    value={investmentForm.unitTypeLabel}
                    onValueChange={(v) => setInvestmentForm(prev => ({ ...prev, unitTypeLabel: v }))}
                  >
                    <SelectTrigger id="unit-type" data-testid="select-unit-type">
                      <SelectValue placeholder="Pick a unit type" />
                    </SelectTrigger>
                    <SelectContent>
                      {cfg.map((t: any) => (
                        <SelectItem key={String(t.label)} value={String(t.label)} data-testid={`unit-type-option-${t.label}`}>
                          {t.label} — {originalCurrency} {Number(t.price).toLocaleString()}
                          {Number(t.sqm) > 0 ? ` (${Number(t.sqm)} sqm · ${originalCurrency} ${Math.round(Number(t.price) / Number(t.sqm)).toLocaleString()}/sqm)` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500 mt-1">
                    The price per unit shown below uses the type you pick.
                  </p>
                </div>
              );
            })()}
            <div>
              <Label htmlFor="units">Number of Units *</Label>
              <Input
                id="units"
                type="number"
                step="any"
                min="1"
                required
                value={investmentForm.units}
                onChange={(e) => setInvestmentForm(prev => ({ ...prev, units: e.target.value }))}
                placeholder="Enter number of units (e.g., 1, 5, 10)"
              />
              {(() => {
                const cfg: Array<{ label: string; quantity: number; price: number }> =
                  Array.isArray((selectedProperty as any)?.unitTypes) ? (selectedProperty as any).unitTypes : [];
                const chosen = investmentForm.unitTypeLabel
                  ? cfg.find(t => String(t.label) === investmentForm.unitTypeLabel)
                  : null;
                const unitPrice = chosen
                  ? Number(chosen.price)
                  : (selectedProperty?.unitPrice || selectedProperty?.minInvestment || 30000);
                return (
                  <div className="mt-2 p-3 bg-slate-50 rounded-lg">
                    <p className="text-sm text-slate-600">
                      Price per Unit: {formatCurrency(unitPrice)}
                    </p>
                    <p className="text-base font-semibold text-slate-900 mt-1">
                      Total: {formatCurrency(parseFloat(investmentForm.units || "0") * unitPrice)}
                    </p>
                  </div>
                );
              })()}
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start">
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-1">No Payment Required</p>
                  <p>You're just reserving your slot. We'll contact you with next steps when the property is ready for funding.</p>
                </div>
              </div>
            </div>
            <Button 
              type="submit" 
              className="w-full bg-blue-600 hover:bg-blue-700"
              disabled={investmentMutation.isPending}
            >
              {investmentMutation.isPending ? "Reserving..." : "Reserve My Slot"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Property Detail Modal */}
      <Dialog open={propertyDetailModalOpen} onOpenChange={setPropertyDetailModalOpen}>
        <DialogContent className="w-[100vw] h-[100vh] sm:w-[95vw] sm:h-auto sm:max-w-4xl sm:max-h-[90vh] overflow-y-auto p-3 sm:p-6 sm:rounded-lg rounded-none">
          {selectedProperty && (
            <>
              <DialogHeader>
                <div className="flex items-start justify-between flex-wrap gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <DialogTitle className="text-lg sm:text-2xl font-bold">{selectedProperty.name}</DialogTitle>
                      {isPropertySoldOut(selectedProperty) && (
                        <Badge data-testid="sold-out-detail-badge" variant="destructive">Sold Out</Badge>
                      )}
                    </div>
                    <DialogDescription className="flex items-center text-base">
                      <MapPin className="w-4 h-4 mr-1" />
                      {selectedProperty.location}
                    </DialogDescription>
                  </div>
                  {selectedProperty.badge && (() => {
                    const badgeInfo = getBadgeInfo(selectedProperty.badge);
                    if (!badgeInfo) return null;
                    const IconComponent = badgeInfo.icon;
                    return (
                      <div className="flex-shrink-0">
                        <div className={`inline-flex items-center px-3 py-1.5 rounded-full text-sm font-medium border ${badgeInfo.color}`}>
                          <IconComponent className="w-4 h-4 mr-2" />
                          {badgeInfo.label}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </DialogHeader>

              <div className="space-y-4 sm:space-y-8">
                {/* Property Media Carousel */}
                <div className="relative">
                  <PropertyMediaCarousel
                    mainImage={selectedProperty.imageUrl}
                    videoUrl={selectedProperty.videoUrl}
                    gallery={selectedProperty.gallery}
                    propertyName={selectedProperty.name}
                  />

                </div>

                {/* Basic Investment Summary */}
                <div>
                  <h3 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4">Investment Summary</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                    <div className="space-y-3">
                      <div>
                        <span className="text-slate-600">Location:</span>
                        <div className="font-semibold">{selectedProperty.location}</div>
                      </div>
                      <div>
                        <span className="text-slate-600">Property Type:</span>
                        <div className="font-semibold capitalize">{selectedProperty.propertyType}</div>
                      </div>
                      <div>
                        <span className="text-slate-600">Unit Size:</span>
                        <div className="font-semibold">{selectedProperty.totalSquareMeters && selectedProperty.totalSlots ? `${(parseFloat(selectedProperty.totalSquareMeters) / selectedProperty.totalSlots).toFixed(1)} sqm` : '—'}</div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <span className="text-slate-600">Price per Unit:</span>
                        <div className="font-semibold text-green-600">{formatCurrency(selectedProperty.minInvestment)}</div>
                      </div>
                      <div>
                        <span className="text-slate-600 text-xs">(Minimum Investment)</span>
                      </div>
                      <div>
                        <span className="text-slate-600">Available Units:</span>
                        <div className="font-semibold">{selectedProperty.availableSlots} of {selectedProperty.totalSlots}</div>
                      </div>

                      <div>
                        <span className="text-slate-600">Status:</span>
                        <div className="font-semibold">{getCustomerPropertyStatusLabel(selectedProperty)}</div>
                      </div>
                    </div>
                  </div>

                </div>

                <UnitCostBreakdownPanel property={selectedProperty} formatAmount={formatCurrency} />

                {/* Partnership Verification */}
                {selectedProperty.badge === 'partnered' && selectedProperty.partnershipDocumentUrl && (
                  <div>
                    <h3 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4">Partnership Verification</h3>
                    <div className="border border-green-200 bg-green-50 rounded-lg p-6">
                      <div className="flex items-start space-x-4">
                        <div className="flex-shrink-0">
                          <Shield className="w-8 h-8 text-green-600" />
                        </div>
                        <div className="flex-1">
                          <h4 className="font-semibold text-green-800 mb-2">Verified Partnership</h4>
                          <p className="text-green-700 mb-4">
                            This property has been verified with a signed partnership agreement between Brikvest and the land owner. 
                            You can view and download the official documentation below for transparency and peace of mind.
                          </p>
                          <div className="flex flex-col gap-3">
                            <Button
                              onClick={() => selectedProperty.partnershipDocumentUrl && window.open(selectedProperty.partnershipDocumentUrl, '_blank')}
                              variant="outline"
                              className="border-green-600 text-green-600 hover:bg-green-600 hover:text-white"
                            >
                              <ExternalLink className="w-4 h-4 mr-2" />
                              Preview Document
                            </Button>
                            <Button
                              onClick={() => {
                                const link = document.createElement('a');
                                link.href = selectedProperty.partnershipDocumentUrl || '';
                                link.download = selectedProperty.partnershipDocumentName || 'Partnership Agreement';
                                link.click();
                              }}
                              variant="outline"
                              className="border-green-600 text-green-600 hover:bg-green-600 hover:text-white"
                            >
                              <Download className="w-4 h-4 mr-2" />
                              Download PDF
                            </Button>
                          </div>
                          {selectedProperty.partnershipDocumentName && (
                            <p className="text-sm text-green-600 mt-2">
                              <FileText className="w-4 h-4 inline mr-1" />
                              {selectedProperty.partnershipDocumentName}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Due Diligence Verification */}
                {selectedProperty.dueDiligenceDocumentUrl && (
                <div data-testid="due-diligence-document-section">
                  <h3 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4">Due Diligence Verification</h3>
                  <div className="border border-slate-200 bg-slate-50 rounded-lg p-4 sm:p-6">
                    <div className="flex items-start gap-3">
                      <FileText className="w-6 h-6 text-blue-600 mt-1" />
                      <div className="flex-1">
                        <h4 className="font-semibold text-slate-800">
                          {selectedProperty.dueDiligenceDocumentName || "Due diligence document"}
                        </h4>
                        <p className="text-slate-600 text-sm mt-1 mb-4">
                          Review the due diligence document provided for this property.
                        </p>
                        <div
                          className="h-[24rem] sm:h-[32rem] overflow-auto rounded-md border border-slate-300 bg-white"
                          data-testid="due-diligence-document-preview"
                        >
                          <iframe
                            src={selectedProperty.dueDiligenceDocumentUrl}
                            title={`${selectedProperty.dueDiligenceDocumentName || "Due diligence document"} preview`}
                            className="h-full w-full"
                          />
                        </div>
                        <div className="mt-4">
                          <Button variant="outline" asChild>
                            <a
                              href={selectedProperty.dueDiligenceDocumentUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              data-testid="due-diligence-document-open"
                            >
                              <ExternalLink className="w-4 h-4 mr-2" /> Open in new window
                            </a>
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                )}

                {/* Description */}
                <div>
                  <h3 className="text-xl font-semibold mb-4">Description</h3>
                  <div 
                    className="prose prose-slate max-w-none text-slate-700"
                    dangerouslySetInnerHTML={{ __html: selectedProperty.description }}
                  />
                </div>

                {/* Developer Notes */}
                {selectedProperty.developerNotes && (
                  <div>
                    <h3 className="text-xl font-semibold mb-4">Developer Notes</h3>
                    <div 
                      className="prose prose-slate max-w-none text-slate-700"
                      dangerouslySetInnerHTML={{ __html: selectedProperty.developerNotes }}
                    />
                  </div>
                )}

                {/* Co-Ownership Details */}
                {selectedProperty.investmentDetails && (
                  <div>
                    <h3 className="text-xl font-semibold mb-4">Co-Ownership Details</h3>
                    <div 
                      className="prose prose-slate max-w-none text-slate-700"
                      dangerouslySetInnerHTML={{ __html: selectedProperty.investmentDetails }}
                    />
                  </div>
                )}

                {/* Action Buttons */}
                {!isPropertySoldOut(selectedProperty) && (
                  <div className="pt-6 border-t border-slate-200">
                    <Button
                      onClick={() => {
                        setPropertyDetailModalOpen(false);
                        openInvestmentModal(selectedProperty);
                      }}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      Reserve Ownership Slot
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Success Modal */}
      <Dialog open={successModalOpen} onOpenChange={setSuccessModalOpen}>
        <DialogContent
          className="max-w-md text-center"
          data-testid="reservation-success-dialog"
        >
          <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="text-white w-8 h-8" />
          </div>
          <DialogHeader className="text-center sm:text-center">
            <DialogTitle>Success!</DialogTitle>
          </DialogHeader>
          <p
            className="text-slate-600 text-center mb-6"
            data-testid="reservation-success-message"
          >
            {successMessage}
          </p>
          <Button 
            onClick={() => {
              setSuccessModalOpen(false);
              setLocation(dashboardReturnPath);
            }}
            className="bg-blue-600 hover:bg-blue-700 mx-auto"
          >
            View My Portfolio
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Public marketing page wrapper around the reusable property experience. */
export default function Home(props: HomeProps = {}) {
  return <PropertyBrowsingContent {...props} />;
}
