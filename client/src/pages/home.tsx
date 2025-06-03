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
import { CheckCircle, MapPin, Clock, Users, Shield, Lock, TrendingUp, Award } from "lucide-react";
import type { Property, InsertInvestmentReservation, InsertDeveloperBid } from "@shared/schema";

export default function Home() {
  const { toast } = useToast();
  const [investmentModalOpen, setInvestmentModalOpen] = useState(false);
  const [developerModalOpen, setDeveloperModalOpen] = useState(false);
  const [successModalOpen, setSuccessModalOpen] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [successMessage, setSuccessMessage] = useState("");

  // Form states
  const [investmentForm, setInvestmentForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    units: "",
    referralCode: ""
  });

  const [developerForm, setDeveloperForm] = useState({
    companyName: "",
    contactPerson: "",
    email: "",
    phone: "",
    projectType: "",
    location: "",
    projectValue: "",
    timeline: "",
    description: "",
    experience: ""
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
        companyName: "",
        contactPerson: "",
        email: "",
        phone: "",
        projectType: "",
        location: "",
        projectValue: "",
        timeline: "",
        description: "",
        experience: ""
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
      companyName: developerForm.companyName,
      contactPerson: developerForm.contactPerson,
      email: developerForm.email,
      phone: developerForm.phone,
      projectType: developerForm.projectType,
      location: developerForm.location,
      projectValue: parseInt(developerForm.projectValue),
      timeline: parseInt(developerForm.timeline),
      description: developerForm.description,
      experience: developerForm.experience,
    };

    developerMutation.mutate(bidData);
  };

  const openInvestmentModal = (property: Property) => {
    setSelectedProperty(property);
    setInvestmentModalOpen(true);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-blue-600">Brikvest</h1>
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
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="bg-gradient-to-br from-blue-600 to-blue-800 text-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold leading-tight mb-6">
                Invest in Premium Real Estate with{" "}
                <span className="text-yellow-400">Fractional Ownership</span>
              </h1>
              <p className="text-xl text-blue-100 mb-8 leading-relaxed">
                Start building your real estate portfolio with as little as ₦500,000. Access premium Nigerian properties and earn passive income through our curated investment opportunities.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button 
                  onClick={() => document.getElementById('properties')?.scrollIntoView({ behavior: 'smooth' })}
                  className="bg-yellow-500 hover:bg-yellow-600 text-black px-8 py-4 text-lg font-semibold"
                >
                  Browse Properties
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
                  className="border-2 border-white text-white hover:bg-white hover:text-blue-600 px-8 py-4 text-lg font-semibold"
                >
                  Learn More
                </Button>
              </div>
              <div className="flex items-center mt-8 space-x-8">
                <div className="text-center">
                  <div className="text-2xl font-bold">₦1.2B+</div>
                  <div className="text-blue-200 text-sm">Total Invested</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">850+</div>
                  <div className="text-blue-200 text-sm">Active Investors</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">15.2%</div>
                  <div className="text-blue-200 text-sm">Avg. Annual Return</div>
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
                <Card key={property.id} className="overflow-hidden border border-slate-200 hover:shadow-xl transition-shadow">
                  <img 
                    src={property.imageUrl} 
                    alt={property.name}
                    className="w-full h-48 object-cover"
                  />
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
                    <Button 
                      onClick={() => openInvestmentModal(property)}
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
              <h3 className="text-2xl font-bold mb-4">Brikvest</h3>
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
              <div>
                <Label htmlFor="contactPerson">Contact Person *</Label>
                <Input
                  id="contactPerson"
                  type="text"
                  required
                  value={developerForm.contactPerson}
                  onChange={(e) => setDeveloperForm(prev => ({ ...prev, contactPerson: e.target.value }))}
                  placeholder="Primary contact name"
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
            <div>
              <Label htmlFor="projectType">Project Type *</Label>
              <Select value={developerForm.projectType} onValueChange={(value) => setDeveloperForm(prev => ({ ...prev, projectType: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select project type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="residential">Residential Development</SelectItem>
                  <SelectItem value="commercial">Commercial Development</SelectItem>
                  <SelectItem value="mixed-use">Mixed-Use Development</SelectItem>
                  <SelectItem value="retail">Retail Development</SelectItem>
                  <SelectItem value="industrial">Industrial Development</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="devLocation">Project Location *</Label>
              <Input
                id="devLocation"
                type="text"
                required
                value={developerForm.location}
                onChange={(e) => setDeveloperForm(prev => ({ ...prev, location: e.target.value }))}
                placeholder="City, State"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label htmlFor="projectValue">Estimated Project Value *</Label>
                <Input
                  id="projectValue"
                  type="number"
                  required
                  value={developerForm.projectValue}
                  onChange={(e) => setDeveloperForm(prev => ({ ...prev, projectValue: e.target.value }))}
                  placeholder="Total project cost"
                />
              </div>
              <div>
                <Label htmlFor="timeline">Timeline (Months) *</Label>
                <Input
                  id="timeline"
                  type="number"
                  required
                  value={developerForm.timeline}
                  onChange={(e) => setDeveloperForm(prev => ({ ...prev, timeline: e.target.value }))}
                  placeholder="Expected completion time"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="description">Project Description *</Label>
              <Textarea
                id="description"
                required
                rows={4}
                value={developerForm.description}
                onChange={(e) => setDeveloperForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Detailed description of your development project..."
              />
            </div>
            <div>
              <Label htmlFor="experience">Years of Experience *</Label>
              <Select value={developerForm.experience} onValueChange={(value) => setDeveloperForm(prev => ({ ...prev, experience: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select experience level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0-2">0-2 Years</SelectItem>
                  <SelectItem value="3-5">3-5 Years</SelectItem>
                  <SelectItem value="6-10">6-10 Years</SelectItem>
                  <SelectItem value="11-20">11-20 Years</SelectItem>
                  <SelectItem value="20+">20+ Years</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button 
              type="submit" 
              className="w-full bg-green-600 hover:bg-green-700"
              disabled={developerMutation.isPending}
            >
              {developerMutation.isPending ? "Submitting..." : "Submit Development Bid"}
            </Button>
          </form>
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
