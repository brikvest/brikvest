import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CheckCircle, MapPin, Clock, Users, Shield, Lock, TrendingUp, Award, FileText, Download, ExternalLink, Menu, X, LogOut, User, Gavel, Tag, Building2, DollarSign, ArrowRight, LayoutDashboard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Property, InsertInvestmentReservation, VerificationStep } from "@shared/schema";
import brikvest_logo from "@/assets/brikvest-logo.png";
import { PropertyMediaCarousel } from "@/components/PropertyMediaCarousel";
import { CurrencySelector } from "@/components/CurrencySelector";
import { useCurrency, useConvertedProperties } from "@/hooks/useCurrency";

export default function Home() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { formatCurrency: formatCurrencyFromHook, userCurrency, convertAmount } = useCurrency();
  const [investmentModalOpen, setInvestmentModalOpen] = useState(false);
  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [propertyDetailModalOpen, setPropertyDetailModalOpen] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [propertiesTab, setPropertiesTab] = useState<"properties" | "resale">("properties");

  // Form states
  const [investmentForm, setInvestmentForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    units: "",
    referralCode: "",
    unitTypeLabel: "",
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) {
      try {
        localStorage.setItem('brikvest_referral', ref);
      } catch {}
      setInvestmentForm(prev => ({ ...prev, referralCode: ref }));
    } else {
      try {
        const stored = localStorage.getItem('brikvest_referral');
        if (stored) {
          setInvestmentForm(prev => ({ ...prev, referralCode: stored }));
        }
      } catch {}
    }
  }, []);

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

  // Fetch verification data for selected property
  const { data: selectedPropertyVerification = [] } = useQuery({
    queryKey: ["/api/properties", selectedProperty?.id, "verification"],
    queryFn: async () => {
      if (!selectedProperty) return [];
      const response = await fetch(`/api/properties/${selectedProperty.id}/verification`);
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!selectedProperty && propertyDetailModalOpen
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
      setSuccessMessage("Your ownership slot has been reserved successfully! We'll contact you soon with next steps.");
      setSuccessModalOpen(true);
      setInvestmentForm({
        fullName: "",
        email: "",
        phone: "",
        units: "",
        referralCode: "",
        unitTypeLabel: "",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to reserve ownership slot",
        variant: "destructive",
      });
    },
  });

  const handleInvestmentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProperty) return;

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
      referralCode: investmentForm.referralCode || undefined,
      unitTypeLabel: chosenType ? chosenType.label : undefined,
    };

    investmentMutation.mutate(reservationData);
  };

  const openInvestmentModal = (property: Property) => {
    setSelectedProperty(property);
    
    // Pre-fill form with user data if authenticated
    if (isAuthenticated && user) {
      setInvestmentForm({
        fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
        email: user.email,
        phone: (user as any).phone || "",
        units: "",
        referralCode: "",
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
      {/* Header */}
      <header className="bg-white/85 backdrop-blur-md border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Brand */}
            <Link href="/" className="flex items-center" data-testid="link-home">
              <img
                src={brikvest_logo}
                alt="Brikvest"
                className="h-8 w-auto cursor-pointer"
              />
            </Link>

            {/* Primary nav (desktop only) — keep to essentials */}
            <nav className="hidden md:flex items-center gap-1">
              <a
                href="#properties"
                className="text-slate-700 hover:text-blue-600 hover:bg-slate-50 px-3 py-2 rounded-md text-sm font-medium transition-colors"
              >
                Properties
              </a>
              <Link
                href="/insights"
                className="text-slate-700 hover:text-blue-600 hover:bg-slate-50 px-3 py-2 rounded-md text-sm font-medium transition-colors"
              >
                Insights
              </Link>
              <Link
                href="/about"
                className="text-slate-700 hover:text-blue-600 hover:bg-slate-50 px-3 py-2 rounded-md text-sm font-medium transition-colors"
              >
                About
              </Link>
              <Link
                href="/developer/pricing"
                className="text-slate-700 hover:text-blue-600 hover:bg-slate-50 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                data-testid="link-nav-pricing"
              >
                Pricing
              </Link>
            </nav>

            {/* Right cluster (desktop) */}
            <div className="hidden md:flex items-center gap-2">
              <CurrencySelector compact />
              {isAuthenticated ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="flex items-center gap-2 rounded-full hover:bg-slate-100 transition-colors p-1 pr-3"
                      data-testid="button-user-menu"
                      aria-label="Account menu"
                    >
                      <Avatar className="w-8 h-8">
                        <AvatarFallback className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white text-xs font-semibold">
                          {(((user as any)?.firstName || (user as any)?.email || "U")[0] || "U").toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium text-slate-700 max-w-[120px] truncate">
                        {(user as any)?.firstName || (user as any)?.email?.split("@")[0] || "Account"}
                      </span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuLabel className="font-normal">
                      <div className="text-sm font-medium text-slate-900 truncate">
                        {(user as any)?.firstName} {(user as any)?.lastName}
                      </div>
                      <div className="text-xs text-slate-500 truncate">{(user as any)?.email}</div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/dashboard" className="cursor-pointer" data-testid="menu-item-portfolio">
                        <LayoutDashboard className="w-4 h-4 mr-2" /> My Portfolio
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/developer/signup" className="cursor-pointer" data-testid="menu-item-list-project">
                        <Building2 className="w-4 h-4 mr-2" /> List your project
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href="/developer/pricing" className="cursor-pointer" data-testid="menu-item-pricing">
                        <TrendingUp className="w-4 h-4 mr-2" /> Developer pricing
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={async () => {
                        try {
                          await fetch("/api/logout", { method: "POST", credentials: "include" });
                          queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
                          window.location.reload();
                        } catch (e) {
                          console.error(e);
                        }
                      }}
                      className="cursor-pointer text-red-600 focus:text-red-600"
                      data-testid="menu-item-signout"
                    >
                      <LogOut className="w-4 h-4 mr-2" /> Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <>
                  <Link href="/developer/pricing">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-slate-700 hover:text-blue-700 hover:bg-slate-100 font-medium"
                      data-testid="link-developer-pricing-nav"
                    >
                      List your project
                    </Button>
                  </Link>
                  <Button
                    onClick={() => (window.location.href = "/login")}
                    className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                    size="sm"
                    data-testid="button-sign-in"
                  >
                    Sign in
                  </Button>
                </>
              )}
            </div>

            {/* Mobile menu button */}
            <div className="md:hidden flex items-center gap-1">
              <CurrencySelector compact />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="text-slate-700"
                data-testid="button-mobile-menu"
                aria-label="Open menu"
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile menu overlay (rendered outside <header> so backdrop-blur ancestor doesn't trap fixed positioning) */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-[60] md:hidden transition-opacity duration-300"
          onClick={() => setMobileMenuOpen(false)}
          data-testid="overlay-mobile-menu"
        />
      )}

      {/* Mobile menu sidebar (rendered outside <header> for the same reason) */}
      <aside
        className={`fixed inset-y-0 right-0 z-[70] w-[85vw] max-w-sm bg-white shadow-2xl transform transition-transform duration-300 ease-in-out md:hidden ${mobileMenuOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'}`}
        aria-hidden={!mobileMenuOpen}
        data-testid="drawer-mobile-menu"
      >
        <div className="flex flex-col h-full">
          {/* Sidebar header */}
          <div className="flex items-center justify-between p-4 border-b border-slate-200">
            <Link href="/" onClick={() => setMobileMenuOpen(false)}>
              <img src={brikvest_logo} alt="Brikvest" className="h-8 cursor-pointer" />
            </Link>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMobileMenuOpen(false)}
              className="text-slate-600 hover:text-blue-600"
              data-testid="button-close-mobile-menu"
            >
              <X className="h-6 w-6" />
            </Button>
          </div>

          {/* Sidebar content */}
          <div className="flex-1 overflow-y-auto py-4">
                {/* Authenticated user card */}
                {isAuthenticated && user ? (
                  <div className="px-4 mb-2">
                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                      <Avatar className="w-10 h-10">
                        <AvatarFallback className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white text-sm font-semibold">
                          {(((user as any)?.firstName || (user as any)?.email || "U")[0] || "U").toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">
                          {(user as any).firstName} {(user as any).lastName}
                        </p>
                        <p className="text-xs text-slate-500 truncate">{(user as any).email}</p>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="space-y-1 px-3 mt-2">
                  {isAuthenticated && (
                    <Link
                      href="/dashboard"
                      className="flex items-center text-slate-700 hover:text-blue-600 hover:bg-slate-50 px-3 py-3 rounded-lg text-base font-medium transition-colors"
                      onClick={() => setMobileMenuOpen(false)}
                      data-testid="link-mobile-dashboard"
                    >
                      <LayoutDashboard className="h-4 w-4 mr-3 text-slate-500" />
                      My Portfolio
                    </Link>
                  )}

                  <a
                    href="#properties"
                    className="flex items-center text-slate-700 hover:text-blue-600 hover:bg-slate-50 px-3 py-3 rounded-lg text-base font-medium transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                    data-testid="link-mobile-properties"
                  >
                    <Building2 className="h-4 w-4 mr-3 text-slate-500" />
                    Properties
                  </a>

                  <Link
                    href="/insights"
                    className="flex items-center text-slate-700 hover:text-blue-600 hover:bg-slate-50 px-3 py-3 rounded-lg text-base font-medium transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                    data-testid="link-mobile-insights"
                  >
                    <TrendingUp className="h-4 w-4 mr-3 text-slate-500" />
                    Insights
                  </Link>

                  <Link
                    href="/about"
                    className="flex items-center text-slate-700 hover:text-blue-600 hover:bg-slate-50 px-3 py-3 rounded-lg text-base font-medium transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                    data-testid="link-mobile-about"
                  >
                    <Award className="h-4 w-4 mr-3 text-slate-500" />
                    About
                  </Link>
                </div>

                <div className="px-3 mt-6 pt-4 border-t border-slate-100">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 px-3">For developers</p>
                  <Link
                    href="/developer/signup"
                    className="flex items-center text-slate-700 hover:text-blue-700 hover:bg-blue-50 px-3 py-3 rounded-lg text-base font-medium transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                    data-testid="link-mobile-developer-signup"
                  >
                    <Building2 className="h-4 w-4 mr-3 text-blue-600" />
                    List your project
                  </Link>
                  <Link
                    href="/developer/pricing"
                    className="flex items-center text-slate-700 hover:text-blue-700 hover:bg-blue-50 px-3 py-3 rounded-lg text-base font-medium transition-colors"
                    onClick={() => setMobileMenuOpen(false)}
                    data-testid="link-mobile-developer-pricing"
                  >
                    <TrendingUp className="h-4 w-4 mr-3 text-blue-600" />
                    Pricing & free trial
                  </Link>
                </div>
              </div>

              {/* Sidebar footer */}
              <div className="border-t border-slate-200 p-4 space-y-3">
                <div>
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Currency</p>
                  <CurrencySelector />
                </div>
                {isAuthenticated ? (
                  <Button
                    onClick={async () => {
                      try {
                        await fetch('/api/logout', {
                          method: 'POST',
                          credentials: 'include'
                        });
                        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
                        window.location.reload();
                      } catch (error) {
                        console.error('Logout error:', error);
                      }
                    }}
                    variant="outline"
                    className="w-full border-slate-300 text-slate-700 hover:bg-slate-50"
                    data-testid="button-mobile-logout"
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    Sign out
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      window.location.href = '/login';
                      setMobileMenuOpen(false);
                    }}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                    data-testid="button-mobile-signin"
                  >
                    Sign in
                  </Button>
                )}
              </div>
            </div>
      </aside>

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

      {/* Properties Section */}
      <section id="properties" className="py-20 bg-white">
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
                        <h3 className="text-xl font-semibold mb-2">{property.name}</h3>
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
                    {isAuthenticated ? (
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
                    href="/developer/signup"
                    className="text-slate-300 hover:text-white transition-colors"
                    data-testid="link-footer-developer-signup"
                  >
                    List your project
                  </Link>
                </li>
                <li>
                  <Link
                    href="/developer/pricing"
                    className="text-slate-300 hover:text-white transition-colors"
                    data-testid="link-footer-developer-pricing"
                  >
                    Pricing & free trial
                  </Link>
                </li>
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
                      {cfg.map(t => (
                        <SelectItem key={String(t.label)} value={String(t.label)} data-testid={`unit-type-option-${t.label}`}>
                          {t.label} — {originalCurrency} {Number(t.price).toLocaleString()}
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
            <div>
              <Label htmlFor="referralCode">Referral Code (Optional)</Label>
              <Input
                id="referralCode"
                type="text"
                value={investmentForm.referralCode}
                onChange={(e) => setInvestmentForm(prev => ({ ...prev, referralCode: e.target.value }))}
                placeholder="Enter referral code if you have one"
              />
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
                    <DialogTitle className="text-lg sm:text-2xl font-bold">{selectedProperty.name}</DialogTitle>
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
                        <div className="font-semibold capitalize">{selectedProperty.status}</div>
                      </div>
                    </div>
                  </div>

                </div>

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
                <div>
                  <h3 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4">Due Diligence Verification</h3>
                  <div className="border border-slate-200 bg-slate-50 rounded-lg p-6">
                    <div className="mb-6">
                      <div className="flex items-center space-x-2 mb-2">
                        <Shield className="w-6 h-6 text-blue-600" />
                        <h4 className="font-semibold text-slate-800">Property Verification Checklist</h4>
                      </div>
                      <p className="text-slate-600 text-sm mb-4">
                        We conduct comprehensive due diligence on every property to ensure transparency and safety for our investors.
                      </p>
                      
                      {/* Progress Bar */}
                      {(() => {
                        const enabledSteps = selectedPropertyVerification.filter((step: any) => step.isEnabled);
                        const completedSteps = enabledSteps.filter((step: any) => step.isCompleted);
                        const progressPercentage = enabledSteps.length > 0 ? (completedSteps.length / enabledSteps.length) * 100 : 0;
                        
                        return (
                          <div className="mb-6">
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-sm font-medium text-slate-700">Verification Progress</span>
                              <span className="text-sm text-slate-600">{completedSteps.length} of {enabledSteps.length} completed</span>
                            </div>
                            <div className="w-full bg-slate-200 rounded-full h-2">
                              <div 
                                className="bg-green-600 h-2 rounded-full transition-all duration-300"
                                style={{ width: `${progressPercentage}%` }}
                              ></div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Verification Steps */}
                    <div className="space-y-4">
                      {selectedPropertyVerification
                        .filter((step: any) => step.isEnabled)
                        .map((step: any) => (
                          <div key={step.id} className="border border-slate-200 bg-white rounded-lg p-4">
                            <div className="flex items-start justify-between">
                              <div className="flex items-start space-x-3 flex-1">
                                <div className="flex-shrink-0 mt-1">
                                  {step.isCompleted ? (
                                    <CheckCircle className="w-5 h-5 text-green-600" />
                                  ) : (
                                    <div className="w-5 h-5 border-2 border-slate-300 rounded-full"></div>
                                  )}
                                </div>
                                <div className="flex-1">
                                  <h5 className="font-medium text-slate-800 mb-1">{step.name}</h5>
                                  <p className="text-sm text-slate-600 mb-2">{step.description}</p>
                                  
                                  {/* Status Badge */}
                                  <div className="flex items-center space-x-2 mb-3">
                                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                      step.isCompleted 
                                        ? 'bg-green-100 text-green-800' 
                                        : 'bg-amber-100 text-amber-800'
                                    }`}>
                                      {step.isCompleted ? 'Verified' : 'In Progress'}
                                    </span>
                                    {step.completedAt && (
                                      <span className="text-xs text-slate-500">
                                        Completed {new Date(step.completedAt).toLocaleDateString()}
                                      </span>
                                    )}
                                  </div>

                                  {/* Proof Photos */}
                                  {step.proofPhotos && step.proofPhotos.length > 0 && (
                                    <div className="mt-3">
                                      <p className="text-xs text-slate-600 mb-2">
                                        Verification Photo{step.proofPhotos.length > 1 ? 's' : ''}:
                                      </p>
                                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                        {step.proofPhotos.map((photoUrl: string, index: number) => (
                                          <div key={index} className="border border-slate-200 rounded-lg overflow-hidden">
                                            <img 
                                              src={photoUrl.startsWith('https://') ? photoUrl : `/verification-photos/${photoUrl.split('/').pop()}`}
                                              alt={`Verification proof ${index + 1} for ${step.name}`}
                                              className="w-full h-20 object-cover cursor-pointer hover:opacity-80 transition-opacity"
                                              onClick={() => window.open(photoUrl.startsWith('https://') ? photoUrl : `/verification-photos/${photoUrl.split('/').pop()}`, '_blank')}
                                            />
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>

                    {/* No Active Verifications Message */}
                    {selectedPropertyVerification.filter((step: any) => step.isEnabled).length === 0 && (
                      <div className="text-center py-8">
                        <Clock className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                        <p className="text-slate-600">Verification checklist is being configured for this property.</p>
                      </div>
                    )}
                  </div>
                </div>

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
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Success Modal */}
      <Dialog open={successModalOpen} onOpenChange={setSuccessModalOpen}>
        <DialogContent className="max-w-md text-center">
          <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="text-white w-8 h-8" />
          </div>
          <DialogHeader>
            <DialogTitle>Success!</DialogTitle>
          </DialogHeader>
          <p className="text-slate-600 mb-6">{successMessage}</p>
          <Button 
            onClick={() => {
              setSuccessModalOpen(false);
              setLocation("/dashboard");
            }}
            className="bg-blue-600 hover:bg-blue-700"
          >
            View My Portfolio
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}