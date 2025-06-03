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
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Users, Building, FileText, Calendar, Mail, Phone, MapPin, Plus, Upload, BarChart3, Home, ExternalLink, Download } from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { FileUpload } from "@/components/FileUpload";
import type { Property, InvestmentReservation, DeveloperBid, InsertProperty } from "@shared/schema";
import brikvest_logo from "@/assets/brikvest-logo.png";

export default function AdminDashboard() {
  const [selectedTab, setSelectedTab] = useState("overview");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [propertyForm, setPropertyForm] = useState({
    name: "",
    location: "",
    description: "",
    developmentCost: "",
    fundingTarget: "",
    minInvestment: "",
    totalSlots: "",
    availableSlots: "",
    badge: "none",
    partnershipDocumentName: "",
    partnershipDocumentUrl: "",
    developerNotes: ""
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
    queryFn: () => fetch("/api/developer-bids").then(res => res.json())
  });

  // Create property mutation
  const createPropertyMutation = useMutation({
    mutationFn: async (data: InsertProperty) => {
      return apiRequest("/api/properties", {
        method: "POST",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" }
      });
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Property created successfully"
      });
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      setPropertyForm({
        name: "",
        location: "",
        description: "",
        developmentCost: "",
        fundingTarget: "",
        minInvestment: "",
        totalSlots: "",
        availableSlots: "",
        badge: "none",
        partnershipDocumentName: "",
        partnershipDocumentUrl: "",
        developerNotes: ""
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create property",
        variant: "destructive"
      });
    }
  });

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-NG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: 'NGN'
    }).format(amount);
  };

  const handlePropertySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const propertyData: InsertProperty = {
      name: propertyForm.name,
      location: propertyForm.location,
      description: propertyForm.description,
      developmentCost: parseFloat(propertyForm.developmentCost),
      fundingTarget: parseFloat(propertyForm.fundingTarget),
      minInvestment: parseFloat(propertyForm.minInvestment),
      totalSlots: parseInt(propertyForm.totalSlots),
      availableSlots: parseInt(propertyForm.availableSlots),
      badge: propertyForm.badge === "none" ? null : propertyForm.badge,
      partnershipDocumentName: propertyForm.partnershipDocumentName || null,
      partnershipDocumentUrl: propertyForm.partnershipDocumentUrl || null,
      developerNotes: propertyForm.developerNotes || null
    };

    createPropertyMutation.mutate(propertyData);
  };

  const menuItems = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'properties', label: 'Properties', icon: Building },
    { id: 'add-property', label: 'Add Property', icon: Plus },
    { id: 'investments', label: 'Investments', icon: Users },
    { id: 'developers', label: 'Developer Bids', icon: FileText },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <div className="w-64 bg-white shadow-lg flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-slate-200">
          <div className="flex items-center space-x-3">
            <img 
              src={brikvest_logo} 
              alt="Brikvest Logo" 
              className="h-8 w-auto"
            />
            <div>
              <h1 className="text-lg font-semibold text-slate-800">Admin</h1>
              <p className="text-sm text-slate-500">Dashboard</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4">
          <ul className="space-y-2">
            {menuItems.map((item) => {
              const IconComponent = item.icon;
              return (
                <li key={item.id}>
                  <button
                    onClick={() => setSelectedTab(item.id)}
                    className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-left transition-colors ${
                      selectedTab === item.id
                        ? 'bg-blue-50 text-blue-700 border border-blue-200'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <IconComponent className="w-5 h-5" />
                    <span>{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200">
          <Link href="/">
            <Button variant="outline" className="w-full flex items-center justify-center space-x-2">
              <Home className="w-4 h-4" />
              <span>Back to Site</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Top Bar */}
        <header className="bg-white shadow-sm border-b border-slate-200 px-6 py-4">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-semibold text-slate-800">
              {menuItems.find(item => item.id === selectedTab)?.label || 'Dashboard'}
            </h2>
            <div className="text-sm text-slate-500">
              {new Date().toLocaleDateString('en-NG', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              })}
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 p-6 overflow-auto">

          {/* Overview */}
          {selectedTab === "overview" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Properties</CardTitle>
                    <Building className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{properties.length}</div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Investments</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{reservations.length}</div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Developer Bids</CardTitle>
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{developerBids.length}</div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Funding</CardTitle>
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {formatCurrency(
                        reservations.reduce((total: number, reservation: any) => 
                          total + (reservation.amount || 0), 0
                        )
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Recent Activity */}
              <Card>
                <CardHeader>
                  <CardTitle>Recent Developer Bids</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {developerBids.slice(0, 5).map((bid: DeveloperBid) => (
                      <div key={bid.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex items-center space-x-3">
                          <div className="bg-blue-100 p-2 rounded-lg">
                            <FileText className="w-4 h-4 text-blue-600" />
                          </div>
                          <div>
                            <p className="font-medium">{bid.companyName}</p>
                            <p className="text-sm text-slate-500">
                              Property ID: {bid.propertyId}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-medium">{formatCurrency(bid.constructionCost)}</p>
                          <p className="text-sm text-slate-500">
                            {formatDate(bid.createdAt.toString())}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Properties */}
          {selectedTab === "properties" && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>All Properties</CardTitle>
                </CardHeader>
                <CardContent>
                  {propertiesLoading ? (
                    <div className="text-center py-8">Loading properties...</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Location</TableHead>
                          <TableHead>Funding Target</TableHead>
                          <TableHead>Available Slots</TableHead>
                          <TableHead>Badge</TableHead>
                          <TableHead>Created</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {properties.map((property: Property) => (
                          <TableRow key={property.id}>
                            <TableCell className="font-medium">{property.name}</TableCell>
                            <TableCell>{property.location}</TableCell>
                            <TableCell>{formatCurrency(property.fundingTarget)}</TableCell>
                            <TableCell>{property.availableSlots}/{property.totalSlots}</TableCell>
                            <TableCell>
                              {property.badge && (
                                <Badge variant="secondary">{property.badge}</Badge>
                              )}
                            </TableCell>
                            <TableCell>{formatDate(property.createdAt.toString())}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Add Property */}
          {selectedTab === "add-property" && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Plus className="w-5 h-5" />
                    <span>Add New Property</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handlePropertySubmit} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <Label htmlFor="name">Property Name</Label>
                        <Input
                          id="name"
                          value={propertyForm.name}
                          onChange={(e) => setPropertyForm(prev => ({ ...prev, name: e.target.value }))}
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="location">Location</Label>
                        <Input
                          id="location"
                          value={propertyForm.location}
                          onChange={(e) => setPropertyForm(prev => ({ ...prev, location: e.target.value }))}
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="developmentCost">Development Cost (₦)</Label>
                        <Input
                          id="developmentCost"
                          type="number"
                          value={propertyForm.developmentCost}
                          onChange={(e) => setPropertyForm(prev => ({ ...prev, developmentCost: e.target.value }))}
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="fundingTarget">Funding Target (₦)</Label>
                        <Input
                          id="fundingTarget"
                          type="number"
                          value={propertyForm.fundingTarget}
                          onChange={(e) => setPropertyForm(prev => ({ ...prev, fundingTarget: e.target.value }))}
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="minInvestment">Minimum Investment (₦)</Label>
                        <Input
                          id="minInvestment"
                          type="number"
                          value={propertyForm.minInvestment}
                          onChange={(e) => setPropertyForm(prev => ({ ...prev, minInvestment: e.target.value }))}
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="totalSlots">Total Slots</Label>
                        <Input
                          id="totalSlots"
                          type="number"
                          value={propertyForm.totalSlots}
                          onChange={(e) => setPropertyForm(prev => ({ ...prev, totalSlots: e.target.value }))}
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="availableSlots">Available Slots</Label>
                        <Input
                          id="availableSlots"
                          type="number"
                          value={propertyForm.availableSlots}
                          onChange={(e) => setPropertyForm(prev => ({ ...prev, availableSlots: e.target.value }))}
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor="badge">Badge Type</Label>
                        <Select value={propertyForm.badge} onValueChange={(value) => setPropertyForm(prev => ({ ...prev, badge: value }))}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select badge type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No Badge</SelectItem>
                            <SelectItem value="partnered">Partnered</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="partnershipDocumentName">Partnership Document Name</Label>
                        <Input
                          id="partnershipDocumentName"
                          value={propertyForm.partnershipDocumentName}
                          onChange={(e) => setPropertyForm(prev => ({ ...prev, partnershipDocumentName: e.target.value }))}
                        />
                      </div>
                      <div>
                        <Label htmlFor="partnershipDocumentUrl">Partnership Document URL</Label>
                        <Input
                          id="partnershipDocumentUrl"
                          type="url"
                          value={propertyForm.partnershipDocumentUrl}
                          onChange={(e) => setPropertyForm(prev => ({ ...prev, partnershipDocumentUrl: e.target.value }))}
                        />
                      </div>
                    </div>
                    
                    <div>
                      <Label htmlFor="description">Description</Label>
                      <Textarea
                        id="description"
                        value={propertyForm.description}
                        onChange={(e) => setPropertyForm(prev => ({ ...prev, description: e.target.value }))}
                        rows={4}
                        required
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="developerNotes">Developer Notes</Label>
                      <Textarea
                        id="developerNotes"
                        value={propertyForm.developerNotes}
                        onChange={(e) => setPropertyForm(prev => ({ ...prev, developerNotes: e.target.value }))}
                        rows={3}
                      />
                    </div>

                    <Button type="submit" disabled={createPropertyMutation.isPending} className="w-full">
                      {createPropertyMutation.isPending ? "Creating..." : "Create Property"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Investments */}
          {selectedTab === "investments" && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Investment Reservations</CardTitle>
                </CardHeader>
                <CardContent>
                  {reservationsLoading ? (
                    <div className="text-center py-8">Loading reservations...</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Investor</TableHead>
                          <TableHead>Property ID</TableHead>
                          <TableHead>Units</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reservations.map((reservation: InvestmentReservation) => (
                          <TableRow key={reservation.id}>
                            <TableCell>
                              <div>
                                <p className="font-medium">{reservation.fullName}</p>
                                <p className="text-sm text-slate-500">{reservation.email}</p>
                              </div>
                            </TableCell>
                            <TableCell>{reservation.propertyId}</TableCell>
                            <TableCell>{reservation.units}</TableCell>
                            <TableCell>{formatCurrency(reservation.amount || 0)}</TableCell>
                            <TableCell>{formatDate(reservation.createdAt.toString())}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Developer Bids */}
          {selectedTab === "developers" && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Developer Bids</CardTitle>
                </CardHeader>
                <CardContent>
                  {bidsLoading ? (
                    <div className="text-center py-8">Loading bids...</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Company</TableHead>
                          <TableHead>Property ID</TableHead>
                          <TableHead>Construction Cost</TableHead>
                          <TableHead>Timeline</TableHead>
                          <TableHead>Contact</TableHead>
                          <TableHead>Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {developerBids.map((bid: DeveloperBid) => (
                          <TableRow key={bid.id}>
                            <TableCell>
                              <div>
                                <p className="font-medium">{bid.companyName}</p>
                                <p className="text-sm text-slate-500">{bid.contactPerson}</p>
                              </div>
                            </TableCell>
                            <TableCell>{bid.propertyId}</TableCell>
                            <TableCell>{formatCurrency(bid.constructionCost)}</TableCell>
                            <TableCell>{bid.timeline}</TableCell>
                            <TableCell>
                              <div className="text-sm">
                                <p>{bid.email}</p>
                                <p>{bid.phone}</p>
                              </div>
                            </TableCell>
                            <TableCell>{formatDate(bid.createdAt.toString())}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}