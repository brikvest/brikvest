import { useState } from "react";
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
import { ArrowLeft, Users, Building, FileText, Calendar, Mail, Phone, MapPin, Plus, Upload, BarChart3, Home, ExternalLink, Download, Eye, Edit, Trash2, Menu, Target, TrendingUp, LogOut, User, Shield } from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { FileUpload } from "@/components/FileUpload";
import { RichTextEditor } from "@/components/RichTextEditor";
import type { Property, InvestmentReservation, DeveloperBid, InsertProperty } from "@shared/schema";

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

  const [propertyForm, setPropertyForm] = useState({
    name: "",
    location: "",
    description: "",
    totalValue: "",
    minInvestment: "",
    projectedReturn: "",
    totalSlots: "",
    availableSlots: "",
    imageUrl: "",
    badge: "none",
    partnershipDocumentName: "",
    partnershipDocumentUrl: "",
    developerNotes: "",
    investmentDetails: ""
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

  // Mutations
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
      setPropertyForm({
        name: "",
        location: "",
        description: "",
        totalValue: "",
        minInvestment: "",
        projectedReturn: "",
        totalSlots: "",
        availableSlots: "",
        imageUrl: "",
        badge: "none",
        partnershipDocumentName: "",
        partnershipDocumentUrl: "",
        developerNotes: "",
        investmentDetails: ""
      });
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
      projectedReturn: "",
      totalSlots: "",
      availableSlots: "",
      imageUrl: "",
      badge: "none",
      partnershipDocumentName: "",
      partnershipDocumentUrl: "",
      developerNotes: "",
      investmentDetails: ""
    });
  };

  const handlePropertySubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const propertyData: InsertProperty = {
      name: propertyForm.name,
      location: propertyForm.location,
      description: propertyForm.description,
      totalValue: parseInt(propertyForm.totalValue),
      minInvestment: parseInt(propertyForm.minInvestment),
      projectedReturn: propertyForm.projectedReturn,
      totalSlots: parseInt(propertyForm.totalSlots),
      availableSlots: parseInt(propertyForm.availableSlots),
      imageUrl: propertyForm.imageUrl || null,
      badge: propertyForm.badge === "none" ? null : propertyForm.badge,
      partnershipDocumentName: propertyForm.partnershipDocumentName || null,
      partnershipDocumentUrl: propertyForm.partnershipDocumentUrl || null,
      developerNotes: propertyForm.developerNotes || null,
      investmentDetails: propertyForm.investmentDetails || null,
    };

    if (editingProperty) {
      updatePropertyMutation.mutate({ id: editingProperty.id, data: propertyData });
    } else {
      createPropertyMutation.mutate(propertyData);
    }
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
                                            projectedReturn: property.projectedReturn,
                                            totalSlots: property.totalSlots.toString(),
                                            availableSlots: property.availableSlots.toString(),
                                            imageUrl: property.imageUrl || "",
                                            badge: property.badge || "none",
                                            partnershipDocumentName: property.partnershipDocumentName || "",
                                            partnershipDocumentUrl: property.partnershipDocumentUrl || "",
                                            developerNotes: property.developerNotes || "",
                                            investmentDetails: property.investmentDetails || ""
                                          });
                                          setIsEditDialogOpen(true);
                                        }}
                                        className="h-9 w-9 p-0 hover:bg-slate-100"
                                      >
                                        <Edit className="h-4 w-4" />
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
                                        projectedReturn: property.projectedReturn,
                                        totalSlots: property.totalSlots.toString(),
                                        availableSlots: property.availableSlots.toString(),
                                        imageUrl: property.imageUrl || "",
                                        badge: property.badge || "none",
                                        partnershipDocumentName: property.partnershipDocumentName || "",
                                        partnershipDocumentUrl: property.partnershipDocumentUrl || "",
                                        developerNotes: property.developerNotes || "",
                                        investmentDetails: property.investmentDetails || ""
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
                    <CardTitle className="text-xl text-slate-900">Property Details</CardTitle>
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
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="description">Description *</Label>
                        <RichTextEditor
                          content={propertyForm.description}
                          onChange={(content) => setPropertyForm(prev => ({ ...prev, description: content }))}
                          placeholder="Describe the property, amenities, and investment opportunity..."
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <Label htmlFor="totalValue">Total Property Value (₦) *</Label>
                          <Input
                            id="totalValue"
                            type="number"
                            value={propertyForm.totalValue}
                            onChange={(e) => setPropertyForm(prev => ({ ...prev, totalValue: e.target.value }))}
                            placeholder="e.g., 50000000"
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="minInvestment">Minimum Investment (₦) *</Label>
                          <Input
                            id="minInvestment"
                            type="number"
                            value={propertyForm.minInvestment}
                            onChange={(e) => setPropertyForm(prev => ({ ...prev, minInvestment: e.target.value }))}
                            placeholder="e.g., 1000000"
                            required
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="space-y-2">
                          <Label htmlFor="projectedReturn">Projected Return *</Label>
                          <Input
                            id="projectedReturn"
                            value={propertyForm.projectedReturn}
                            onChange={(e) => setPropertyForm(prev => ({ ...prev, projectedReturn: e.target.value }))}
                            placeholder="e.g., 15% annually"
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="totalSlots">Total Investment Slots *</Label>
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
                        <Select value={propertyForm.badge} onValueChange={(value) => setPropertyForm(prev => ({ ...prev, badge: value }))}>
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
                        <Label>Property Image</Label>
                        <FileUpload
                          onUploadSuccess={(url, fileName) => {
                            setPropertyForm(prev => ({ ...prev, imageUrl: url }));
                          }}
                          accept="image/*"
                          uploadType="image"
                          label="Upload property image"
                          currentFile={propertyForm.imageUrl}
                          disabled={createPropertyMutation.isPending}
                        />
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
                        <Label htmlFor="developerNotes">Developer Notes</Label>
                        <RichTextEditor
                          content={propertyForm.developerNotes}
                          onChange={(content) => setPropertyForm(prev => ({ ...prev, developerNotes: content }))}
                          placeholder="Internal notes about the developer or partnership..."
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="investmentDetails">Investment Details</Label>
                        <RichTextEditor
                          content={propertyForm.investmentDetails}
                          onChange={(content) => setPropertyForm(prev => ({ ...prev, investmentDetails: content }))}
                          placeholder="Detailed investment information for potential investors..."
                        />
                      </div>

                      <div className="flex gap-4 pt-6">
                        <Button 
                          type="button" 
                          variant="outline" 
                          onClick={() => setSelectedTab('properties')}
                          className="flex-1"
                        >
                          Cancel
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
                        projectedReturn: viewingProperty.projectedReturn,
                        totalSlots: viewingProperty.totalSlots.toString(),
                        availableSlots: viewingProperty.availableSlots.toString(),
                        imageUrl: viewingProperty.imageUrl || "",
                        badge: viewingProperty.badge || "none",
                        partnershipDocumentName: viewingProperty.partnershipDocumentName || "",
                        partnershipDocumentUrl: viewingProperty.partnershipDocumentUrl || "",
                        developerNotes: viewingProperty.developerNotes || "",
                        investmentDetails: viewingProperty.investmentDetails || ""
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
              {/* Property Image */}
              {viewingProperty.imageUrl && (
                <div className="w-full h-64 bg-slate-100 rounded-lg overflow-hidden">
                  <img 
                    src={viewingProperty.imageUrl} 
                    alt={viewingProperty.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

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

              {/* Investment Details */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-slate-50 rounded-lg p-4">
                  <h3 className="font-semibold text-slate-900 mb-2">Total Value</h3>
                  <p className="text-2xl font-bold text-slate-900">{formatCurrency(viewingProperty.totalValue)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <h3 className="font-semibold text-slate-900 mb-2">Min Investment</h3>
                  <p className="text-2xl font-bold text-slate-900">{formatCurrency(viewingProperty.minInvestment)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <h3 className="font-semibold text-slate-900 mb-2">Projected Return</h3>
                  <p className="text-2xl font-bold text-slate-900">{viewingProperty.projectedReturn}</p>
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

              {/* Investment Details */}
              {viewingProperty.investmentDetails && (
                <div>
                  <h3 className="font-semibold text-slate-900 mb-2">Investment Details</h3>
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

            <div className="space-y-2">
              <Label htmlFor="edit-description">Description *</Label>
              <RichTextEditor
                content={propertyForm.description}
                onChange={(content) => setPropertyForm(prev => ({ ...prev, description: content }))}
                placeholder="Describe the property, amenities, and investment opportunity..."
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="edit-totalValue">Total Property Value (₦) *</Label>
                <Input
                  id="edit-totalValue"
                  type="number"
                  value={propertyForm.totalValue}
                  onChange={(e) => setPropertyForm(prev => ({ ...prev, totalValue: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-minInvestment">Minimum Investment (₦) *</Label>
                <Input
                  id="edit-minInvestment"
                  type="number"
                  value={propertyForm.minInvestment}
                  onChange={(e) => setPropertyForm(prev => ({ ...prev, minInvestment: e.target.value }))}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <Label htmlFor="edit-projectedReturn">Projected Return *</Label>
                <Input
                  id="edit-projectedReturn"
                  value={propertyForm.projectedReturn}
                  onChange={(e) => setPropertyForm(prev => ({ ...prev, projectedReturn: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-totalSlots">Total Investment Slots *</Label>
                <Input
                  id="edit-totalSlots"
                  type="number"
                  value={propertyForm.totalSlots}
                  onChange={(e) => setPropertyForm(prev => ({ ...prev, totalSlots: e.target.value }))}
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
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-badge">Property Status</Label>
              <Select value={propertyForm.badge} onValueChange={(value) => setPropertyForm(prev => ({ ...prev, badge: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Available</SelectItem>
                  <SelectItem value="partnered">Partnered</SelectItem>
                  <SelectItem value="premium">Premium</SelectItem>
                  <SelectItem value="featured">Featured</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Property Image</Label>
              <FileUpload
                onUploadSuccess={(url, fileName) => {
                  setPropertyForm(prev => ({ ...prev, imageUrl: url }));
                }}
                accept="image/*"
                uploadType="image"
                label="Upload property image"
                currentFile={propertyForm.imageUrl}
                disabled={updatePropertyMutation.isPending}
              />
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
                disabled={updatePropertyMutation.isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-developerNotes">Developer Notes</Label>
              <RichTextEditor
                content={propertyForm.developerNotes}
                onChange={(content) => setPropertyForm(prev => ({ ...prev, developerNotes: content }))}
                placeholder="Internal notes about the developer or partnership..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-investmentDetails">Investment Details</Label>
              <RichTextEditor
                content={propertyForm.investmentDetails}
                onChange={(content) => setPropertyForm(prev => ({ ...prev, investmentDetails: content }))}
                placeholder="Detailed investment information for potential investors..."
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

              {/* Investment Details */}
              <div className="bg-blue-50 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Investment Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-slate-600">Property ID</Label>
                    <p className="text-slate-900 mt-1">#{viewingReservation.propertyId}</p>
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
                          onClick={() => window.open(viewingDeveloperBid.pastProjectLink, '_blank')}
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
    </div>
  );
}