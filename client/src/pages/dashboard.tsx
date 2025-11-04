import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Home, TrendingUp, Building2, DollarSign, Clock, CheckCircle, LogOut, User, ArrowRight, Menu, X, AlertCircle, ShieldCheck } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import type { InvestmentReservation, Property } from "@shared/schema";
import { useCurrency } from "@/hooks/useCurrency";
import brikvest_logo from "@/assets/brikvest-logo.png";

export default function Dashboard() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { formatCurrency, userCurrency } = useCurrency();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [kycModalOpen, setKycModalOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation("/login");
    }
  }, [isAuthenticated, isLoading, setLocation]);

  // Fetch user's reservations with property details
  const { data: reservations = [] } = useQuery<(InvestmentReservation & { property?: Property })[]>({
    queryKey: ["/api/user/reservations"],
    enabled: isAuthenticated,
  });

  const handleLogout = async () => {
    try {
      await fetch("/api/logout", { method: "POST", credentials: "include" });
      window.location.href = "/";
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-slate-600">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  const userData = user as any;
  const totalInvested = reservations.reduce((sum, res) => sum + (res.units * (res.property?.minInvestment || 0)), 0);
  const activeReservations = reservations.filter(r => r.status === "reserved").length;
  const completedInvestments = reservations.filter(r => r.status === "paid").length;
  const isKycVerified = userData.kycStatus === 'verified';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar - Desktop & Mobile */}
      <div className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 transform transition-transform duration-300 ease-in-out lg:translate-x-0 ${
        mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className="flex flex-col h-full">
          {/* Logo & Close Button */}
          <div className="p-6 border-b border-slate-200 flex items-center justify-between">
            <img src={brikvest_logo} alt="Brikvest" className="h-8" />
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden p-2 hover:bg-slate-100 rounded-lg"
              data-testid="button-close-menu"
            >
              <X className="h-5 w-5 text-slate-600" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-2">
            <Link href="/dashboard">
              <a 
                className="flex items-center space-x-3 px-4 py-3 rounded-lg bg-blue-50 text-blue-600 font-medium" 
                data-testid="nav-dashboard"
                onClick={() => setMobileMenuOpen(false)}
              >
                <Home className="h-5 w-5" />
                <span>Dashboard</span>
              </a>
            </Link>
            <Link href="/#properties">
              <a 
                className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors" 
                data-testid="nav-properties"
                onClick={() => setMobileMenuOpen(false)}
              >
                <Building2 className="h-5 w-5" />
                <span>Browse Properties</span>
              </a>
            </Link>
            <Link href="/insights">
              <a 
                className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors" 
                data-testid="nav-insights"
                onClick={() => setMobileMenuOpen(false)}
              >
                <TrendingUp className="h-5 w-5" />
                <span>Market Insights</span>
              </a>
            </Link>
          </nav>

          {/* User section */}
          <div className="p-4 border-t border-slate-200">
            <div className="flex items-center space-x-3 px-4 py-3 rounded-lg bg-slate-50">
              <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                <User className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">
                  {userData.firstName} {userData.lastName}
                </p>
                <p className="text-xs text-slate-500 truncate">{userData.email}</p>
              </div>
            </div>
            <Button
              onClick={handleLogout}
              variant="ghost"
              className="w-full mt-2 text-slate-600 hover:text-red-600 justify-start"
              data-testid="button-logout"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="lg:ml-64">
        {/* Header */}
        <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
          <div className="px-4 sm:px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              {/* Mobile Menu Button */}
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden p-2 hover:bg-slate-100 rounded-lg"
                data-testid="button-open-menu"
              >
                <Menu className="h-6 w-6 text-slate-600" />
              </button>

              {/* Welcome Message */}
              <div className="flex-1 min-w-0">
                <h1 className="text-lg sm:text-2xl font-bold text-slate-900 truncate">
                  Welcome back, {userData.firstName}!
                </h1>
                <p className="text-xs sm:text-sm text-slate-600 mt-1 hidden sm:block">
                  Track your investments and explore new opportunities
                </p>
              </div>

              {/* New Investment Button */}
              <Button
                onClick={() => setLocation("/#properties")}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm px-3 sm:px-4 whitespace-nowrap"
                data-testid="button-new-investment"
              >
                <DollarSign className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">New Investment</span>
              </Button>
            </div>
          </div>
        </header>

        {/* KYC Verification Banner - Sticky */}
        {userData.kycStatus !== 'verified' && (
          <div className="sticky top-[73px] z-20 bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg">
            <div className="px-4 sm:px-6 py-3 sm:py-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-start sm:items-center gap-3">
                  <AlertCircle className="h-5 w-5 sm:h-6 sm:w-6 flex-shrink-0 mt-0.5 sm:mt-0" />
                  <div>
                    <h3 className="font-semibold text-sm sm:text-base">
                      {userData.kycStatus === 'pending' && 'Verify Your Identity'}
                      {userData.kycStatus === 'submitted' && 'KYC Under Review'}
                      {userData.kycStatus === 'rejected' && 'KYC Verification Required'}
                    </h3>
                    <p className="text-xs sm:text-sm mt-1 opacity-95">
                      {userData.kycStatus === 'pending' && 'Complete KYC verification to unlock full access to your investment details and withdraw funds.'}
                      {userData.kycStatus === 'submitted' && 'Your documents are being reviewed. This usually takes 1-2 business days.'}
                      {userData.kycStatus === 'rejected' && 'Your KYC submission needs attention. Please resubmit your documents.'}
                    </p>
                  </div>
                </div>
                {userData.kycStatus !== 'submitted' && (
                  <Button
                    onClick={() => setKycModalOpen(true)}
                    className="bg-white text-orange-600 hover:bg-orange-50 font-semibold whitespace-nowrap self-start sm:self-auto"
                    data-testid="button-verify-kyc"
                  >
                    <ShieldCheck className="h-4 w-4 mr-2" />
                    {userData.kycStatus === 'rejected' ? 'Resubmit KYC' : 'Verify Now'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Dashboard Content */}
        <main className="p-4 sm:p-6 max-w-7xl mx-auto">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
            <Card className="shadow-lg hover:shadow-xl transition-shadow relative" data-testid="card-total-invested">
              <CardContent className="p-4 sm:p-6">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs sm:text-sm text-slate-600 mb-1">Total Invested</p>
                    <p className={`text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900 truncate ${!isKycVerified ? 'blur-md select-none' : ''}`}>
                      {formatCurrency(totalInvested)}
                    </p>
                  </div>
                  <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                    <DollarSign className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600" />
                  </div>
                </div>
                {!isKycVerified && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-[2px]">
                    <ShieldCheck className="h-6 w-6 text-slate-400" />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-lg hover:shadow-xl transition-shadow relative" data-testid="card-active-reservations">
              <CardContent className="p-4 sm:p-6">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs sm:text-sm text-slate-600 mb-1">Active Reservations</p>
                    <p className={`text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900 ${!isKycVerified ? 'blur-md select-none' : ''}`}>
                      {activeReservations}
                    </p>
                  </div>
                  <div className="w-10 h-10 sm:w-12 sm:h-12 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                    <Clock className="h-5 w-5 sm:h-6 sm:w-6 text-amber-600" />
                  </div>
                </div>
                {!isKycVerified && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-[2px]">
                    <ShieldCheck className="h-6 w-6 text-slate-400" />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-lg hover:shadow-xl transition-shadow sm:col-span-2 lg:col-span-1 relative" data-testid="card-completed">
              <CardContent className="p-4 sm:p-6">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs sm:text-sm text-slate-600 mb-1">Completed</p>
                    <p className={`text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900 ${!isKycVerified ? 'blur-md select-none' : ''}`}>
                      {completedInvestments}
                    </p>
                  </div>
                  <div className="w-10 h-10 sm:w-12 sm:h-12 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                    <CheckCircle className="h-5 w-5 sm:h-6 sm:w-6 text-green-600" />
                  </div>
                </div>
                {!isKycVerified && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-[2px]">
                    <ShieldCheck className="h-6 w-6 text-slate-400" />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* My Reservations */}
          <Card className="mb-6 sm:mb-8 shadow-lg">
            <CardHeader className="border-b border-slate-200 p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle className="text-lg sm:text-xl">My Investment Reservations</CardTitle>
                {reservations.length > 0 && (
                  <Button
                    variant="ghost"
                    onClick={() => setLocation("/#properties")}
                    className="text-blue-600 hover:text-blue-700 text-sm self-start sm:self-auto"
                  >
                    View All Properties
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              {reservations.length === 0 ? (
                <div className="text-center py-8 sm:py-12">
                  <Building2 className="h-12 w-12 sm:h-16 sm:w-16 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">No investments yet</h3>
                  <p className="text-sm sm:text-base text-slate-600 mb-6">Start building your real estate portfolio today</p>
                  <Button
                    onClick={() => setLocation("/#properties")}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    data-testid="button-browse-properties"
                  >
                    Browse Properties
                  </Button>
                </div>
              ) : (
                <div className="space-y-3 sm:space-y-4">
                  {reservations.map((reservation) => (
                    <div
                      key={reservation.id}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 sm:p-4 border border-slate-200 rounded-lg hover:border-blue-300 hover:shadow-md transition-all"
                      data-testid={`reservation-${reservation.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-slate-900 mb-1 text-sm sm:text-base">
                          {reservation.property?.name || `Property #${reservation.propertyId}`}
                        </h4>
                        <p className="text-xs sm:text-sm text-slate-600">
                          {reservation.units} {reservation.units === 1 ? 'slot' : 'slots'} • {formatCurrency(reservation.units * (reservation.property?.minInvestment || 0))}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          Reserved {new Date(reservation.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                            reservation.status === "paid"
                              ? "bg-green-100 text-green-700"
                              : reservation.status === "reserved"
                              ? "bg-amber-100 text-amber-700"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {reservation.status === "paid" ? "Completed" : reservation.status === "reserved" ? "Pending Payment" : reservation.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Account Information */}
          <Card className="shadow-lg">
            <CardHeader className="border-b border-slate-200 p-4 sm:p-6">
              <CardTitle className="text-lg sm:text-xl">Account Information</CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                <div>
                  <p className="text-xs sm:text-sm text-slate-600 mb-1">Full Name</p>
                  <p className="text-sm sm:text-base font-medium text-slate-900">{userData.firstName} {userData.lastName}</p>
                </div>
                <div>
                  <p className="text-xs sm:text-sm text-slate-600 mb-1">Email Address</p>
                  <p className="text-sm sm:text-base font-medium text-slate-900 break-all">{userData.email}</p>
                </div>
                <div>
                  <p className="text-xs sm:text-sm text-slate-600 mb-1">Phone Number</p>
                  <p className="text-sm sm:text-base font-medium text-slate-900">{userData.phone || "Not provided"}</p>
                </div>
                <div>
                  <p className="text-xs sm:text-sm text-slate-600 mb-1">Preferred Currency</p>
                  <p className="text-sm sm:text-base font-medium text-slate-900">{userCurrency}</p>
                </div>
                <div>
                  <p className="text-xs sm:text-sm text-slate-600 mb-1">Member Since</p>
                  <p className="text-sm sm:text-base font-medium text-slate-900">
                    {new Date(userData.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs sm:text-sm text-slate-600 mb-1">Account Status</p>
                  <span className="inline-flex px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                    Active
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}