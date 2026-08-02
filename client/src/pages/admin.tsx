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
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { ArrowLeft, Users, Building, Calendar, Mail, Phone, MapPin, Plus, Upload, BarChart3, Home, ExternalLink, Download, Eye, Edit, Trash2, Menu, Target, TrendingUp, LogOut, User, Shield, CheckCircle, RefreshCw, ShieldCheck, XCircle, MoreVertical, FileText, UserCheck, Clock, Gift, DollarSign, Repeat, Tag, Gavel, Banknote, Loader2, AlertTriangle, Briefcase, Hammer, Globe } from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { FileUpload } from "@/components/FileUpload";
import { RichTextEditor } from "@/components/RichTextEditor";
import { PropertyMediaCarousel } from "@/components/PropertyMediaCarousel";
import type { Property, InvestmentReservation, InsertProperty, VerificationStep, MarketInsight, User as UserType, PropertyValuation } from "@shared/schema";
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

function ValuationManagement({ propertyId, authenticatedRequest, queryClient, toast }: {
  propertyId: number;
  authenticatedRequest: (url: string, options?: any) => Promise<any>;
  queryClient: any;
  toast: any;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notifyingId, setNotifyingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    valuationDate: '',
    currentValue: '',
    rawAssetValue: '',
    investorBasisValue: '',
    appreciationPercentage: '',
    notes: '',
  });
  const [reportFile, setReportFile] = useState<File | null>(null);

  const { data: valuations = [], isLoading } = useQuery<PropertyValuation[]>({
    queryKey: ["/api/admin/properties", propertyId, "valuations"],
    queryFn: () => authenticatedRequest(`/api/admin/properties/${propertyId}/valuations`),
  });

  const handleSubmit = async () => {
    if (!formData.valuationDate || !formData.currentValue) {
      toast({ title: "Missing fields", description: "Date and current value are required", variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const sessionId = localStorage.getItem("admin_session_id");
      const fd = new FormData();
      fd.append('valuationDate', formData.valuationDate);
      fd.append('currentValue', formData.currentValue);
      if (formData.rawAssetValue) fd.append('rawAssetValue', formData.rawAssetValue);
      if (formData.investorBasisValue) fd.append('investorBasisValue', formData.investorBasisValue);
      if (formData.appreciationPercentage) fd.append('appreciationPercentage', formData.appreciationPercentage);
      if (formData.notes) fd.append('notes', formData.notes);
      if (reportFile) fd.append('valuationReport', reportFile);

      const response = await fetch(`/api/admin/properties/${propertyId}/valuations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionId}` },
        body: fd,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create valuation');
      }

      toast({ title: "Valuation entry added" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/properties", propertyId, "valuations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/properties"] });
      setShowAddForm(false);
      setFormData({ valuationDate: '', currentValue: '', rawAssetValue: '', investorBasisValue: '', appreciationPercentage: '', notes: '' });
      setReportFile(null);
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await authenticatedRequest(`/api/admin/valuations/${id}`, { method: 'DELETE' });
      toast({ title: "Valuation entry deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/properties", propertyId, "valuations"] });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleNotify = async (id: number) => {
    setNotifyingId(id);
    try {
      const result = await authenticatedRequest(`/api/admin/valuations/${id}/notify`, { method: 'POST' });
      toast({ title: "Notifications sent", description: result.message });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to send notifications", variant: "destructive" });
    } finally {
      setNotifyingId(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-900">Valuation History</h3>
        <Button size="sm" variant="outline" onClick={() => setShowAddForm(!showAddForm)}>
          <Plus className="h-4 w-4 mr-1" />
          Add Valuation
        </Button>
      </div>

      {showAddForm && (
        <div className="border border-blue-200 bg-blue-50 rounded-lg p-4 mb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Valuation Date *</Label>
              <Input
                type="date"
                value={formData.valuationDate}
                onChange={(e) => setFormData(prev => ({ ...prev, valuationDate: e.target.value }))}
              />
            </div>
            <div>
              <Label>Current Property Value (₦) *</Label>
              <Input
                type="number"
                placeholder="e.g. 50000000"
                value={formData.currentValue}
                onChange={(e) => setFormData(prev => ({ ...prev, currentValue: e.target.value }))}
              />
              <p className="text-xs text-slate-400 mt-1">General reference value</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Raw Asset / Land Value (₦)</Label>
              <Input
                type="number"
                placeholder="e.g. 12500000"
                value={formData.rawAssetValue}
                onChange={(e) => setFormData(prev => ({ ...prev, rawAssetValue: e.target.value }))}
              />
              <p className="text-xs text-slate-400 mt-1">Market value of the land — used for Land Appreciation graph</p>
            </div>
            <div>
              <Label>Investor Basis Value (₦)</Label>
              <Input
                type="number"
                placeholder="e.g. 16250000"
                value={formData.investorBasisValue}
                onChange={(e) => setFormData(prev => ({ ...prev, investorBasisValue: e.target.value }))}
              />
              <p className="text-xs text-slate-400 mt-1">Investor-facing value (incl. SPV/legal/deal costs) — used for Investment Performance graph</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Appreciation % (optional)</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="e.g. 15.5"
                value={formData.appreciationPercentage}
                onChange={(e) => setFormData(prev => ({ ...prev, appreciationPercentage: e.target.value }))}
              />
            </div>
            <div>
              <Label>Valuation Report PDF (optional)</Label>
              <Input
                type="file"
                accept=".pdf"
                onChange={(e) => setReportFile(e.target.files?.[0] || null)}
              />
            </div>
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Textarea
              placeholder="Any notes about this valuation..."
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              rows={2}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSubmit} disabled={uploading}>
              {uploading ? 'Saving...' : 'Save Valuation'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading valuations...</p>
      ) : valuations.length === 0 ? (
        <p className="text-sm text-slate-500">No valuation records yet. Add the first one to start tracking property value.</p>
      ) : (
        <div className="space-y-2">
          {valuations.map((v) => (
            <div key={v.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div className="flex-1">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm font-medium text-slate-900">
                    {new Date(v.valuationDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </span>
                  <span className="text-xs text-slate-500">Land: ₦{Number(v.rawAssetValue || v.currentValue).toLocaleString()}</span>
                  <span className="text-xs text-slate-500">Investor: ₦{Number(v.investorBasisValue || v.currentValue).toLocaleString()}</span>
                  {v.appreciationPercentage && (
                    <Badge variant="outline" className={Number(v.appreciationPercentage) >= 0 ? 'text-green-700 border-green-300' : 'text-red-700 border-red-300'}>
                      {Number(v.appreciationPercentage) >= 0 ? '+' : ''}{v.appreciationPercentage}%
                    </Badge>
                  )}
                  {v.reportUrl && (
                    <a href={v.reportUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs flex items-center gap-1">
                      <FileText className="h-3 w-3" /> PDF
                    </a>
                  )}
                </div>
                {v.notes && <p className="text-xs text-slate-500 mt-1">{v.notes}</p>}
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="text-blue-500 hover:bg-blue-50 h-8 w-8 p-0" onClick={() => handleNotify(v.id)} disabled={notifyingId === v.id} title="Notify investors">
                  {notifyingId === v.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="ghost" size="sm" className="text-red-500 hover:bg-red-50 h-8 w-8 p-0" onClick={() => handleDelete(v.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
      queryClient.invalidateQueries({ queryKey: ["/api/admin/properties"] });
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
    mutationFn: async (id: number) => {
      return await authenticatedRequest(`/api/admin/investments/${id}/mark-payment-received`, {
        method: "PUT",
        body: JSON.stringify({}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reservations/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/properties"] });
      toast({
        title: "Payment marked",
        description: "Payment has been marked as received and investor notified with payment reference",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Cannot mark payment",
        description: error.message || "Failed to mark payment as received",
        variant: "destructive",
      });
    },
  });

  const confirmInvestmentMutation = useMutation({
    mutationFn: async (id: number) => {
      return await authenticatedRequest(`/api/admin/investments/${id}/confirm`, {
        method: "PUT",
        body: JSON.stringify({}),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reservations/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/properties"] });
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

  const reinstateInvestmentMutation = useMutation({
    mutationFn: async (id: number) => {
      return await authenticatedRequest(`/api/admin/investments/${id}/reinstate`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/reservations/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/properties"] });
      toast({
        title: "Investment reinstated",
        description: data?.certificateNumber
          ? `Confirmed as investment. Certificate ${data.certificateNumber} issued and the investor has been emailed.`
          : "Reservation reinstated and confirmed as an investment.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Reinstate failed",
        description: error.message || "Failed to reinstate reservation",
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
      queryClient.invalidateQueries({ queryKey: ["/api/admin/properties"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/admin/properties"] });
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
      case "reserved": return "bg-yellow-100 text-yellow-800";
      case "converted_to_investment": return "bg-green-100 text-green-800";
      case "expired": return "bg-orange-100 text-orange-800";
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
                    step="any"
                    min="0.01"
                    value={units}
                    onChange={(e) => setUnits(e.target.value)}
                    placeholder="Enter any amount (e.g., 1, 2.5, 10)"
                    data-testid="input-units"
                  />
                  <div className="mt-2 p-3 bg-slate-50 rounded-lg">
                    <p className="text-sm text-slate-600">
                      Unit Price: {getCurrencySymbol(selectedProperty.currency || 'NGN')}
                      {(selectedProperty.unitPrice || selectedProperty.minInvestment || 0).toLocaleString()}
                    </p>
                    <p className="text-base font-semibold text-slate-900 mt-1">
                      Total Amount: {getCurrencySymbol(selectedProperty.currency || 'NGN')}
                      {(parseFloat(units || "0") * (selectedProperty.unitPrice || selectedProperty.minInvestment || 0)).toLocaleString()}
                    </p>
                    {parseFloat(units || "0") > availableUnits && (
                      <p className="text-sm text-amber-600 mt-1">
                        Note: Only {availableUnits.toLocaleString()} units available
                      </p>
                    )}
                  </div>
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
              variant={statusFilter === "reserved" ? "default" : "outline"}
              onClick={() => setStatusFilter("reserved")}
              size="sm"
              data-testid="filter-reserved"
            >
              Reserved ({reservations.filter(r => r.status === "reserved").length})
            </Button>
            <Button
              variant={statusFilter === "converted_to_investment" ? "default" : "outline"}
              onClick={() => setStatusFilter("converted_to_investment")}
              size="sm"
              data-testid="filter-confirmed"
            >
              Invested ({reservations.filter(r => r.status === "converted_to_investment").length})
            </Button>
            <Button
              variant={statusFilter === "expired" ? "default" : "outline"}
              onClick={() => setStatusFilter("expired")}
              size="sm"
              data-testid="filter-expired"
            >
              Expired ({reservations.filter(r => r.status === "expired").length})
            </Button>
            <Button
              variant={statusFilter === "cancelled" ? "default" : "outline"}
              onClick={() => setStatusFilter("cancelled")}
              size="sm"
              data-testid="filter-cancelled"
            >
              Cancelled ({reservations.filter(r => r.status === "cancelled").length})
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Owner</TableHead>
                      <TableHead>Units</TableHead>
                      <TableHead>% Ownership</TableHead>
                      <TableHead>Cost Base</TableHead>
                      <TableHead>Entry Date</TableHead>
                      <TableHead>Certificate ID</TableHead>
                      <TableHead>SPV</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredReservations.map((reservation) => {
                      const property = properties.find(p => p.id === reservation.propertyId);
                      const totalUnits = property?.totalUnits || property?.totalSlots || 100;
                      const ownershipPercent = totalUnits > 0 ? ((reservation.units / totalUnits) * 100).toFixed(2) : '0.00';
                      
                      return (
                        <TableRow key={reservation.id}>
                          <TableCell>
                            <div>
                              <div className="font-medium">{reservation.fullName}</div>
                              <div className="text-sm text-slate-500">{reservation.email}</div>
                            </div>
                          </TableCell>
                          <TableCell>{reservation.units}</TableCell>
                          <TableCell>{ownershipPercent}%</TableCell>
                          <TableCell>
                            {getCurrencySymbol(reservation.currency)}{Number(reservation.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell>
                            {new Date(reservation.createdAt).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric'
                            })}
                          </TableCell>
                          <TableCell>
                            {reservation.certificateNumber ? (
                              <Badge variant="outline" className="font-mono text-xs">
                                {reservation.certificateNumber}
                              </Badge>
                            ) : (
                              <span className="text-slate-400 text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {property?.spvName ? (
                              <span className="font-mono text-sm text-blue-700">{property.spvName}</span>
                            ) : (
                              <span className="text-slate-400 text-sm">-</span>
                            )}
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
                                {reservation.status === "reserved" && (
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
                                {(reservation.status === "reserved" || reservation.status === "converted_to_investment") && reservation.status !== "cancelled" && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => cancelInvestmentMutation.mutate(reservation.id)}
                                      disabled={cancelInvestmentMutation.isPending}
                                      className="text-red-600 focus:text-red-600"
                                      data-testid={`menu-cancel-${reservation.id}`}
                                    >
                                      <XCircle className="h-4 w-4 mr-2" />
                                      {reservation.status === "converted_to_investment" ? "Revert & Cancel" : "Cancel Reservation"}
                                    </DropdownMenuItem>
                                  </>
                                )}
                                {(reservation.status === "expired" || reservation.status === "cancelled") && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => reinstateInvestmentMutation.mutate(reservation.id)}
                                      disabled={reinstateInvestmentMutation.isPending}
                                      className="text-emerald-600 focus:text-emerald-600"
                                      data-testid={`menu-reinstate-${reservation.id}`}
                                    >
                                      <CheckCircle className="h-4 w-4 mr-2" />
                                      Reinstate as investment
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
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

    </div>
  );
}

// User Approvals Tab Component
function UserApprovalsTab({ authenticatedRequest }: { authenticatedRequest: (url: string, options?: any) => Promise<any> }) {
  const { toast } = useToast();
  const [rejectingUser, setRejectingUser] = useState<any>(null);
  const [rejectReason, setRejectReason] = useState("");

  const { data: pendingUsers = [], isLoading, refetch } = useQuery({
    queryKey: ["/api/admin/pending-users"],
    queryFn: () => authenticatedRequest("/api/admin/pending-users"),
    refetchInterval: 30000,
  });

  const approveMutation = useMutation({
    mutationFn: async (userId: number) => {
      return await authenticatedRequest(`/api/admin/users/${userId}/approve`, { method: "POST" });
    },
    onSuccess: () => {
      toast({ title: "User Approved", description: "The user has been approved and notified by email." });
      refetch();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to approve user", variant: "destructive" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ userId, reason }: { userId: number; reason: string }) => {
      return await authenticatedRequest(`/api/admin/users/${userId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
    },
    onSuccess: () => {
      toast({ title: "User Rejected", description: "The user has been declined and notified by email." });
      setRejectingUser(null);
      setRejectReason("");
      refetch();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to reject user", variant: "destructive" });
    },
  });

  if (isLoading) {
    return <div className="flex items-center justify-center p-12"><RefreshCw className="h-6 w-6 animate-spin text-slate-400" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">User Approvals</h2>
          <p className="text-slate-500 mt-1">Review and approve new member applications</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {pendingUsers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-12 text-center">
            <UserCheck className="h-12 w-12 text-slate-300 mb-4" />
            <h3 className="text-lg font-semibold text-slate-700">No Pending Applications</h3>
            <p className="text-slate-500 mt-1">All member applications have been reviewed.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-center gap-3">
            <Clock className="h-5 w-5 text-amber-600 flex-shrink-0" />
            <p className="text-amber-800 text-sm font-medium">{pendingUsers.length} pending application{pendingUsers.length !== 1 ? 's' : ''} awaiting your review</p>
          </div>

          {pendingUsers.map((user: any) => (
            <Card key={user.id} className="border-l-4 border-l-amber-400">
              <CardContent className="p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="text-lg font-semibold text-slate-900">
                      {user.firstName} {user.lastName}
                    </h3>
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <Mail className="h-4 w-4" />
                      {user.email}
                    </div>
                    {user.phone && (
                      <div className="flex items-center gap-2 text-sm text-slate-500">
                        <Phone className="h-4 w-4" />
                        {user.phone}
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <Clock className="h-4 w-4" />
                      Applied {new Date(user.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => approveMutation.mutate(user.id)}
                      disabled={approveMutation.isPending}
                    >
                      <CheckCircle className="h-4 w-4 mr-1" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setRejectingUser(user)}
                      disabled={rejectMutation.isPending}
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      Decline
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Rejection Dialog */}
      <Dialog open={!!rejectingUser} onOpenChange={(open) => { if (!open) { setRejectingUser(null); setRejectReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline Membership Application</DialogTitle>
            <DialogDescription>
              Declining {rejectingUser?.firstName} {rejectingUser?.lastName}'s application. They will be notified by email.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Reason for declining (optional)</Label>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g., Incomplete information, unable to verify identity..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectingUser(null); setRejectReason(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => rejectMutation.mutate({ userId: rejectingUser.id, reason: rejectReason })}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending ? "Declining..." : "Confirm Decline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Payment Reviews Tab Component
function PaymentReviewsTab({ 
  authenticatedRequest,
  getCurrencySymbol,
  queryClient,
  toast
}: {
  authenticatedRequest: any;
  getCurrencySymbol: (currency: string) => string;
  queryClient: any;
  toast: any;
}) {
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [selectedSubmission, setSelectedSubmission] = useState<any>(null);

  const { data: submissions = [], isLoading, refetch } = useQuery({
    queryKey: ["/api/admin/payment-submissions"],
    queryFn: async () => {
      const response = await authenticatedRequest("/api/admin/payment-submissions");
      return response;
    },
  });

  const handleApprove = async (submission: any) => {
    setApprovingId(submission.id);
    try {
      await authenticatedRequest(`/api/admin/payment-submissions/${submission.id}/approve`, {
        method: "PUT",
      });
      toast({
        title: "Payment Approved",
        description: `Investment confirmed for ${submission.user?.email}. Certificate generated.`,
      });
      refetch();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/reservations"] });
    } catch (error: any) {
      toast({
        title: "Approval Failed",
        description: error.message || "Failed to approve payment",
        variant: "destructive",
      });
    } finally {
      setApprovingId(null);
    }
  };

  const handleReject = async () => {
    if (!selectedSubmission || !rejectionReason.trim()) {
      toast({
        title: "Rejection Reason Required",
        description: "Please provide a reason for rejection",
        variant: "destructive",
      });
      return;
    }

    setRejectingId(selectedSubmission.id);
    try {
      await authenticatedRequest(`/api/admin/payment-submissions/${selectedSubmission.id}/reject`, {
        method: "PUT",
        body: JSON.stringify({ reason: rejectionReason }),
      });
      toast({
        title: "Payment Rejected",
        description: "User has been notified and can re-upload payment proof.",
      });
      setShowRejectDialog(false);
      setRejectionReason("");
      setSelectedSubmission(null);
      refetch();
    } catch (error: any) {
      toast({
        title: "Rejection Failed",
        description: error.message || "Failed to reject payment",
        variant: "destructive",
      });
    } finally {
      setRejectingId(null);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-NG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-4 text-slate-600">Loading payment submissions...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Payment Reviews</h1>
        <p className="text-slate-600 mt-2">Review and approve/reject user payment proofs</p>
      </div>

      {submissions.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <FileText className="h-12 w-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-600">No pending payment submissions</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {submissions.map((submission: any) => (
            <Card key={submission.id} className="overflow-hidden">
              <CardContent className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                  <div>
                    <p className="text-sm text-slate-500">User</p>
                    <p className="font-medium">{submission.user?.email}</p>
                    <p className="text-sm text-slate-600">{submission.user?.kycFullName || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Property</p>
                    <p className="font-medium">{submission.property?.name || 'Unknown'}</p>
                    <p className="text-sm text-slate-600">{submission.reservation?.units} units</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Amount</p>
                    <p className="font-medium text-green-600">
                      {getCurrencySymbol(submission.reservation?.currency || 'NGN')}
                      {Number(submission.reservation?.amount || 0).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-500">Submitted</p>
                    <p className="font-medium">{formatDate(submission.submittedAt)}</p>
                    <Badge variant="outline" className="mt-1">
                      {submission.proofType === 'pdf' ? 'PDF' : 'Image'}
                    </Badge>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between pt-4 border-t">
                  <a 
                    href={submission.proofUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 font-medium"
                  >
                    <Eye className="h-4 w-4" />
                    View Payment Proof
                    <ExternalLink className="h-3 w-3" />
                  </a>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => {
                        setSelectedSubmission(submission);
                        setShowRejectDialog(true);
                      }}
                      disabled={approvingId === submission.id || rejectingId === submission.id}
                    >
                      <XCircle className="h-4 w-4 mr-2" />
                      Reject
                    </Button>
                    <Button
                      className="bg-green-600 hover:bg-green-700"
                      onClick={() => handleApprove(submission)}
                      disabled={approvingId === submission.id || rejectingId === submission.id}
                    >
                      {approvingId === submission.id ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                          Approving...
                        </>
                      ) : (
                        <>
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Approve
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Payment Proof</AlertDialogTitle>
            <AlertDialogDescription>
              This will notify the user that their payment proof was rejected. 
              They will be able to upload a new proof.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Label htmlFor="rejection-reason">Rejection Reason (required)</Label>
            <Textarea
              id="rejection-reason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="e.g., Amount doesn't match, receipt is unclear, wrong account..."
              className="mt-2"
              rows={3}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setRejectionReason("");
              setSelectedSubmission(null);
            }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReject}
              className="bg-red-600 hover:bg-red-700"
              disabled={!rejectionReason.trim() || rejectingId !== null}
            >
              {rejectingId !== null ? "Rejecting..." : "Reject Payment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// User Portfolio Tab Component
function UserPortfolioTab({ 
  authenticatedRequest,
  getCurrencySymbol
}: {
  authenticatedRequest: any;
  getCurrencySymbol: (currency: string) => string;
}) {
  const { toast } = useToast();
  const [searchEmail, setSearchEmail] = useState("");
  const [searching, setSearching] = useState(false);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [portfolioData, setPortfolioData] = useState<{
    user: any;
    reservations: any[];
    summary: {
      totalPortfolioValue: number;
      propertiesOwned: number;
      activeReservations: number;
      confirmedInvestments: number;
    };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (!searchEmail.trim()) return;
    
    setSearching(true);
    setError(null);
    setPortfolioData(null);
    
    try {
      const response = await authenticatedRequest(`/api/admin/users/portfolio?email=${encodeURIComponent(searchEmail)}`);
      setPortfolioData(response);
    } catch (err: any) {
      setError(err.message || "Failed to find user portfolio");
    } finally {
      setSearching(false);
    }
  };

  const handleCancelInvestment = async (reservationId: number) => {
    setCancellingId(reservationId);
    try {
      await authenticatedRequest(`/api/admin/investments/${reservationId}/cancel`, {
        method: 'PUT'
      });
      toast({
        title: "Investment cancelled",
        description: "The investment has been cancelled and units returned",
      });
      // Refresh the portfolio data
      handleSearch();
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to cancel investment",
        variant: "destructive",
      });
    } finally {
      setCancellingId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'converted_to_investment':
        return <Badge className="bg-green-100 text-green-800">Invested</Badge>;
      case 'reserved':
        return <Badge className="bg-amber-100 text-amber-800">Reserved</Badge>;
      case 'expired':
        return <Badge className="bg-orange-100 text-orange-800">Expired</Badge>;
      case 'cancelled':
        return <Badge className="bg-red-100 text-red-800">Cancelled</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">User Portfolio Lookup</h1>
        <p className="text-slate-600 mt-2">Search for a user to view their portfolio as they see it on their dashboard</p>
      </div>

      {/* Search Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Search User
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Input
              placeholder="Enter user email address"
              value={searchEmail}
              onChange={(e) => setSearchEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="flex-1"
              data-testid="input-search-user-email"
            />
            <Button 
              onClick={handleSearch} 
              disabled={searching || !searchEmail.trim()}
              data-testid="button-search-user"
            >
              {searching ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Searching...
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4 mr-2" />
                  View Portfolio
                </>
              )}
            </Button>
          </div>
          {error && (
            <p className="text-red-600 mt-2 text-sm">{error}</p>
          )}
        </CardContent>
      </Card>

      {/* Portfolio Results */}
      {portfolioData && (
        <>
          {/* User Info Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                User Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-slate-500">Name</p>
                  <p className="font-medium">{portfolioData.user.kycFullName || `${portfolioData.user.firstName || ''} ${portfolioData.user.lastName || ''}`.trim() || 'Not provided'}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-500">Email</p>
                  <p className="font-medium">{portfolioData.user.email}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-500">Phone</p>
                  <p className="font-medium">{portfolioData.user.phone || 'Not provided'}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-500">KYC Status</p>
                  <Badge 
                    variant={portfolioData.user.kycStatus === 'approved' ? 'default' : 'secondary'}
                    className={portfolioData.user.kycStatus === 'approved' ? 'bg-green-100 text-green-800' : ''}
                  >
                    {portfolioData.user.kycStatus || 'Not submitted'}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-slate-500">Account Created</p>
                  <p className="font-medium">
                    {portfolioData.user.createdAt 
                      ? new Date(portfolioData.user.createdAt).toLocaleDateString() 
                      : 'Unknown'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Portfolio Summary - Same as user dashboard */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="bg-gradient-to-br from-blue-600 to-blue-800">
              <CardContent className="p-6">
                <p className="text-sm text-blue-100 font-medium">Total Portfolio Value</p>
                <p className="text-2xl font-bold text-white mt-1">
                  {getCurrencySymbol('NGN')}{portfolioData.summary.totalPortfolioValue.toLocaleString()}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-slate-600 font-medium">Properties Owned</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">
                  {portfolioData.summary.propertiesOwned}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-slate-600 font-medium">Active Reservations</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">
                  {portfolioData.summary.activeReservations}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-slate-600 font-medium">Confirmed Investments</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">
                  {portfolioData.summary.confirmedInvestments}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Investment Details Table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building className="h-5 w-5" />
                Investment Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              {portfolioData.reservations.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <Building className="h-12 w-12 mx-auto mb-4 text-slate-300" />
                  <p>No investments found for this user</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Property</TableHead>
                        <TableHead>Units</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Certificate</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {portfolioData.reservations.map((reservation: any) => (
                        <TableRow key={reservation.id}>
                          <TableCell>
                            <div className="font-medium">{reservation.property?.name || 'Unknown Property'}</div>
                            <div className="text-sm text-slate-500">{reservation.property?.location || ''}</div>
                          </TableCell>
                          <TableCell>{parseFloat(reservation.units).toLocaleString()}</TableCell>
                          <TableCell>
                            {getCurrencySymbol(reservation.currency || 'NGN')}
                            {parseFloat(reservation.amount || 0).toLocaleString()}
                          </TableCell>
                          <TableCell>{getStatusBadge(reservation.status)}</TableCell>
                          <TableCell>
                            {new Date(reservation.createdAt).toLocaleDateString()}
                          </TableCell>
                          <TableCell>
                            {reservation.certificate ? (
                              <Badge className="bg-green-100 text-green-800">
                                {reservation.certificate.certificateNumber}
                              </Badge>
                            ) : reservation.status === 'converted_to_investment' ? (
                              <Badge variant="secondary">Pending</Badge>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {reservation.status !== 'cancelled' ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {(reservation.status === 'reserved' || reservation.status === 'converted_to_investment') && (
                                    <DropdownMenuItem
                                      onClick={() => handleCancelInvestment(reservation.id)}
                                      disabled={cancellingId === reservation.id}
                                      className="text-red-600 focus:text-red-600"
                                      data-testid={`menu-cancel-portfolio-${reservation.id}`}
                                    >
                                      <XCircle className="h-4 w-4 mr-2" />
                                      {reservation.status === 'converted_to_investment' ? 'Revert & Cancel' : 'Cancel Reservation'}
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ) : (
                              <span className="text-slate-400 text-sm">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function ResaleListingsTab({ authenticatedRequest }: { authenticatedRequest: (url: string, options?: any) => Promise<any> }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [cancelNote, setCancelNote] = useState("");

  const { data: listings = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/resale-listings"],
    queryFn: () => authenticatedRequest("/api/admin/resale-listings"),
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, action, note }: { id: number; action: string; note?: string }) => {
      return authenticatedRequest(`/api/admin/resale-listings/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/resale-listings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/resale-payments"] });
      toast({ title: "Listing reviewed" });
      setReviewingId(null);
      setReviewNote("");
    },
    onError: () => {
      toast({ title: "Failed to review listing", variant: "destructive" });
    },
  });

  const endBiddingMutation = useMutation({
    mutationFn: async (id: number) => {
      return authenticatedRequest(`/api/admin/resale-listings/${id}/end-bidding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/resale-listings"] });
      toast({ title: "Bidding ended", description: data?.message || "Bidding has been closed" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to end bidding", description: error?.message, variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async ({ id, note }: { id: number; note?: string }) => {
      return authenticatedRequest(`/api/admin/resale-listings/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/resale-listings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/resale-payments"] });
      toast({ title: "Listing cancelled", description: data?.message || "Listing has been cancelled" });
      setCancellingId(null);
      setCancelNote("");
    },
    onError: (error: any) => {
      toast({ title: "Failed to cancel listing", description: error?.message, variant: "destructive" });
    },
  });

  const expirePaymentMutation = useMutation({
    mutationFn: async (id: number) => {
      return authenticatedRequest(`/api/admin/resale-listings/${id}/expire-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/resale-listings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/resale-payments"] });
      toast({ title: "Payment expired", description: data?.message || "Processed expired payment" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to expire payment", description: error?.message, variant: "destructive" });
    },
  });

  const pendingCount = listings.filter((l: any) => l.status === "pending_review").length;
  const approvedCount = listings.filter((l: any) => l.status === "approved").length;
  const awaitingCount = listings.filter((l: any) => l.status === "awaiting_payment").length;
  const soldCount = listings.filter((l: any) => l.status === "sold").length;

  const statusConfig: Record<string, { label: string; color: string }> = {
    pending_review: { label: "Pending Review", color: "bg-yellow-100 text-yellow-800" },
    approved: { label: "Live", color: "bg-green-100 text-green-700" },
    rejected: { label: "Rejected", color: "bg-red-100 text-red-700" },
    awaiting_payment: { label: "Awaiting Payment", color: "bg-orange-100 text-orange-700" },
    sold: { label: "Sold", color: "bg-blue-100 text-blue-700" },
    cancelled: { label: "Cancelled", color: "bg-slate-100 text-slate-600" },
  };

  const filteredListings = statusFilter === "all"
    ? listings
    : listings.filter((l: any) => l.status === statusFilter);

  if (isLoading) {
    return <div className="flex items-center justify-center py-12 text-slate-500">Loading resale listings...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Resale Listings</h1>
        <p className="text-slate-500">Review and manage P2P unit resale requests</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter("all")}>
          <CardContent className={`p-3 text-center ${statusFilter === "all" ? "ring-2 ring-blue-500 rounded-lg" : ""}`}>
            <p className="text-2xl font-bold">{listings.length}</p>
            <p className="text-xs text-slate-500">Total</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter("pending_review")}>
          <CardContent className={`p-3 text-center ${statusFilter === "pending_review" ? "ring-2 ring-yellow-500 rounded-lg" : ""}`}>
            <p className="text-2xl font-bold text-yellow-600">{pendingCount}</p>
            <p className="text-xs text-slate-500">Pending</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter("approved")}>
          <CardContent className={`p-3 text-center ${statusFilter === "approved" ? "ring-2 ring-green-500 rounded-lg" : ""}`}>
            <p className="text-2xl font-bold text-green-600">{approvedCount}</p>
            <p className="text-xs text-slate-500">Live</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter("awaiting_payment")}>
          <CardContent className={`p-3 text-center ${statusFilter === "awaiting_payment" ? "ring-2 ring-orange-500 rounded-lg" : ""}`}>
            <p className="text-2xl font-bold text-orange-600">{awaitingCount}</p>
            <p className="text-xs text-slate-500">Awaiting Pay</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter("sold")}>
          <CardContent className={`p-3 text-center ${statusFilter === "sold" ? "ring-2 ring-blue-500 rounded-lg" : ""}`}>
            <p className="text-2xl font-bold text-blue-600">{soldCount}</p>
            <p className="text-xs text-slate-500">Sold</p>
          </CardContent>
        </Card>
      </div>

      {filteredListings.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-slate-500">
          {statusFilter === "all" ? "No resale listings yet." : `No ${statusConfig[statusFilter]?.label || statusFilter} listings.`}
        </CardContent></Card>
      ) : (
        <div className="space-y-4">
          {filteredListings.map((listing: any) => {
            const si = statusConfig[listing.status] || { label: listing.status, color: "bg-slate-100 text-slate-600" };
            const canCancel = ["pending_review", "approved", "awaiting_payment"].includes(listing.status);

            return (
              <Card key={listing.id} className="overflow-hidden">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-col gap-4">
                    {/* Header row */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-slate-900 text-lg">{listing.propertyName}</h4>
                        <Badge className={si.color}>{si.label}</Badge>
                        <Badge variant="outline" className="text-xs">
                          {listing.sellingType === "fixed_price" ? (
                            <><Tag className="h-3 w-3 mr-1" /> Fixed Price</>
                          ) : (
                            <><Gavel className="h-3 w-3 mr-1" /> Auction</>
                          )}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-400">ID #{listing.id} · {new Date(listing.createdAt).toLocaleDateString()}</p>
                    </div>

                    {/* Details grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Seller</p>
                        <p className="font-semibold text-slate-900">{listing.sellerName}</p>
                        {listing.sellerEmail && <p className="text-xs text-slate-400">{listing.sellerEmail}</p>}
                      </div>
                      <div className="bg-slate-50 rounded-lg p-3">
                        <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Units & Price</p>
                        <p className="font-semibold text-slate-900">{listing.units} units</p>
                        {listing.sellingType === "fixed_price" ? (
                          <p className="text-sm text-blue-700 font-bold">{listing.currency} {parseFloat(listing.askingPrice || 0).toLocaleString()}</p>
                        ) : (
                          <p className="text-xs text-slate-500">
                            Reserve: {listing.minimumPrice ? `${listing.currency} ${parseFloat(listing.minimumPrice).toLocaleString()}` : "None"}
                          </p>
                        )}
                      </div>
                      {listing.sellingType === "bidding" && (
                        <div className="bg-purple-50 rounded-lg p-3">
                          <p className="text-xs text-purple-500 uppercase tracking-wide mb-1">Bidding Activity</p>
                          <p className="font-semibold text-purple-900">{listing.bidCount || 0} bid{(listing.bidCount || 0) !== 1 ? "s" : ""}</p>
                          {listing.highestBidAmount && (
                            <p className="text-sm text-purple-700 font-bold">
                              Highest: {listing.currency} {parseFloat(listing.highestBidAmount).toLocaleString()}
                            </p>
                          )}
                          {listing.highestBidderName && (
                            <p className="text-xs text-purple-500">by {listing.highestBidderName}</p>
                          )}
                        </div>
                      )}
                      {listing.winnerId && (
                        <div className="bg-blue-50 rounded-lg p-3">
                          <p className="text-xs text-blue-500 uppercase tracking-wide mb-1">
                            {listing.status === "sold" ? "Buyer" : "Winner"}
                          </p>
                          <p className="font-semibold text-blue-900">{listing.winnerName || `User #${listing.winnerId}`}</p>
                          {listing.winnerEmail && <p className="text-xs text-blue-400">{listing.winnerEmail}</p>}
                          {listing.paymentDeadline && listing.status === "awaiting_payment" && (
                            <p className="text-xs text-orange-600 mt-1">
                              Deadline: {new Date(listing.paymentDeadline).toLocaleDateString()} {new Date(listing.paymentDeadline).toLocaleTimeString()}
                            </p>
                          )}
                          {listing.paymentStatus === "pending_verification" && (
                            <Badge className="mt-1 bg-yellow-100 text-yellow-800 text-xs">Payment Submitted</Badge>
                          )}
                        </div>
                      )}
                      {listing.propertyLocation && (
                        <div className="bg-slate-50 rounded-lg p-3">
                          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Location</p>
                          <p className="font-medium text-slate-900 flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" /> {listing.propertyLocation}
                          </p>
                        </div>
                      )}
                    </div>

                    {listing.adminReviewNote && (
                      <p className="text-sm text-slate-500 italic bg-slate-50 rounded px-3 py-2">
                        Admin note: {listing.adminReviewNote}
                      </p>
                    )}

                    {/* Action buttons */}
                    <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
                      {/* Pending Review: Approve / Reject */}
                      {listing.status === "pending_review" && (
                        <>
                          {reviewingId === listing.id ? (
                            <div className="flex flex-col gap-2 w-full sm:w-auto sm:flex-row sm:items-end">
                              <Input
                                placeholder="Optional note..."
                                value={reviewNote}
                                onChange={(e) => setReviewNote(e.target.value)}
                                className="text-sm sm:w-48"
                              />
                              <Button
                                size="sm"
                                className="bg-green-600 hover:bg-green-700 text-white"
                                disabled={reviewMutation.isPending}
                                onClick={() => reviewMutation.mutate({ id: listing.id, action: "approve", note: reviewNote })}
                              >
                                <CheckCircle className="h-3.5 w-3.5 mr-1" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={reviewMutation.isPending}
                                onClick={() => reviewMutation.mutate({ id: listing.id, action: "reject", note: reviewNote })}
                              >
                                <XCircle className="h-3.5 w-3.5 mr-1" />
                                Reject
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => { setReviewingId(null); setReviewNote(""); }}>
                                Back
                              </Button>
                            </div>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => setReviewingId(listing.id)}>
                              <Shield className="h-3.5 w-3.5 mr-1" />
                              Review Listing
                            </Button>
                          )}
                        </>
                      )}

                      {/* Approved + Bidding: End Bidding */}
                      {listing.status === "approved" && listing.sellingType === "bidding" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-amber-700 border-amber-300 hover:bg-amber-50"
                          disabled={endBiddingMutation.isPending}
                          onClick={() => endBiddingMutation.mutate(listing.id)}
                        >
                          <Gavel className="h-3.5 w-3.5 mr-1" />
                          {endBiddingMutation.isPending ? "Ending..." : "End Bidding"}
                        </Button>
                      )}

                      {/* Awaiting Payment: Expire Payment (offer to next bidder) */}
                      {listing.status === "awaiting_payment" && listing.paymentDeadline && new Date(listing.paymentDeadline) < new Date() && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-orange-700 border-orange-300 hover:bg-orange-50"
                          disabled={expirePaymentMutation.isPending}
                          onClick={() => expirePaymentMutation.mutate(listing.id)}
                        >
                          <Clock className="h-3.5 w-3.5 mr-1" />
                          {expirePaymentMutation.isPending ? "Processing..." : "Expire & Next Bidder"}
                        </Button>
                      )}

                      {/* Cancel action (for non-sold, non-cancelled) */}
                      {canCancel && (
                        <>
                          {cancellingId === listing.id ? (
                            <div className="flex flex-col gap-2 w-full sm:w-auto sm:flex-row sm:items-end">
                              <Input
                                placeholder="Reason for cancellation..."
                                value={cancelNote}
                                onChange={(e) => setCancelNote(e.target.value)}
                                className="text-sm sm:w-52"
                              />
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={cancelMutation.isPending}
                                onClick={() => cancelMutation.mutate({ id: listing.id, note: cancelNote })}
                              >
                                {cancelMutation.isPending ? "Cancelling..." : "Confirm Cancel"}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => { setCancellingId(null); setCancelNote(""); }}>
                                Back
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => setCancellingId(listing.id)}
                            >
                              <XCircle className="h-3.5 w-3.5 mr-1" />
                              Cancel Listing
                            </Button>
                          )}
                        </>
                      )}

                      {/* Sold indicator */}
                      {listing.status === "sold" && (
                        <Badge className="bg-green-100 text-green-800 border-green-300">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Transfer Complete
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ResalePaymentsTab({ authenticatedRequest }: { authenticatedRequest: (url: string, options?: any) => Promise<any> }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: payments = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/resale-payments"],
    queryFn: () => authenticatedRequest("/api/admin/resale-payments"),
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, action, reason }: { id: number; action: string; reason?: string }) => {
      return authenticatedRequest(`/api/admin/resale-payments/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, rejectionReason: reason }),
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/resale-payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/resale-listings"] });
      toast({ title: "Payment reviewed", description: data?.message || "Payment has been processed" });
      setReviewingId(null);
      setRejectionReason("");
    },
    onError: () => {
      toast({ title: "Review failed", variant: "destructive" });
    },
  });

  const pendingCount = payments.filter((p: any) => p.status === "pending_verification").length;
  const approvedCount = payments.filter((p: any) => p.status === "approved").length;
  const rejectedCount = payments.filter((p: any) => p.status === "rejected").length;

  const statusConfig: Record<string, { label: string; color: string }> = {
    pending_verification: { label: "Pending Verification", color: "bg-yellow-100 text-yellow-800" },
    approved: { label: "Approved — Transferred", color: "bg-green-100 text-green-700" },
    rejected: { label: "Rejected", color: "bg-red-100 text-red-700" },
  };

  const filteredPayments = statusFilter === "all"
    ? payments
    : payments.filter((p: any) => p.status === statusFilter);

  if (isLoading) {
    return <div className="flex items-center justify-center py-12 text-slate-500">Loading resale payments...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Resale Payments</h1>
        <p className="text-slate-600 mt-1">Review and verify buyer payments for resale transactions</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter("all")}>
          <CardContent className={`p-3 text-center ${statusFilter === "all" ? "ring-2 ring-blue-500 rounded-lg" : ""}`}>
            <p className="text-2xl font-bold">{payments.length}</p>
            <p className="text-xs text-slate-500">Total</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter("pending_verification")}>
          <CardContent className={`p-3 text-center ${statusFilter === "pending_verification" ? "ring-2 ring-yellow-500 rounded-lg" : ""}`}>
            <p className="text-2xl font-bold text-yellow-600">{pendingCount}</p>
            <p className="text-xs text-slate-500">Pending</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter("approved")}>
          <CardContent className={`p-3 text-center ${statusFilter === "approved" ? "ring-2 ring-green-500 rounded-lg" : ""}`}>
            <p className="text-2xl font-bold text-green-600">{approvedCount}</p>
            <p className="text-xs text-slate-500">Approved</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter("rejected")}>
          <CardContent className={`p-3 text-center ${statusFilter === "rejected" ? "ring-2 ring-red-500 rounded-lg" : ""}`}>
            <p className="text-2xl font-bold text-red-600">{rejectedCount}</p>
            <p className="text-xs text-slate-500">Rejected</p>
          </CardContent>
        </Card>
      </div>

      {filteredPayments.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Banknote className="h-16 w-16 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">
              {statusFilter === "all" ? "No resale payments yet" : `No ${statusConfig[statusFilter]?.label || statusFilter} payments`}
            </h3>
            <p className="text-slate-600">Payments will appear here when buyers confirm their transfers</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredPayments.map((payment: any) => {
            const status = statusConfig[payment.status] || { label: payment.status, color: "bg-slate-100 text-slate-600" };

            return (
              <Card key={payment.id} className={`overflow-hidden ${payment.status === "pending_verification" ? "border-yellow-300 bg-yellow-50/30" : ""}`}>
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-col gap-4">
                    {/* Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-bold text-slate-900 text-lg">{payment.propertyName}</h3>
                        <Badge className={status.color}>{status.label}</Badge>
                        <Badge variant="outline" className="text-xs">
                          {payment.listingType === "fixed_price" ? "Fixed Price" : "Auction"}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-400">Payment #{payment.id} · {new Date(payment.createdAt).toLocaleDateString()}</p>
                    </div>

                    {/* Full transaction details */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                      <div className="bg-white border border-slate-200 rounded-lg p-3">
                        <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Buyer</p>
                        <p className="font-semibold text-slate-900">{payment.buyerName}</p>
                        {payment.buyerEmail && <p className="text-xs text-slate-400">{payment.buyerEmail}</p>}
                      </div>
                      <div className="bg-white border border-slate-200 rounded-lg p-3">
                        <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Seller</p>
                        <p className="font-semibold text-slate-900">{payment.sellerName}</p>
                        {payment.sellerEmail && <p className="text-xs text-slate-400">{payment.sellerEmail}</p>}
                      </div>
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <p className="text-xs text-blue-500 uppercase tracking-wide mb-1">Expected Amount</p>
                        <p className="font-bold text-blue-800 text-lg">
                          {payment.currency} {parseFloat(payment.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-lg p-3">
                        <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Units Transferring</p>
                        <p className="font-semibold text-slate-900">{payment.listingUnits} units</p>
                      </div>
                      {payment.bankReference && (
                        <div className="bg-white border border-slate-200 rounded-lg p-3">
                          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Bank Reference</p>
                          <p className="font-semibold font-mono text-slate-900">{payment.bankReference}</p>
                        </div>
                      )}
                      <div className="bg-white border border-slate-200 rounded-lg p-3">
                        <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Payment Method</p>
                        <p className="font-medium text-slate-900">{payment.paymentMethod === "bank_transfer" ? "Bank Transfer" : payment.paymentMethod}</p>
                      </div>
                    </div>

                    {/* Proof + review info */}
                    <div className="flex flex-wrap gap-4 items-center">
                      {payment.proofUrl && (
                        <a
                          href={payment.proofUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 bg-blue-50 rounded-lg px-3 py-2 border border-blue-200"
                        >
                          <Eye className="h-4 w-4" />
                          View Payment Proof ({payment.proofType || 'file'})
                        </a>
                      )}
                      {!payment.proofUrl && payment.status === "pending_verification" && (
                        <p className="text-sm text-amber-600 flex items-center gap-1">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          No proof uploaded — verify via bank reference only
                        </p>
                      )}
                    </div>

                    {payment.rejectionReason && payment.status === "rejected" && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                        <strong>Rejection reason:</strong> {payment.rejectionReason}
                      </div>
                    )}

                    {payment.status === "approved" && (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 flex items-center gap-2">
                        <CheckCircle className="h-4 w-4" />
                        Payment verified. Units transferred from seller to buyer. Listing marked as sold.
                        {payment.reviewedAt && (
                          <span className="text-xs text-green-500 ml-auto">
                            Approved {new Date(payment.reviewedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Actions for pending payments */}
                    {payment.status === "pending_verification" && (
                      <div className="border-t border-slate-200 pt-3">
                        {reviewingId === payment.id ? (
                          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
                            <Button
                              size="sm"
                              className="bg-green-600 hover:bg-green-700 text-white"
                              disabled={reviewMutation.isPending}
                              onClick={() => reviewMutation.mutate({ id: payment.id, action: "approve" })}
                            >
                              <CheckCircle className="h-3.5 w-3.5 mr-1" />
                              {reviewMutation.isPending ? "Processing..." : "Approve & Transfer Units"}
                            </Button>
                            <div className="flex gap-2 items-end flex-1">
                              <Input
                                placeholder="Rejection reason..."
                                value={rejectionReason}
                                onChange={(e) => setRejectionReason(e.target.value)}
                                className="text-sm flex-1"
                              />
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={reviewMutation.isPending}
                                onClick={() => reviewMutation.mutate({ id: payment.id, action: "reject", reason: rejectionReason })}
                              >
                                <XCircle className="h-3.5 w-3.5 mr-1" />
                                Reject
                              </Button>
                            </div>
                            <Button size="sm" variant="ghost" onClick={() => { setReviewingId(null); setRejectionReason(""); }}>
                              Back
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                            onClick={() => setReviewingId(payment.id)}
                          >
                            <Shield className="h-3.5 w-3.5 mr-1" />
                            Review Payment
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ResaleAuditTab({ authenticatedRequest }: { authenticatedRequest: (url: string, options?: any) => Promise<any> }) {
  const [filterListingId, setFilterListingId] = useState("");
  const [selectedListingId, setSelectedListingId] = useState<number | null>(null);

  const queryUrl = filterListingId
    ? `/api/admin/resale-audit-logs?listingId=${filterListingId}`
    : "/api/admin/resale-audit-logs";

  const { data: logs = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/resale-audit-logs", filterListingId],
    queryFn: async () => {
      const res = await authenticatedRequest(queryUrl);
      return res.json();
    },
  });

  const { data: listingTimeline } = useQuery<any>({
    queryKey: ["/api/admin/resale-audit-logs/listing", selectedListingId],
    queryFn: async () => {
      if (!selectedListingId) return null;
      const res = await authenticatedRequest(`/api/admin/resale-audit-logs/listing/${selectedListingId}`);
      return res.json();
    },
    enabled: !!selectedListingId,
  });

  const getActionBadge = (action: string) => {
    const config: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      listing_created: { label: "Listing Created", variant: "outline" },
      listing_approved: { label: "Approved", variant: "default" },
      listing_rejected: { label: "Rejected", variant: "destructive" },
      listing_cancelled_by_seller: { label: "Seller Cancelled", variant: "secondary" },
      listing_cancelled_by_admin: { label: "Admin Cancelled", variant: "destructive" },
      bid_placed: { label: "Bid Placed", variant: "outline" },
      fixed_price_purchase: { label: "Fixed Price Buy", variant: "default" },
      bidding_ended_winner_selected: { label: "Winner Selected", variant: "default" },
      payment_submitted: { label: "Payment Submitted", variant: "outline" },
      payment_approved_transfer_complete: { label: "Transfer Complete", variant: "default" },
      payment_rejected: { label: "Payment Rejected", variant: "destructive" },
      payment_deadline_expired: { label: "Deadline Expired", variant: "destructive" },
      next_bidder_offered: { label: "Next Bidder", variant: "secondary" },
    };
    const c = config[action] || { label: action, variant: "outline" as const };
    return <Badge variant={c.variant}>{c.label}</Badge>;
  };

  const getActorBadge = (actorType: string) => {
    if (actorType === "admin") return <Badge variant="destructive" className="text-xs">Admin</Badge>;
    if (actorType === "system") return <Badge variant="secondary" className="text-xs">System</Badge>;
    return <Badge variant="outline" className="text-xs">User</Badge>;
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-12 text-slate-500">Loading audit logs...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-3xl font-bold text-slate-900">Resale Audit Trail</h1>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Filter by Listing ID..."
            value={filterListingId}
            onChange={(e) => setFilterListingId(e.target.value)}
            className="w-48"
          />
        </div>
      </div>

      <div className="text-sm text-slate-500 mb-2">
        {logs.length} audit event{logs.length !== 1 ? "s" : ""} recorded
      </div>

      {/* Timeline for a specific listing */}
      {selectedListingId && listingTimeline && (
        <Dialog open={!!selectedListingId} onOpenChange={() => setSelectedListingId(null)}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Listing #{selectedListingId} — Full Timeline</DialogTitle>
              {listingTimeline.listing && (
                <DialogDescription>
                  {listingTimeline.listing.sellingType === "bidding" ? "Auction" : "Fixed Price"} · 
                  {listingTimeline.listing.units} units · 
                  Status: {listingTimeline.listing.status}
                </DialogDescription>
              )}
            </DialogHeader>
            <div className="space-y-3">
              {listingTimeline.timeline?.map((entry: any, idx: number) => (
                <div key={entry.id} className="flex gap-3 items-start">
                  <div className="flex flex-col items-center">
                    <div className={`w-3 h-3 rounded-full ${idx === 0 ? "bg-emerald-500" : "bg-slate-300"}`} />
                    {idx < listingTimeline.timeline.length - 1 && <div className="w-0.5 h-full bg-slate-200 min-h-[40px]" />}
                  </div>
                  <div className="flex-1 pb-4">
                    <div className="flex items-center gap-2 mb-1">
                      {getActionBadge(entry.action)}
                      {getActorBadge(entry.actorType)}
                      <span className="text-xs text-slate-400">{new Date(entry.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-sm text-slate-700">{entry.details}</p>
                    <div className="flex flex-wrap gap-3 text-xs text-slate-500 mt-1">
                      {entry.actorName && <span>By: {entry.actorName}</span>}
                      {entry.sellerName && <span>Seller: {entry.sellerName}</span>}
                      {entry.buyerName && <span>Buyer: {entry.buyerName}</span>}
                      {entry.amount && <span>Amount: {entry.currency} {parseFloat(entry.amount).toLocaleString()}</span>}
                      {entry.units && <span>Units: {entry.units}</span>}
                    </div>
                  </div>
                </div>
              ))}
              {(!listingTimeline.timeline || listingTimeline.timeline.length === 0) && (
                <p className="text-slate-500 text-sm">No audit events for this listing.</p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Main audit log table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">Timestamp</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Property</TableHead>
                <TableHead>Listing</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Parties</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-slate-500">
                    No audit events recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log: any) => (
                  <TableRow key={log.id} className="hover:bg-slate-50">
                    <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>{getActionBadge(log.action)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        {getActorBadge(log.actorType)}
                        {log.actorName && <span className="text-xs text-slate-500">{log.actorName}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{log.propertyName || "-"}</TableCell>
                    <TableCell>
                      {log.listingId ? (
                        <Button
                          variant="link"
                          size="sm"
                          className="p-0 h-auto text-blue-600"
                          onClick={() => setSelectedListingId(log.listingId)}
                        >
                          #{log.listingId}
                        </Button>
                      ) : "-"}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600 max-w-[300px] truncate" title={log.details || ""}>
                      {log.details || "-"}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="space-y-0.5">
                        {log.sellerName && <div>Seller: {log.sellerName}</div>}
                        {log.buyerName && <div>Buyer: {log.buyerName}</div>}
                        {log.amount && <div>{log.currency} {parseFloat(log.amount).toLocaleString()}</div>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

const ONBOARDING_STAGES: { key: string; label: string; color: string }[] = [
  { key: "submitted",        label: "Submitted",        color: "bg-slate-100 text-slate-700" },
  { key: "due_diligence",    label: "Due diligence",    color: "bg-amber-100 text-amber-700" },
  { key: "agreement_signed", label: "Agreement signed", color: "bg-indigo-100 text-indigo-700" },
  { key: "live",             label: "Live",             color: "bg-emerald-100 text-emerald-700" },
  { key: "rejected",         label: "Rejected",         color: "bg-rose-100 text-rose-700" },
];

function DeveloperOnboardingTab({ authenticatedRequest }: { authenticatedRequest: (url: string, options?: any) => Promise<any> }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [rejecting, setRejecting] = useState<any>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [deleting, setDeleting] = useState<any>(null);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const emptyOnboardForm = {
    email: "", firstName: "", lastName: "", phone: "",
    companyName: "", companyRegistration: "", websiteUrl: "", companyDescription: "", companyLogoUrl: "",
    bankName: "", bankAccountName: "", bankAccountNumber: "",
  };
  const [onboardForm, setOnboardForm] = useState({ ...emptyOnboardForm });

  const { data: devs = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/developer-onboarding"],
    queryFn: () => authenticatedRequest("/api/admin/developer-onboarding"),
  });

  const stageMutation = useMutation({
    mutationFn: async ({ id, stage, reason }: { id: number; stage: string; reason?: string }) =>
      authenticatedRequest(`/api/admin/developer-onboarding/${id}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage, reason }),
      }),
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/developer-onboarding"] });
      setRejecting(null);
      setRejectReason("");
      toast({ title: vars.stage === "rejected" ? "Developer rejected" : "Stage updated" });
    },
    onError: (e: any) => toast({ title: "Failed to update stage", description: String(e?.message || ""), variant: "destructive" }),
  });

  const revokeInviteMutation = useMutation({
    mutationFn: async (id: number) =>
      authenticatedRequest(`/api/admin/developer-onboarding/${id}/revoke-invite`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/developer-onboarding"] });
      toast({ title: "Invite revoked", description: "The emailed password-setup link no longer works." });
    },
    onError: (e: any) => toast({ title: "Failed to revoke invite", description: String(e?.message || ""), variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) =>
      authenticatedRequest(`/api/admin/developer-onboarding/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/developer-onboarding"] });
      toast({ title: "Developer deleted" });
    },
    onError: (e: any) => {
      const raw = String(e?.message || "").replace(/^\d+:\s*/, "");
      let msg = raw;
      try { const p = JSON.parse(raw); if (p?.message) msg = p.message; } catch {}
      toast({ title: "Can't delete developer", description: msg, variant: "destructive" });
    },
  });

  const onboardMutation = useMutation({
    mutationFn: async () =>
      authenticatedRequest(`/api/admin/developer-onboarding`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(onboardForm),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/developer-onboarding"] });
      setOnboardOpen(false);
      setOnboardForm({ ...emptyOnboardForm });
      toast({ title: "Developer onboarded", description: "An invite email with a password-setup link was sent." });
    },
    onError: (e: any) => {
      const raw = String(e?.message || "").replace(/^\d+:\s*/, "");
      let msg = raw;
      try { const p = JSON.parse(raw); if (p?.message) msg = p.message; } catch {}
      toast({ title: "Failed to onboard developer", description: msg, variant: "destructive" });
    },
  });

  const nextStageOf = (stage: string) => {
    const order = ["submitted", "due_diligence", "agreement_signed", "live"];
    const idx = order.indexOf(stage);
    return idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
  };

  const counts: Record<string, number> = { all: devs.length };
  for (const s of ONBOARDING_STAGES) counts[s.key] = devs.filter((d: any) => (d.onboardingStage || "submitted") === s.key).length;
  const filtered = stageFilter === "all" ? devs : devs.filter((d: any) => (d.onboardingStage || "submitted") === stageFilter);
  const uof = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setOnboardForm({ ...onboardForm, [k]: e.target.value });

  if (isLoading) return <div className="space-y-3 mt-6">{[1, 2].map((i) => <div key={i} className="h-32 bg-slate-100 rounded animate-pulse" />)}</div>;

  return (
    <div className="space-y-6 mt-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Developer Onboarding</h2>
          <p className="text-slate-600 mt-1">Due-diligence pipeline: Submitted → Due diligence → Agreement signed → Live. No listing goes live without passing review.</p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => setOnboardOpen(true)} data-testid="button-onboard-developer">
          <Plus className="w-4 h-4 mr-2" /> Onboard developer
        </Button>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {[{ key: "all", label: "All" }, ...ONBOARDING_STAGES].map((c: any) => (
          <button
            key={c.key}
            onClick={() => setStageFilter(c.key)}
            className={`text-left rounded-lg border border-slate-200 p-3 transition-all ${stageFilter === c.key ? "ring-2 ring-blue-500" : ""}`}
            data-testid={`filter-onboarding-${c.key}`}
          >
            <div className="text-xl font-bold text-slate-900">{counts[c.key] ?? 0}</div>
            <div className="text-[11px] uppercase tracking-wider text-slate-600 mt-0.5">{c.label}</div>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-slate-500">No developers in this stage.</CardContent></Card>
      ) : (
        <div className="space-y-4">
          {filtered.map((d: any) => {
            const stage = d.onboardingStage || "submitted";
            const meta = ONBOARDING_STAGES.find((s) => s.key === stage) || ONBOARDING_STAGES[0];
            const next = nextStageOf(stage);
            return (
              <Card key={d.id} data-testid={`card-onboarding-dev-${d.id}`}>
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-start gap-3 min-w-0">
                      {d.companyLogoUrl ? (
                        <img src={d.companyLogoUrl} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-200 flex-shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                          <Building className="w-5 h-5 text-slate-400" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-900">{d.companyName || "—"}</span>
                          <Badge className={meta.color}>{meta.label}</Badge>
                          {d.invitePending && <Badge className="bg-purple-100 text-purple-700">Invite pending</Badge>}
                        </div>
                        <div className="text-sm text-slate-600 mt-0.5">
                          {d.firstName} {d.lastName} · {d.email}{d.phone ? ` · ${d.phone}` : ""}
                        </div>
                        <div className="text-xs text-slate-500 mt-1 space-x-3">
                          {d.companyRegistration && <span>RC: {d.companyRegistration}</span>}
                          {d.bankName ? (
                            <span>Bank: {d.bankName} · {d.bankAccountName} · {d.bankAccountNumber}</span>
                          ) : (
                            <span className="text-amber-600">No payout details yet</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {d.projectCount} project(s){d.firstProject ? ` — first: ${d.firstProject.name}, ${d.firstProject.location} (${d.firstProject.projectStatus})` : ""}
                        </div>
                        {stage === "rejected" && d.onboardingRejectionReason && (
                          <div className="text-xs text-rose-600 mt-1">Reason: {d.onboardingRejectionReason}</div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {next && (
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700"
                          disabled={stageMutation.isPending}
                          onClick={() => stageMutation.mutate({ id: d.id, stage: next })}
                          data-testid={`button-advance-${d.id}`}
                        >
                          <CheckCircle className="w-4 h-4 mr-1.5" />
                          {next === "live" ? "Approve & go live" : `Move to ${ONBOARDING_STAGES.find(s => s.key === next)?.label}`}
                        </Button>
                      )}
                      {stage !== "rejected" && stage !== "live" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-rose-600 border-rose-200 hover:bg-rose-50"
                          onClick={() => setRejecting(d)}
                          data-testid={`button-reject-${d.id}`}
                        >
                          <XCircle className="w-4 h-4 mr-1.5" /> Reject
                        </Button>
                      )}
                      {stage === "rejected" && (
                        <Button size="sm" variant="outline" onClick={() => stageMutation.mutate({ id: d.id, stage: "due_diligence" })}>
                          <RefreshCw className="w-4 h-4 mr-1.5" /> Re-review
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost" className="text-slate-500" data-testid={`button-onboarding-more-${d.id}`}>
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {d.invitePending && (
                            <DropdownMenuItem
                              onClick={() => revokeInviteMutation.mutate(d.id)}
                              disabled={revokeInviteMutation.isPending}
                              data-testid={`menu-revoke-invite-${d.id}`}
                            >
                              <XCircle className="w-4 h-4 mr-2" /> Revoke invite link
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="text-rose-600 focus:text-rose-600"
                            onClick={() => setDeleting(d)}
                            data-testid={`menu-delete-dev-${d.id}`}
                          >
                            <Trash2 className="w-4 h-4 mr-2" /> Delete developer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Reject dialog */}
      <Dialog open={!!rejecting} onOpenChange={(o) => { if (!o) { setRejecting(null); setRejectReason(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject {rejecting?.companyName}</DialogTitle>
            <DialogDescription>The developer will receive an email with this reason. They can contact support to re-apply.</DialogDescription>
          </DialogHeader>
          <Textarea rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="e.g. Title documentation could not be verified" data-testid="input-reject-reason" />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejecting(null); setRejectReason(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || stageMutation.isPending}
              onClick={() => stageMutation.mutate({ id: rejecting.id, stage: "rejected", reason: rejectReason.trim() })}
              data-testid="button-confirm-reject"
            >
              Reject developer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.companyName || deleting?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the developer account{deleting?.invitePending ? " and cancels the pending invite" : ""}. It only works when they have no projects or linked records — otherwise consider rejecting them instead. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              onClick={() => { deleteMutation.mutate(deleting.id); setDeleting(null); }}
              data-testid="button-confirm-delete-dev"
            >
              Delete developer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Onboard-on-behalf dialog */}
      <Dialog open={onboardOpen} onOpenChange={setOnboardOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Onboard a developer</DialogTitle>
            <DialogDescription>
              Create the developer's account on their behalf. They'll receive an invite email with a link to set their password. The account starts in Due diligence.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2 text-sm font-semibold text-slate-700">Contact</div>
            <div><Label>First name *</Label><Input value={onboardForm.firstName} onChange={uof("firstName")} data-testid="input-ob-first-name" /></div>
            <div><Label>Last name</Label><Input value={onboardForm.lastName} onChange={uof("lastName")} /></div>
            <div><Label>Email *</Label><Input type="email" value={onboardForm.email} onChange={uof("email")} data-testid="input-ob-email" /></div>
            <div><Label>Phone</Label><Input value={onboardForm.phone} onChange={uof("phone")} /></div>
            <div className="sm:col-span-2 text-sm font-semibold text-slate-700 mt-2">Company</div>
            <div><Label>Company name *</Label><Input value={onboardForm.companyName} onChange={uof("companyName")} data-testid="input-ob-company" /></div>
            <div><Label>RC number</Label><Input value={onboardForm.companyRegistration} onChange={uof("companyRegistration")} placeholder="RC1234567" /></div>
            <div className="sm:col-span-2"><Label>Website</Label><Input type="url" value={onboardForm.websiteUrl} onChange={uof("websiteUrl")} placeholder="https://" /></div>
            <div className="sm:col-span-2">
              <Label>Company description</Label>
              <Textarea rows={3} value={onboardForm.companyDescription} onChange={uof("companyDescription")} placeholder="Short paragraph buyers will see on the store page" />
            </div>
            <div className="sm:col-span-2">
              <FileUpload
                label="Company logo"
                uploadType="image"
                accept="image/*"
                currentFile={onboardForm.companyLogoUrl}
                onUploadSuccess={(url) => setOnboardForm((f) => ({ ...f, companyLogoUrl: url }))}
              />
            </div>
            <div className="sm:col-span-2 text-sm font-semibold text-slate-700 mt-2">Payout details (buyers pay the developer directly)</div>
            <div><Label>Bank name</Label><Input value={onboardForm.bankName} onChange={uof("bankName")} /></div>
            <div><Label>Account name</Label><Input value={onboardForm.bankAccountName} onChange={uof("bankAccountName")} /></div>
            <div><Label>Account number</Label><Input inputMode="numeric" value={onboardForm.bankAccountNumber} onChange={uof("bankAccountNumber")} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOnboardOpen(false)}>Cancel</Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              disabled={!onboardForm.email || !onboardForm.firstName || !onboardForm.companyName || onboardMutation.isPending}
              onClick={() => onboardMutation.mutate()}
              data-testid="button-submit-onboard"
            >
              {onboardMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Create account & send invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DeveloperProjectsTab({ authenticatedRequest }: { authenticatedRequest: (url: string, options?: any) => Promise<any> }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: groups = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/developer-projects"],
    queryFn: () => authenticatedRequest("/api/admin/developer-projects"),
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: string }) =>
      authenticatedRequest(`/api/admin/developer-projects/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/developer-projects"] });
      toast({ title: "Project updated" });
    },
    onError: () => toast({ title: "Failed to update project", variant: "destructive" }),
  });

  const takeOverMutation = useMutation({
    mutationFn: async (id: number) =>
      authenticatedRequest(`/api/admin/developer-projects/${id}/take-over`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/developer-projects"] });
      toast({ title: "Project taken over", description: "You now manage this project." });
    },
    onError: () => toast({ title: "Failed to take over", variant: "destructive" }),
  });

  const [feeEditing, setFeeEditing] = useState<any>(null);
  const [feeValue, setFeeValue] = useState("");
  const feeMutation = useMutation({
    mutationFn: async ({ id, fee }: { id: number; fee: number | null }) =>
      authenticatedRequest(`/api/admin/developer-projects/${id}/due-diligence-fee`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fee }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/developer-projects"] });
      setFeeEditing(null);
      setFeeValue("");
      toast({ title: "Due diligence fee saved" });
    },
    onError: () => toast({ title: "Failed to save fee", variant: "destructive" }),
  });

  const STATUS: Record<string, { label: string; color: string }> = {
    draft:            { label: "Draft",            color: "bg-slate-100 text-slate-700" },
    pending_approval: { label: "Pending Approval", color: "bg-amber-100 text-amber-700" },
    live:             { label: "Live",             color: "bg-emerald-100 text-emerald-700" },
    sold_out:         { label: "Sold Out",         color: "bg-blue-100 text-blue-700" },
    archived:         { label: "Archived",         color: "bg-slate-200 text-slate-600" },
  };

  // Flatten + filter projects
  const allProjects = groups.flatMap((g: any) =>
    (g.projects || []).map((p: any) => ({ ...p, _developer: g.developer }))
  );
  const counts = {
    all: allProjects.length,
    pending_approval: allProjects.filter((p: any) => p.projectStatus === "pending_approval").length,
    live: allProjects.filter((p: any) => p.projectStatus === "live").length,
    draft: allProjects.filter((p: any) => p.projectStatus === "draft").length,
  };
  const filtered = statusFilter === "all" ? allProjects : allProjects.filter((p: any) => p.projectStatus === statusFilter);

  if (isLoading) return <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-32 bg-slate-100 rounded animate-pulse" />)}</div>;

  return (
    <div className="space-y-6 mt-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Developer Projects</h2>
        <p className="text-slate-600 mt-1">Approve, reject, or archive projects submitted by self-service developers.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { key: "all",              label: "All",      count: counts.all,              color: "border-slate-200" },
          { key: "pending_approval", label: "Pending",  count: counts.pending_approval, color: "border-amber-200 bg-amber-50" },
          { key: "live",             label: "Live",     count: counts.live,             color: "border-emerald-200 bg-emerald-50" },
          { key: "draft",            label: "Drafts",   count: counts.draft,            color: "border-slate-200" },
        ].map((c) => (
          <button
            key={c.key}
            onClick={() => setStatusFilter(c.key)}
            className={`text-left rounded-lg border p-4 transition-all ${c.color} ${statusFilter === c.key ? "ring-2 ring-blue-500" : ""}`}
            data-testid={`filter-${c.key}`}
          >
            <div className="text-2xl font-bold text-slate-900">{c.count}</div>
            <div className="text-xs uppercase tracking-wider text-slate-600 mt-1">{c.label}</div>
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-slate-500">
            <Briefcase className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            No developers have signed up yet.
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500">No projects match this filter.</CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filtered.map((p: any) => {
            const meta = STATUS[p.projectStatus] || STATUS.draft;
            return (
              <Card key={p.id} data-testid={`admin-project-${p.id}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                      <div className="w-16 h-16 rounded-lg bg-slate-100 flex-shrink-0 overflow-hidden">
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center"><Building className="w-6 h-6 text-slate-400" /></div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-semibold text-slate-900 truncate">{p.name}</h3>
                          <Badge className={meta.color}>{meta.label}</Badge>
                        </div>
                        <div className="text-sm text-slate-600 mb-2">{p.location}</div>
                        <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                          <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" />{p._developer.companyName || `${p._developer.firstName} ${p._developer.lastName}`}</span>
                          <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{p._developer.email}</span>
                          {p._developer.websiteUrl && (
                            <a href={p._developer.websiteUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-blue-600 hover:underline">
                              <Globe className="w-3 h-3" />Website
                            </a>
                          )}
                        </div>
                        <div className="flex items-center gap-4 text-xs text-slate-500 mt-2 flex-wrap">
                          <span>{p.totalUnits} units · {p.currency} {parseFloat(p.unitPrice || "0").toLocaleString()}/unit</span>
                          <span>Total raise: {p.currency} {parseFloat(p.totalValue || "0").toLocaleString()}</span>
                          {Number(p.landSizeSqm) > 0 && <span>Land: {Number(p.landSizeSqm).toLocaleString()} sqm</span>}
                          <button
                            className="text-blue-600 hover:underline"
                            onClick={() => { setFeeEditing(p); setFeeValue(p.dueDiligenceFee ? String(Number(p.dueDiligenceFee)) : ""); }}
                            data-testid={`button-edit-dd-fee-${p.id}`}
                          >
                            DD fee: {Number(p.dueDiligenceFee) > 0 ? `${p.currency} ${Number(p.dueDiligenceFee).toLocaleString()}` : "not set"} — edit
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      {p.projectStatus === "pending_approval" && (
                        <>
                          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => reviewMutation.mutate({ id: p.id, action: "approve" })} disabled={reviewMutation.isPending} data-testid={`button-approve-${p.id}`}>
                            <CheckCircle className="w-4 h-4 mr-1" /> Approve
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => reviewMutation.mutate({ id: p.id, action: "reject" })} disabled={reviewMutation.isPending} data-testid={`button-reject-${p.id}`}>
                            <XCircle className="w-4 h-4 mr-1" /> Send back
                          </Button>
                        </>
                      )}
                      {p.projectStatus === "live" && (
                        <Button size="sm" variant="outline" onClick={() => reviewMutation.mutate({ id: p.id, action: "archive" })} disabled={reviewMutation.isPending} data-testid={`button-archive-${p.id}`}>
                          Archive
                        </Button>
                      )}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost" className="text-amber-700 hover:bg-amber-50" data-testid={`button-takeover-${p.id}`}>
                            Take over
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Take over this project?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Brikvest admin will take administrative control of <strong>{p.name}</strong>. The developer will lose portal access to it but the project will remain live for investors. The developer will be notified by email. This action cannot be undone from the admin panel.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => takeOverMutation.mutate(p.id)} className="bg-amber-600 hover:bg-amber-700">
                              Yes, take over
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Due-diligence fee dialog */}
      <Dialog open={!!feeEditing} onOpenChange={(o) => { if (!o) { setFeeEditing(null); setFeeValue(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Due diligence fee — {feeEditing?.name}</DialogTitle>
            <DialogDescription>
              Set the total fee for this project. Each buyer pays a share proportional to the sqm they own
              {Number(feeEditing?.landSizeSqm) > 0
                ? ` of the ${Number(feeEditing.landSizeSqm).toLocaleString()} sqm land (e.g. owning half the land = half the fee).`
                : ". Note: this project has no land size set, so the fee won't be charged until the developer sets one."}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>Total fee ({feeEditing?.currency})</Label>
            <Input
              type="number"
              min={0}
              value={feeValue}
              onChange={(e) => setFeeValue(e.target.value)}
              placeholder="e.g. 500000"
              data-testid="input-dd-fee"
            />
            {Number(feeValue) > 0 && Number(feeEditing?.landSizeSqm) > 0 && (
              <p className="text-xs text-slate-500 mt-1">
                Example: a buyer with {Math.round(Number(feeEditing.landSizeSqm) / 2).toLocaleString()} sqm (50%) pays {feeEditing?.currency} {(Number(feeValue) / 2).toLocaleString()}.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setFeeEditing(null); setFeeValue(""); }}>Cancel</Button>
            {Number(feeEditing?.dueDiligenceFee) > 0 && (
              <Button variant="outline" className="text-rose-600" disabled={feeMutation.isPending} onClick={() => feeMutation.mutate({ id: feeEditing.id, fee: null })}>
                Clear fee
              </Button>
            )}
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              disabled={feeMutation.isPending || feeValue === "" || Number(feeValue) < 0}
              onClick={() => feeMutation.mutate({ id: feeEditing.id, fee: Number(feeValue) })}
              data-testid="button-save-dd-fee"
            >
              Save fee
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReferralRewardsTab({ authenticatedRequest }: { authenticatedRequest: (url: string, options?: any) => Promise<any> }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: rewards = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/referral-rewards"],
    queryFn: () => authenticatedRequest("/api/admin/referral-rewards"),
  });

  const updatePayoutMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      return authenticatedRequest(`/api/admin/referral-rewards/${id}/payout`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/referral-rewards"] });
      toast({ title: "Payout status updated" });
    },
    onError: () => {
      toast({ title: "Failed to update", variant: "destructive" });
    },
  });

  const totalPending = rewards.filter(r => r.payoutStatus === 'pending' && Number(r.rewardAmount) > 0).length;
  const totalApproved = rewards.filter(r => r.payoutStatus === 'approved').length;
  const totalPaid = rewards.filter(r => r.payoutStatus === 'paid').length;
  const totalRewardValue = rewards.reduce((sum: number, r: any) => sum + Number(r.rewardAmount), 0);

  if (isLoading) {
    return <div className="text-center py-12 text-slate-500">Loading referral rewards...</div>;
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800 mb-6">Referral Rewards</h2>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 text-center">
            <Gift className="h-6 w-6 text-purple-600 mx-auto mb-1" />
            <p className="text-2xl font-bold">{rewards.length}</p>
            <p className="text-xs text-slate-600">Total Referrers</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <DollarSign className="h-6 w-6 text-green-600 mx-auto mb-1" />
            <p className="text-2xl font-bold">${totalRewardValue}</p>
            <p className="text-xs text-slate-600">Total Rewards</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Clock className="h-6 w-6 text-yellow-600 mx-auto mb-1" />
            <p className="text-2xl font-bold">{totalPending}</p>
            <p className="text-xs text-slate-600">Pending Payouts</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <CheckCircle className="h-6 w-6 text-blue-600 mx-auto mb-1" />
            <p className="text-2xl font-bold">{totalPaid}</p>
            <p className="text-xs text-slate-600">Paid Out</p>
          </CardContent>
        </Card>
      </div>

      {rewards.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-slate-500">
            <Gift className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <p>No referral rewards yet. Users will appear here when they successfully refer others.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left p-3 text-sm font-medium text-slate-600">User</th>
                    <th className="text-left p-3 text-sm font-medium text-slate-600">Email</th>
                    <th className="text-center p-3 text-sm font-medium text-slate-600">Referrals</th>
                    <th className="text-center p-3 text-sm font-medium text-slate-600">Reward</th>
                    <th className="text-center p-3 text-sm font-medium text-slate-600">Status</th>
                    <th className="text-center p-3 text-sm font-medium text-slate-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rewards.map((reward: any) => (
                    <tr key={reward.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="p-3 text-sm font-medium text-slate-800">{reward.userName}</td>
                      <td className="p-3 text-sm text-slate-600">{reward.userEmail}</td>
                      <td className="p-3 text-sm text-center">{reward.referralCount}</td>
                      <td className="p-3 text-sm text-center font-semibold text-green-700">${Number(reward.rewardAmount)}</td>
                      <td className="p-3 text-center">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          reward.payoutStatus === 'paid' ? 'bg-green-100 text-green-800' :
                          reward.payoutStatus === 'approved' ? 'bg-blue-100 text-blue-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {reward.payoutStatus}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        {Number(reward.rewardAmount) > 0 && (
                          <div className="flex gap-1 justify-center">
                            {reward.payoutStatus === 'pending' && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-blue-600 border-blue-300 text-xs"
                                onClick={() => updatePayoutMutation.mutate({ id: reward.id, status: 'approved' })}
                                disabled={updatePayoutMutation.isPending}
                              >
                                Approve
                              </Button>
                            )}
                            {reward.payoutStatus === 'approved' && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-green-600 border-green-300 text-xs"
                                onClick={() => updatePayoutMutation.mutate({ id: reward.id, status: 'paid' })}
                                disabled={updatePayoutMutation.isPending}
                              >
                                Mark Paid
                              </Button>
                            )}
                            {reward.payoutStatus !== 'pending' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-slate-500 text-xs"
                                onClick={() => updatePayoutMutation.mutate({ id: reward.id, status: 'pending' })}
                                disabled={updatePayoutMutation.isPending}
                              >
                                Reset
                              </Button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
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
  const [kycRejectionReason, setKycRejectionReason] = useState("");
  const [showKycRejectConfirm, setShowKycRejectConfirm] = useState(false);
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
  const [uploadingValuationReport, setUploadingValuationReport] = useState(false);
  const [valuationReportFile, setValuationReportFile] = useState<File | null>(null);

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
    currency: "NGN",
    totalSquareMeters: "",
    isTransferable: false,
    developerId: "none" as string,
  });

  // Fetch developers (owners) for property-developer linking
  const { data: developerOptions = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/developer-onboarding"],
    queryFn: () => authenticatedRequest("/api/admin/developer-onboarding"),
    enabled: !!user,
  });

  // Fetch properties (admin endpoint)
  const { data: properties = [], isLoading: propertiesLoading } = useQuery({
    queryKey: ["/api/admin/properties"],
    queryFn: () => authenticatedRequest("/api/admin/properties")
  });

  // Developer filter for the Properties tab
  const [developerFilter, setDeveloperFilter] = useState<string>("all");
  const filteredProperties = (properties as Property[]).filter((p: Property) => {
    if (developerFilter === "all") return true;
    if (developerFilter === "brikvest") return !p.developerId;
    return String(p.developerId) === developerFilter;
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
    queryKey: ["/api/admin/properties", selectedPropertyForVerification?.id, "verification"],
    queryFn: async () => {
      if (!selectedPropertyForVerification) return [];
      return await authenticatedRequest(`/api/properties/${selectedPropertyForVerification.id}/verification`);
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
      queryClient.invalidateQueries({ queryKey: ["/api/admin/properties"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/admin/properties"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/admin/properties"] });
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
    mutationFn: async ({ userId, status, rejectionReason }: { userId: number; status: string; rejectionReason?: string }) => {
      return await authenticatedRequest(`/api/admin/kyc/${userId}/status`, {
        method: "PUT",
        body: JSON.stringify({ status, rejectionReason }),
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
      currency: "NGN",
      totalSquareMeters: "",
      isTransferable: false,
      developerId: "none" as string,
    });
    clearDraft(); // Clear draft when form is reset
    setIsDraftSaved(false);
  };

  const handleValuationReportUpload = async (propertyId: number) => {
    if (!valuationReportFile) return;
    
    if (valuationReportFile.type !== 'application/pdf') {
      toast({ title: "Invalid file type", description: "Only PDF files are allowed", variant: "destructive" });
      return;
    }
    
    setUploadingValuationReport(true);
    try {
      const sessionId = localStorage.getItem("admin_session_id");
      const formData = new FormData();
      formData.append('valuationReport', valuationReportFile);
      
      const response = await fetch(`/api/admin/properties/${propertyId}/valuation-report`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionId}` },
        body: formData,
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Upload failed');
      }
      
      const data = await response.json();
      toast({ title: "Valuation report uploaded successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/properties"] });
      setValuationReportFile(null);
      if (viewingProperty?.id === propertyId) {
        setViewingProperty({ ...viewingProperty, valuationReportUrl: data.property?.valuationReportUrl, valuationReportName: data.property?.valuationReportName });
      }
    } catch (error: any) {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    } finally {
      setUploadingValuationReport(false);
    }
  };

  const handleRemoveValuationReport = async (propertyId: number) => {
    try {
      await authenticatedRequest(`/api/admin/properties/${propertyId}/valuation-report`, {
        method: 'DELETE',
      });
      toast({ title: "Valuation report removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/properties"] });
      if (viewingProperty?.id === propertyId) {
        setViewingProperty({ ...viewingProperty, valuationReportUrl: null, valuationReportName: null });
      }
    } catch (error: any) {
      toast({ title: "Failed to remove report", description: error.message, variant: "destructive" });
    }
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
      currency: "NGN",
      totalSquareMeters: "",
      isTransferable: false,
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
      status: propertyForm.status,
      currency: propertyForm.currency,
      totalSquareMeters: propertyForm.totalSquareMeters || null,
      isTransferable: propertyForm.isTransferable,
      developerId: propertyForm.developerId && propertyForm.developerId !== "none"
        ? parseInt(propertyForm.developerId)
        : null,
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
              <Button
                variant={selectedTab === "payment-reviews" ? "secondary" : "ghost"}
                className="w-full justify-start mb-1"
                onClick={() => setSelectedTab("payment-reviews")}
              >
                <FileText className="mr-3 h-4 w-4" />
                Payment Reviews
              </Button>
              <Button
                variant={selectedTab === "user-approvals" ? "secondary" : "ghost"}
                className="w-full justify-start mb-1"
                onClick={() => setSelectedTab("user-approvals")}
              >
                <UserCheck className="mr-3 h-4 w-4" />
                User Approvals
              </Button>
              <Button
                variant={selectedTab === "user-portfolio" ? "secondary" : "ghost"}
                className="w-full justify-start mb-1"
                onClick={() => setSelectedTab("user-portfolio")}
              >
                <Eye className="mr-3 h-4 w-4" />
                User Portfolio
              </Button>
              <Button
                variant={selectedTab === "referral-rewards" ? "secondary" : "ghost"}
                className="w-full justify-start mb-1"
                onClick={() => setSelectedTab("referral-rewards")}
              >
                <Gift className="mr-3 h-4 w-4" />
                Referral Rewards
              </Button>
              <Button
                variant={selectedTab === "resale-listings" ? "secondary" : "ghost"}
                className="w-full justify-start mb-1"
                onClick={() => setSelectedTab("resale-listings")}
              >
                <Repeat className="mr-3 h-4 w-4" />
                Resale Listings
              </Button>
              <Button
                variant={selectedTab === "resale-payments" ? "secondary" : "ghost"}
                className="w-full justify-start mb-1"
                onClick={() => setSelectedTab("resale-payments")}
              >
                <Banknote className="mr-3 h-4 w-4" />
                Resale Payments
              </Button>
              <Button
                variant={selectedTab === "resale-audit" ? "secondary" : "ghost"}
                className="w-full justify-start mb-1"
                onClick={() => setSelectedTab("resale-audit")}
              >
                <FileText className="mr-3 h-4 w-4" />
                Resale Audit Trail
              </Button>
              <Button
                variant={selectedTab === "developer-projects" ? "secondary" : "ghost"}
                className="w-full justify-start mb-1"
                onClick={() => setSelectedTab("developer-projects")}
                data-testid="button-tab-developer-projects"
              >
                <Briefcase className="mr-3 h-4 w-4" />
                Developer Projects
              </Button>
              <Button
                variant={selectedTab === "developer-onboarding" ? "secondary" : "ghost"}
                className="w-full justify-start mb-1"
                onClick={() => setSelectedTab("developer-onboarding")}
                data-testid="button-tab-developer-onboarding"
              >
                <UserCheck className="mr-3 h-4 w-4" />
                Developer Onboarding
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
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <Select value={developerFilter} onValueChange={setDeveloperFilter}>
                      <SelectTrigger className="w-full sm:w-[240px]" data-testid="select-developer-filter">
                        <SelectValue placeholder="Filter by developer" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All developers</SelectItem>
                        <SelectItem value="brikvest">Brikvest-managed</SelectItem>
                        {developerOptions.map((dev: any) => (
                          <SelectItem key={dev.id} value={String(dev.id)}>
                            {dev.companyName || dev.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button 
                      onClick={() => {
                        resetPropertyForm();
                        setEditingProperty(null);
                        setSelectedTab('add-property');
                      }} 
                      className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg w-full sm:w-auto transition-all duration-200"
                      size="lg"
                    >
                      <Plus className="h-5 w-5 mr-2" />
                      Add New Property
                    </Button>
                  </div>
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
                                <TableHead className="text-slate-900 font-semibold py-4 px-6">Developer</TableHead>
                                <TableHead className="text-slate-900 font-semibold py-4 px-6">Investment</TableHead>
                                <TableHead className="text-slate-900 font-semibold py-4 px-6">Progress</TableHead>
                                <TableHead className="text-slate-900 font-semibold py-4 px-6">Status</TableHead>
                                <TableHead className="text-slate-900 font-semibold py-4 px-6 text-right">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {filteredProperties.length === 0 ? (
                                <TableRow>
                                  <TableCell colSpan={7} className="py-10 text-center text-slate-500">
                                    No properties match this developer filter.
                                  </TableCell>
                                </TableRow>
                              ) : filteredProperties.map((property: Property) => (
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
                                    {(property as any).developerCompanyName ? (
                                      <div className="flex items-center text-slate-900">
                                        <Briefcase className="w-4 h-4 text-slate-400 mr-2 flex-shrink-0" />
                                        <span className="truncate">{(property as any).developerCompanyName}</span>
                                      </div>
                                    ) : (
                                      <span className="text-slate-400">—</span>
                                    )}
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
                                            currency: property.currency || "NGN",
                                            totalSquareMeters: property.totalSquareMeters || "",
                                            isTransferable: property.isTransferable || false,
                                            developerId: property.developerId ? String(property.developerId) : "none",
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
                          {filteredProperties.length === 0 ? (
                            <div className="text-center text-slate-500 py-10">
                              No properties match this developer filter.
                            </div>
                          ) : filteredProperties.map((property: Property) => (
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
                                        currency: property.currency || "USD",
                                        totalSquareMeters: property.totalSquareMeters || "",
                                        isTransferable: property.isTransferable || false,
                                        developerId: property.developerId ? String(property.developerId) : "none",
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
                                    kyc.kycStatus === 'approved' ? 'default' : 
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

                      <div className="flex items-center gap-3 py-2">
                        <input
                          type="checkbox"
                          id="isTransferable"
                          checked={propertyForm.isTransferable}
                          onChange={(e) => setPropertyForm(prev => ({ ...prev, isTransferable: e.target.checked }))}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        <div>
                          <Label htmlFor="isTransferable" className="cursor-pointer">Allow P2P Unit Transfers</Label>
                          <p className="text-xs text-slate-500">If enabled, investors can list their units for resale to other members</p>
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
                        <Label htmlFor="totalSquareMeters">Total Square Meters</Label>
                        <Input
                          id="totalSquareMeters"
                          type="number"
                          step="0.01"
                          value={propertyForm.totalSquareMeters}
                          onChange={(e) => setPropertyForm(prev => ({ ...prev, totalSquareMeters: e.target.value }))}
                          placeholder="e.g., 5000"
                        />
                        <p className="text-xs text-slate-500">Total land area in sqm. Unit size will be calculated automatically (total sqm / total units).</p>
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
                            <SelectItem value="approved">Approved</SelectItem>
                            <SelectItem value="exclusive">Exclusive</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-slate-500">Badge indicates our relationship status with this property</p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="developerId">Developer (Optional)</Label>
                        <Select value={propertyForm.developerId || "none"} onValueChange={(value) => setPropertyForm(prev => ({ ...prev, developerId: value }))}>
                          <SelectTrigger data-testid="select-developer">
                            <SelectValue placeholder="Select developer" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No Developer (Brikvest-managed)</SelectItem>
                            {developerOptions.map((dev: any) => (
                              <SelectItem key={dev.id} value={String(dev.id)}>
                                {dev.companyName || dev.email}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-slate-500">Linking a developer shows their brand (logo, name, RC number) to buyers on listing pages</p>
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
                                    kyc.kycStatus === 'approved' ? 'default' : 
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

            {/* Payment Reviews */}
            {selectedTab === "payment-reviews" && (
              <PaymentReviewsTab
                authenticatedRequest={authenticatedRequest}
                getCurrencySymbol={getCurrencySymbol}
                queryClient={queryClient}
                toast={toast}
              />
            )}

            {/* User Approvals */}
            {selectedTab === "user-approvals" && (
              <UserApprovalsTab authenticatedRequest={authenticatedRequest} />
            )}

            {/* User Portfolio Lookup */}
            {selectedTab === "user-portfolio" && (
              <UserPortfolioTab
                authenticatedRequest={authenticatedRequest}
                getCurrencySymbol={getCurrencySymbol}
              />
            )}

            {/* Referral Rewards Management */}
            {selectedTab === "referral-rewards" && (
              <ReferralRewardsTab authenticatedRequest={authenticatedRequest} />
            )}
            {selectedTab === "resale-listings" && (
              <ResaleListingsTab authenticatedRequest={authenticatedRequest} />
            )}
            {selectedTab === "resale-payments" && (
              <ResalePaymentsTab authenticatedRequest={authenticatedRequest} />
            )}
            {selectedTab === "resale-audit" && (
              <ResaleAuditTab authenticatedRequest={authenticatedRequest} />
            )}
            {selectedTab === "developer-projects" && (
              <DeveloperProjectsTab authenticatedRequest={authenticatedRequest} />
            )}
            {selectedTab === "developer-onboarding" && (
              <DeveloperOnboardingTab authenticatedRequest={authenticatedRequest} />
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
                        currency: viewingProperty.currency || "NGN",
                        totalSquareMeters: viewingProperty.totalSquareMeters || "",
                        isTransferable: viewingProperty.isTransferable || false,
                        developerId: viewingProperty.developerId ? String(viewingProperty.developerId) : "none",
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

              {/* Valuation History Management */}
              <ValuationManagement
                propertyId={viewingProperty.id}
                authenticatedRequest={authenticatedRequest}
                queryClient={queryClient}
                toast={toast}
              />
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

            <div className="flex items-center gap-3 py-2">
              <input
                type="checkbox"
                id="edit-isTransferable"
                checked={propertyForm.isTransferable}
                onChange={(e) => setPropertyForm(prev => ({ ...prev, isTransferable: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300"
              />
              <div>
                <Label htmlFor="edit-isTransferable" className="cursor-pointer">Allow P2P Unit Transfers</Label>
                <p className="text-xs text-slate-500">If enabled, investors can list their units for resale to other members</p>
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

            <div className="space-y-2">
              <Label htmlFor="edit-totalSquareMeters">Total Square Meters</Label>
              <Input
                id="edit-totalSquareMeters"
                type="number"
                step="0.01"
                value={propertyForm.totalSquareMeters}
                onChange={(e) => setPropertyForm(prev => ({ ...prev, totalSquareMeters: e.target.value }))}
                placeholder="e.g., 5000"
              />
              <p className="text-xs text-slate-500">Total land area in sqm. Unit size will be calculated automatically (total sqm / total units).</p>
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

            {/* Developer link */}
            <div className="space-y-2">
              <Label htmlFor="edit-developerId">Developer (Optional)</Label>
              <Select value={propertyForm.developerId || "none"} onValueChange={(value) => setPropertyForm(prev => ({ ...prev, developerId: value }))}>
                <SelectTrigger data-testid="select-edit-developer">
                  <SelectValue placeholder="Select developer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No Developer (Brikvest-managed)</SelectItem>
                  {developerOptions.map((dev: any) => (
                    <SelectItem key={dev.id} value={String(dev.id)}>
                      {dev.companyName || dev.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">Linking a developer shows their brand (logo, name, RC number) to buyers on listing pages</p>
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
                      variant={viewingReservation.status === 'converted_to_investment' ? 'default' : 'secondary'}
                      className="mt-1"
                    >
                      {viewingReservation.status === 'converted_to_investment' ? 'Invested' : viewingReservation.status}
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
                        viewingKyc.kycStatus === 'approved' ? 'default' : 
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
                        status: 'approved' 
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
                      setKycRejectionReason("");
                      setShowKycRejectConfirm(true);
                    }}
                    disabled={updateKycStatusMutation.isPending}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Reject KYC
                  </Button>
                </div>
              )}

              {/* Rejection Reason Dialog */}
              {showKycRejectConfirm && (
                <div className="mt-4 p-4 border border-red-200 bg-red-50 rounded-lg">
                  <p className="text-sm font-medium text-red-900 mb-2">Provide Rejection Reason</p>
                  <Textarea
                    placeholder="Enter the reason for rejecting this KYC (optional but recommended)"
                    value={kycRejectionReason}
                    onChange={(e) => setKycRejectionReason(e.target.value)}
                    className="mb-3"
                    rows={3}
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowKycRejectConfirm(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        updateKycStatusMutation.mutate({ 
                          userId: viewingKyc.id, 
                          status: 'rejected',
                          rejectionReason: kycRejectionReason || undefined
                        });
                        setShowKycRejectConfirm(false);
                        setIsKycDetailOpen(false);
                      }}
                      disabled={updateKycStatusMutation.isPending}
                    >
                      Confirm Rejection
                    </Button>
                  </div>
                </div>
              )}

              {viewingKyc.kycStatus === 'approved' && (
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