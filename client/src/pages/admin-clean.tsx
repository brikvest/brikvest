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
import { ArrowLeft, Users, Building, FileText, Calendar, Mail, Phone, MapPin, Plus, Upload, BarChart3, Home, ExternalLink, Download, Eye, Edit, Trash2, Menu, Target, TrendingUp } from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { FileUpload } from "@/components/FileUpload";
import type { Property, InvestmentReservation, DeveloperBid, InsertProperty } from "@shared/schema";

export default function AdminDashboard() {
  const [selectedTab, setSelectedTab] = useState("overview");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [viewingProperty, setViewingProperty] = useState<Property | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
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
      const response = await apiRequest("/api/properties", {
        method: "POST",
        body: JSON.stringify(data),
      });
      return response;
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
      const response = await apiRequest(`/api/properties/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
      return response;
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

  // Helper functions
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
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
                    onClick={() => setSelectedTab('add-property')} 
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
                                        onClick={() => setEditingProperty(property)}
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
                                    onClick={() => setEditingProperty(property)}
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

            {/* Other tabs content would go here */}
            {selectedTab === "overview" && (
              <div className="space-y-6 mt-6">
                <h1 className="text-3xl font-bold text-slate-900">Dashboard Overview</h1>
                <p className="text-slate-600">Welcome to the admin dashboard</p>
              </div>
            )}

            {selectedTab === "add-property" && (
              <div className="space-y-6 mt-6">
                <h1 className="text-3xl font-bold text-slate-900">Add New Property</h1>
                <p className="text-slate-600">Create a new property listing</p>
              </div>
            )}

            {selectedTab === "reservations" && (
              <div className="space-y-6 mt-6">
                <h1 className="text-3xl font-bold text-slate-900">Reservations</h1>
                <p className="text-slate-600">Manage investment reservations</p>
              </div>
            )}

            {selectedTab === "developer-bids" && (
              <div className="space-y-6 mt-6">
                <h1 className="text-3xl font-bold text-slate-900">Developer Bids</h1>
                <p className="text-slate-600">Review developer proposals</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}