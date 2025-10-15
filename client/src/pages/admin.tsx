import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { ArrowLeft, Users, Building, FileText, Calendar, Mail, Phone, MapPin, Plus, Upload, BarChart3, Home, ExternalLink, Download, Eye, Edit, Trash2, Menu, Target, TrendingUp, LogOut, User, Shield, CheckCircle, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { FileUpload } from "@/components/FileUpload";
import { RichTextEditor } from "@/components/RichTextEditor";
import { PropertyMediaCarousel } from "@/components/PropertyMediaCarousel";
import type { Property, InvestmentReservation, DeveloperBid, InsertProperty, VerificationStep, MarketInsight } from "@shared/schema";
import { FileUploader } from "@/components/FileUploader";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

// Helper function to get currency symbol
const getCurrencySymbol = (currency: string) => {
  switch (currency) {
    case 'NGN': return '₦';
    case 'USD': return '$';
    default: return currency;
  }
};

export default function AdminDashboard() {
  const [selectedTab, setSelectedTab] = useState("overview");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, logout, authenticatedRequest } = useAdminAuth();

  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [viewingProperty, setViewingProperty] = useState<Property | null>(null);
  const [viewingReservation, setViewingReservation] = useState<InvestmentReservation | null>(null);
  const [viewingDeveloperBid, setViewingDeveloperBid] = useState<DeveloperBid | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isReservationViewOpen, setIsReservationViewOpen] = useState(false);
  const [isDeveloperBidViewOpen, setIsDeveloperBidViewOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deletingProperty, setDeletingProperty] = useState<Property | null>(null);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [isDraftSaved, setIsDraftSaved] = useState(false);
  
  // Verification state
  const [selectedPropertyForVerification, setSelectedPropertyForVerification] = useState<Property | null>(null);
  const [verificationStepBeingEdited, setVerificationStepBeingEdited] = useState<any>(null);
  const [isVerificationDialogOpen, setIsVerificationDialogOpen] = useState(false);
  const [uploadingVerificationPhoto, setUploadingVerificationPhoto] = useState(false);

  const [propertyForm, setPropertyForm] = useState({
    name: "",
    location: "",
    description: "",
    totalValue: "",
    minInvestment: "",
    totalSlots: "",
    availableSlots: "",
    imageUrl: "",
    propertyType: "land",
    badge: "none" as string | null,
    partnershipDocumentName: "",
    partnershipDocumentUrl: "",
    developerNotes: "",
    investmentDetails: "",
    videoUrl: "",
    gallery: [] as string[],
    status: "active",
    currency: "NGN"
  });

  // Fetch properties
  const { data: properties = [], isLoading: propertiesLoading } = useQuery({
    queryKey: ["/api/properties"],
    queryFn: () => fetch("/api/properties").then(res => res.json())
  });

  // Fetch reservations
  const { data: reservations = [], isLoading: reservationsLoading } = useQuery({
    queryKey: ["/api/reservations/all"],
    queryFn: async () => {
      const response = await fetch("/api/reservations/all");
      if (!response.ok) return [];
      return response.json();
    }
  });

  // Fetch developer bids
  const { data: developerBids = [], isLoading: bidsLoading } = useQuery({
    queryKey: ["/api/developer-bids"],
    queryFn: async () => {
      const response = await fetch("/api/developer-bids");
      if (!response.ok) return [];
      return response.json();
    }
  });

  // Fetch verification steps
  const { data: verificationSteps = [] } = useQuery({
    queryKey: ["/api/verification-steps"],
    queryFn: async () => {
      const response = await fetch("/api/verification-steps");
      if (!response.ok) return [];
      return response.json();
    }
  });

  // Fetch verification checklist for selected property
  const { data: propertyVerificationData = [], refetch: refetchVerification } = useQuery({
    queryKey: ["/api/properties", selectedPropertyForVerification?.id, "verification"],
    queryFn: async () => {
      if (!selectedPropertyForVerification) return [];
      const response = await fetch(`/api/properties/${selectedPropertyForVerification.id}/verification`);
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!selectedPropertyForVerification
  });

  // Mutations
  const markAsPaidMutation = useMutation({
    mutationFn: async (reservationId: number) => {
      return await authenticatedRequest(`/api/reservations/${reservationId}/mark-paid`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reservations/all"] });
      toast({ title: "Success", description: "Payment confirmation sent to investor!" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  });

  const createPropertyMutation = useMutation({
    mutationFn: async (data: InsertProperty) => {
      return await authenticatedRequest("/api/properties", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      toast({ title: "Property created successfully" });
      clearDraft(); // Clear draft on successful creation
      resetPropertyForm();
    },
    onError: (error) => {
      toast({ title: "Error creating property", description: error.message, variant: "destructive" });
    }
  });

  const updatePropertyMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: InsertProperty }) => {
      return await authenticatedRequest(`/api/properties/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      toast({ title: "Property updated successfully" });
      setIsEditDialogOpen(false);
      setEditingProperty(null);
    },
    onError: (error) => {
      toast({ title: "Error updating property", description: error.message, variant: "destructive" });
    }
  });

  const deletePropertyMutation = useMutation({
    mutationFn: async (id: number) => {
      return await authenticatedRequest(`/api/properties/${id}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      toast({ title: "Property deleted successfully" });
    },
    onError: (error) => {
      toast({ title: "Error deleting property", description: error.message, variant: "destructive" });
    }
  });

  // Verification mutations
  const updateVerificationChecklistMutation = useMutation({
    mutationFn: async ({ propertyId, enabledSteps }: { propertyId: number; enabledSteps: number[] }) => {
      return await authenticatedRequest(`/api/properties/${propertyId}/verification`, {
        method: "POST",
        body: JSON.stringify({ enabledSteps }),
      });
    },
    onSuccess: () => {
      refetchVerification();
      toast({ title: "Verification checklist updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error updating checklist", description: error.message, variant: "destructive" });
    }
  });

  const updateVerificationStepMutation = useMutation({
    mutationFn: async ({ propertyId, stepId, data }: { propertyId: number; stepId: number; data: any }) => {
      return await authenticatedRequest(`/api/properties/${propertyId}/verification/${stepId}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      refetchVerification();
      toast({ title: "Verification step updated successfully" });
      setIsVerificationDialogOpen(false);
      setVerificationStepBeingEdited(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error updating verification step", description: error.message, variant: "destructive" });
    }
  });

  // Helper functions
  const formatCurrency = (amount: number) => {
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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const openPropertyDetailModal = (property: Property) => {
    setViewingProperty(property);
    setIsViewDialogOpen(true);
  };

  const openReservationDetailModal = (reservation: InvestmentReservation) => {
    setViewingReservation(reservation);
    setIsReservationViewOpen(true);
  };

  const openDeveloperBidDetailModal = (bid: DeveloperBid) => {
    setViewingDeveloperBid(bid);
    setIsDeveloperBidViewOpen(true);
  };

  const resetPropertyForm = () => {
    setPropertyForm({
      name: "",
      location: "",
      description: "",
      totalValue: "",
      minInvestment: "",
      totalSlots: "",
      availableSlots: "",
      imageUrl: "",
      propertyType: "land",
      badge: "none" as string | null,
      partnershipDocumentName: "",
      partnershipDocumentUrl: "",
      developerNotes: "",
      investmentDetails: "",
      videoUrl: "",
      gallery: [] as string[],
      status: "active",
      currency: "NGN"
    });
    clearDraft(); // Clear draft when form is reset
    setIsDraftSaved(false);
  };

  const openDeleteConfirmation = (property: Property) => {
    setDeletingProperty(property);
    setDeleteConfirmationText("");
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteProperty = () => {
    if (deletingProperty && deleteConfirmationText === deletingProperty.name) {
      deletePropertyMutation.mutate(deletingProperty.id);
      setIsDeleteDialogOpen(false);
      setDeletingProperty(null);
      setDeleteConfirmationText("");
    }
  };

  // Draft functionality
  const DRAFT_KEY = 'property_draft';

  const saveToDraft = () => {
    const draftData = {
      ...propertyForm,
      timestamp: Date.now()
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draftData));
    setIsDraftSaved(true);
    toast({ title: "Draft saved", description: "Your property data has been saved locally" });
  };

  const loadFromDraft = () => {
    const savedDraft = localStorage.getItem(DRAFT_KEY);
    if (savedDraft) {
      try {
        const draftData = JSON.parse(savedDraft);
        delete draftData.timestamp; // Remove timestamp before setting form
        setPropertyForm(draftData);
        setIsDraftSaved(true);
        toast({ title: "Draft loaded", description: "Your saved property data has been restored" });
      } catch (error) {
        console.error('Error loading draft:', error);
        localStorage.removeItem(DRAFT_KEY);
      }
    }
  };

  const clearDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    setIsDraftSaved(false);
  };

  const hasUnsavedChanges = () => {
    const currentForm = JSON.stringify(propertyForm);
    const emptyForm = JSON.stringify({
      name: "",
      location: "",
      description: "",
      totalValue: "",
      minInvestment: "",
      totalSlots: "",
      availableSlots: "",
      imageUrl: "",
      propertyType: "land",
      badge: "none",
      partnershipDocumentName: "",
      partnershipDocumentUrl: "",
      developerNotes: "",
      investmentDetails: "",
      videoUrl: "",
      gallery: [],
      status: "active",
      currency: "NGN"
    });
    return currentForm !== emptyForm;
  };

  // Load draft on component mount
  useEffect(() => {
    const savedDraft = localStorage.getItem(DRAFT_KEY);
    if (savedDraft) {
      const shouldLoad = window.confirm(
        "You have a saved draft. Would you like to restore your previous property data?"
      );
      if (shouldLoad) {
        loadFromDraft();
      }
    }
  }, []);

  // Warn before page refresh if there are unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges() && !isDraftSaved) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return 'You have unsaved changes. Are you sure you want to leave?';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [propertyForm, isDraftSaved]);

  const handlePropertySubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate minimum content requirements
    const stripHtml = (html: string) => html.replace(/<[^>]*>/g, '').trim();
    
    if (stripHtml(propertyForm.description).length < 50) {
      toast({ title: "Description too short", description: "Please provide at least 50 characters for the description", variant: "destructive" });
      return;
    }
    
    // Developer notes are optional - no minimum length required
    
    if (stripHtml(propertyForm.investmentDetails).length < 30) {
      toast({ title: "Co-ownership details too short", description: "Please provide at least 30 characters for co-ownership details", variant: "destructive" });
      return;
    }

    // Calculate minimum investment automatically based on total value and slots
    const totalValue = parseInt(propertyForm.totalValue);
    const totalSlots = parseInt(propertyForm.totalSlots);
    const calculatedMinInvestment = Math.floor(totalValue / totalSlots);

    const propertyData: InsertProperty = {
      name: propertyForm.name,
      location: propertyForm.location,
      description: propertyForm.description, // Use admin's actual input
      totalValue: totalValue,
      minInvestment: calculatedMinInvestment, // Calculated automatically
      totalSlots: totalSlots,
      availableSlots: parseInt(propertyForm.availableSlots),
      imageUrl: propertyForm.imageUrl || "",
      videoUrl: propertyForm.videoUrl || null,
      gallery: propertyForm.gallery.length > 0 ? propertyForm.gallery : null,
      propertyType: propertyForm.propertyType,
      badge: propertyForm.badge === "none" ? null : propertyForm.badge,
      partnershipDocumentName: propertyForm.partnershipDocumentName || null,
      partnershipDocumentUrl: propertyForm.partnershipDocumentUrl || null,
      developerNotes: propertyForm.developerNotes, // Use admin's actual input  
      investmentDetails: propertyForm.investmentDetails, // Use admin's actual input
      status: propertyForm.status, // Include the status field
      currency: propertyForm.currency,
    };



    if (editingProperty) {
      updatePropertyMutation.mutate({ id: editingProperty.id, data: propertyData });
    } else {
      createPropertyMutation.mutate(propertyData);
    }
  };

  // Market Insights Content Component
  function MarketInsightsContent() {
    const { toast } = useToast();
    
    // Fetch Guzape graph data
    const { data: graphData, isLoading: graphLoading } = useQuery({
      queryKey: ['/api/scrape/guzape-graphs'],
      queryFn: async () => {
        try {
          const response = await fetch('/api/scrape/guzape-graphs');
          if (!response.ok) {
            return null;
          }
          return await response.json();
        } catch (error) {
          console.error('Failed to fetch graph data:', error);
          return null;
        }
      }
    });

    const handleRefreshData = async () => {
      try {
        // Re-scrape the HTML first
        await fetch('/api/scrape/guzape-html?persist=1');
        // Then invalidate the cache to fetch new graph data
        queryClient.invalidateQueries({ queryKey: ['/api/scrape/guzape-graphs'] });
        toast({
          title: "Data refreshed",
          description: "Market data has been updated from PropertyPro.ng",
        });
      } catch (error) {
        toast({
          title: "Refresh failed",
          description: "Could not refresh market data. Please try again.",
          variant: "destructive",
        });
      }
    };

    if (graphLoading) {
      return (
        <div className="space-y-6">
          <Card className="border-slate-200">
            <CardContent className="p-6">
              <div className="animate-pulse space-y-4">
                <div className="h-6 bg-slate-200 rounded w-1/3"></div>
                <div className="h-64 bg-slate-100 rounded"></div>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    if (!graphData) {
      return (
        <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl border border-slate-200 p-12 lg:p-16">
          <div className="text-center max-w-lg mx-auto">
            <div className="w-20 h-20 bg-white rounded-2xl shadow-sm flex items-center justify-center mx-auto mb-8">
              <TrendingUp className="h-10 w-10 text-slate-400" />
            </div>
            <h3 className="text-2xl font-semibold text-slate-900 mb-4">No market data yet</h3>
            <p className="text-slate-600 mb-8 text-lg">
              Click "Load Market Data" to fetch Guzape market insights from PropertyPro.ng
            </p>
            <Button onClick={handleRefreshData} size="lg" data-testid="button-load-data">
              <RefreshCw className="h-5 w-5 mr-2" />
              Load Market Data
            </Button>
          </div>
        </div>
      );
    }

    // Transform data for recharts
    const priceChartData = graphData.priceChart.labels.map((year: number, index: number) => ({
      year: year.toString(),
      price: graphData.priceChart.values[index],
    }));

    const indexChartData = graphData.indexChart.labels.map((year: number, index: number) => ({
      year: year.toString(),
      index: graphData.indexChart.values[index],
    }));

    // Format currency
    const formatPrice = (value: number) => {
      if (value >= 1e9) return `₦${(value / 1e9).toFixed(1)}B`;
      if (value >= 1e6) return `₦${(value / 1e6).toFixed(0)}M`;
      return `₦${value.toLocaleString()}`;
    };

    const currentPrice = graphData.priceChart.values[graphData.priceChart.values.length - 1];
    const priceGrowth = graphData.indexChart.values[graphData.indexChart.values.length - 1];

    return (
      <div className="space-y-6">
        {/* Header with Refresh Button */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Guzape Market Analysis</h2>
            <p className="text-sm text-slate-600 mt-1">
              Last updated: {new Date(graphData.scrapedAt).toLocaleString()}
            </p>
          </div>
          <Button onClick={handleRefreshData} variant="outline" data-testid="button-refresh-data">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh Data
          </Button>
        </div>

        {/* Key Metrics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="border-slate-200">
            <CardContent className="p-6">
              <div className="text-sm text-slate-600 mb-1">Current Average Price</div>
              <div className="text-3xl font-bold text-slate-900">{formatPrice(currentPrice)}</div>
              <div className="text-xs text-slate-500 mt-1">Guzape, Abuja (2025)</div>
            </CardContent>
          </Card>
          <Card className="border-slate-200">
            <CardContent className="p-6">
              <div className="text-sm text-slate-600 mb-1">Price Growth</div>
              <div className="text-3xl font-bold text-green-600">+{priceGrowth.toFixed(0)}%</div>
              <div className="text-xs text-slate-500 mt-1">Since 2019 baseline</div>
            </CardContent>
          </Card>
          <Card className="border-slate-200">
            <CardContent className="p-6">
              <div className="text-sm text-slate-600 mb-1">Market Trend</div>
              <div className="flex items-center">
                <TrendingUp className="h-6 w-6 text-green-600 mr-2" />
                <div className="text-xl font-bold text-slate-900">Strong Growth</div>
              </div>
              <div className="text-xs text-slate-500 mt-1">Upward trajectory</div>
            </CardContent>
          </Card>
        </div>

        {/* Average Price Historical Chart */}
        <Card className="border-slate-200" data-testid="card-price-chart">
          <CardHeader>
            <CardTitle className="text-lg">Average Price History (Guzape, Abuja)</CardTitle>
            <p className="text-sm text-slate-600">Historical property prices from 2019 to 2025</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={priceChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis 
                  dataKey="year" 
                  stroke="#64748b"
                  style={{ fontSize: '12px' }}
                />
                <YAxis 
                  tickFormatter={formatPrice}
                  stroke="#64748b"
                  style={{ fontSize: '12px' }}
                />
                <Tooltip 
                  formatter={(value: number) => formatPrice(value)}
                  labelFormatter={(label) => `Year ${label}`}
                  contentStyle={{ 
                    backgroundColor: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px'
                  }}
                />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="price" 
                  stroke="#0f172a" 
                  strokeWidth={3}
                  name="Average Price"
                  dot={{ fill: "#0f172a", r: 5 }}
                  activeDot={{ r: 7 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Price Index Growth Chart */}
        <Card className="border-slate-200" data-testid="card-index-chart">
          <CardHeader>
            <CardTitle className="text-lg">Price Index Growth</CardTitle>
            <p className="text-sm text-slate-600">Percentage change from 2019 baseline</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={indexChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis 
                  dataKey="year"
                  stroke="#64748b"
                  style={{ fontSize: '12px' }}
                />
                <YAxis 
                  tickFormatter={(value) => `${value}%`}
                  stroke="#64748b"
                  style={{ fontSize: '12px' }}
                />
                <Tooltip 
                  formatter={(value: number) => `${value.toFixed(1)}%`}
                  labelFormatter={(label) => `Year ${label}`}
                  contentStyle={{ 
                    backgroundColor: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px'
                  }}
                />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="index" 
                  stroke="#16a34a" 
                  strokeWidth={3}
                  name="Price Index"
                  dot={{ fill: "#16a34a", r: 5 }}
                  activeDot={{ r: 7 }}
                />
              </LineChart>
            </ResponsiveContainer>

            {/* Key Insights */}
            <div className="mt-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
              <h4 className="font-semibold text-slate-900 mb-2">Key Insights:</h4>
              <ul className="space-y-1 text-sm text-slate-700">
                <li>• {((priceGrowth) / 100).toFixed(1)}x price increase since 2019</li>
                <li>• Average price reached {formatPrice(currentPrice)} in 2025</li>
                <li>• Strong upward trend indicating growing demand in Guzape area</li>
                <li>• Data sourced from PropertyPro.ng market analysis</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="flex h-screen">
        {/* Sidebar */}
        <div className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-0 ${isMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="flex items-center justify-between h-16 px-6 border-b border-slate-200">
            <h1 className="text-xl font-bold text-slate-900">Admin Panel</h1>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsMenuOpen(false)}
              className="lg:hidden"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </div>

          <nav className="mt-6">
            <div className="px-3">
              <Button
                variant={selectedTab === "overview" ? "secondary" : "ghost"}
                className="w-full justify-start mb-1"
                onClick={() => setSelectedTab("overview")}
              >
                <BarChart3 className="mr-3 h-4 w-4" />
                Overview
              </Button>
              <Button
                variant={selectedTab === "properties" ? "secondary" : "ghost"}
                className="w-full justify-start mb-1"
                onClick={() => setSelectedTab("properties")}
              >
                <Building className="mr-3 h-4 w-4" />
                Properties
              </Button>
              <Button
                variant={selectedTab === "add-property" ? "secondary" : "ghost"}
                className="w-full justify-start mb-1"
                onClick={() => setSelectedTab("add-property")}
              >
                <Plus className="mr-3 h-4 w-4" />
                Add Property
              </Button>
              <Button
                variant={selectedTab === "verification" ? "secondary" : "ghost"}
                className="w-full justify-start mb-1"
                onClick={() => setSelectedTab("verification")}
              >
                <CheckCircle className="mr-3 h-4 w-4" />
                Verification
              </Button>
              <Button
                variant={selectedTab === "reservations" ? "secondary" : "ghost"}
                className="w-full justify-start mb-1"
                onClick={() => setSelectedTab("reservations")}
              >
                <Users className="mr-3 h-4 w-4" />
                Reservations
              </Button>
              <Button
                variant={selectedTab === "developer-bids" ? "secondary" : "ghost"}
                className="w-full justify-start mb-1"
                onClick={() => setSelectedTab("developer-bids")}
              >
                <FileText className="mr-3 h-4 w-4" />
                Developer Bids
              </Button>
              <Button
                variant={selectedTab === "insights" ? "secondary" : "ghost"}
                className="w-full justify-start mb-1"
                onClick={() => setSelectedTab("insights")}
              >
                <TrendingUp className="mr-3 h-4 w-4" />
                Market Insights
              </Button>
            </div>
          </nav>
        </div>

        {/* Overlay */}
        {isMenuOpen && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
            onClick={() => setIsMenuOpen(false)}
          />
        )}

        {/* Main content */}
        <div className="flex-1 flex flex-col lg:ml-0">
          {/* Header */}
          <header className="fixed top-0 left-0 right-0 lg:left-64 z-30 bg-white border-b border-slate-200 h-16">
            <div className="flex items-center justify-between h-full px-4 lg:px-6">
              <div className="flex items-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsMenuOpen(true)}
                  className="lg:hidden mr-2"
                >
                  <Menu className="h-4 w-4" />
                </Button>
                <h2 className="text-lg font-semibold text-slate-900 capitalize">
                  {selectedTab.replace('-', ' ')}
                </h2>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/">
                  <Button variant="ghost" size="sm">
                    <Home className="h-4 w-4 mr-2" />
                    View Site
                  </Button>
                </Link>
              </div>
            </div>
          </header>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto pt-16 px-4 lg:px-6 pb-6">
            {/* Properties */}
            {selectedTab === "properties" && (
              <div className="space-y-8 mt-6">
                {/* Header Section */}
                <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h1 className="text-3xl lg:text-4xl font-bold text-slate-900">Properties</h1>
                    <p className="text-slate-600 mt-2 text-lg">Manage your real estate investment portfolio</p>
                  </div>
                  <Button 
                    onClick={() => {
                      resetPropertyForm();
                      setEditingProperty(null);
                      setSelectedTab('add-property');
                    }} 
                    className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg w-full lg:w-auto transition-all duration-200"
                    size="lg"
                  >
                    <Plus className="h-5 w-5 mr-2" />
                    Add New Property
                  </Button>
                </div>

                {/* Properties Content */}
                {propertiesLoading ? (
                  <div className="grid grid-cols-1 gap-6">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="bg-white rounded-xl border border-slate-200 p-8">
                        <div className="animate-pulse">
                          <div className="h-6 bg-slate-200 rounded w-1/4 mb-4"></div>
                          <div className="h-4 bg-slate-200 rounded w-1/2 mb-3"></div>
                          <div className="h-4 bg-slate-200 rounded w-1/3"></div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : properties.length === 0 ? (
                  <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl border border-slate-200 p-12 lg:p-16">
                    <div className="text-center max-w-lg mx-auto">
                      <div className="w-20 h-20 bg-white rounded-2xl shadow-sm flex items-center justify-center mx-auto mb-8">
                        <Building className="h-10 w-10 text-slate-400" />
                      </div>
                      <h3 className="text-2xl font-semibold text-slate-900 mb-4">No properties yet</h3>
                      <p className="text-slate-600 mb-8 text-lg">Start building your portfolio by adding your first investment property</p>
                      <Button 
                        onClick={() => setSelectedTab('add-property')} 
                        className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg transition-all duration-200"
                        size="lg"
                      >
                        <Plus className="h-5 w-5 mr-2" />
                        Add Your First Property
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {/* Stats Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                      <Card className="border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                        <CardContent className="p-6">
                          <div className="flex items-center">
                            <div className="p-3 bg-blue-100 rounded-xl">
                              <Building className="h-6 w-6 text-blue-600" />
                            </div>
                            <div className="ml-4">
                              <p className="text-sm font-medium text-slate-600">Total Properties</p>
                              <p className="text-3xl font-bold text-slate-900">{properties.length}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                        <CardContent className="p-6">
                          <div className="flex items-center">
                            <div className="p-3 bg-green-100 rounded-xl">
                              <TrendingUp className="h-6 w-6 text-green-600" />
                            </div>
                            <div className="ml-4">
                              <p className="text-sm font-medium text-slate-600">Total Value</p>
                              <p className="text-3xl font-bold text-slate-900">
                                {formatCurrency(properties.reduce((sum: number, p: Property) => sum + p.totalValue, 0))}
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                        <CardContent className="p-6">
                          <div className="flex items-center">
                            <div className="p-3 bg-purple-100 rounded-xl">
                              <Users className="h-6 w-6 text-purple-600" />
                            </div>
                            <div className="ml-4">
                              <p className="text-sm font-medium text-slate-600">Total Slots</p>
                              <p className="text-3xl font-bold text-slate-900">
                                {properties.reduce((sum: number, p: Property) => sum + p.totalSlots, 0)}
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                        <CardContent className="p-6">
                          <div className="flex items-center">
                            <div className="p-3 bg-orange-100 rounded-xl">
                              <Target className="h-6 w-6 text-orange-600" />
                            </div>
                            <div className="ml-4">
                              <p className="text-sm font-medium text-slate-600">Available</p>
                              <p className="text-3xl font-bold text-slate-900">
                                {properties.reduce((sum: number, p: Property) => sum + p.availableSlots, 0)}
                              </p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Properties Table/Grid */}
                    <Card className="border-slate-200 shadow-sm">
                      {/* Desktop Table View */}
                      <div className="hidden lg:block">
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-slate-50 hover:bg-slate-50">
                                <TableHead className="text-slate-900 font-semibold py-4 px-6">Property</TableHead>
                                <TableHead className="text-slate-900 font-semibold py-4 px-6">Location</TableHead>
                                <TableHead className="text-slate-900 font-semibold py-4 px-6">Investment</TableHead>
                                <TableHead className="text-slate-900 font-semibold py-4 px-6">Progress</TableHead>
                                <TableHead className="text-slate-900 font-semibold py-4 px-6">Status</TableHead>
                                <TableHead className="text-slate-900 font-semibold py-4 px-6 text-right">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {properties.map((property: Property) => (
                                <TableRow key={property.id} className="hover:bg-slate-50/50 transition-colors">
                                  <TableCell className="py-6 px-6">
                                    <div className="flex items-center space-x-4">
                                      <div className="w-14 h-14 bg-slate-100 rounded-xl overflow-hidden flex-shrink-0">
                                        {property.imageUrl ? (
                                          <img 
                                            src={property.imageUrl} 
                                            alt={property.name}
                                            className="w-full h-full object-cover"
                                          />
                                        ) : (
                                          <div className="w-full h-full flex items-center justify-center">
                                            <Building className="w-7 h-7 text-slate-400" />
                                          </div>
                                        )}
                                      </div>
                                      <div className="min-w-0">
                                        <p className="font-semibold text-slate-900 truncate text-base">
                                          {property.name}
                                        </p>
                                        <p className="text-sm text-slate-500 truncate">
                                          Property Investment
                                        </p>
                                      </div>
                                    </div>
                                  </TableCell>
                                  <TableCell className="py-6 px-6">
                                    <div className="flex items-center text-slate-900">
                                      <MapPin className="w-4 h-4 text-slate-400 mr-2 flex-shrink-0" />
                                      <span className="truncate">{property.location}</span>
                                    </div>
                                  </TableCell>
                                  <TableCell className="py-6 px-6">
                                    <div>
                                      <p className="font-semibold text-slate-900">
                                        {formatCurrency(property.totalValue)}
                                      </p>
                                      <p className="text-sm text-slate-500">
                                        Min: {formatCurrency(property.minInvestment)}
                                      </p>
                                    </div>
                                  </TableCell>
                                  <TableCell className="py-6 px-6">
                                    <div className="space-y-2 min-w-[120px]">
                                      <div className="flex items-center justify-between">
                                        <span className="text-sm text-slate-600">
                                          {property.totalSlots - property.availableSlots}/{property.totalSlots} slots
                                        </span>
                                        <span className="text-sm font-medium text-slate-900">
                                          {Math.round(((property.totalSlots - property.availableSlots) / property.totalSlots) * 100)}%
                                        </span>
                                      </div>
                                      <div className="w-full bg-slate-200 rounded-full h-2">
                                        <div 
                                          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                          style={{ 
                                            width: `${((property.totalSlots - property.availableSlots) / property.totalSlots) * 100}%` 
                                          }}
                                        ></div>
                                      </div>
                                    </div>
                                  </TableCell>
                                  <TableCell className="py-6 px-6">
                                    {property.badge ? (
                                      <Badge 
                                        variant={property.badge === 'partnered' ? 'default' : 'secondary'}
                                        className={`${
                                          property.badge === 'partnered' 
                                            ? 'bg-emerald-100 text-emerald-800 border-emerald-200' 
                                            : 'bg-slate-100 text-slate-800 border-slate-200'
                                        }`}
                                      >
                                        {property.badge === 'partnered' ? '✓ Partnered' : property.badge}
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="text-slate-500 border-slate-300">
                                        Available
                                      </Badge>
                                    )}
                                  </TableCell>
                                  <TableCell className="py-6 px-6">
                                    <div className="flex items-center justify-end space-x-2">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => openPropertyDetailModal(property)}
                                        className="h-9 w-9 p-0 hover:bg-slate-100"
                                      >
                                        <Eye className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                          setEditingProperty(property);
                                          setPropertyForm({
                                            name: property.name,
                                            location: property.location,
                                            description: property.description,
                                            totalValue: property.totalValue.toString(),
                                            minInvestment: property.minInvestment.toString(),
                                            totalSlots: property.totalSlots.toString(),
                                            availableSlots: property.availableSlots.toString(),
                                            imageUrl: property.imageUrl || "",
                                            videoUrl: property.videoUrl || "",
                                            gallery: property.gallery || [],
                                            propertyType: property.propertyType || "land",
                                            badge: property.badge || "none",
                                            partnershipDocumentName: property.partnershipDocumentName || "",
                                            partnershipDocumentUrl: property.partnershipDocumentUrl || "",
                                            developerNotes: property.developerNotes || "",
                                            investmentDetails: property.investmentDetails || "",
                                            status: property.status,
                                            currency: property.currency || "NGN"
                                          });
                                          setIsEditDialogOpen(true);
                                        }}
                                        className="h-9 w-9 p-0 hover:bg-slate-100"
                                      >
                                        <Edit className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => openDeleteConfirmation(property)}
                                        className="h-9 w-9 p-0 hover:bg-red-100 text-red-600"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>

                      {/* Mobile Grid View */}
                      <div className="lg:hidden p-6">
                        <div className="grid gap-6">
                          {properties.map((property: Property) => (
                            <div key={property.id} className="border border-slate-200 rounded-xl p-6 hover:shadow-sm transition-all duration-200">
                              <div className="flex items-start space-x-4 mb-6">
                                <div className="w-16 h-16 bg-slate-100 rounded-xl overflow-hidden flex-shrink-0">
                                  {property.imageUrl ? (
                                    <img 
                                      src={property.imageUrl} 
                                      alt={property.name}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                      <Building className="w-8 h-8 text-slate-400" />
                                    </div>
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <h3 className="text-lg font-semibold text-slate-900 truncate">{property.name}</h3>
                                  <p className="text-sm text-slate-600">Property Investment</p>
                                  <div className="flex items-center mt-2">
                                    <MapPin className="w-4 h-4 text-slate-400 mr-1" />
                                    <span className="text-sm text-slate-600 truncate">{property.location}</span>
                                  </div>
                                </div>
                                <div className="flex space-x-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => openPropertyDetailModal(property)}
                                    className="h-8 w-8 p-0"
                                  >
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setEditingProperty(property);
                                      setPropertyForm({
                                        name: property.name,
                                        location: property.location,
                                        description: property.description,
                                        totalValue: property.totalValue.toString(),
                                        minInvestment: property.minInvestment.toString(),
                                        totalSlots: property.totalSlots.toString(),
                                        availableSlots: property.availableSlots.toString(),
                                        imageUrl: property.imageUrl || "",
                                        videoUrl: property.videoUrl || "",
                                        gallery: property.gallery || [],
                                        propertyType: property.propertyType || "land",
                                        badge: property.badge || "none",
                                        partnershipDocumentName: property.partnershipDocumentName || "",
                                        partnershipDocumentUrl: property.partnershipDocumentUrl || "",
                                        developerNotes: property.developerNotes || "",
                                        investmentDetails: property.investmentDetails || "",
                                        status: property.status,
                                        currency: property.currency || "USD"
                                      });
                                      setIsEditDialogOpen(true);
                                    }}
                                    className="h-8 w-8 p-0"
                                  >
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
                                <div className="space-y-2">
                                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Investment Value</p>
                                  <p className="text-xl font-bold text-slate-900">{formatCurrency(property.totalValue)}</p>
                                  <p className="text-sm text-slate-600">Min: {formatCurrency(property.minInvestment)}</p>
                                </div>
                                <div className="space-y-2">
                                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Progress</p>
                                  <div className="flex items-center justify-between mb-3">
                                    <span className="text-sm text-slate-600">
                                      {property.totalSlots - property.availableSlots}/{property.totalSlots} slots
                                    </span>
                                    <span className="text-sm font-medium text-slate-900">
                                      {Math.round(((property.totalSlots - property.availableSlots) / property.totalSlots) * 100)}%
                                    </span>
                                  </div>
                                  <div className="w-full bg-slate-200 rounded-full h-3">
                                    <div 
                                      className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                                      style={{ 
                                        width: `${((property.totalSlots - property.availableSlots) / property.totalSlots) * 100}%` 
                                      }}
                                    ></div>
                                  </div>
                                </div>
                              </div>

                              <div className="flex justify-between items-center">
                                {property.badge ? (
                                  <Badge 
                                    variant={property.badge === 'partnered' ? 'default' : 'secondary'}
                                    className={`${
                                      property.badge === 'partnered' 
                                        ? 'bg-emerald-100 text-emerald-800 border-emerald-200' 
                                        : 'bg-slate-100 text-slate-800 border-slate-200'
                                    }`}
                                  >
                                    {property.badge === 'partnered' ? '✓ Partnered' : property.badge}
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-slate-500 border-slate-300">
                                    Available
                                  </Badge>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </Card>
                  </div>
                )}
              </div>
            )}

            {/* Overview */}
            {selectedTab === "overview" && (
              <div className="space-y-8 mt-6">
                {/* Header Section */}
                <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h1 className="text-3xl lg:text-4xl font-bold text-slate-900">Dashboard Overview</h1>
                    <p className="text-slate-600 mt-2 text-lg">Monitor your real estate investment platform</p>
                  </div>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  <Card className="border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                    <CardContent className="p-6">
                      <div className="flex items-center">
                        <div className="p-3 bg-blue-100 rounded-xl">
                          <Building className="h-6 w-6 text-blue-600" />
                        </div>
                        <div className="ml-4">
                          <p className="text-sm font-medium text-slate-600">Total Properties</p>
                          <p className="text-3xl font-bold text-slate-900">{properties.length}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                    <CardContent className="p-6">
                      <div className="flex items-center">
                        <div className="p-3 bg-green-100 rounded-xl">
                          <TrendingUp className="h-6 w-6 text-green-600" />
                        </div>
                        <div className="ml-4">
                          <p className="text-sm font-medium text-slate-600">Total Value</p>
                          <p className="text-3xl font-bold text-slate-900">
                            {formatCurrency(properties.reduce((sum: number, p: Property) => sum + p.totalValue, 0))}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                    <CardContent className="p-6">
                      <div className="flex items-center">
                        <div className="p-3 bg-purple-100 rounded-xl">
                          <Users className="h-6 w-6 text-purple-600" />
                        </div>
                        <div className="ml-4">
                          <p className="text-sm font-medium text-slate-600">Reservations</p>
                          <p className="text-3xl font-bold text-slate-900">{reservations.length}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-200">
                    <CardContent className="p-6">
                      <div className="flex items-center">
                        <div className="p-3 bg-orange-100 rounded-xl">
                          <FileText className="h-6 w-6 text-orange-600" />
                        </div>
                        <div className="ml-4">
                          <p className="text-sm font-medium text-slate-600">Developer Bids</p>
                          <p className="text-3xl font-bold text-slate-900">{developerBids.length}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Recent Activity */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <Card className="border-slate-200 shadow-sm">
                    <CardHeader>
                      <CardTitle className="flex items-center">
                        <Users className="h-5 w-5 mr-2 text-blue-600" />
                        Recent Reservations
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {reservations.length === 0 ? (
                        <div className="text-center py-8">
                          <Users className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                          <p className="text-slate-500">No reservations yet</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {reservations.slice(0, 5).map((reservation: InvestmentReservation) => (
                            <div key={reservation.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                              <div>
                                <p className="font-medium text-slate-900">{reservation.fullName}</p>
                                <p className="text-sm text-slate-500">{reservation.email}</p>
                              </div>
                              <div className="text-right">
                                <p className="font-medium text-slate-900">{reservation.units} units</p>
                                <p className="text-xs text-slate-500">{formatDate(reservation.createdAt.toString())}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border-slate-200 shadow-sm">
                    <CardHeader>
                      <CardTitle className="flex items-center">
                        <FileText className="h-5 w-5 mr-2 text-green-600" />
                        Recent Developer Bids
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {developerBids.length === 0 ? (
                        <div className="text-center py-8">
                          <FileText className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                          <p className="text-slate-500">No developer bids yet</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {developerBids.slice(0, 5).map((bid: DeveloperBid) => (
                            <div key={bid.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                              <div>
                                <p className="font-medium text-slate-900">{bid.companyName}</p>
                                <p className="text-sm text-slate-500">{bid.developerName}</p>
                              </div>
                              <div className="text-right">
                                <p className="font-medium text-slate-900">{formatCurrency(bid.estimatedCost)}</p>
                                <p className="text-xs text-slate-500">{formatDate(bid.createdAt.toString())}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {/* Verification */}
            {selectedTab === "verification" && (
              <div className="space-y-6 mt-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h1 className="text-2xl lg:text-3xl font-bold text-slate-900">Due Diligence Verification</h1>
                    <p className="text-slate-600 mt-1 text-base">Manage property verification checklists and proof uploads</p>
                  </div>
                </div>

                {/* Property Selection */}
                <Card className="border-slate-200 shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center">
                      <CheckCircle className="h-5 w-5 mr-2 text-blue-600" />
                      Property Verification Management
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {properties.map((property: Property) => (
                        <div key={property.id} className="p-4 border border-slate-200 rounded-lg">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <h3 className="font-semibold text-slate-900">{property.name}</h3>
                              <p className="text-sm text-slate-600">{property.location}</p>
                              
                              {/* Verification Progress */}
                              {selectedPropertyForVerification?.id === property.id && propertyVerificationData.length > 0 && (
                                <div className="mt-3">
                                  <div className="flex items-center space-x-2 mb-2">
                                    <div className="w-full bg-slate-200 rounded-full h-2">
                                      <div 
                                        className="bg-green-600 h-2 rounded-full transition-all duration-300"
                                        style={{
                                          width: `${(propertyVerificationData.filter((step: any) => step.isCompleted && step.isEnabled).length / propertyVerificationData.filter((step: any) => step.isEnabled).length) * 100 || 0}%`
                                        }}
                                      ></div>
                                    </div>
                                    <span className="text-sm text-slate-600 whitespace-nowrap">
                                      {propertyVerificationData.filter((step: any) => step.isCompleted && step.isEnabled).length} / {propertyVerificationData.filter((step: any) => step.isEnabled).length} Complete
                                    </span>
                                  </div>
                                </div>
                              )}
                            </div>
                            
                            <Button
                              onClick={() => {
                                setSelectedPropertyForVerification(property);
                              }}
                              variant={selectedPropertyForVerification?.id === property.id ? "default" : "outline"}
                              size="sm"
                            >
                              {selectedPropertyForVerification?.id === property.id ? "Selected" : "Manage Verification"}
                            </Button>
                          </div>

                          {/* Verification Steps */}
                          {selectedPropertyForVerification?.id === property.id && propertyVerificationData.length > 0 && (
                            <div className="mt-4 space-y-3">
                              <div className="flex items-center justify-between">
                                <h4 className="font-medium text-slate-900">Verification Checklist</h4>
                                <Button
                                  onClick={() => {
                                    // Toggle checklist configuration logic here
                                    const enabledSteps = propertyVerificationData
                                      .filter((step: any) => step.isEnabled)
                                      .map((step: any) => step.id);
                                    
                                    // For now, enable all steps if none are enabled
                                    if (enabledSteps.length === 0) {
                                      updateVerificationChecklistMutation.mutate({
                                        propertyId: property.id,
                                        enabledSteps: verificationSteps.map((step: VerificationStep) => step.id)
                                      });
                                    }
                                  }}
                                  variant="outline"
                                  size="sm"
                                >
                                  Configure Steps
                                </Button>
                              </div>
                              
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {propertyVerificationData
                                  .filter((step: any) => step.isEnabled)
                                  .map((step: any) => (
                                  <div key={step.id} className={`p-3 rounded-lg border-2 transition-colors ${
                                    step.isCompleted 
                                      ? 'border-green-200 bg-green-50' 
                                      : 'border-slate-200 bg-white hover:border-slate-300'
                                  }`}>
                                    <div className="flex items-start justify-between">
                                      <div className="flex-1">
                                        <div className="flex items-center space-x-2 mb-1">
                                          <CheckCircle className={`h-4 w-4 ${
                                            step.isCompleted ? 'text-green-600' : 'text-slate-400'
                                          }`} />
                                          <span className="text-sm font-medium text-slate-900">{step.name}</span>
                                        </div>
                                        <p className="text-xs text-slate-600">{step.description}</p>
                                        {step.proofPhotos?.length > 0 && (
                                          <div className="mt-2">
                                            <Badge variant="secondary" className="text-xs">
                                              {step.proofPhotos.length} photo{step.proofPhotos.length > 1 ? 's' : ''}
                                            </Badge>
                                          </div>
                                        )}
                                      </div>
                                      
                                      <Button
                                        onClick={() => {
                                          setVerificationStepBeingEdited(step);
                                          setIsVerificationDialogOpen(true);
                                        }}
                                        variant="ghost"
                                        size="sm"
                                        className="ml-2"
                                      >
                                        <Edit className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Add Property */}
            {selectedTab === "add-property" && (
              <div className="space-y-6 mt-4">
                {/* Header Section */}
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h1 className="text-2xl lg:text-3xl font-bold text-slate-900">Add New Property</h1>
                    <p className="text-slate-600 mt-1 text-base">Create a new property listing for investors</p>
                  </div>
                  <Button 
                    onClick={() => setSelectedTab('properties')} 
                    variant="outline"
                    className="w-full lg:w-auto"
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Properties
                  </Button>
                </div>

                {/* Add Property Form */}
                <Card className="border-slate-200 shadow-sm max-w-5xl mx-auto">
                  <CardHeader className="pb-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-xl text-slate-900">Property Details</CardTitle>
                      {isDraftSaved && (
                        <Badge variant="secondary" className="bg-green-100 text-green-700">
                          Draft Saved
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">

                    <form onSubmit={handlePropertySubmit} className="space-y-5">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <Label htmlFor="name">Property Name *</Label>
                          <Input
                            id="name"
                            value={propertyForm.name}
                            onChange={(e) => setPropertyForm(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="e.g., Lagos Marina Complex"
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="location">Location *</Label>
                          <Input
                            id="location"
                            value={propertyForm.location}
                            onChange={(e) => setPropertyForm(prev => ({ ...prev, location: e.target.value }))}
                            placeholder="e.g., Victoria Island, Lagos"
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="propertyType">Property Type *</Label>
                          <Select value={propertyForm.propertyType} onValueChange={(value) => setPropertyForm(prev => ({ ...prev, propertyType: value }))}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select property type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="land">Land</SelectItem>
                              <SelectItem value="apartment">Apartment</SelectItem>
                              <SelectItem value="house">House</SelectItem>
                              <SelectItem value="commercial">Commercial</SelectItem>
                              <SelectItem value="mixed-use">Mixed Use</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="status">Listing Status *</Label>
                          <Select value={propertyForm.status} onValueChange={(value) => setPropertyForm(prev => ({ ...prev, status: value }))}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="active">🟢 Active (Public)</SelectItem>
                              <SelectItem value="pending">🟡 Pending Review</SelectItem>
                              <SelectItem value="sold_out">🔴 Sold Out</SelectItem>
                              <SelectItem value="completed">✅ Completed</SelectItem>
                              <SelectItem value="archived">📦 Archived (Hidden)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="description">Description *</Label>
                        <RichTextEditor
                          content={propertyForm.description}
                          onChange={(content) => setPropertyForm(prev => ({ ...prev, description: content }))}
                          placeholder="Describe the property, amenities, and investment opportunity..."
                        />
                      </div>

                      {/* Currency Selector */}
                      <div className="space-y-2">
                        <Label htmlFor="currency">Property Currency *</Label>
                        <Select value={propertyForm.currency} onValueChange={(value) => setPropertyForm(prev => ({ ...prev, currency: value }))}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select currency" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NGN">₦ Nigerian Naira (NGN)</SelectItem>
                            <SelectItem value="USD">$ US Dollars (USD)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <Label htmlFor="totalValue">Total Property Value ({getCurrencySymbol(propertyForm.currency)}) *</Label>
                          <Input
                            id="totalValue"
                            type="number"
                            value={propertyForm.totalValue}
                            onChange={(e) => setPropertyForm(prev => ({ ...prev, totalValue: e.target.value }))}
                            placeholder={propertyForm.currency === 'NGN' ? 'e.g., 2000000000' : 'e.g., 50000000'}
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Minimum Investment ({getCurrencySymbol(propertyForm.currency)})</Label>
                          <div className="p-3 bg-slate-50 border rounded-md">
                            <span className="text-slate-900 font-medium">
                              {propertyForm.totalValue && propertyForm.totalSlots ? 
                                `${getCurrencySymbol(propertyForm.currency)}${Math.floor(parseInt(propertyForm.totalValue) / parseInt(propertyForm.totalSlots)).toLocaleString()}` 
                                : 'Enter total value and slots first'
                              }
                            </span>
                            <p className="text-xs text-slate-500 mt-1">Calculated automatically</p>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                        <div className="space-y-2">
                          <Label htmlFor="totalSlots">Total Ownership Slots *</Label>
                          <Input
                            id="totalSlots"
                            type="number"
                            value={propertyForm.totalSlots}
                            onChange={(e) => setPropertyForm(prev => ({ ...prev, totalSlots: e.target.value }))}
                            placeholder="e.g., 50"
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="availableSlots">Available Slots *</Label>
                          <Input
                            id="availableSlots"
                            type="number"
                            value={propertyForm.availableSlots}
                            onChange={(e) => setPropertyForm(prev => ({ ...prev, availableSlots: e.target.value }))}
                            placeholder="e.g., 50"
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="badge">Partnership Status</Label>
                        <Select value={propertyForm.badge || "none"} onValueChange={(value) => setPropertyForm(prev => ({ ...prev, badge: value === "none" ? null : value }))}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select partnership status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No Badge</SelectItem>
                            <SelectItem value="partnered">Partnered</SelectItem>
                            <SelectItem value="verified">Verified</SelectItem>
                            <SelectItem value="exclusive">Exclusive</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-slate-500">Badge indicates our relationship status with this property</p>
                      </div>

                      <div className="space-y-2">
                        <Label>Main Property Image</Label>
                        <FileUpload
                          onUploadSuccess={(url, fileName) => {
                            setPropertyForm(prev => ({ ...prev, imageUrl: url }));
                          }}
                          accept="image/*"
                          uploadType="image"
                          label="Upload main property image"
                          currentFile={propertyForm.imageUrl}
                          disabled={createPropertyMutation.isPending}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Property Video</Label>
                        <FileUpload
                          onUploadSuccess={(url, fileName) => {
                            setPropertyForm(prev => ({ ...prev, videoUrl: url }));
                          }}
                          accept="video/*"
                          uploadType="video"
                          label="Upload property video (1 video maximum)"
                          currentFile={propertyForm.videoUrl}
                          disabled={createPropertyMutation.isPending}
                        />
                        <p className="text-xs text-slate-500">Upload a video showcasing the property. Maximum 1 video allowed.</p>
                      </div>

                      <div className="space-y-2">
                        <Label>Property Gallery</Label>
                        <div className="space-y-3">
                          {propertyForm.gallery.map((photoUrl, index) => (
                            <div key={index} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                              <img src={photoUrl} alt={`Gallery ${index + 1}`} className="w-16 h-16 object-cover rounded" />
                              <span className="flex-1 text-sm text-slate-700">Photo {index + 1}</span>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setPropertyForm(prev => ({
                                    ...prev,
                                    gallery: prev.gallery.filter((_, i) => i !== index)
                                  }));
                                }}
                                disabled={createPropertyMutation.isPending}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                          {propertyForm.gallery.length < 10 && (
                            <FileUpload
                              onUploadSuccess={(url, fileName) => {
                                setPropertyForm(prev => ({
                                  ...prev,
                                  gallery: [...prev.gallery, url]
                                }));
                              }}
                              accept="image/*"
                              uploadType="image"
                              label={`Upload photo ${propertyForm.gallery.length + 1} (${10 - propertyForm.gallery.length} remaining)`}
                              disabled={createPropertyMutation.isPending}
                            />
                          )}
                        </div>
                        <p className="text-xs text-slate-500">Upload up to 10 additional photos of the property. JPG, PNG formats accepted.</p>
                      </div>

                      <div className="space-y-2">
                        <Label>Partnership Document</Label>
                        <FileUpload
                          onUploadSuccess={(url, fileName) => {
                            setPropertyForm(prev => ({ 
                              ...prev, 
                              partnershipDocumentUrl: url,
                              partnershipDocumentName: fileName
                            }));
                          }}
                          accept=".pdf,.doc,.docx"
                          uploadType="document"
                          label="Upload partnership document"
                          currentFile={propertyForm.partnershipDocumentName}
                          disabled={createPropertyMutation.isPending}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="developerNotes">Developer Notes (Optional)</Label>
                        <RichTextEditor
                          content={propertyForm.developerNotes}
                          onChange={(content) => setPropertyForm(prev => ({ ...prev, developerNotes: content }))}
                          placeholder="Internal notes about the developer or partnership..."
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="investmentDetails">Co-Ownership Details</Label>
                        <RichTextEditor
                          content={propertyForm.investmentDetails}
                          onChange={(content) => setPropertyForm(prev => ({ ...prev, investmentDetails: content }))}
                          placeholder="Detailed co-ownership information for potential investors..."
                        />
                      </div>

                      <div className="flex gap-3 pt-6">
                        <Button 
                          type="button" 
                          variant="outline" 
                          onClick={() => setSelectedTab('properties')}
                          className="flex-1"
                        >
                          Cancel
                        </Button>
                        <Button 
                          type="button" 
                          variant="secondary" 
                          onClick={saveToDraft}
                          disabled={!hasUnsavedChanges()}
                          className="flex-1"
                        >
                          {isDraftSaved ? "Draft Saved ✓" : "Save to Draft"}
                        </Button>
                        <Button 
                          type="submit" 
                          disabled={createPropertyMutation.isPending}
                          className="flex-1 bg-blue-600 hover:bg-blue-700"
                        >
                          {createPropertyMutation.isPending ? "Creating..." : "Create Property"}
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Reservations */}
            {selectedTab === "reservations" && (
              <div className="space-y-8 mt-6">
                {/* Header Section */}
                <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h1 className="text-3xl lg:text-4xl font-bold text-slate-900">Investment Reservations</h1>
                    <p className="text-slate-600 mt-2 text-lg">Monitor and manage investor reservations</p>
                  </div>
                </div>

                {/* Reservations Content */}
                {reservationsLoading ? (
                  <div className="grid grid-cols-1 gap-6">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="bg-white rounded-xl border border-slate-200 p-8">
                        <div className="animate-pulse">
                          <div className="h-6 bg-slate-200 rounded w-1/4 mb-4"></div>
                          <div className="h-4 bg-slate-200 rounded w-1/2 mb-3"></div>
                          <div className="h-4 bg-slate-200 rounded w-1/3"></div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : reservations.length === 0 ? (
                  <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl border border-slate-200 p-12 lg:p-16">
                    <div className="text-center max-w-lg mx-auto">
                      <div className="w-20 h-20 bg-white rounded-2xl shadow-sm flex items-center justify-center mx-auto mb-8">
                        <Users className="h-10 w-10 text-slate-400" />
                      </div>
                      <h3 className="text-2xl font-semibold text-slate-900 mb-4">No reservations yet</h3>
                      <p className="text-slate-600 mb-8 text-lg">Investment reservations will appear here once investors start making reservations</p>
                    </div>
                  </div>
                ) : (
                  <Card className="border-slate-200 shadow-sm">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-slate-50 hover:bg-slate-50">
                            <TableHead className="text-slate-900 font-semibold py-4 px-6">Investor</TableHead>
                            <TableHead className="text-slate-900 font-semibold py-4 px-6">Contact</TableHead>
                            <TableHead className="text-slate-900 font-semibold py-4 px-6">Property</TableHead>
                            <TableHead className="text-slate-900 font-semibold py-4 px-6">Investment</TableHead>
                            <TableHead className="text-slate-900 font-semibold py-4 px-6">Date</TableHead>
                            <TableHead className="text-slate-900 font-semibold py-4 px-6">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {reservations.map((reservation: InvestmentReservation) => (
                            <TableRow key={reservation.id} className="hover:bg-slate-50/50 transition-colors">
                              <TableCell className="py-6 px-6">
                                <div>
                                  <p className="font-semibold text-slate-900">
                                    {reservation.fullName}
                                  </p>
                                  <p className="text-sm text-slate-500">Units: {reservation.units}</p>
                                </div>
                              </TableCell>
                              <TableCell className="py-6 px-6">
                                <div>
                                  <p className="text-slate-900">{reservation.email}</p>
                                  <p className="text-sm text-slate-500">{reservation.phone}</p>
                                </div>
                              </TableCell>
                              <TableCell className="py-6 px-6">
                                <p className="text-slate-900">Property ID: {reservation.propertyId}</p>
                              </TableCell>
                              <TableCell className="py-6 px-6">
                                <p className="font-semibold text-slate-900">
                                  {reservation.units} units
                                </p>
                              </TableCell>
                              <TableCell className="py-6 px-6">
                                <p className="text-slate-900">{formatDate(reservation.createdAt.toString())}</p>
                              </TableCell>
                              <TableCell className="py-6 px-6">
                                <Button
                                  onClick={() => openReservationDetailModal(reservation)}
                                  variant="outline"
                                  size="sm"
                                  className="flex items-center space-x-2"
                                >
                                  <Eye className="h-4 w-4" />
                                  <span>View Details</span>
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </Card>
                )}
              </div>
            )}

            {/* Developer Bids */}
            {selectedTab === "developer-bids" && (
              <div className="space-y-8 mt-6">
                {/* Header Section */}
                <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h1 className="text-3xl lg:text-4xl font-bold text-slate-900">Developer Bids</h1>
                    <p className="text-slate-600 mt-2 text-lg">Review and manage developer project proposals</p>
                  </div>
                </div>

                {/* Developer Bids Content */}
                {bidsLoading ? (
                  <div className="grid grid-cols-1 gap-6">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="bg-white rounded-xl border border-slate-200 p-8">
                        <div className="animate-pulse">
                          <div className="h-6 bg-slate-200 rounded w-1/4 mb-4"></div>
                          <div className="h-4 bg-slate-200 rounded w-1/2 mb-3"></div>
                          <div className="h-4 bg-slate-200 rounded w-1/3"></div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : developerBids.length === 0 ? (
                  <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl border border-slate-200 p-12 lg:p-16">
                    <div className="text-center max-w-lg mx-auto">
                      <div className="w-20 h-20 bg-white rounded-2xl shadow-sm flex items-center justify-center mx-auto mb-8">
                        <FileText className="h-10 w-10 text-slate-400" />
                      </div>
                      <h3 className="text-2xl font-semibold text-slate-900 mb-4">No developer bids yet</h3>
                      <p className="text-slate-600 mb-8 text-lg">Developer project proposals will appear here once developers start submitting bids</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-6">
                    {developerBids.map((bid: DeveloperBid) => (
                      <Card key={bid.id} className="border-slate-200 shadow-sm hover:shadow-md transition-all duration-200">
                        <CardContent className="p-6">
                          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div className="lg:col-span-2">
                              <h3 className="text-xl font-semibold text-slate-900 mb-2">{bid.companyName}</h3>
                              <p className="text-slate-600 mb-4">{bid.description}</p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="flex items-center">
                                  <Calendar className="h-4 w-4 text-slate-400 mr-2" />
                                  <span className="text-sm text-slate-600">{bid.timeline} months</span>
                                </div>
                                <div className="flex items-center">
                                  <Mail className="h-4 w-4 text-slate-400 mr-2" />
                                  <span className="text-sm text-slate-600">{bid.email}</span>
                                </div>
                                <div className="flex items-center">
                                  <Phone className="h-4 w-4 text-slate-400 mr-2" />
                                  <span className="text-sm text-slate-600">{bid.phone}</span>
                                </div>
                                <div className="flex items-center">
                                  <Calendar className="h-4 w-4 text-slate-400 mr-2" />
                                  <span className="text-sm text-slate-600">{formatDate(bid.createdAt.toString())}</span>
                                </div>
                              </div>
                            </div>
                            <div className="lg:col-span-1">
                              <div className="bg-slate-50 rounded-xl p-4">
                                <p className="text-sm font-medium text-slate-600 mb-2">Estimated Cost</p>
                                <p className="text-2xl font-bold text-slate-900 mb-4">
                                  {formatCurrency(bid.estimatedCost)}
                                </p>
                                <div className="space-y-2">
                                  <Button
                                    onClick={() => openDeveloperBidDetailModal(bid)}
                                    variant="outline"
                                    size="sm"
                                    className="w-full flex items-center justify-center space-x-2"
                                  >
                                    <Eye className="h-4 w-4" />
                                    <span>View Details</span>
                                  </Button>
                                  {bid.pastProjectFile && (
                                    <Button variant="outline" size="sm" className="w-full">
                                      <Download className="h-4 w-4 mr-2" />
                                      Past Projects
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Market Insights Tab */}
            {selectedTab === "insights" && (
              <div className="space-y-8 mt-6">
                {/* Header Section */}
                <div>
                  <h1 className="text-3xl lg:text-4xl font-bold text-slate-900">Market Insights</h1>
                  <p className="text-slate-600 mt-2 text-lg">Competitive property data from PropertyPro.ng</p>
                </div>

                {/* Market Insights Content */}
                <MarketInsightsContent />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Property Detail Modal */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center justify-between">
              <span>{viewingProperty?.name}</span>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (viewingProperty) {
                      setEditingProperty(viewingProperty);
                      setPropertyForm({
                        name: viewingProperty.name,
                        location: viewingProperty.location,
                        description: viewingProperty.description,
                        totalValue: viewingProperty.totalValue.toString(),
                        minInvestment: viewingProperty.minInvestment.toString(),
                        totalSlots: viewingProperty.totalSlots.toString(),
                        availableSlots: viewingProperty.availableSlots.toString(),
                        imageUrl: viewingProperty.imageUrl || "",
                        videoUrl: viewingProperty.videoUrl || "",
                        gallery: viewingProperty.gallery || [],
                        propertyType: viewingProperty.propertyType || "land",
                        badge: viewingProperty.badge || "none",
                        partnershipDocumentName: viewingProperty.partnershipDocumentName || "",
                        partnershipDocumentUrl: viewingProperty.partnershipDocumentUrl || "",
                        developerNotes: viewingProperty.developerNotes || "",
                        investmentDetails: viewingProperty.investmentDetails || "",
                        status: viewingProperty.status,
                        currency: viewingProperty.currency || "NGN"
                      });
                      setIsViewDialogOpen(false);
                      setIsEditDialogOpen(true);
                    }
                  }}
                >
                  <Edit className="h-4 w-4 mr-2" />
                  Edit Property
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="text-red-600 border-red-200 hover:bg-red-50">
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Property</AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to delete "{viewingProperty?.name}"? This action cannot be undone and will remove all associated data.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          if (viewingProperty) {
                            deletePropertyMutation.mutate(viewingProperty.id);
                            setIsViewDialogOpen(false);
                          }
                        }}
                        className="bg-red-600 hover:bg-red-700"
                      >
                        Delete Property
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </DialogTitle>
          </DialogHeader>

          {viewingProperty && (
            <div className="space-y-6">
              {/* Property Media Carousel */}
              <div className="w-full">
                <PropertyMediaCarousel
                  mainImage={viewingProperty.imageUrl}
                  videoUrl={viewingProperty.videoUrl}
                  gallery={viewingProperty.gallery}
                  propertyName={viewingProperty.name}
                />
              </div>

              {/* Basic Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold text-slate-900 mb-2">Location</h3>
                  <p className="text-slate-600">{viewingProperty.location}</p>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 mb-2">Status</h3>
                  {viewingProperty.badge ? (
                    <Badge 
                      variant={viewingProperty.badge === 'partnered' ? 'default' : 'secondary'}
                      className={`${
                        viewingProperty.badge === 'partnered' 
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-200' 
                          : 'bg-slate-100 text-slate-800 border-slate-200'
                      }`}
                    >
                      {viewingProperty.badge === 'partnered' ? '✓ Partnered' : viewingProperty.badge}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-slate-500 border-slate-300">
                      Available
                    </Badge>
                  )}
                </div>
              </div>

              {/* Co-Ownership Details */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-slate-50 rounded-lg p-4">
                  <h3 className="font-semibold text-slate-900 mb-2">Total Value</h3>
                  <p className="text-2xl font-bold text-slate-900">{formatCurrency(viewingProperty.totalValue)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <h3 className="font-semibold text-slate-900 mb-2">Min Investment</h3>
                  <p className="text-2xl font-bold text-slate-900">{formatCurrency(viewingProperty.minInvestment)}</p>
                </div>

              </div>

              {/* Slots Progress */}
              <div>
                <h3 className="font-semibold text-slate-900 mb-4">Investment Progress</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-600">
                      {viewingProperty.totalSlots - viewingProperty.availableSlots} of {viewingProperty.totalSlots} slots filled
                    </span>
                    <span className="font-medium text-slate-900">
                      {Math.round(((viewingProperty.totalSlots - viewingProperty.availableSlots) / viewingProperty.totalSlots) * 100)}%
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-3">
                    <div 
                      className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                      style={{ 
                        width: `${((viewingProperty.totalSlots - viewingProperty.availableSlots) / viewingProperty.totalSlots) * 100}%` 
                      }}
                    ></div>
                  </div>
                </div>
              </div>

              {/* Description */}
              <div>
                <h3 className="font-semibold text-slate-900 mb-2">Description</h3>
                <div 
                  className="text-slate-600 leading-relaxed prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: viewingProperty.description }}
                />
              </div>

              {/* Co-Ownership Details */}
              {viewingProperty.investmentDetails && (
                <div>
                  <h3 className="font-semibold text-slate-900 mb-2">Co-Ownership Details</h3>
                  <div 
                    className="text-slate-600 leading-relaxed prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: viewingProperty.investmentDetails }}
                  />
                </div>
              )}

              {/* Developer Notes */}
              {viewingProperty.developerNotes && (
                <div>
                  <h3 className="font-semibold text-slate-900 mb-2">Developer Notes</h3>
                  <div 
                    className="text-slate-600 leading-relaxed prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: viewingProperty.developerNotes }}
                  />
                </div>
              )}

              {/* Partnership Document */}
              {viewingProperty.partnershipDocumentUrl && (
                <div>
                  <h3 className="font-semibold text-slate-900 mb-2">Partnership Document</h3>
                  <Button variant="outline" asChild>
                    <a href={viewingProperty.partnershipDocumentUrl} target="_blank" rel="noopener noreferrer">
                      <Download className="h-4 w-4 mr-2" />
                      {viewingProperty.partnershipDocumentName || 'Download Document'}
                    </a>
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Property Modal */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Property</DialogTitle>
          </DialogHeader>

          <form onSubmit={handlePropertySubmit} className="space-y-6">
            {/* Basic Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Property Name *</Label>
                <Input
                  id="edit-name"
                  value={propertyForm.name}
                  onChange={(e) => setPropertyForm(prev => ({ ...prev, name: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-location">Location *</Label>
                <Input
                  id="edit-location"
                  value={propertyForm.location}
                  onChange={(e) => setPropertyForm(prev => ({ ...prev, location: e.target.value }))}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="edit-propertyType">Property Type *</Label>
                <Select value={propertyForm.propertyType} onValueChange={(value) => setPropertyForm(prev => ({ ...prev, propertyType: value }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select property type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="residential">Residential</SelectItem>
                    <SelectItem value="commercial">Commercial</SelectItem>
                    <SelectItem value="land">Land</SelectItem>
                    <SelectItem value="mixed-use">Mixed Use</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-status">Status *</Label>
                <Select value={propertyForm.status} onValueChange={(value) => setPropertyForm(prev => ({ ...prev, status: value }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">🟢 Active (Public)</SelectItem>
                    <SelectItem value="pending">🟡 Pending Review</SelectItem>
                    <SelectItem value="sold_out">🔴 Sold Out</SelectItem>
                    <SelectItem value="completed">✅ Completed</SelectItem>
                    <SelectItem value="archived">📦 Archived (Hidden)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Property Description */}
            <div className="space-y-2">
              <Label htmlFor="edit-description">Property Description *</Label>
              <RichTextEditor
                content={propertyForm.description}
                onChange={(content) => setPropertyForm(prev => ({ ...prev, description: content }))}
                placeholder="Describe the property, amenities, and investment opportunity... (minimum 50 characters)"
                className="min-h-[200px]"
              />
            </div>

            {/* Currency Selector */}
            <div className="space-y-2">
              <Label htmlFor="edit-currency">Property Currency *</Label>
              <Select value={propertyForm.currency} onValueChange={(value) => setPropertyForm(prev => ({ ...prev, currency: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select currency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NGN">₦ Nigerian Naira (NGN)</SelectItem>
                  <SelectItem value="USD">$ US Dollars (USD)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Financial Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="edit-totalValue">Total Property Value ({getCurrencySymbol(propertyForm.currency)}) *</Label>
                <Input
                  id="edit-totalValue"
                  type="number"
                  value={propertyForm.totalValue}
                  onChange={(e) => setPropertyForm(prev => ({ ...prev, totalValue: e.target.value }))}
                  placeholder={propertyForm.currency === 'NGN' ? 'e.g., 2000000000' : 'e.g., 50000000'}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Minimum Investment ({getCurrencySymbol(propertyForm.currency)})</Label>
                <div className="p-3 bg-slate-50 border rounded-md">
                  <span className="text-slate-900 font-medium">
                    {propertyForm.totalValue && propertyForm.totalSlots ? 
                      `${getCurrencySymbol(propertyForm.currency)}${Math.floor(parseInt(propertyForm.totalValue) / parseInt(propertyForm.totalSlots)).toLocaleString()}` 
                      : 'Enter total value and slots first'
                    }
                  </span>
                  <p className="text-xs text-slate-500 mt-1">Calculated automatically</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="edit-totalSlots">Total Ownership Slots *</Label>
                <Input
                  id="edit-totalSlots"
                  type="number"
                  value={propertyForm.totalSlots}
                  onChange={(e) => setPropertyForm(prev => ({ ...prev, totalSlots: e.target.value }))}
                  placeholder="e.g., 100"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-availableSlots">Available Slots *</Label>
                <Input
                  id="edit-availableSlots"
                  type="number"
                  value={propertyForm.availableSlots}
                  onChange={(e) => setPropertyForm(prev => ({ ...prev, availableSlots: e.target.value }))}
                  placeholder="e.g., 85"
                  required
                />
              </div>
            </div>

            {/* Property Badge */}
            <div className="space-y-2">
              <Label htmlFor="edit-badge">Property Badge</Label>
              <Select value={propertyForm.badge || 'none'} onValueChange={(value) => setPropertyForm(prev => ({ ...prev, badge: value === 'none' ? null : value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select badge" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Badge</SelectItem>
                  <SelectItem value="partnered">Partnered</SelectItem>
                  <SelectItem value="premium">Premium</SelectItem>
                  <SelectItem value="featured">Featured</SelectItem>
                  <SelectItem value="land">Land</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Media Upload */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Property Media</h3>
              
              <div className="space-y-2">
                <Label>Main Property Image *</Label>
                <FileUpload
                  onUploadSuccess={(url, fileName) => {
                    setPropertyForm(prev => ({ ...prev, imageUrl: url }));
                  }}
                  accept="image/*"
                  uploadType="image"
                  label="Upload main property image"
                  currentFile={propertyForm.imageUrl}
                  disabled={updatePropertyMutation.isPending}
                />
              </div>

              <div className="space-y-2">
                <Label>Property Video (Optional)</Label>
                <FileUpload
                  onUploadSuccess={(url, fileName) => {
                    setPropertyForm(prev => ({ ...prev, videoUrl: url }));
                  }}
                  accept="video/*"
                  uploadType="video"
                  label="Upload property video"
                  currentFile={propertyForm.videoUrl}
                  disabled={updatePropertyMutation.isPending}
                />
              </div>

              <div className="space-y-2">
                <Label>Property Gallery (Optional)</Label>
                <p className="text-sm text-slate-600">Upload up to 10 additional images for the property gallery</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Array.from({ length: 10 }).map((_, index) => (
                    <div key={index} className="space-y-2">
                      <Label>Image {index + 1}</Label>
                      <FileUpload
                        onUploadSuccess={(url, fileName) => {
                          setPropertyForm(prev => {
                            const newGallery = [...(prev.gallery || [])];
                            newGallery[index] = url;
                            return { ...prev, gallery: newGallery };
                          });
                        }}
                        accept="image/*"
                        uploadType="image"
                        label={`Upload image ${index + 1}`}
                        currentFile={propertyForm.gallery?.[index]}
                        disabled={updatePropertyMutation.isPending}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Partnership Document */}
            {propertyForm.badge === 'partnered' && (
              <div className="space-y-2">
                <Label>Partnership Document *</Label>
                <FileUpload
                  onUploadSuccess={(url, fileName) => {
                    setPropertyForm(prev => ({ 
                      ...prev, 
                      partnershipDocumentUrl: url,
                      partnershipDocumentName: fileName
                    }));
                  }}
                  accept=".pdf,.doc,.docx"
                  uploadType="document"
                  label="Upload partnership document"
                  currentFile={propertyForm.partnershipDocumentName}
                  disabled={updatePropertyMutation.isPending}
                />
              </div>
            )}

            {/* Developer Notes */}
            <div className="space-y-2">
              <Label htmlFor="edit-developerNotes">Developer Notes (Optional)</Label>
              <RichTextEditor
                content={propertyForm.developerNotes}
                onChange={(content) => setPropertyForm(prev => ({ ...prev, developerNotes: content }))}
                placeholder="Internal notes about the developer or partnership..."
                className="min-h-[150px]"
              />
            </div>

            {/* Co-Ownership Details */}
            <div className="space-y-2">
              <Label htmlFor="edit-investmentDetails">Co-Ownership Details</Label>
              <RichTextEditor
                content={propertyForm.investmentDetails}
                onChange={(content) => setPropertyForm(prev => ({ ...prev, investmentDetails: content }))}
                placeholder="Detailed co-ownership information for potential investors... (minimum 30 characters)"
                className="min-h-[150px]"
              />
            </div>

            <div className="flex gap-4 pt-6">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setIsEditDialogOpen(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={updatePropertyMutation.isPending}
                className="flex-1 bg-blue-600 hover:bg-blue-700"
              >
                {updatePropertyMutation.isPending ? "Updating..." : "Update Property"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Investment Reservation Detail Modal */}
      <Dialog open={isReservationViewOpen} onOpenChange={setIsReservationViewOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl">Reservation Details</DialogTitle>
          </DialogHeader>

          {viewingReservation && (
            <div className="space-y-6">
              {/* Investor Information */}
              <div className="bg-slate-50 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Investor Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Full Name</Label>
                    <p className="text-slate-900 mt-1">{viewingReservation.fullName}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Email Address</Label>
                    <p className="text-slate-900 mt-1">{viewingReservation.email}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Phone Number</Label>
                    <p className="text-slate-900 mt-1">{viewingReservation.phone}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Reservation Status</Label>
                    <Badge 
                      variant={viewingReservation.status === 'confirmed' ? 'default' : 'secondary'}
                      className="mt-1"
                    >
                      {viewingReservation.status}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Co-Ownership Details */}
              <div className="bg-blue-50 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Co-Ownership Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Property</Label>
                    <p className="text-slate-900 mt-1 font-semibold">
                      {properties.find((p: any) => p.id === viewingReservation.propertyId)?.name || `Property #${viewingReservation.propertyId}`}
                    </p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Units Reserved</Label>
                    <p className="text-slate-900 mt-1 font-semibold">{viewingReservation.units} units</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Referral Code</Label>
                    <p className="text-slate-900 mt-1">
                      {viewingReservation.referralCode || 'No referral code'}
                    </p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Reservation Date</Label>
                    <p className="text-slate-900 mt-1">{formatDate(viewingReservation.createdAt.toString())}</p>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                <Button
                  variant="outline"
                  className="flex-1 flex items-center justify-center space-x-2"
                  onClick={() => {
                    window.location.href = `mailto:${viewingReservation.email}`;
                  }}
                >
                  <Mail className="h-4 w-4" />
                  <span>Contact Investor</span>
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 flex items-center justify-center space-x-2"
                  onClick={() => {
                    window.location.href = `tel:${viewingReservation.phone}`;
                  }}
                >
                  <Phone className="h-4 w-4" />
                  <span>Call Investor</span>
                </Button>
                <Button
                  variant="default"
                  className="flex-1 flex items-center justify-center space-x-2 bg-green-600 hover:bg-green-700"
                  onClick={() => markAsPaidMutation.mutate(viewingReservation.id)}
                  disabled={markAsPaidMutation.isPending}
                >
                  <CheckCircle className="h-4 w-4" />
                  <span>{markAsPaidMutation.isPending ? "Sending..." : "Mark as Paid"}</span>
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Developer Bid Detail Modal */}
      <Dialog open={isDeveloperBidViewOpen} onOpenChange={setIsDeveloperBidViewOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl">Developer Bid Details</DialogTitle>
          </DialogHeader>

          {viewingDeveloperBid && (
            <div className="space-y-6">
              {/* Developer Information */}
              <div className="bg-slate-50 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Developer Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Developer Name</Label>
                    <p className="text-slate-900 mt-1">{viewingDeveloperBid.developerName}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Company Name</Label>
                    <p className="text-slate-900 mt-1 font-semibold">{viewingDeveloperBid.companyName}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Email Address</Label>
                    <p className="text-slate-900 mt-1">{viewingDeveloperBid.email}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Phone Number</Label>
                    <p className="text-slate-900 mt-1">{viewingDeveloperBid.phone}</p>
                  </div>
                </div>
              </div>

              {/* Project Details */}
              <div className="bg-blue-50 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Project Proposal</h3>
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Project Description</Label>
                    <p className="text-slate-900 mt-2 leading-relaxed">{viewingDeveloperBid.description}</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <Label className="text-sm font-medium text-slate-600">Estimated Cost</Label>
                      <p className="text-slate-900 mt-1 text-xl font-bold">
                        {formatCurrency(viewingDeveloperBid.estimatedCost)}
                      </p>
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-slate-600">Timeline</Label>
                      <p className="text-slate-900 mt-1">{viewingDeveloperBid.timeline} months</p>
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-slate-600">Status</Label>
                      <Badge 
                        variant={
                          viewingDeveloperBid.status === 'approved' ? 'default' :
                          viewingDeveloperBid.status === 'pending' ? 'secondary' : 'outline'
                        }
                        className="mt-1"
                      >
                        {viewingDeveloperBid.status}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>

              {/* Experience & Qualifications */}
              <div className="bg-green-50 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Experience & Qualifications</h3>
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Why This Developer Should Be Selected</Label>
                    <p className="text-slate-900 mt-2 leading-relaxed">{viewingDeveloperBid.whySelected}</p>
                  </div>
                  {viewingDeveloperBid.pastProjectLink && (
                    <div>
                      <Label className="text-sm font-medium text-slate-600">Past Projects Portfolio</Label>
                      <div className="mt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (viewingDeveloperBid.pastProjectLink) {
                              window.open(viewingDeveloperBid.pastProjectLink, '_blank');
                            }
                          }}
                          className="flex items-center space-x-2"
                        >
                          <ExternalLink className="h-4 w-4" />
                          <span>View Portfolio</span>
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                <Button
                  variant="outline"
                  className="flex-1 flex items-center justify-center space-x-2"
                  onClick={() => {
                    window.location.href = `mailto:${viewingDeveloperBid.email}`;
                  }}
                >
                  <Mail className="h-4 w-4" />
                  <span>Contact Developer</span>
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 flex items-center justify-center space-x-2"
                  onClick={() => {
                    window.location.href = `tel:${viewingDeveloperBid.phone}`;
                  }}
                >
                  <Phone className="h-4 w-4" />
                  <span>Call Developer</span>
                </Button>
                {viewingDeveloperBid.pastProjectFile && (
                  <Button
                    variant="outline"
                    className="flex-1 flex items-center justify-center space-x-2"
                  >
                    <Download className="h-4 w-4" />
                    <span>Download Files</span>
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Property Confirmation Modal */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the property "{deletingProperty?.name}" and all its associated data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="confirmText">To confirm, type the property name exactly as shown:</Label>
              <div className="text-sm font-mono bg-slate-100 p-2 rounded border">
                {deletingProperty?.name}
              </div>
              <Input
                id="confirmText"
                value={deleteConfirmationText}
                onChange={(e) => setDeleteConfirmationText(e.target.value)}
                placeholder="Type the property name here"
                className="font-mono"
              />
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setDeleteConfirmationText("");
              setDeletingProperty(null);
            }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteProperty}
              disabled={deleteConfirmationText !== deletingProperty?.name || deletePropertyMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {deletePropertyMutation.isPending ? "Deleting..." : "Delete Property"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Verification Step Edit Dialog */}
      <Dialog open={isVerificationDialogOpen} onOpenChange={setIsVerificationDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {verificationStepBeingEdited?.name || "Edit Verification Step"}
            </DialogTitle>
          </DialogHeader>

          {verificationStepBeingEdited && (
            <div className="space-y-6">
              <div>
                <p className="text-sm text-slate-600 mb-4">
                  {verificationStepBeingEdited.description}
                </p>
                
                {/* Completion Status */}
                <div className="flex items-center space-x-3 p-4 bg-slate-50 rounded-lg">
                  <input
                    type="checkbox"
                    id="completed"
                    checked={verificationStepBeingEdited.isCompleted || false}
                    onChange={(e) => {
                      setVerificationStepBeingEdited((prev: any) => ({
                        ...prev,
                        isCompleted: e.target.checked
                      }));
                    }}
                    className="w-4 h-4 text-green-600 rounded"
                  />
                  <Label htmlFor="completed" className="text-sm font-medium">
                    Mark as completed
                  </Label>
                </div>
              </div>

              {/* Notes Section */}
              <div className="space-y-2">
                <Label htmlFor="verification-notes">Notes (Optional)</Label>
                <Textarea
                  id="verification-notes"
                  placeholder="Add any notes about this verification step..."
                  value={verificationStepBeingEdited.notes || ""}
                  onChange={(e) => {
                    setVerificationStepBeingEdited((prev: any) => ({
                      ...prev,
                      notes: e.target.value
                    }));
                  }}
                  rows={3}
                />
              </div>

              {/* Photo Upload Section */}
              <div className="space-y-4">
                <Label>Proof Photos (Optional)</Label>
                <FileUploader
                  maxFiles={5}
                  maxFileSize={10485760} // 10MB
                  accept="image/*"
                  disabled={uploadingVerificationPhoto}
                  onUpload={async (files: File[]) => {
                    try {
                      setUploadingVerificationPhoto(true);
                      
                      // Process each file using the working Cloudinary upload system
                      for (const file of files) {
                        const formData = new FormData();
                        formData.append('image', file);

                        const response = await fetch('/api/upload/image', {
                          method: 'POST',
                          body: formData,
                        });

                        if (!response.ok) {
                          const errorData = await response.json();
                          throw new Error(errorData.error || 'Upload failed');
                        }

                        const result = await response.json();
                        
                        // Add to current photos using the Cloudinary URL
                        setVerificationStepBeingEdited((prev: any) => ({
                          ...prev,
                          proofPhotos: [...(prev?.proofPhotos || []), result.url]
                        }));
                      }
                      
                      toast({ title: "Photos uploaded successfully" });
                    } catch (error) {
                      console.error("Upload error:", error);
                      toast({ 
                        title: "Upload failed", 
                        description: error instanceof Error ? error.message : "Failed to upload proof photos",
                        variant: "destructive" 
                      });
                    } finally {
                      setUploadingVerificationPhoto(false);
                    }
                  }}
                />
              </div>

              {/* Display current photos */}
              {verificationStepBeingEdited.proofPhotos && verificationStepBeingEdited.proofPhotos.length > 0 && (
                <div className="space-y-2">
                  <Label>Current Photos</Label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {verificationStepBeingEdited.proofPhotos.map((photo: string, index: number) => (
                      <div key={index} className="relative group">
                        <img
                          src={photo.startsWith('https://') ? photo : `/verification-photos/${photo.split('/').pop()}`}
                          alt={`Proof ${index + 1}`}
                          className="w-full h-24 object-cover rounded-lg border border-slate-200"
                        />
                        <button
                          onClick={() => {
                            const updatedPhotos = verificationStepBeingEdited.proofPhotos.filter((_: string, i: number) => i !== index);
                            setVerificationStepBeingEdited((prev: any) => ({
                              ...prev,
                              proofPhotos: updatedPhotos
                            }));
                          }}
                          className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Save Button */}
              <div className="flex justify-end space-x-3 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsVerificationDialogOpen(false);
                    setVerificationStepBeingEdited(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (selectedPropertyForVerification && verificationStepBeingEdited) {
                      updateVerificationStepMutation.mutate({
                        propertyId: selectedPropertyForVerification.id,
                        stepId: verificationStepBeingEdited.id,
                        data: {
                          isCompleted: verificationStepBeingEdited.isCompleted,
                          notes: verificationStepBeingEdited.notes,
                          proofPhotos: verificationStepBeingEdited.proofPhotos || []
                        }
                      });
                    }
                  }}
                  disabled={updateVerificationStepMutation.isPending || uploadingVerificationPhoto}
                >
                  {updateVerificationStepMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}