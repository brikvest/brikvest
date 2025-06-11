import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Building, DollarSign, Calendar, MapPin, User, LogOut } from "lucide-react";
import { useLocation } from "wouter";
import { useEffect } from "react";
import type { InvestmentReservation } from "@shared/schema";

export default function Dashboard() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation("/login");
    }
  }, [isAuthenticated, isLoading, setLocation]);

  const { data: userInvestments = [] } = useQuery<InvestmentReservation[]>({
    queryKey: ["/api/user/investments"],
    enabled: isAuthenticated,
  });

  const { data: stats } = useQuery<{
    totalInvested: number;
    activeInvestments: number;
    expectedReturns: number;
  }>({
    queryKey: ["/api/user/stats"],
    enabled: isAuthenticated,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <h1 className="text-xl font-semibold text-gray-900">Investment Dashboard</h1>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <User className="h-4 w-4 text-gray-600" />
                <span className="text-sm text-gray-700">
                  {(user as any)?.firstName || (user as any)?.email || 'User'}
                </span>
              </div>
              <Button
                onClick={() => setLocation("/")}
                variant="outline"
                size="sm"
              >
                Back to Home
              </Button>
              <Button
                onClick={() => window.location.href = '/api/logout'}
                variant="outline"
                size="sm"
                className="flex items-center space-x-1"
              >
                <LogOut className="h-4 w-4" />
                <span>Logout</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Invested</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(stats?.totalInvested || 0)}
              </div>
              <p className="text-xs text-muted-foreground">
                Across all properties
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Investments</CardTitle>
              <Building className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.activeInvestments || 0}</div>
              <p className="text-xs text-muted-foreground">
                Properties invested in
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Expected Returns</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(stats?.expectedReturns || 0)}
              </div>
              <p className="text-xs text-muted-foreground">
                Annual projected return
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Investments List */}
        <Card>
          <CardHeader>
            <CardTitle>My Investments</CardTitle>
          </CardHeader>
          <CardContent>
            {userInvestments.length === 0 ? (
              <div className="text-center py-8">
                <Building className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500 mb-4">No investments yet</p>
                <Button onClick={() => setLocation("/")}>
                  Browse Properties
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {userInvestments.map((investment) => (
                  <div key={investment.id} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h3 className="font-semibold text-lg">Property Investment</h3>
                        <p className="text-sm text-gray-600">
                          {investment.units} units invested
                        </p>
                      </div>
                      <Badge 
                        variant={investment.status === 'confirmed' ? 'default' : 'secondary'}
                      >
                        {investment.status}
                      </Badge>
                    </div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-gray-500">Investment Amount</p>
                        <p className="font-semibold">
                          {formatCurrency(investment.units * 32353)}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500">Units</p>
                        <p className="font-semibold">{investment.units}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">Date</p>
                        <p className="font-semibold">
                          {new Date(investment.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500">Referral Code</p>
                        <p className="font-semibold">
                          {investment.referralCode || 'None'}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}