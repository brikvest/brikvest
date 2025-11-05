import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Home, TrendingUp, Building2, DollarSign, Clock, CheckCircle, LogOut, User, ArrowRight, Menu, X, AlertCircle, ShieldCheck, Upload } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import type { InvestmentReservation, Property } from "@shared/schema";
import { useCurrency } from "@/hooks/useCurrency";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import brikvest_logo from "@/assets/brikvest-logo.png";

export default function Dashboard() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { formatCurrency, userCurrency } = useCurrency();
  const { toast } = useToast();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [kycModalOpen, setKycModalOpen] = useState(false);
  const [kycFormData, setKycFormData] = useState({
    fullName: '',
    dateOfBirth: '',
    address: '',
    occupation: '',
    idType: '',
    idNumber: '',
  });
  const [idDocumentFile, setIdDocumentFile] = useState<File | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  const handleKycSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validation
    if (!kycFormData.fullName || !kycFormData.dateOfBirth || !kycFormData.address || !kycFormData.occupation || !kycFormData.idType || !kycFormData.idNumber) {
      toast({
        title: "Missing Information",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }

    if (!idDocumentFile) {
      toast({
        title: "ID Document Required",
        description: "Please upload your government-issued ID document.",
        variant: "destructive",
      });
      return;
    }

    if (!signatureFile) {
      toast({
        title: "Signature Required",
        description: "Please upload an image of your signature.",
        variant: "destructive",
      });
      return;
    }

    // Validate signature file type
    const allowedSignatureTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedSignatureTypes.includes(signatureFile.type)) {
      toast({
        title: "Invalid Signature File",
        description: "Signature must be a JPG, PNG, or WEBP image.",
        variant: "destructive",
      });
      return;
    }

    // Validate signature file size (max 5MB)
    const maxSignatureSize = 5 * 1024 * 1024; // 5MB
    if (signatureFile.size > maxSignatureSize) {
      toast({
        title: "Signature File Too Large",
        description: "Signature image must be less than 5MB.",
        variant: "destructive",
      });
      return;
    }

    // Check age (must be 18+)
    const dob = new Date(kycFormData.dateOfBirth);
    const age = Math.floor((new Date().getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    if (age < 18) {
      toast({
        title: "Age Requirement",
        description: "You must be 18 years or older to complete KYC verification.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);

    try {
      // Create FormData for file upload
      const formData = new FormData();
      formData.append('fullName', kycFormData.fullName);
      formData.append('dateOfBirth', kycFormData.dateOfBirth);
      formData.append('address', kycFormData.address);
      formData.append('occupation', kycFormData.occupation);
      formData.append('idType', kycFormData.idType);
      formData.append('idNumber', kycFormData.idNumber);
      formData.append('idDocument', idDocumentFile);
      formData.append('signature', signatureFile);
      if (selfieFile) {
        formData.append('selfie', selfieFile);
      }

      const response = await fetch('/api/kyc/submit', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('KYC submission failed');
      }

      toast({
        title: "KYC Submitted Successfully",
        description: "Your documents are being reviewed. This usually takes 1-2 business days.",
      });

      // Refresh user data
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      
      // Close modal and reset form
      setKycModalOpen(false);
      setKycFormData({
        fullName: '',
        dateOfBirth: '',
        address: '',
        occupation: '',
        idType: '',
        idNumber: '',
      });
      setIdDocumentFile(null);
      setSelfieFile(null);
      setSignatureFile(null);
    } catch (error) {
      console.error('KYC submission error:', error);
      toast({
        title: "Submission Failed",
        description: "There was an error submitting your KYC documents. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading || !user) {
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
  const totalInvested = reservations.reduce((sum, res) => {
    const units = typeof res.units === 'string' ? parseFloat(res.units) : res.units;
    return sum + (units * (res.property?.minInvestment || 0));
  }, 0);
  const activeReservations = reservations.filter(r => r.status === "reserved").length;
  const completedInvestments = reservations.filter(r => r.status === "paid").length;
  const isKycVerified = userData.kycStatus === 'verified';
  
  // Check if KYC needs update (missing new required fields)
  const needsKycUpdate = (userData.kycStatus === 'verified' || userData.kycStatus === 'submitted') && 
    (!userData.kycOccupation || !userData.kycSignatureUrl);

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
            <Link 
              href="/dashboard"
              className="flex items-center space-x-3 px-4 py-3 rounded-lg bg-blue-50 text-blue-600 font-medium" 
              data-testid="nav-dashboard"
              onClick={() => setMobileMenuOpen(false)}
            >
              <Home className="h-5 w-5" />
              <span>Dashboard</span>
            </Link>
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                setLocation('/');
                setTimeout(() => {
                  const element = document.getElementById('properties');
                  if (element) {
                    element.scrollIntoView({ behavior: 'smooth' });
                  }
                }, 100);
              }}
              className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors w-full text-left" 
              data-testid="nav-properties"
            >
              <Building2 className="h-5 w-5" />
              <span>Browse Properties</span>
            </button>
            <Link 
              href="/insights"
              className="flex items-center space-x-3 px-4 py-3 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors" 
              data-testid="nav-insights"
              onClick={() => setMobileMenuOpen(false)}
            >
              <TrendingUp className="h-5 w-5" />
              <span>Market Insights</span>
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
                onClick={() => {
                  setLocation('/');
                  setTimeout(() => {
                    const element = document.getElementById('properties');
                    if (element) {
                      element.scrollIntoView({ behavior: 'smooth' });
                    }
                  }, 100);
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm px-3 sm:px-4 whitespace-nowrap"
                data-testid="button-new-investment"
              >
                <DollarSign className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">New Investment</span>
              </Button>
            </div>
          </div>
        </header>

        {/* KYC Update Required Banner - For existing users missing new fields */}
        {needsKycUpdate && (
          <div className="sticky top-[73px] z-20 bg-orange-600 text-white shadow-md">
            <div className="px-4 sm:px-6 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <AlertCircle className="h-5 w-5 flex-shrink-0" />
                  <p className="text-sm">
                    <strong>KYC Update Required:</strong> Please update your verification with your occupation and signature to continue accessing all features.
                  </p>
                </div>
                <Button
                  onClick={() => setKycModalOpen(true)}
                  className="bg-white text-orange-600 hover:bg-orange-50 font-medium whitespace-nowrap"
                  data-testid="button-update-kyc"
                >
                  <ShieldCheck className="h-4 w-4 mr-2" />
                  Update KYC
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* KYC Verification Banner - Sticky */}
        {!needsKycUpdate && userData.kycStatus !== 'verified' && (
          <div className="sticky top-[73px] z-20 bg-blue-600 text-white shadow-md">
            <div className="px-4 sm:px-6 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <AlertCircle className="h-5 w-5 flex-shrink-0" />
                  <p className="text-sm">
                    {userData.kycStatus === 'pending' && 'Complete identity verification to view your investment details'}
                    {userData.kycStatus === 'submitted' && 'Your verification is under review (1-2 business days)'}
                    {userData.kycStatus === 'rejected' && 'Please resubmit your verification documents'}
                  </p>
                </div>
                {userData.kycStatus !== 'submitted' && (
                  <Button
                    onClick={() => setKycModalOpen(true)}
                    className="bg-white text-blue-600 hover:bg-blue-50 font-medium whitespace-nowrap"
                    data-testid="button-verify-kyc"
                  >
                    <ShieldCheck className="h-4 w-4 mr-2" />
                    Verify
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

          {/* Pending Reservations */}
          {(() => {
            const pendingReservations = reservations.filter(r => 
              r.status === 'payment_pending' || r.status === 'payment_received'
            );
            
            if (pendingReservations.length > 0) {
              return (
                <Card className="mb-6 sm:mb-8 shadow-lg border-yellow-200">
                  <CardHeader className="border-b border-yellow-200 bg-yellow-50 p-4 sm:p-6">
                    <CardTitle className="text-lg sm:text-xl flex items-center gap-2">
                      <Clock className="h-5 w-5 text-yellow-600" />
                      Pending Reservations
                    </CardTitle>
                    <p className="text-sm text-slate-600 mt-1">Complete payment to confirm your investments</p>
                  </CardHeader>
                  <CardContent className="p-4 sm:p-6">
                    <div className="space-y-3 sm:space-y-4">
                      {pendingReservations.map((reservation) => (
                        <div
                          key={reservation.id}
                          className="border border-yellow-200 rounded-lg p-4 bg-yellow-50/50"
                          data-testid={`reservation-pending-${reservation.id}`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                            <div className="flex-1">
                              <h4 className="font-semibold text-slate-900 mb-1 text-sm sm:text-base">
                                {reservation.property?.name || `Property #${reservation.propertyId}`}
                              </h4>
                              <div className="space-y-1 text-xs sm:text-sm text-slate-600">
                                <p>Units: {reservation.units}</p>
                                <p>Amount: {formatCurrency(reservation.amount)}</p>
                                <p className="text-xs text-slate-500">
                                  Created {new Date(reservation.createdAt).toLocaleDateString()}
                                </p>
                              </div>
                            </div>
                            <span
                              className={`px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap self-start ${
                                reservation.status === "payment_received"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-yellow-100 text-yellow-700"
                              }`}
                            >
                              {reservation.status === "payment_received" ? "Payment Received" : "Payment Pending"}
                            </span>
                          </div>
                          
                          {reservation.status === "payment_pending" && (
                            <div className="mt-4 p-3 bg-white border border-yellow-200 rounded-lg">
                              <p className="text-sm font-medium text-slate-900 mb-2">Next Steps:</p>
                              <p className="text-xs text-slate-600">
                                Please complete your payment to confirm this investment. Contact support for payment instructions.
                              </p>
                            </div>
                          )}

                          {reservation.status === "payment_received" && (
                            <div className="mt-4 p-3 bg-white border border-blue-200 rounded-lg">
                              <p className="text-sm font-medium text-blue-900 mb-2">Payment received!</p>
                              <p className="text-xs text-blue-700">
                                Your payment has been received and is being processed. Your investment will be confirmed shortly.
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            }
            return null;
          })()}

          {/* My Holdings */}
          {(() => {
            const confirmedInvestments = reservations.filter(r => r.status === 'confirmed');
            
            return (
              <Card className="mb-6 sm:mb-8 shadow-lg">
                <CardHeader className="border-b border-slate-200 p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg sm:text-xl">My Property Holdings</CardTitle>
                      <p className="text-sm text-slate-600 mt-1">Your confirmed real estate investments</p>
                    </div>
                    {reservations.length > 0 && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setLocation('/');
                          setTimeout(() => {
                            const element = document.getElementById('properties');
                            if (element) {
                              element.scrollIntoView({ behavior: 'smooth' });
                            }
                          }, 100);
                        }}
                        className="text-blue-600 hover:text-blue-700 text-sm self-start sm:self-auto"
                      >
                        View All Properties
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-4 sm:p-6">
                  {confirmedInvestments.length === 0 ? (
                    <div className="text-center py-8 sm:py-12">
                      <Building2 className="h-12 w-12 sm:h-16 sm:w-16 text-slate-300 mx-auto mb-4" />
                      <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">No confirmed investments yet</h3>
                      <p className="text-sm sm:text-base text-slate-600 mb-6">Start building your real estate portfolio today</p>
                      <Button
                        onClick={() => {
                          setLocation('/');
                          setTimeout(() => {
                            const element = document.getElementById('properties');
                            if (element) {
                              element.scrollIntoView({ behavior: 'smooth' });
                            }
                          }, 100);
                        }}
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                        data-testid="button-browse-properties"
                      >
                        Browse Properties
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3 sm:space-y-4">
                      {confirmedInvestments.map((reservation) => (
                        <div
                          key={reservation.id}
                          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 sm:p-4 border border-slate-200 rounded-lg hover:border-blue-300 hover:shadow-md transition-all"
                          data-testid={`holding-${reservation.id}`}
                        >
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-slate-900 mb-1 text-sm sm:text-base">
                              {reservation.property?.name || `Property #${reservation.propertyId}`}
                            </h4>
                            <div className="text-xs sm:text-sm text-slate-600 space-y-0.5">
                              <p>Units owned: {reservation.units}</p>
                              <p>Cost basis: {formatCurrency(reservation.amount)}</p>
                              <p className="text-xs text-slate-500 mt-1">
                                Confirmed {new Date(reservation.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center">
                            <span className="px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap bg-green-100 text-green-700">
                              Confirmed
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}
        </main>
      </div>

      {/* KYC Verification Modal */}
      <Dialog open={kycModalOpen} onOpenChange={setKycModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-blue-600" />
              KYC Verification
            </DialogTitle>
            <DialogDescription>
              Complete your identity verification to unlock full access to your investment account. All information is encrypted and secure.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleKycSubmit} className="space-y-6 mt-4">
            {/* Personal Information */}
            <div className="space-y-4">
              <h3 className="font-semibold text-lg text-slate-900">Personal Information</h3>
              
              <div>
                <Label htmlFor="fullName" className="text-sm font-medium">
                  Full Legal Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="fullName"
                  type="text"
                  value={kycFormData.fullName}
                  onChange={(e) => setKycFormData({ ...kycFormData, fullName: e.target.value })}
                  placeholder="As shown on government-issued ID"
                  className="mt-1"
                  required
                  data-testid="input-kyc-fullname"
                />
                <p className="text-xs text-slate-500 mt-1">Must match your government ID exactly</p>
              </div>

              <div>
                <Label htmlFor="dateOfBirth" className="text-sm font-medium">
                  Date of Birth <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="dateOfBirth"
                  type="date"
                  value={kycFormData.dateOfBirth}
                  onChange={(e) => setKycFormData({ ...kycFormData, dateOfBirth: e.target.value })}
                  max={new Date(new Date().setFullYear(new Date().getFullYear() - 18)).toISOString().split('T')[0]}
                  className="mt-1"
                  required
                  data-testid="input-kyc-dob"
                />
                <p className="text-xs text-slate-500 mt-1">You must be 18 years or older</p>
              </div>

              <div>
                <Label htmlFor="address" className="text-sm font-medium">
                  Residential Address <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="address"
                  value={kycFormData.address}
                  onChange={(e) => setKycFormData({ ...kycFormData, address: e.target.value })}
                  placeholder="Street address, city, state/province, postal code, country"
                  className="mt-1"
                  rows={3}
                  required
                  data-testid="input-kyc-address"
                />
              </div>

              <div>
                <Label htmlFor="occupation" className="text-sm font-medium">
                  Occupation <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="occupation"
                  type="text"
                  value={kycFormData.occupation}
                  onChange={(e) => setKycFormData({ ...kycFormData, occupation: e.target.value })}
                  placeholder="Your current occupation or profession"
                  className="mt-1"
                  required
                  data-testid="input-kyc-occupation"
                />
              </div>
            </div>

            {/* Contact Information - Pre-filled */}
            <div className="space-y-4">
              <h3 className="font-semibold text-lg text-slate-900">Contact Information</h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium text-slate-600">Email</Label>
                  <Input
                    value={userData.email}
                    disabled
                    className="mt-1 bg-slate-50"
                  />
                </div>
                <div>
                  <Label className="text-sm font-medium text-slate-600">Phone</Label>
                  <Input
                    value={userData.phone || "Not provided"}
                    disabled
                    className="mt-1 bg-slate-50"
                  />
                </div>
              </div>
            </div>

            {/* Government ID */}
            <div className="space-y-4">
              <h3 className="font-semibold text-lg text-slate-900">Government-Issued ID</h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="idType" className="text-sm font-medium">
                    ID Type <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={kycFormData.idType}
                    onValueChange={(value) => setKycFormData({ ...kycFormData, idType: value })}
                    required
                  >
                    <SelectTrigger className="mt-1" data-testid="select-kyc-idtype">
                      <SelectValue placeholder="Select ID type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="passport">Passport</SelectItem>
                      <SelectItem value="drivers_license">Driver's License</SelectItem>
                      <SelectItem value="national_id">National ID Card</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="idNumber" className="text-sm font-medium">
                    ID Number <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="idNumber"
                    type="text"
                    value={kycFormData.idNumber}
                    onChange={(e) => setKycFormData({ ...kycFormData, idNumber: e.target.value })}
                    placeholder="ID number"
                    className="mt-1"
                    required
                    data-testid="input-kyc-idnumber"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="idDocument" className="text-sm font-medium">
                  Upload ID Document <span className="text-red-500">*</span>
                </Label>
                <div className="mt-1">
                  <Input
                    id="idDocument"
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => setIdDocumentFile(e.target.files?.[0] || null)}
                    className="cursor-pointer"
                    required
                    data-testid="input-kyc-document"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Clear photo or scan of your ID (JPG, PNG, or PDF, max 10MB)
                  </p>
                  {idDocumentFile && (
                    <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" />
                      {idDocumentFile.name} selected
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Signature */}
            <div className="space-y-4">
              <h3 className="font-semibold text-lg text-slate-900">Signature <span className="text-red-500">*</span></h3>
              
              <div>
                <Label htmlFor="signature" className="text-sm font-medium">
                  Upload Signature <span className="text-red-500">*</span>
                </Label>
                <div className="mt-1">
                  <Input
                    id="signature"
                    type="file"
                    accept="image/*"
                    onChange={(e) => setSignatureFile(e.target.files?.[0] || null)}
                    className="cursor-pointer"
                    required
                    data-testid="input-kyc-signature"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Upload a clear image of your signature (JPG or PNG, max 5MB)
                  </p>
                  {signatureFile && (
                    <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" />
                      {signatureFile.name} selected
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Selfie (Optional) */}
            <div className="space-y-4">
              <h3 className="font-semibold text-lg text-slate-900">Selfie Verification (Optional)</h3>
              
              <div>
                <Label htmlFor="selfie" className="text-sm font-medium">
                  Upload a Selfie
                </Label>
                <div className="mt-1">
                  <Input
                    id="selfie"
                    type="file"
                    accept="image/*"
                    onChange={(e) => setSelfieFile(e.target.files?.[0] || null)}
                    className="cursor-pointer"
                    data-testid="input-kyc-selfie"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    A clear photo of your face for identity verification (Optional)
                  </p>
                  {selfieFile && (
                    <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" />
                      {selfieFile.name} selected
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setKycModalOpen(false)}
                className="flex-1"
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1 bg-blue-600 hover:bg-blue-700"
                disabled={submitting}
                data-testid="button-submit-kyc"
              >
                {submitting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Submitting...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Submit for Verification
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}