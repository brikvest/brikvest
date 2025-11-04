import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Home, TrendingUp, Building2, DollarSign, Clock, CheckCircle, LogOut, User, ArrowRight } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useEffect } from "react";
import type { InvestmentReservation, Property } from "@shared/schema";
import { useCurrency } from "@/hooks/useCurrency";
import brikvest_logo from "@/assets/brikvest-logo.png";

export default function Dashboard() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { formatCurrency, userCurrency } = useCurrency();

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

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Sidebar */}
      <div className="fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 hidden lg:block">
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="p-6 border-b border-slate-200">
            <img src={brikvest_logo} alt="Brikvest" className="h-8" />
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-2">
            <Link href="/dashboard">
              <a className="flex items-center space-x-3 px-4 py-3 rounded-lg bg-blue-50 text-blue-600 font-medium" data-testid="nav-dashboard">
                <Home className="h-5 w-5" />
                <span>Dashboard</span>
              </a>
            </Link>
            <Link href="/#properties">
              <a className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors" data-testid="nav-properties">
                <Building2 className="h-5 w-5" />
                <span>Browse Properties</span>
              </a>
            </Link>
            <Link href="/insights">
              <a className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors" data-testid="nav-insights">
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
        <header className="bg-white border-b border-slate-200 sticky top-0 z-40">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Welcome back, {userData.firstName}!</h1>
                <p className="text-sm text-slate-600 mt-1">Track your investments and explore new opportunities</p>
              </div>
              <Button
                onClick={() => setLocation("/#properties")}
                className="bg-blue-600 hover:bg-blue-700 text-white"
                data-testid="button-new-investment"
              >
                <DollarSign className="h-4 w-4 mr-2" />
                New Investment
              </Button>
            </div>
          </div>
        </header>

        {/* Dashboard Content */}
        <main className="p-6 max-w-7xl mx-auto">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <Card className="shadow-lg hover:shadow-xl transition-shadow" data-testid="card-total-invested">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600 mb-1">Total Invested</p>
                    <p className="text-3xl font-bold text-slate-900">{formatCurrency(totalInvested)}</p>
                  </div>
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                    <DollarSign className="h-6 w-6 text-blue-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg hover:shadow-xl transition-shadow" data-testid="card-active-reservations">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600 mb-1">Active Reservations</p>
                    <p className="text-3xl font-bold text-slate-900">{activeReservations}</p>
                  </div>
                  <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center">
                    <Clock className="h-6 w-6 text-amber-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg hover:shadow-xl transition-shadow" data-testid="card-completed">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600 mb-1">Completed</p>
                    <p className="text-3xl font-bold text-slate-900">{completedInvestments}</p>
                  </div>
                  <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                    <CheckCircle className="h-6 w-6 text-green-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* My Reservations */}
          <Card className="mb-8 shadow-lg">
            <CardHeader className="border-b border-slate-200">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl">My Investment Reservations</CardTitle>
                {reservations.length > 0 && (
                  <Button
                    variant="ghost"
                    onClick={() => setLocation("/#properties")}
                    className="text-blue-600 hover:text-blue-700"
                  >
                    View All Properties
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-6">
              {reservations.length === 0 ? (
                <div className="text-center py-12">
                  <Building2 className="h-16 w-16 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">No investments yet</h3>
                  <p className="text-slate-600 mb-6">Start building your real estate portfolio today</p>
                  <Button
                    onClick={() => setLocation("/#properties")}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    data-testid="button-browse-properties"
                  >
                    Browse Properties
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {reservations.map((reservation) => (
                    <div
                      key={reservation.id}
                      className="flex items-center justify-between p-4 border border-slate-200 rounded-lg hover:border-blue-300 hover:shadow-md transition-all"
                      data-testid={`reservation-${reservation.id}`}
                    >
                      <div className="flex-1">
                        <h4 className="font-semibold text-slate-900 mb-1">
                          {reservation.property?.name || `Property #${reservation.propertyId}`}
                        </h4>
                        <p className="text-sm text-slate-600">
                          {reservation.units} {reservation.units === 1 ? 'slot' : 'slots'} • {formatCurrency(reservation.units * (reservation.property?.minInvestment || 0))}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          Reserved {new Date(reservation.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center space-x-4">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-semibold ${
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
            <CardHeader className="border-b border-slate-200">
              <CardTitle className="text-xl">Account Information</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <p className="text-sm text-slate-600 mb-1">Full Name</p>
                  <p className="text-base font-medium text-slate-900">{userData.firstName} {userData.lastName}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600 mb-1">Email Address</p>
                  <p className="text-base font-medium text-slate-900">{userData.email}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600 mb-1">Phone Number</p>
                  <p className="text-base font-medium text-slate-900">{userData.phone || "Not provided"}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600 mb-1">Preferred Currency</p>
                  <p className="text-base font-medium text-slate-900">{userCurrency}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600 mb-1">Member Since</p>
                  <p className="text-base font-medium text-slate-900">
                    {new Date(userData.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-600 mb-1">Account Status</p>
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