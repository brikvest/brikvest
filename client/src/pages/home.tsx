import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CheckCircle, MapPin, Clock, Users, Shield, Lock, TrendingUp, Award, FileText, Download, ExternalLink, Menu, X } from "lucide-react";
import type { Property, InsertInvestmentReservation, InsertDeveloperBid } from "@shared/schema";
import brikvest_logo from "@/assets/brikvest-logo.png";

export default function Home() {
  const { toast } = useToast();
  const [investmentModalOpen, setInvestmentModalOpen] = useState(false);
  const [developerModalOpen, setDeveloperModalOpen] = useState(false);
  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [propertyDetailModalOpen, setPropertyDetailModalOpen] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Form states
  const [investmentForm, setInvestmentForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    units: "",
    referralCode: ""
  });

  const [developerForm, setDeveloperForm] = useState({
    developerName: "",
    companyName: "",
    email: "",
    phone: "",
    estimatedCost: 0,
    costCurrency: "NGN",
    description: "",
    timeline: 0,
    pastProjectLink: "",
    pastProjectFile: "",
    whySelected: ""
  });

  // Fetch properties
  const { data: properties = [], isLoading } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  // Seed properties on first load if none exist
  useEffect(() => {
    if (properties.length === 0 && !isLoading) {
      apiRequest("POST", "/api/seed-properties").catch(console.error);
    }
  }, [properties.length, isLoading]);

  // Investment reservation mutation
  const investmentMutation = useMutation({
    mutationFn: async (data: InsertInvestmentReservation) => {
      const response = await apiRequest("POST", "/api/reservations", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      setInvestmentModalOpen(false);
      setSuccessMessage("Your investment slot has been reserved successfully! We'll contact you soon with next steps.");
      setSuccessModalOpen(true);
      setInvestmentForm({
        fullName: "",
        email: "",
        phone: "",
        units: "",
        referralCode: ""
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to reserve investment slot",
        variant: "destructive",
      });
    },
  });

  // Developer bid mutation
  const developerMutation = useMutation({
    mutationFn: async (data: InsertDeveloperBid) => {
      const response = await apiRequest("POST", "/api/developer-bids", data);
      return response.json();
    },
    onSuccess: () => {
      setDeveloperModalOpen(false);
      setSuccessMessage("Your development bid has been submitted successfully! Our team will review it and get back to you within 48 hours.");
      setSuccessModalOpen(true);
      setDeveloperForm({
        developerName: "",
        companyName: "",
        email: "",
        phone: "",
        estimatedCost: 0,
        costCurrency: "NGN",
        description: "",
        timeline: 0,
        pastProjectLink: "",
        pastProjectFile: "",
        whySelected: ""
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to submit developer bid",
        variant: "destructive",
      });
    },
  });

  const handleInvestmentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProperty) return;

    const reservationData: InsertInvestmentReservation = {
      propertyId: selectedProperty.id,
      fullName: investmentForm.fullName,
      email: investmentForm.email,
      phone: investmentForm.phone,
      units: parseInt(investmentForm.units),
      referralCode: investmentForm.referralCode || undefined,
    };

    investmentMutation.mutate(reservationData);
  };

  const handleDeveloperSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const bidData: InsertDeveloperBid = {
      developerName: developerForm.developerName,
      companyName: developerForm.companyName,
      email: developerForm.email,
      phone: developerForm.phone,
      estimatedCost: developerForm.estimatedCost,
      costCurrency: developerForm.costCurrency,
      description: developerForm.description,
      timeline: developerForm.timeline,
      pastProjectLink: developerForm.pastProjectLink || undefined,
      pastProjectFile: developerForm.pastProjectFile || undefined,
      whySelected: developerForm.whySelected,
    };

    developerMutation.mutate(bidData);
  };

  const openInvestmentModal = (property: Property) => {
    setSelectedProperty(property);
    setInvestmentModalOpen(true);
  };

  const openPropertyDetailModal = (property: Property) => {
    setSelectedProperty(property);
    setPropertyDetailModalOpen(true);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
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
      <header className="bg-white shadow-sm border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <img 
                src={brikvest_logo} 
                alt="Brikvest Logo" 
                className="h-8 w-auto"
              />
            </div>
            <nav className="hidden md:block">
              <div className="ml-10 flex items-baseline space-x-8">
                <a href="#properties" className="text-slate-600 hover:text-blue-600 px-3 py-2 text-sm font-medium transition-colors">
                  Properties
                </a>

                <a href="#how-it-works" className="text-slate-600 hover:text-blue-600 px-3 py-2 text-sm font-medium transition-colors">
                  How It Works
                </a>
                <a href="#developers" className="text-slate-600 hover:text-blue-600 px-3 py-2 text-sm font-medium transition-colors">
                  For Developers
                </a>
              </div>
            </nav>
            <div className="hidden md:block">
              <Button 
                onClick={() => document.getElementById('properties')?.scrollIntoView({ behavior: 'smooth' })}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                Get Started
              </Button>
            </div>
            
            {/* Mobile menu button */}
            <div className="md:hidden">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="text-slate-600 hover:text-blue-600"
              >
                {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
              </Button>
            </div>
          </div>
          
          {/* Mobile menu */}
          {mobileMenuOpen && (
            <div className="md:hidden">
              <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3 bg-white border-t border-slate-200">
                <a 
                  href="#properties" 
                  className="text-slate-600 hover:text-blue-600 block px-3 py-2 text-base font-medium"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Properties
                </a>

                <a 
                  href="#how-it-works" 
                  className="text-slate-600 hover:text-blue-600 block px-3 py-2 text-base font-medium"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  How It Works
                </a>
                <a 
                  href="#developers" 
                  className="text-slate-600 hover:text-blue-600 block px-3 py-2 text-base font-medium"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  For Developers
                </a>
                <div className="pt-4">
                  <Button 
                    onClick={() => {
                      document.getElementById('properties')?.scrollIntoView({ behavior: 'smooth' });
                      setMobileMenuOpen(false);
                    }}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    Get Started
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Hero Section */}
      <section className="bg-gradient-to-br from-blue-50 to-slate-100 text-slate-800 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight mb-6">
                Invest in Premium Real Estate with{" "}
                <span className="text-blue-600">Fractional Ownership</span>
              </h1>
              <p className="text-xl text-slate-600 mb-8 leading-relaxed">
                Start building your real estate portfolio with as little as ₦500,000. Access premium Nigerian properties and earn passive income through our curated investment opportunities.
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
                  <div className="text-2xl font-bold text-slate-800">₦90.8M+</div>
                  <div className="text-slate-500 text-sm">Total Invested</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-slate-800">22+</div>
                  <div className="text-slate-500 text-sm">Active Investors</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-slate-800">15.2%</div>
                  <div className="text-slate-500 text-sm">Avg. Annual Return</div>
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
              <h3 className="text-xl font-semibold mb-4">Reserve Your Slot</h3>
              <p className="text-slate-600">
                Secure your investment slot by choosing the number of units and providing your details. No payment required to reserve.
              </p>
            </div>
            <div className="text-center">
              <div className="bg-yellow-500 text-white w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 text-2xl font-bold">
                3
              </div>
              <h3 className="text-xl font-semibold mb-4">Earn Returns</h3>
              <p className="text-slate-600">
                Receive regular distributions and watch your investment grow through property appreciation and rental income.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Properties Section */}
      <section id="properties" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              Featured Investment Properties
            </h2>
            <p className="text-xl text-slate-600 max-w-3xl mx-auto">
              Carefully selected properties with strong growth potential and steady returns
            </p>
          </div>

          {isLoading ? (
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
              {properties.map((property) => (
                <Card key={property.id} className="overflow-hidden border border-slate-200 hover:shadow-xl transition-shadow cursor-pointer">
                  <div onClick={() => openPropertyDetailModal(property)}>
                    <div className="relative">
                      <img 
                        src={property.imageUrl} 
                        alt={property.name}
                        className="w-full h-48 object-cover"
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
                          <span className="text-slate-600">Total Value:</span>
                          <div className="font-semibold">{formatCurrency(property.totalValue)}</div>
                        </div>
                        <div>
                          <span className="text-slate-600">Min. Investment:</span>
                          <div className="font-semibold text-green-600">{formatCurrency(property.minInvestment)}</div>
                        </div>
                        <div>
                          <span className="text-slate-600">Projected Return:</span>
                          <div className="font-semibold text-green-600">{property.projectedReturn}%</div>
                        </div>
                        <div>
                          <span className="text-slate-600">Available Slots:</span>
                          <div className="font-semibold">{property.availableSlots} / {property.totalSlots}</div>
                        </div>
                      </div>
                      <div className="mb-4">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-sm text-slate-600">Funding Progress</span>
                          <span className="text-sm font-medium">{property.fundingProgress}%</span>
                        </div>
                        <div className="w-full bg-slate-200 rounded-full h-2">
                          <div 
                            className="bg-green-600 h-2 rounded-full transition-all duration-300" 
                            style={{ width: `${property.fundingProgress}%` }}
                          />
                        </div>
                      </div>
                    </CardContent>
                  </div>
                  <CardContent className="px-6 pb-6">
                    <Button 
                      onClick={(e) => {
                        e.stopPropagation();
                        openInvestmentModal(property);
                      }}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      Reserve Investment Slot
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </section>



      {/* Developer Section */}
      <section id="developers" className="py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <img 
                src="https://images.unsplash.com/photo-1504307651254-35680f356dfd?ixlib=rb-4.0.3&auto=format&fit=crop&w=800&h=600" 
                alt="Construction site with modern building development and cranes" 
                className="rounded-2xl shadow-lg w-full h-auto"
              />
            </div>
            <div>
              <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-6">For Developers</h2>
              <p className="text-xl text-slate-600 mb-8">
                Join our network of trusted developers and bid on exciting new projects. Access capital from our investor community and bring your vision to life.
              </p>
              <div className="space-y-4 mb-8">
                <div className="flex items-center">
                  <CheckCircle className="text-green-600 w-5 h-5 mr-4" />
                  <span className="text-slate-700">Access to vetted investor network</span>
                </div>
                <div className="flex items-center">
                  <CheckCircle className="text-green-600 w-5 h-5 mr-4" />
                  <span className="text-slate-700">Competitive bidding platform</span>
                </div>
                <div className="flex items-center">
                  <CheckCircle className="text-green-600 w-5 h-5 mr-4" />
                  <span className="text-slate-700">Project management support</span>
                </div>
                <div className="flex items-center">
                  <CheckCircle className="text-green-600 w-5 h-5 mr-4" />
                  <span className="text-slate-700">Transparent evaluation process</span>
                </div>
              </div>
              <Button 
                onClick={() => setDeveloperModalOpen(true)}
                className="bg-green-600 hover:bg-green-700 text-white px-8 py-4 text-lg font-semibold"
              >
                Submit Development Bid
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Trust & Security Section */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">Trusted by Thousands</h2>
            <p className="text-xl text-slate-600 max-w-3xl mx-auto">Your investment security is our top priority</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Shield className="text-blue-600 w-8 h-8" />
              </div>
              <h3 className="font-semibold mb-2">Transparent Operations</h3>
              <p className="text-slate-600 text-sm">Full transparency in all our investment processes and operations</p>
            </div>
            <div className="text-center">
              <div className="bg-green-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Lock className="text-green-600 w-8 h-8" />
              </div>
              <h3 className="font-semibold mb-2">Bank-Level Security</h3>
              <p className="text-slate-600 text-sm">256-bit SSL encryption protects your data</p>
            </div>
            <div className="text-center">
              <div className="bg-yellow-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <TrendingUp className="text-yellow-600 w-8 h-8" />
              </div>
              <h3 className="font-semibold mb-2">No Payment Required</h3>
              <p className="text-slate-600 text-sm">Reserve investment slots without payment - we contact you when ready</p>
            </div>
            <div className="text-center">
              <div className="bg-blue-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="text-blue-600 w-8 h-8" />
              </div>
              <h3 className="font-semibold mb-2">Expert Nigerian Team</h3>
              <p className="text-slate-600 text-sm">Local real estate professionals with deep market knowledge</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
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
                <li><a href="#" className="text-slate-300 hover:text-white transition-colors">About Us</a></li>
                <li><a href="#" className="text-slate-300 hover:text-white transition-colors">How It Works</a></li>
                <li><a href="#" className="text-slate-300 hover:text-white transition-colors">Security</a></li>
                <li><a href="#" className="text-slate-300 hover:text-white transition-colors">Careers</a></li>
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
            <p className="text-slate-400">&copy; 2024 Brikvest. All rights reserved. Investment opportunities subject to terms and conditions.</p>
          </div>
        </div>
      </footer>

      {/* Investment Modal */}
      <Dialog open={investmentModalOpen} onOpenChange={setInvestmentModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reserve Investment Slot</DialogTitle>
            <DialogDescription>
              Fill out the form below to reserve your investment slot. No payment required at this time.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleInvestmentSubmit} className="space-y-6">
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
            <div>
              <Label htmlFor="units">Number of Units *</Label>
              <Select value={investmentForm.units} onValueChange={(value) => setInvestmentForm(prev => ({ ...prev, units: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select units to reserve" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 Unit ({formatCurrency(selectedProperty?.minInvestment || 1000)})</SelectItem>
                  <SelectItem value="5">5 Units ({formatCurrency((selectedProperty?.minInvestment || 1000) * 5)})</SelectItem>
                  <SelectItem value="10">10 Units ({formatCurrency((selectedProperty?.minInvestment || 1000) * 10)})</SelectItem>
                  <SelectItem value="25">25 Units ({formatCurrency((selectedProperty?.minInvestment || 1000) * 25)})</SelectItem>
                  <SelectItem value="50">50 Units ({formatCurrency((selectedProperty?.minInvestment || 1000) * 50)})</SelectItem>
                </SelectContent>
              </Select>
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

      {/* Developer Modal */}
      <Dialog open={developerModalOpen} onOpenChange={setDeveloperModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Submit Development Bid</DialogTitle>
            <DialogDescription>
              Join our network of trusted developers. Complete the form below to submit your development proposal.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleDeveloperSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label htmlFor="developerName">Developer Name *</Label>
                <Input
                  id="developerName"
                  type="text"
                  required
                  value={developerForm.developerName}
                  onChange={(e) => setDeveloperForm(prev => ({ ...prev, developerName: e.target.value }))}
                  placeholder="Your full name"
                />
              </div>
              <div>
                <Label htmlFor="companyName">Company Name *</Label>
                <Input
                  id="companyName"
                  type="text"
                  required
                  value={developerForm.companyName}
                  onChange={(e) => setDeveloperForm(prev => ({ ...prev, companyName: e.target.value }))}
                  placeholder="Your company name"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label htmlFor="devEmail">Email Address *</Label>
                <Input
                  id="devEmail"
                  type="email"
                  required
                  value={developerForm.email}
                  onChange={(e) => setDeveloperForm(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="Business email"
                />
              </div>
              <div>
                <Label htmlFor="devPhone">Phone Number *</Label>
                <Input
                  id="devPhone"
                  type="tel"
                  required
                  value={developerForm.phone}
                  onChange={(e) => setDeveloperForm(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="Business phone"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label htmlFor="estimatedCost">Estimated Construction Cost *</Label>
                <Input
                  id="estimatedCost"
                  type="number"
                  required
                  value={developerForm.estimatedCost}
                  onChange={(e) => setDeveloperForm(prev => ({ ...prev, estimatedCost: parseInt(e.target.value) || 0 }))}
                  placeholder="Enter amount"
                />
              </div>
              <div>
                <Label htmlFor="costCurrency">Currency *</Label>
                <Select value={developerForm.costCurrency} onValueChange={(value) => setDeveloperForm(prev => ({ ...prev, costCurrency: value }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select currency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NGN">₦ Nigerian Naira</SelectItem>
                    <SelectItem value="USD">$ US Dollar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="description">Description of Proposed Development *</Label>
              <Textarea
                id="description"
                required
                rows={4}
                value={developerForm.description}
                onChange={(e) => setDeveloperForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Type of structure, number of units, target market, financial projections..."
              />
            </div>
            <div>
              <Label htmlFor="timeline">Estimated Timeline (in months) *</Label>
              <Input
                id="timeline"
                type="number"
                required
                value={developerForm.timeline}
                onChange={(e) => setDeveloperForm(prev => ({ ...prev, timeline: parseInt(e.target.value) || 0 }))}
                placeholder="e.g., 24"
              />
            </div>
            <div>
              <Label htmlFor="pastProjectLink">Past Project Link (Optional)</Label>
              <Input
                id="pastProjectLink"
                type="url"
                value={developerForm.pastProjectLink}
                onChange={(e) => setDeveloperForm(prev => ({ ...prev, pastProjectLink: e.target.value }))}
                placeholder="https://example.com/project"
              />
            </div>
            <div>
              <Label htmlFor="pastProjectFile">📎 Upload a Similar Past Project (Optional)</Label>
              <Input
                id="pastProjectFile"
                type="file"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setDeveloperForm(prev => ({ ...prev, pastProjectFile: file.name }));
                  }
                }}
              />
              <p className="text-sm text-muted-foreground mt-1">
                {developerForm.pastProjectFile || "No file chosen"}
              </p>
            </div>
            <div>
              <Label htmlFor="whySelected">Why Should You Be Selected? *</Label>
              <Textarea
                id="whySelected"
                required
                rows={4}
                value={developerForm.whySelected}
                onChange={(e) => setDeveloperForm(prev => ({ ...prev, whySelected: e.target.value }))}
                placeholder="Explain why your company is a good fit for this development opportunity..."
              />
            </div>
            <Button 
              type="submit" 
              className="w-full bg-green-600 hover:bg-green-700"
              disabled={developerMutation.isPending}
            >
              {developerMutation.isPending ? "Submitting..." : "Submit Bid"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Property Detail Modal */}
      <Dialog open={propertyDetailModalOpen} onOpenChange={setPropertyDetailModalOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          {selectedProperty && (
            <>
              <DialogHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <DialogTitle className="text-2xl font-bold">{selectedProperty.name}</DialogTitle>
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

              <div className="space-y-8">
                {/* Property Image */}
                <div className="relative">
                  <img 
                    src={selectedProperty.imageUrl} 
                    alt={selectedProperty.name}
                    className="w-full h-64 object-cover rounded-lg"
                  />
                  <div className="absolute top-4 right-4">
                    <span className="bg-green-600 text-white px-3 py-1 rounded-full text-sm font-medium">
                      {selectedProperty.projectedReturn}% Annual ROI
                    </span>
                  </div>
                </div>

                {/* Investment Details */}
                <div>
                  <h3 className="text-xl font-semibold mb-4">Investment Details</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <div>
                        <span className="text-slate-600">Location:</span>
                        <div className="font-semibold">{selectedProperty.location}</div>
                      </div>
                      <div>
                        <span className="text-slate-600">Land Size:</span>
                        <div className="font-semibold">1,700 sqm</div>
                      </div>
                      <div>
                        <span className="text-slate-600">Funding Target:</span>
                        <div className="font-semibold">{formatCurrency(selectedProperty.totalValue)}</div>
                      </div>
                      <div>
                        <span className="text-slate-600">Total Invested:</span>
                        <div className="font-semibold text-green-600">
                          {formatCurrency((selectedProperty.totalSlots - selectedProperty.availableSlots) * selectedProperty.minInvestment)}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <span className="text-slate-600">Minimum Investment:</span>
                        <div className="font-semibold text-green-600">{formatCurrency(selectedProperty.minInvestment)}</div>
                      </div>
                      <div>
                        <span className="text-slate-600">Maturity Date:</span>
                        <div className="font-semibold">5/6/2033</div>
                      </div>
                      <div>
                        <span className="text-slate-600">Annual ROI:</span>
                        <div className="font-semibold text-green-600">{selectedProperty.projectedReturn}%</div>
                      </div>
                      <div>
                        <span className="text-slate-600">Exit Strategy:</span>
                        <div className="font-semibold">7-year exit with ongoing rental income and resale flexibility</div>
                      </div>
                    </div>
                  </div>

                  {/* Funding Progress */}
                  <div className="mt-6">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-medium">Funding Progress</span>
                      <span className="font-semibold">{selectedProperty.fundingProgress}%</span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-3">
                      <div 
                        className="bg-green-600 h-3 rounded-full transition-all duration-300" 
                        style={{ width: `${selectedProperty.fundingProgress}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Partnership Verification */}
                {selectedProperty.badge === 'partnered' && selectedProperty.partnershipDocumentUrl && (
                  <div>
                    <h3 className="text-xl font-semibold mb-4">Partnership Verification</h3>
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
                          <div className="flex flex-col sm:flex-row gap-3">
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

                {/* Description */}
                <div>
                  <h3 className="text-xl font-semibold mb-4">Description</h3>
                  <div className="prose prose-slate max-w-none">
                    <p className="mb-4">
                      We are excited to offer investors a unique opportunity to co-invest in a high-value residential development located in Guzape, one of Abuja's most prestigious and secure neighborhoods.
                    </p>

                    <div className="mb-4">
                      <h4 className="font-semibold mb-2">📍 Strategic Location Highlights:</h4>
                      <ul className="list-disc ml-6 space-y-1">
                        <li>35-minute drive from Nnamdi Azikiwe International Airport</li>
                        <li>10-minute drive from the Central Business District</li>
                        <li>5-minute proximity to premium supermarkets and shopping centers</li>
                        <li>Situated in a neighborhood known for security and infrastructure, with an average of 20 hours of power supply daily</li>
                      </ul>
                    </div>

                    <p className="mb-4">
                      Investors may exit early by reselling their shares to other users on the platform.
                    </p>

                    <p className="mb-4">
                      Before development begins, all investors will vote to select the preferred real estate developer, based on submitted proposals via the platform.
                    </p>

                    <p className="mb-4">
                      This is an opportunity to participate in a professionally managed, income-generating real estate project in a high-demand location—while retaining flexibility and collective decision-making power.
                    </p>

                    <p className="font-medium">
                      👉 If you're interested in investing, please sign up to express your interest and you will be informed of the next steps.
                    </p>
                  </div>
                </div>

                {/* Developer Notes */}
                <div>
                  <h3 className="text-xl font-semibold mb-4">Developer Notes</h3>
                  <div className="space-y-4">
                    <p>
                      We are inviting bids from real estate developers to design and execute a high-income-generating project on the 1,700 sqm land at {selectedProperty.location}.
                    </p>

                    <div>
                      <h4 className="font-semibold mb-2">Key Requirements:</h4>
                      <ul className="list-disc ml-6 space-y-2 text-slate-700">
                        <li><strong>Development Type:</strong> Multi-unit residential apartments are strongly preferred. Ideal configurations: Studio, 1-bedroom, 2-bedroom, and 3-bedroom units.</li>
                        <li><strong>Occupancy Goal:</strong> Minimum capacity to serve 50 tenants or more.</li>
                        <li><strong>Alternative Consideration:</strong> Villas may be considered, but only if the proposed development demonstrates very high income-generating potential.</li>
                        <li><strong>Exit Plan:</strong> The exit timeline is 7 years from project commencement.</li>
                      </ul>
                    </div>

                    <div>
                      <p className="font-semibold mb-2">Developers are expected to:</p>
                      <ul className="list-disc ml-6 space-y-1 text-slate-700">
                        <li>Generate rental income during this period</li>
                        <li>Strategically sell all units before the 7-year timeline</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="font-semibold mb-2">Application Process:</h4>
                      <ul className="list-disc ml-6 space-y-2 text-slate-700">
                        <li>Click the "Bid to Develop" button and submit a proposal including approximate financial projections and target unit mix.</li>
                        <li>Share your track record and past completed projects to strengthen your application.</li>
                        <li>Successful applicants from this first stage will be contacted for a due diligence phase, where we will assess project feasibility and your capacity to deliver.</li>
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-4 pt-6 border-t border-slate-200">
                  <Button 
                    onClick={() => {
                      setPropertyDetailModalOpen(false);
                      setDeveloperModalOpen(true);
                    }}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                  >
                    Bid to Develop
                  </Button>
                  <Button 
                    onClick={() => {
                      setPropertyDetailModalOpen(false);
                      openInvestmentModal(selectedProperty);
                    }}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    Reserve Investment Slot
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
            onClick={() => setSuccessModalOpen(false)}
            className="bg-blue-600 hover:bg-blue-700"
          >
            Close
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}