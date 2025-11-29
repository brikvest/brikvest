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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { ArrowLeft, Users, Building, Calendar, Mail, Phone, MapPin, Plus, Upload, BarChart3, Home, ExternalLink, Download, Eye, Edit, Trash2, Menu, Target, TrendingUp, LogOut, User, Shield, CheckCircle, RefreshCw, ShieldCheck, XCircle, MoreVertical, FileText } from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { FileUpload } from "@/components/FileUpload";
import { RichTextEditor } from "@/components/RichTextEditor";
import { PropertyMediaCarousel } from "@/components/PropertyMediaCarousel";
import type { Property, InvestmentReservation, InsertProperty, VerificationStep, MarketInsight, User as UserType } from "@shared/schema";
import { FileUploader } from "@/components/FileUploader";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { useCurrency } from "@/hooks/useCurrency";

// Helper function to get currency symbol
const getCurrencySymbol = (currency: string) => {
  switch (currency) {
    case 'NGN': return '₦';
    case 'USD': return '$';
    default: return currency;
  }
};

// Helper function to convert Cloudinary images to JPG format for browser compatibility
const convertToJpg = (url: string): string => {
  if (!url || !url.includes('cloudinary.com')) return url;
  
  // Cloudinary URL format: https://res.cloudinary.com/{cloud_name}/image/upload/{transformations}/{version}/{path}
  // We need to insert f_jpg transformation
  const parts = url.split('/upload/');
  if (parts.length === 2) {
    return `${parts[0]}/upload/f_jpg/${parts[1]}`;
  }
  return url;
};

// Admin Investments Tab Component
function AdminInvestmentsTab({ 
  properties, 
  reservations,
  authenticatedRequest,
  queryClient,
  toast 
}: {
  properties: Property[];
  reservations: InvestmentReservation[];
  authenticatedRequest: any;
  queryClient: any;
  toast: any;
}) {
  const [activeSubTab, setActiveSubTab] = useState<"create" | "manage">("create");
  const [userEmail, setUserEmail] = useState("");
  const [searchedUser, setSearchedUser] = useState<UserType | null>(null);
  const [searchingUser, setSearchingUser] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | null>(null);
  const [units, setUnits] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentEvidenceFile, setPaymentEvidenceFile] = useState<File | null>(null);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);

  // Filter states for management view
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Mark Payment Received dialog states
  const [markPaymentReservation, setMarkPaymentReservation] = useState<InvestmentReservation | null>(null);
  const [isMarkPaymentDialogOpen, setIsMarkPaymentDialogOpen] = useState(false);
  const [markPaymentRef, setMarkPaymentRef] = useState("");

  // Edit reservation states
  const [editingReservation, setEditingReservation] = useState<InvestmentReservation | null>(null);
  const [isEditReservationOpen, setIsEditReservationOpen] = useState(false);
  const [editUnits, setEditUnits] = useState("");
  const [editPaymentMethod, setEditPaymentMethod] = useState("");
  const [editPaymentReference, setEditPaymentReference] = useState("");
  const [editPaymentEvidenceFile, setEditPaymentEvidenceFile] = useState<File | null>(null);
  const [editUploadingEvidence, setEditUploadingEvidence] = useState(false);
  const [editNotes, setEditNotes] = useState("");
  const [editingSubmitting, setEditingSubmitting] = useState(false);

  const searchUserMutation = useMutation({
    mutationFn: async (email: string) => {
      return await authenticatedRequest("/api/admin/users/search", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
    },
    onSuccess: (data) => {
      if (data.user) {
        setSearchedUser(data.user);
        toast({
          title: "User found",
          description: `Found ${data.user.email}`,
        });
      } else {
        setSearchedUser(null);
        toast({
          title: "User not found",
          description: "No user with this email exists",
          variant: "destructive",
        });
      }
    },
    onError: () => {
      toast({
        title: "Search failed",
        description: "Failed to search for user",
        variant: "destructive",
      });
    },
  });

  const createUserMutation = useMutation({
    mutationFn: async (data: { email: string; fullName: string; phone?: string }) => {
      return await authenticatedRequest("/api/admin/users/create", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: (data) => {
      setSearchedUser(data.user);
      toast({
        title: "User created",
        description: `Created account for ${data.user.email}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Creation failed",
        description: error.message || "Failed to create user",
        variant: "destructive",
      });
    },
  });

  const createInvestmentMutation = useMutation({
    mutationFn: async (data: any) => {
      return await authenticatedRequest("/api/admin/investments/create", {
        method: "POST",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reservations/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      toast({
        title: "Investment created",
        description: "Investment reservation has been created successfully",
      });
      // Reset form
      setSearchedUser(null);
      setUserEmail("");
      setSelectedPropertyId(null);
      setUnits("");
      setPaymentMethod("");
      setPaymentReference("");
      setPaymentEvidenceFile(null);
      setNotes("");
    },
    onError: (error: any) => {
      toast({
        title: "Creation failed",
        description: error.message || "Failed to create investment",
        variant: "destructive",
      });
    },
  });

  const markPaymentReceivedMutation = useMutation({
    mutationFn: async ({ id, paymentReference }: { id: number; paymentReference: string }) => {
      return await authenticatedRequest(`/api/admin/investments/${id}/mark-payment-received`, {
        method: "PUT",
        body: JSON.stringify({ paymentReference }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reservations/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      setIsMarkPaymentDialogOpen(false);
      setMarkPaymentReservation(null);
      setMarkPaymentRef("");
      toast({
        title: "Payment marked",
        description: "Payment has been marked as received and investor notified",
      });
    },
  });

  const handleOpenMarkPaymentDialog = (reservation: InvestmentReservation) => {
    setMarkPaymentReservation(reservation);
    setMarkPaymentRef(reservation.paymentReference || "");
    setIsMarkPaymentDialogOpen(true);
  };

  const handleSubmitMarkPayment = () => {
    if (!markPaymentReservation || !markPaymentRef.trim()) {
      toast({
        title: "Payment reference required",
        description: "Please enter a payment reference before marking as paid",
        variant: "destructive",
      });
      return;
    }
    markPaymentReceivedMutation.mutate({ 
      id: markPaymentReservation.id, 
      paymentReference: markPaymentRef.trim() 
    });
  };

  const confirmInvestmentMutation = useMutation({
    mutationFn: async (id: number) => {
      return await authenticatedRequest(`/api/admin/investments/${id}/confirm`, {
        method: "PUT",
        body: JSON.stringify({}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reservations/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      toast({
        title: "Investment confirmed",
        description: "Investment has been confirmed successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Confirmation failed",
        description: error.message || "Failed to confirm investment",
        variant: "destructive",
      });
    },
  });

  const cancelInvestmentMutation = useMutation({
    mutationFn: async (id: number) => {
      return await authenticatedRequest(`/api/admin/investments/${id}/cancel`, {
        method: "PUT",
        body: JSON.stringify({}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reservations/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      toast({
        title: "Investment cancelled",
        description: "Investment has been cancelled",
      });
    },
  });

  const updateReservationMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      return await authenticatedRequest(`/api/admin/investments/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reservations/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      setIsEditReservationOpen(false);
      setEditingReservation(null);
      toast({
        title: "Investment updated",
        description: "Investment reservation has been updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error.message || "Failed to update investment",
        variant: "destructive",
      });
    },
  });

  const handleSearchUser = () => {
    if (!userEmail.trim()) {
      toast({
        title: "Email required",
        description: "Please enter a user email",
        variant: "destructive",
      });
      return;
    }
    searchUserMutation.mutate(userEmail);
  };

  const handleCreateInvestment = async () => {
    // Validation
    if (!searchedUser || !selectedPropertyId || !units) {
      toast({
        title: "Missing information",
        description: "Please complete all required fields",
        variant: "destructive",
      });
      return;
    }

    const unitsValue = parseFloat(units);
    if (isNaN(unitsValue) || unitsValue <= 0) {
      toast({
        title: "Invalid units",
        description: "Units must be a positive number",
        variant: "destructive",
      });
      return;
    }

    if (unitsValue > availableUnits) {
      toast({
        title: "Not enough units",
        description: `Only ${availableUnits} units available`,
        variant: "destructive",
      });
      return;
    }

    let paymentEvidenceUrl = null;

    // Upload payment evidence if provided
    if (paymentEvidenceFile) {
      setUploadingEvidence(true);
      try {
        const formData = new FormData();
        formData.append('file', paymentEvidenceFile);
        
        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });
        
        if (!response.ok) {
          throw new Error('Upload failed');
        }
        
        const data = await response.json();
        paymentEvidenceUrl = data.url;
      } catch (error) {
        toast({
          title: "Upload failed",
          description: "Failed to upload payment evidence",
          variant: "destructive",
        });
        setUploadingEvidence(false);
        return;
      } finally {
        setUploadingEvidence(false);
      }
    }

    createInvestmentMutation.mutate({
      userId: searchedUser.id,
      propertyId: selectedPropertyId,
      units: unitsValue,
      paymentMethod,
      paymentReference,
      paymentEvidenceUrl,
      notes,
    });
  };

  const handleOpenEditReservation = (reservation: InvestmentReservation) => {
    setEditingReservation(reservation);
    setEditUnits(reservation.units.toString());
    setEditPaymentMethod(reservation.paymentMethod || "");
    setEditPaymentReference(reservation.paymentReference || "");
    setEditNotes(reservation.notes || "");
    setEditPaymentEvidenceFile(null);
    setIsEditReservationOpen(true);
  };

  const handleUpdateReservation = async () => {
    if (!editingReservation) return;

    // Validation
    const unitsValue = parseFloat(editUnits);
    if (isNaN(unitsValue) || unitsValue <= 0) {
      toast({
        title: "Invalid units",
        description: "Units must be a positive number",
        variant: "destructive",
      });
      return;
    }

    setEditingSubmitting(true);

    let paymentEvidenceUrl = editingReservation.paymentEvidenceUrl;

    // Upload payment evidence if provided
    if (editPaymentEvidenceFile) {
      setEditUploadingEvidence(true);
      try {
        const formData = new FormData();
        formData.append('file', editPaymentEvidenceFile);
        
        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });
        
        if (!response.ok) {
          throw new Error('Upload failed');
        }
        
        const data = await response.json();
        paymentEvidenceUrl = data.url;
      } catch (error) {
        toast({
          title: "Upload failed",
          description: "Failed to upload payment evidence",
          variant: "destructive",
        });
        setEditUploadingEvidence(false);
        setEditingSubmitting(false);
        return;
      } finally {
        setEditUploadingEvidence(false);
      }
    }

    updateReservationMutation.mutate({
      id: editingReservation.id,
      data: {
        units: unitsValue,
        paymentMethod: editPaymentMethod || null,
        paymentReference: editPaymentReference || null,
        paymentEvidenceUrl,
        notes: editNotes || null,
      },
    });

    setEditingSubmitting(false);
  };

  const selectedProperty = properties.find(p => p.id === selectedPropertyId);
  const availableUnits = selectedProperty 
    ? (selectedProperty.totalSlots && selectedProperty.totalSlots > 0 
        ? (selectedProperty.availableSlots || 0)
        : (selectedProperty.totalUnits || 0) - (selectedProperty.reservedUnits || 0) - (selectedProperty.soldUnits || 0))
    : 0;

  const filteredReservations = reservations.filter((r) => {
    if (statusFilter === "all") return true;
    return r.status === statusFilter;
  });

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "payment_pending": return "bg-yellow-100 text-yellow-800";
      case "payment_received": return "bg-blue-100 text-blue-800";
      case "confirmed": return "bg-green-100 text-green-800";
      case "cancelled": return "bg-red-100 text-red-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <div className="space-y-6 mt-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Admin-Assisted Investments</h1>
        <p className="text-slate-600 mt-2">Create and manage investments on behalf of users</p>
      </div>

      {/* Sub-tabs */}
      <div className="flex space-x-2 border-b border-slate-200">
        <button
          onClick={() => setActiveSubTab("create")}
          className={`px-4 py-2 font-medium transition-colors ${
            activeSubTab === "create"
              ? "border-b-2 border-blue-600 text-blue-600"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Create Investment
        </button>
        <button
          onClick={() => setActiveSubTab("manage")}
          className={`px-4 py-2 font-medium transition-colors ${
            activeSubTab === "manage"
              ? "border-b-2 border-blue-600 text-blue-600"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Manage Investments
        </button>
      </div>

      {/* Create Investment Tab */}
      {activeSubTab === "create" && (
        <div className="space-y-6">
          {/* Step 1: User Lookup */}
          <Card>
            <CardHeader>
              <CardTitle>Step 1: Find or Create User</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>User Email</Label>
                <div className="flex space-x-2">
                  <Input
                    type="email"
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    placeholder="user@example.com"
                    data-testid="input-user-email"
                  />
                  <Button 
                    onClick={handleSearchUser}
                    disabled={searchUserMutation.isPending}
                    data-testid="button-search-user"
                  >
                    {searchUserMutation.isPending ? "Searching..." : "Search"}
                  </Button>
                </div>
              </div>

              {searchedUser && (
                <div className="bg-green-50 border border-green-200 p-4 rounded-lg">
                  <p className="font-medium text-green-900">User Found</p>
                  <p className="text-sm text-green-700">Email: {searchedUser.email}</p>
                  <p className="text-sm text-green-700">
                    Name: {searchedUser.firstName} {searchedUser.lastName}
                  </p>
                  <p className="text-sm text-green-700">KYC Status: {searchedUser.kycStatus || "Not submitted"}</p>
                </div>
              )}

              {!searchedUser && userEmail && !searchUserMutation.isPending && (
                <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-lg space-y-3">
                  <p className="font-medium text-yellow-900">User not found. Create a new account?</p>
                  <div className="space-y-2">
                    <div>
                      <Label>Full Name</Label>
                      <Input
                        id="new-user-name"
                        placeholder="John Doe"
                        data-testid="input-new-user-name"
                      />
                    </div>
                    <div>
                      <Label>Phone (Optional)</Label>
                      <Input
                        id="new-user-phone"
                        placeholder="+234..."
                        data-testid="input-new-user-phone"
                      />
                    </div>
                    <Button
                      onClick={() => {
                        const fullName = (document.getElementById("new-user-name") as HTMLInputElement).value;
                        const phone = (document.getElementById("new-user-phone") as HTMLInputElement).value;
                        if (!fullName) {
                          toast({
                            title: "Name required",
                            description: "Please enter the user's full name",
                            variant: "destructive",
                          });
                          return;
                        }
                        createUserMutation.mutate({ email: userEmail, fullName, phone });
                      }}
                      disabled={createUserMutation.isPending}
                      data-testid="button-create-user"
                    >
                      {createUserMutation.isPending ? "Creating..." : "Create User"}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Step 2: Property Selection */}
          {searchedUser && (
            <Card>
              <CardHeader>
                <CardTitle>Step 2: Select Property</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Property</Label>
                  <Select
                    value={selectedPropertyId?.toString() || ""}
                    onValueChange={(value) => setSelectedPropertyId(parseInt(value))}
                  >
                    <SelectTrigger data-testid="select-property">
                      <SelectValue placeholder="Select a property" />
                    </SelectTrigger>
                    <SelectContent>
                      {properties.map((property) => (
                        <SelectItem key={property.id} value={property.id.toString()}>
                          {property.name} - {getCurrencySymbol(property.currency || 'NGN')}
                          {(property.unitPrice || property.minInvestment || 0).toLocaleString()}/unit
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedProperty && (
                  <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg space-y-2">
                    <p className="font-medium text-blue-900">{selectedProperty.name}</p>
                    <p className="text-sm text-blue-700">
                      Price per Unit: {getCurrencySymbol(selectedProperty.currency || 'NGN')}
                      {(selectedProperty.unitPrice || selectedProperty.minInvestment || 0).toLocaleString()}
                    </p>
                    <p className="text-sm text-blue-700">
                      Available Units: {availableUnits.toLocaleString()}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Step 3: Investment Details */}
          {searchedUser && selectedProperty && (
            <Card>
              <CardHeader>
                <CardTitle>Step 3: Investment Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Number of Units</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={units}
                    onChange={(e) => setUnits(e.target.value)}
                    placeholder="0.00"
                    max={availableUnits}
                    data-testid="input-units"
                  />
                  <p className="text-sm text-slate-500 mt-1">
                    Total: {getCurrencySymbol(selectedProperty.currency || 'NGN')}
                    {(parseFloat(units || "0") * (selectedProperty.unitPrice || selectedProperty.minInvestment || 0)).toLocaleString()}
                  </p>
                </div>

                <div>
                  <Label>Payment Method (Optional)</Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger data-testid="select-payment-method">
                      <SelectValue placeholder="Select payment method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="check">Check</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Payment Reference (Optional)</Label>
                  <Input
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    placeholder="Transaction reference"
                    data-testid="input-payment-reference"
                  />
                </div>

                <div>
                  <Label>Payment Evidence (Optional)</Label>
                  <div className="border-2 border-dashed border-slate-200 rounded-lg p-4">
                    {paymentEvidenceFile ? (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Upload className="h-4 w-4 text-green-600" />
                          <span className="text-sm text-slate-700">{paymentEvidenceFile.name}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPaymentEvidenceFile(null)}
                        >
                          Remove
                        </Button>
                      </div>
                    ) : (
                      <div className="text-center">
                        <input
                          type="file"
                          id="payment-evidence-upload"
                          className="hidden"
                          accept="image/*,.pdf"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              setPaymentEvidenceFile(file);
                            }
                          }}
                          data-testid="input-payment-evidence"
                        />
                        <label htmlFor="payment-evidence-upload" className="cursor-pointer">
                          <Upload className="h-8 w-8 text-slate-400 mx-auto mb-2" />
                          <p className="text-sm text-slate-600">Click to upload payment proof</p>
                          <p className="text-xs text-slate-400 mt-1">PDF or image files</p>
                        </label>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <Label>Notes (Optional)</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Additional notes about this investment"
                    data-testid="textarea-notes"
                  />
                </div>

                <Button
                  onClick={handleCreateInvestment}
                  disabled={createInvestmentMutation.isPending || uploadingEvidence || !units}
                  className="w-full"
                  data-testid="button-create-investment"
                >
                  {uploadingEvidence ? "Uploading..." : createInvestmentMutation.isPending ? "Creating..." : "Create Investment"}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Manage Investments Tab */}
      {activeSubTab === "manage" && (
        <div className="space-y-4">
          <div className="flex space-x-2">
            <Button
              variant={statusFilter === "all" ? "default" : "outline"}
              onClick={() => setStatusFilter("all")}
              size="sm"
              data-testid="filter-all"
            >
              All ({reservations.length})
            </Button>
            <Button
              variant={statusFilter === "payment_pending" ? "default" : "outline"}
              onClick={() => setStatusFilter("payment_pending")}
              size="sm"
              data-testid="filter-payment-pending"
            >
              Payment Pending ({reservations.filter(r => r.status === "payment_pending").length})
            </Button>
            <Button
              variant={statusFilter === "payment_received" ? "default" : "outline"}
              onClick={() => setStatusFilter("payment_received")}
              size="sm"
              data-testid="filter-payment-received"
            >
              Payment Received ({reservations.filter(r => r.status === "payment_received").length})
            </Button>
            <Button
              variant={statusFilter === "confirmed" ? "default" : "outline"}
              onClick={() => setStatusFilter("confirmed")}
              size="sm"
              data-testid="filter-confirmed"
            >
              Confirmed ({reservations.filter(r => r.status === "confirmed").length})
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Property</TableHead>
                    <TableHead>Units</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredReservations.map((reservation) => (
                    <TableRow key={reservation.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{reservation.fullName}</div>
                          <div className="text-sm text-slate-500">{reservation.email}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {properties.find(p => p.id === reservation.propertyId)?.name || `Property #${reservation.propertyId}`}
                      </TableCell>
                      <TableCell>{reservation.units}</TableCell>
                      <TableCell>
                        {getCurrencySymbol(reservation.currency)}{reservation.amount.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge className={getStatusBadgeColor(reservation.status)}>
                          {reservation.status.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              data-testid={`button-actions-${reservation.id}`}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => handleOpenEditReservation(reservation)}
                              data-testid={`menu-view-${reservation.id}`}
                            >
                              <Eye className="h-4 w-4 mr-2" />
                              View Details
                            </DropdownMenuItem>
                            {(reservation.status === "reserved" || reservation.status === "pending" || reservation.status === "payment_pending" || reservation.status === "payment_received") && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => handleOpenEditReservation(reservation)}
                                  data-testid={`menu-edit-${reservation.id}`}
                                >
                                  <Edit className="h-4 w-4 mr-2" />
                                  Edit Details
                                </DropdownMenuItem>
                              </>
                            )}
                            {(reservation.status === "reserved" || reservation.status === "pending" || reservation.status === "payment_pending") && (
                              <DropdownMenuItem
                                onClick={() => handleOpenMarkPaymentDialog(reservation)}
                                disabled={markPaymentReceivedMutation.isPending}
                                data-testid={`menu-mark-payment-${reservation.id}`}
                              >
                                <CheckCircle className="h-4 w-4 mr-2" />
                                Mark as Paid
                              </DropdownMenuItem>
                            )}
                            {reservation.status === "payment_received" && (
                              <DropdownMenuItem
                                onClick={() => confirmInvestmentMutation.mutate(reservation.id)}
                                disabled={confirmInvestmentMutation.isPending}
                                data-testid={`menu-confirm-${reservation.id}`}
                              >
                                <ShieldCheck className="h-4 w-4 mr-2" />
                                Confirm Investment
                              </DropdownMenuItem>
                            )}
                            {(reservation.status === "reserved" || reservation.status === "pending" || reservation.status === "payment_pending" || reservation.status === "payment_received") && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => cancelInvestmentMutation.mutate(reservation.id)}
                                  disabled={cancelInvestmentMutation.isPending}
                                  className="text-red-600 focus:text-red-600"
                                  data-testid={`menu-cancel-${reservation.id}`}
                                >
                                  <XCircle className="h-4 w-4 mr-2" />
                                  Cancel Investment
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Edit Reservation Dialog */}
      <Dialog open={isEditReservationOpen} onOpenChange={setIsEditReservationOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Investment Reservation</DialogTitle>
          </DialogHeader>
          
          {editingReservation && (
            <div className="space-y-6">
              {/* User and Property Info (Read-only) */}
              <div className="bg-slate-50 p-4 rounded-lg space-y-2">
                <div>
                  <Label className="text-sm font-medium text-slate-700">User</Label>
                  <p className="text-sm text-slate-900">{editingReservation.fullName} ({editingReservation.email})</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-slate-700">Property</Label>
                  <p className="text-sm text-slate-900">
                    {properties.find(p => p.id === editingReservation.propertyId)?.name || `Property #${editingReservation.propertyId}`}
                  </p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-slate-700">Current Status</Label>
                  <Badge className={getStatusBadgeColor(editingReservation.status)}>
                    {editingReservation.status.replace('_', ' ')}
                  </Badge>
                </div>
                <div className="pt-2 border-t border-slate-200">
                  <Label className="text-sm font-medium text-slate-700">Current Amount</Label>
                  <p className="text-lg font-semibold text-slate-900">
                    {getCurrencySymbol(editingReservation.currency)}{editingReservation.amount.toLocaleString()}
                  </p>
                  <p className="text-xs text-slate-500">
                    {editingReservation.units} units × {getCurrencySymbol(editingReservation.currency)}{editingReservation.unitPriceSnapshot.toLocaleString()} per unit
                  </p>
                </div>
              </div>

              {/* Editable Fields */}
              <div className="space-y-4">
                <div>
                  <Label htmlFor="edit-units">Number of Units <span className="text-red-500">*</span></Label>
                  <Input
                    id="edit-units"
                    type="number"
                    step="0.01"
                    value={editUnits}
                    onChange={(e) => setEditUnits(e.target.value)}
                    placeholder="Enter number of units"
                    data-testid="input-edit-units"
                  />
                  {editUnits && !isNaN(parseFloat(editUnits)) && (
                    <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <p className="text-sm font-medium text-blue-900">New Amount</p>
                      <p className="text-xl font-bold text-blue-900">
                        {getCurrencySymbol(editingReservation.currency)}
                        {Math.round(parseFloat(editUnits) * (typeof editingReservation.unitPriceSnapshot === 'string' ? parseFloat(editingReservation.unitPriceSnapshot) : editingReservation.unitPriceSnapshot)).toLocaleString()}
                      </p>
                      <p className="text-xs text-blue-700 mt-1">
                        {parseFloat(editUnits)} units × {getCurrencySymbol(editingReservation.currency)}{(typeof editingReservation.unitPriceSnapshot === 'string' ? parseFloat(editingReservation.unitPriceSnapshot) : editingReservation.unitPriceSnapshot).toLocaleString()} per unit
                      </p>
                    </div>
                  )}
                </div>

                <div>
                  <Label htmlFor="edit-payment-method">Payment Method</Label>
                  <Select value={editPaymentMethod} onValueChange={setEditPaymentMethod}>
                    <SelectTrigger id="edit-payment-method" data-testid="select-edit-payment-method">
                      <SelectValue placeholder="Select payment method" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="check">Check</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="edit-payment-reference">Payment Reference</Label>
                  <Input
                    id="edit-payment-reference"
                    value={editPaymentReference}
                    onChange={(e) => setEditPaymentReference(e.target.value)}
                    placeholder="Transaction ID or reference number"
                    data-testid="input-edit-payment-reference"
                  />
                </div>

                <div>
                  <Label htmlFor="edit-payment-evidence">Payment Evidence (Optional)</Label>
                  <Input
                    id="edit-payment-evidence"
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => setEditPaymentEvidenceFile(e.target.files?.[0] || null)}
                    data-testid="input-edit-payment-evidence"
                  />
                  {editingReservation.paymentEvidenceUrl && !editPaymentEvidenceFile && (
                    <div className="mt-2">
                      {editingReservation.paymentEvidenceUrl.includes('/api/documents/') ? (
                        <div className="space-y-2">
                          <p className="text-xs text-slate-500">Current PDF document:</p>
                          <div className="border border-slate-200 rounded-lg p-2">
                            <a 
                              href={editingReservation.paymentEvidenceUrl} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="flex items-center space-x-2 text-blue-600 hover:underline text-sm"
                            >
                              <FileText className="h-4 w-4" />
                              <span>View PDF Document</span>
                            </a>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-xs text-slate-500">Current image:</p>
                          <a 
                            href={editingReservation.paymentEvidenceUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                          >
                            <img 
                              src={editingReservation.paymentEvidenceUrl} 
                              alt="Payment evidence" 
                              className="max-w-xs rounded-lg border border-slate-200 hover:border-blue-500 transition-colors"
                            />
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <Label htmlFor="edit-notes">Notes (Internal)</Label>
                  <Textarea
                    id="edit-notes"
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Add any notes about this investment"
                    rows={3}
                    data-testid="input-edit-notes"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2">
                <Button
                  variant="outline"
                  onClick={() => setIsEditReservationOpen(false)}
                  disabled={editingSubmitting || editUploadingEvidence}
                  data-testid="button-cancel-edit"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleUpdateReservation}
                  disabled={editingSubmitting || editUploadingEvidence}
                  data-testid="button-save-edit"
                >
                  {editUploadingEvidence ? "Uploading..." : editingSubmitting ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Mark Payment Received Dialog */}
      <Dialog open={isMarkPaymentDialogOpen} onOpenChange={setIsMarkPaymentDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark Payment as Received</DialogTitle>
          </DialogHeader>
          
          {markPaymentReservation && (
            <div className="space-y-6">
              {/* Investment Summary */}
              <div className="bg-slate-50 p-4 rounded-lg space-y-2">
                <div>
                  <Label className="text-sm font-medium text-slate-700">Investor</Label>
                  <p className="text-sm text-slate-900">{markPaymentReservation.fullName}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-slate-700">Property</Label>
                  <p className="text-sm text-slate-900">
                    {properties.find(p => p.id === markPaymentReservation.propertyId)?.name || `Property #${markPaymentReservation.propertyId}`}
                  </p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-slate-700">Amount</Label>
                  <p className="text-lg font-semibold text-slate-900">
                    {getCurrencySymbol(markPaymentReservation.currency)}{markPaymentReservation.amount.toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Payment Reference Input */}
              <div className="space-y-2">
                <Label htmlFor="mark-payment-reference" className="text-sm font-medium">
                  Payment Reference <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="mark-payment-reference"
                  value={markPaymentRef}
                  onChange={(e) => setMarkPaymentRef(e.target.value)}
                  placeholder="Enter transaction ID or reference number"
                  data-testid="input-mark-payment-reference"
                />
                <p className="text-xs text-slate-500">
                  This reference will be included in the email sent to the investor.
                </p>
              </div>

              <div className="flex justify-end space-x-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsMarkPaymentDialogOpen(false);
                    setMarkPaymentReservation(null);
                    setMarkPaymentRef("");
                  }}
                  disabled={markPaymentReceivedMutation.isPending}
                  data-testid="button-cancel-mark-payment"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmitMarkPayment}
                  disabled={markPaymentReceivedMutation.isPending || !markPaymentRef.trim()}
                  data-testid="button-confirm-mark-payment"
                >
                  {markPaymentReceivedMutation.isPending ? "Processing..." : "Mark as Paid & Notify Investor"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AdminDashboard() {
  const [selectedTab, setSelectedTab] = useState("overview");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, logout, authenticatedRequest } = useAdminAuth();
  const { userCurrency, formatCurrency: formatCurrencyBase, convertAmount } = useCurrency();

  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [viewingProperty, setViewingProperty] = useState<Property | null>(null);
  const [viewingReservation, setViewingReservation] = useState<InvestmentReservation | null>(null);
  const [viewingKyc, setViewingKyc] = useState<UserType | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isReservationViewOpen, setIsReservationViewOpen] = useState(false);
  const [isKycDetailOpen, setIsKycDetailOpen] = useState(false);
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

  // Fetch KYC submissions
  const { data: kycSubmissions = [], isLoading: kycLoading } = useQuery<UserType[]>({
    queryKey: ["/api/admin/kyc/submissions"],
    queryFn: async () => {
      return await authenticatedRequest("/api/admin/kyc/submissions");
    },
    enabled: !!user, // Only fetch if admin is logged in
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

  const updateKycStatusMutation = useMutation({
    mutationFn: async ({ userId, status }: { userId: number; status: string }) => {
      return await authenticatedRequest(`/api/admin/kyc/${userId}/status`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/kyc/submissions"] });
      toast({ title: "KYC status updated successfully" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Error updating KYC status", 
        description: error.message, 
        variant: "destructive" 
      });
    }
  });

  // Helper functions
  const formatCurrency = (amount: number, currency: string = 'NGN') => {
    // Convert to user's selected currency first
    const convertedAmount = convertAmount(amount, currency);
    
    // Get the currency symbol
    const symbol = userCurrency === 'USD' ? '$' : 
                   userCurrency === 'EUR' ? '€' :
                   userCurrency === 'GBP' ? '£' :
                   userCurrency === 'NGN' ? '₦' : userCurrency;
    
    // Apply abbreviation logic
    if (convertedAmount >= 1000000000) {
      const billions = convertedAmount / 1000000000;
      return billions % 1 === 0 ? `${symbol}${billions}B` : `${symbol}${billions.toFixed(1)}B`;
    } else if (convertedAmount >= 1000000) {
      const millions = convertedAmount / 1000000;
      return millions % 1 === 0 ? `${symbol}${millions}M` : `${symbol}${millions.toFixed(1)}M`;
    } else if (convertedAmount >= 1000) {
      const thousands = convertedAmount / 1000;
      return thousands % 1 === 0 ? `${symbol}${thousands}K` : `${symbol}${thousands.toFixed(1)}K`;
    } else {
      return `${symbol}${convertedAmount.toFixed(2)}`;
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
                variant={selectedTab === "admin-investments" ? "secondary" : "ghost"}
                className="w-full justify-start mb-1"
                onClick={() => setSelectedTab("admin-investments")}
              >
                <Target className="mr-3 h-4 w-4" />
                Admin Investments
              </Button>
              <Button
                variant={selectedTab === "kyc-verifications" ? "secondary" : "ghost"}
                className="w-full justify-start mb-1"
                onClick={() => setSelectedTab("kyc-verifications")}
              >
                <ShieldCheck className="mr-3 h-4 w-4" />
                KYC Verifications
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
                            <div className="p-3 bg-blue-100 rounded-xl">
                              <TrendingUp className="h-6 w-6 text-blue-600" />
                            </div>
                            <div className="ml-4">
                              <p className="text-sm font-medium text-slate-600">Total Value</p>
                              <p className="text-3xl font-bold text-slate-900">
                                {formatCurrencyBase(properties.reduce((sum: number, p: Property) => 
                                  sum + convertAmount(p.totalValue, p.currency), 0
                                ))}
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
                                        {formatCurrency(property.totalValue, property.currency)}
                                      </p>
                                      <p className="text-sm text-slate-500">
                                        Min: {formatCurrency(property.minInvestment, property.currency)}
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
                                  <p className="text-xl font-bold text-slate-900">{formatCurrency(property.totalValue, property.currency)}</p>
                                  <p className="text-sm text-slate-600">Min: {formatCurrency(property.minInvestment, property.currency)}</p>
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
                        <div className="p-3 bg-blue-100 rounded-xl">
                          <TrendingUp className="h-6 w-6 text-blue-600" />
                        </div>
                        <div className="ml-4">
                          <p className="text-sm font-medium text-slate-600">Total Value</p>
                          <p className="text-3xl font-bold text-slate-900">
                            {formatCurrencyBase(properties.reduce((sum: number, p: Property) => 
                              sum + convertAmount(p.totalValue, p.currency), 0
                            ))}
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
                          <ShieldCheck className="h-6 w-6 text-orange-600" />
                        </div>
                        <div className="ml-4">
                          <p className="text-sm font-medium text-slate-600">KYC Submissions</p>
                          <p className="text-3xl font-bold text-slate-900">{kycSubmissions.length}</p>
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
                        <ShieldCheck className="h-5 w-5 mr-2 text-blue-600" />
                        Recent KYC Submissions
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {kycSubmissions.length === 0 ? (
                        <div className="text-center py-8">
                          <ShieldCheck className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                          <p className="text-slate-500">No KYC submissions yet</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {kycSubmissions.slice(0, 5).map((kyc) => (
                            <div key={kyc.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                              <div>
                                <p className="font-medium text-slate-900">{kyc.kycFullName || kyc.email}</p>
                                <p className="text-sm text-slate-500">{kyc.email}</p>
                              </div>
                              <div className="text-right">
                                <Badge 
                                  variant={
                                    kyc.kycStatus === 'verified' ? 'default' : 
                                    kyc.kycStatus === 'rejected' ? 'destructive' : 
                                    'secondary'
                                  }
                                >
                                  {kyc.kycStatus}
                                </Badge>
                                {kyc.kycSubmittedAt && (
                                  <p className="text-xs text-slate-500 mt-1">{formatDate(kyc.kycSubmittedAt.toString())}</p>
                                )}
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
                                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
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
                                      ? 'border-blue-200 bg-blue-50' 
                                      : 'border-slate-200 bg-white hover:border-slate-300'
                                  }`}>
                                    <div className="flex items-start justify-between">
                                      <div className="flex-1">
                                        <div className="flex items-center space-x-2 mb-1">
                                          <CheckCircle className={`h-4 w-4 ${
                                            step.isCompleted ? 'text-blue-600' : 'text-slate-400'
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
                        <Badge variant="secondary" className="bg-blue-100 text-blue-700">
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

            {/* Admin-Assisted Investments */}
            {selectedTab === "admin-investments" && (
              <AdminInvestmentsTab
                properties={properties}
                reservations={reservations}
                authenticatedRequest={authenticatedRequest}
                queryClient={queryClient}
                toast={toast}
              />
            )}

            {/* KYC Verifications */}
            {selectedTab === "kyc-verifications" && (
              <div className="space-y-6">
                <div>
                  <h1 className="text-3xl font-bold text-slate-900">KYC Verifications</h1>
                  <p className="text-slate-600 mt-2">Review and manage user identity verifications</p>
                </div>

                {kycLoading ? (
                  <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="mt-4 text-slate-600">Loading KYC submissions...</p>
                  </div>
                ) : kycSubmissions.length === 0 ? (
                  <Card>
                    <CardContent className="p-12 text-center">
                      <ShieldCheck className="h-12 w-12 text-slate-300 mx-auto mb-4" />
                      <p className="text-slate-600">No KYC submissions yet</p>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardHeader>
                      <CardTitle>KYC Submissions ({kycSubmissions.length})</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>User</TableHead>
                            <TableHead>Full Name</TableHead>
                            <TableHead>Date of Birth</TableHead>
                            <TableHead>ID Type</TableHead>
                            <TableHead>Submitted</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Documents</TableHead>
                            <TableHead>Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {kycSubmissions.map((kyc) => (
                            <TableRow key={kyc.id}>
                              <TableCell>
                                <div>
                                  <div className="font-medium">{kyc.kycFullName || kyc.email}</div>
                                  <div className="text-sm text-slate-500">{kyc.email}</div>
                                </div>
                              </TableCell>
                              <TableCell>{kyc.kycFullName || '-'}</TableCell>
                              <TableCell>
                                {kyc.kycDateOfBirth 
                                  ? new Date(kyc.kycDateOfBirth).toLocaleDateString('en-US', { timeZone: 'UTC' }) 
                                  : '-'}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">{kyc.kycIdType || '-'}</Badge>
                              </TableCell>
                              <TableCell>
                                {kyc.kycSubmittedAt 
                                  ? formatDate(kyc.kycSubmittedAt.toString()) 
                                  : '-'}
                              </TableCell>
                              <TableCell>
                                <Badge 
                                  variant={
                                    kyc.kycStatus === 'verified' ? 'default' : 
                                    kyc.kycStatus === 'rejected' ? 'destructive' : 
                                    'secondary'
                                  }
                                >
                                  {kyc.kycStatus}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-2">
                                  {kyc.kycIdDocumentUrl && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => window.open(kyc.kycIdDocumentUrl!, '_blank')}
                                    >
                                      <ExternalLink className="h-3 w-3 mr-1" />
                                      ID Doc
                                    </Button>
                                  )}
                                  {kyc.kycSelfieUrl && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => window.open(kyc.kycSelfieUrl!, '_blank')}
                                    >
                                      <Eye className="h-3 w-3 mr-1" />
                                      Selfie
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setViewingKyc(kyc);
                                    setIsKycDetailOpen(true);
                                  }}
                                >
                                  <Eye className="h-3 w-3 mr-1" />
                                  View Details
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
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
                  <p className="text-2xl font-bold text-slate-900">{formatCurrency(viewingProperty.totalValue, viewingProperty.currency)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-4">
                  <h3 className="font-semibold text-slate-900 mb-2">Min Investment</h3>
                  <p className="text-2xl font-bold text-slate-900">{formatCurrency(viewingProperty.minInvestment, viewingProperty.currency)}</p>
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
                  className="flex-1 flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700"
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
                    className="w-4 h-4 text-blue-600 rounded"
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

      {/* KYC Detail Modal */}
      <Dialog open={isKycDetailOpen} onOpenChange={setIsKycDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center">
              <ShieldCheck className="h-6 w-6 mr-2 text-blue-600" />
              KYC Verification Details
            </DialogTitle>
          </DialogHeader>

          {viewingKyc && (
            <div className="space-y-6">
              {/* User Information */}
              <div className="bg-slate-50 p-4 rounded-lg">
                <h3 className="font-semibold text-lg mb-3 flex items-center">
                  <User className="h-5 w-5 mr-2 text-blue-600" />
                  User Information
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-slate-600">Email</p>
                    <p className="font-medium">{viewingKyc.email}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600">User ID</p>
                    <p className="font-medium">#{viewingKyc.id}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600">Account Created</p>
                    <p className="font-medium">
                      {viewingKyc.createdAt 
                        ? formatDate(viewingKyc.createdAt.toString())
                        : '-'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600">Phone</p>
                    <p className="font-medium">{viewingKyc.phone || '-'}</p>
                  </div>
                </div>
              </div>

              {/* KYC Information */}
              <div className="bg-blue-50 p-4 rounded-lg border-2 border-blue-200">
                <h3 className="font-semibold text-lg mb-3 flex items-center">
                  <ShieldCheck className="h-5 w-5 mr-2 text-blue-600" />
                  Identity Verification
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-slate-600">Full Legal Name</p>
                    <p className="font-medium">{viewingKyc.kycFullName || '-'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600">Date of Birth</p>
                    <p className="font-medium">
                      {viewingKyc.kycDateOfBirth 
                        ? new Date(viewingKyc.kycDateOfBirth).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            timeZone: 'UTC'
                          })
                        : '-'}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-sm text-slate-600">Residential Address</p>
                    <p className="font-medium">{viewingKyc.kycAddress || '-'}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-sm text-slate-600">Occupation</p>
                    <p className="font-medium">{(viewingKyc as any).kycOccupation || '-'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600">ID Type</p>
                    <Badge variant="outline" className="mt-1">
                      {viewingKyc.kycIdType === 'passport' && 'International Passport'}
                      {viewingKyc.kycIdType === 'drivers_license' && "Driver's License"}
                      {viewingKyc.kycIdType === 'national_id' && 'National ID Card'}
                      {!viewingKyc.kycIdType && '-'}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600">ID Number</p>
                    <p className="font-medium font-mono">{viewingKyc.kycIdNumber || '-'}</p>
                  </div>
                </div>
              </div>

              {/* Submission Details */}
              <div className="bg-slate-50 p-4 rounded-lg">
                <h3 className="font-semibold text-lg mb-3 flex items-center">
                  <Calendar className="h-5 w-5 mr-2 text-blue-600" />
                  Submission Status
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-slate-600">Current Status</p>
                    <Badge 
                      variant={
                        viewingKyc.kycStatus === 'verified' ? 'default' : 
                        viewingKyc.kycStatus === 'rejected' ? 'destructive' : 
                        'secondary'
                      }
                      className="mt-1"
                    >
                      {viewingKyc.kycStatus}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600">Submitted On</p>
                    <p className="font-medium">
                      {viewingKyc.kycSubmittedAt 
                        ? formatDate(viewingKyc.kycSubmittedAt.toString())
                        : '-'}
                    </p>
                  </div>
                  {viewingKyc.kycVerifiedAt && (
                    <div>
                      <p className="text-sm text-slate-600">Verified On</p>
                      <p className="font-medium">
                        {formatDate(viewingKyc.kycVerifiedAt.toString())}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Documents */}
              <div className="bg-slate-50 p-4 rounded-lg">
                <h3 className="font-semibold text-lg mb-3 flex items-center">
                  <ExternalLink className="h-5 w-5 mr-2 text-blue-600" />
                  Uploaded Documents
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {viewingKyc.kycIdDocumentUrl && (
                    <div className="border border-slate-200 rounded-lg p-3 bg-white">
                      <p className="text-sm font-medium text-slate-700 mb-2">ID Document</p>
                      {viewingKyc.kycIdDocumentUrl.includes('/api/documents/') ? (
                        <div className="aspect-square bg-slate-100 rounded flex items-center justify-center mb-2">
                          <FileText className="h-16 w-16 text-slate-400" />
                        </div>
                      ) : (
                        <img 
                          src={convertToJpg(viewingKyc.kycIdDocumentUrl)} 
                          alt="ID Document" 
                          className="w-full aspect-square object-cover rounded mb-2"
                          onError={(e) => {
                            e.currentTarget.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="%23999">Error</text></svg>';
                          }}
                        />
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(viewingKyc.kycIdDocumentUrl!, '_blank')}
                        className="w-full"
                      >
                        <ExternalLink className="h-3 w-3 mr-2" />
                        {viewingKyc.kycIdDocumentUrl.includes('/api/documents/') ? 'View PDF' : 'Open'}
                      </Button>
                    </div>
                  )}
                  {(viewingKyc as any).kycSignatureUrl && (
                    <div className="border border-slate-200 rounded-lg p-3 bg-white">
                      <p className="text-sm font-medium text-slate-700 mb-2">Signature</p>
                      <img 
                        src={convertToJpg((viewingKyc as any).kycSignatureUrl)} 
                        alt="Signature" 
                        className="w-full aspect-square object-contain rounded mb-2 bg-white border border-slate-100"
                        onError={(e) => {
                          e.currentTarget.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="%23999">Error loading</text></svg>';
                        }}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(convertToJpg((viewingKyc as any).kycSignatureUrl!), '_blank')}
                        className="w-full"
                      >
                        <ExternalLink className="h-3 w-3 mr-2" />
                        Open
                      </Button>
                    </div>
                  )}
                  {viewingKyc.kycSelfieUrl && (
                    <div className="border border-slate-200 rounded-lg p-3 bg-white">
                      <p className="text-sm font-medium text-slate-700 mb-2">Selfie</p>
                      <img 
                        src={convertToJpg(viewingKyc.kycSelfieUrl)} 
                        alt="Selfie" 
                        className="w-full aspect-square object-cover rounded mb-2"
                        onError={(e) => {
                          e.currentTarget.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="%23999">Error loading</text></svg>';
                        }}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(convertToJpg(viewingKyc.kycSelfieUrl!), '_blank')}
                        className="w-full"
                      >
                        <Eye className="h-3 w-3 mr-2" />
                        Open
                      </Button>
                    </div>
                  )}
                  {!viewingKyc.kycIdDocumentUrl && !(viewingKyc as any).kycSignatureUrl && !viewingKyc.kycSelfieUrl && (
                    <p className="text-slate-500 col-span-3">No documents uploaded</p>
                  )}
                </div>
              </div>

              {/* Actions */}
              {viewingKyc.kycStatus === 'submitted' && (
                <div className="flex gap-3 pt-4 border-t">
                  <Button
                    variant="default"
                    className="flex-1 bg-blue-600 hover:bg-blue-700"
                    onClick={() => {
                      updateKycStatusMutation.mutate({ 
                        userId: viewingKyc.id, 
                        status: 'verified' 
                      });
                      setIsKycDetailOpen(false);
                    }}
                    disabled={updateKycStatusMutation.isPending}
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Approve KYC
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1"
                    onClick={() => {
                      updateKycStatusMutation.mutate({ 
                        userId: viewingKyc.id, 
                        status: 'rejected' 
                      });
                      setIsKycDetailOpen(false);
                    }}
                    disabled={updateKycStatusMutation.isPending}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Reject KYC
                  </Button>
                </div>
              )}

              {viewingKyc.kycStatus === 'verified' && (
                <div className="bg-green-50 border border-green-200 p-4 rounded-lg text-center">
                  <CheckCircle className="h-8 w-8 text-green-600 mx-auto mb-2" />
                  <p className="text-green-800 font-medium">This KYC has been verified</p>
                </div>
              )}

              {viewingKyc.kycStatus === 'rejected' && (
                <div className="bg-red-50 border border-red-200 p-4 rounded-lg text-center">
                  <XCircle className="h-8 w-8 text-red-600 mx-auto mb-2" />
                  <p className="text-red-800 font-medium">This KYC has been rejected</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}