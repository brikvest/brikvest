import { useQuery, useQueries, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { TrendingUp, Building2, DollarSign, Clock, CheckCircle, LogOut, User, ArrowRight, Menu, X, AlertCircle, ShieldCheck, Upload, BarChart3, PieChart, Award, Download, FileText, Copy, Share2, Users, Tag, Gavel, XCircle, Megaphone, Hammer } from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";
import { useEffect, useState, useRef, useCallback, useId } from "react";
import type { InvestmentReservation, Property, OwnershipCertificate, PropertyValuation } from "@shared/schema";
import { useCurrency } from "@/hooks/useCurrency";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import brikvest_logo from "@/assets/brikvest-logo.png";
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { OwnershipCertificate as CertificateComponent, CertificateDownloadButton } from "@/components/OwnershipCertificate";
import { CurrencySelector } from "@/components/CurrencySelector";
import { Badge } from "@/components/ui/badge";
import { PropertyBrowsingContent } from "@/pages/home";
import { MarketInsightsContent } from "@/pages/insights";
import { getDashboardLoginUrl, getDashboardSection, getDashboardSectionUrl, type DashboardSection } from "@/lib/investorNavigation";
import { InvestorLegalDocuments } from "@/components/legal/LegalDocuments";
import { portfolioLandAmount, summarizeLandPortfolio } from "@shared/holding-costs";
import { AssetPerformanceSection } from "@/components/portfolio/AssetPerformanceSection";
import { PortfolioValueCards } from "@/components/portfolio/PortfolioValueCards";
import { holdingValueAtDate, propertyValuationQuery } from "@/lib/portfolio-performance";

function InvestmentPerformanceCharts({ reservations, formatCurrency, convertAmount, totalInvested, toast }: {
  reservations: (InvestmentReservation & { property?: Property })[];
  formatCurrency: (v: number) => string;
  convertAmount: (amount: number, fromCurrency: string) => number;
  totalInvested: number;
  toast: any;
}) {
  const gradientId = useId().replace(/:/g, "");
  const confirmedInvestments = reservations.filter(r => r.status === 'converted_to_investment');
  const investedPropertyIds = Array.from(new Set(confirmedInvestments.map(r => r.propertyId)));

  const valuationQueries = useQueries({
    queries: investedPropertyIds.map(propertyValuationQuery),
  });

  const allLoading = valuationQueries.some(q => q.isLoading);

  const valuationsByProperty: Record<number, PropertyValuation[]> = {};
  investedPropertyIds.forEach((pid, idx) => {
    valuationsByProperty[pid] = valuationQueries[idx]?.data || [];
  });

  const landAppreciationData = (() => {
    const allDates = new Set<string>();
    Object.values(valuationsByProperty).forEach(vals => {
      vals.forEach(v => {
        allDates.add(new Date(v.valuationDate).toISOString().split('T')[0]);
      });
    });
    const sortedDates = Array.from(allDates).sort();
    if (sortedDates.length === 0) return [];

    return sortedDates.map(dateStr => {
      let totalValue = 0;
      let count = 0;
      investedPropertyIds.forEach(pid => {
        const vals = valuationsByProperty[pid] || [];
        const applicable = vals.filter(v => new Date(v.valuationDate).toISOString().split('T')[0] <= dateStr);
        if (applicable.length > 0) {
          const latest = applicable[applicable.length - 1];
          totalValue += Number(latest.rawAssetValue || latest.currentValue);
          count++;
        }
      });
      return {
        date: new Date(dateStr).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        value: totalValue,
        properties: count,
      };
    });
  })();

  const latestAppreciation = (() => {
    if (landAppreciationData.length < 2) return null;
    const first = landAppreciationData[0].value;
    const last = landAppreciationData[landAppreciationData.length - 1].value;
    if (first === 0) return null;
    return ((last - first) / first * 100).toFixed(1);
  })();

  const investmentPerformanceData = (() => {
    const results: { date: string; initialValue: number; currentValue: number }[] = [];
    const allDates = new Set<string>();

    confirmedInvestments.forEach(inv => {
      const invDate = new Date(inv.createdAt).toISOString().split('T')[0];
      allDates.add(invDate);
    });

    Object.values(valuationsByProperty).forEach(vals => {
      vals.forEach(v => allDates.add(new Date(v.valuationDate).toISOString().split('T')[0]));
    });

    const sortedDates = Array.from(allDates).sort();
    if (sortedDates.length === 0) return [];

    sortedDates.forEach(dateStr => {
      let totalInitial = 0;
      let totalCurrent = 0;

      confirmedInvestments.forEach(inv => {
        const invDate = new Date(inv.createdAt).toISOString().split('T')[0];
        if (invDate > dateStr) return;

        const landAmount = portfolioLandAmount(inv);
        if (landAmount === null) return;
        const invAmount = convertAmount(landAmount, inv.currency || "NGN");
        totalInitial += invAmount;

        totalCurrent += holdingValueAtDate(inv, valuationsByProperty[inv.propertyId] || [], dateStr, convertAmount);
      });

      results.push({
        date: new Date(dateStr).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        initialValue: totalInitial,
        currentValue: Math.round(totalCurrent),
      });
    });

    return results;
  })();

  const latestPerformance = (() => {
    if (investmentPerformanceData.length === 0) return null;
    const latest = investmentPerformanceData[investmentPerformanceData.length - 1];
    if (!latest || latest.initialValue === 0) return null;
    return {
      initial: latest.initialValue,
      current: latest.currentValue,
      returnPct: ((latest.currentValue - latest.initialValue) / latest.initialValue * 100).toFixed(2),
    };
  })();

  const latestReportPropertyId = (() => {
    for (const pid of investedPropertyIds) {
      const vals = valuationsByProperty[pid] || [];
      const withReport = vals.filter(v => v.reportUrl);
      if (withReport.length > 0) return pid;
    }
    return null;
  })();

  if (allLoading) {
    return (
      <Card className="mb-6 sm:mb-8 shadow-lg">
        <CardContent className="p-6 text-center text-slate-500">Loading performance data...</CardContent>
      </Card>
    );
  }

  if (valuationQueries.some(query => query.isError)) {
    return (
      <Card className="mb-6 sm:mb-8 shadow-lg">
        <CardContent className="space-y-3 p-6" role="alert">
          <p className="text-sm text-slate-700">Could not load performance data. Your holdings have not changed. Retry to view the valuation graphs.</p>
          <Button variant="outline" disabled={valuationQueries.some(query => query.isFetching)}
            onClick={() => void Promise.all(valuationQueries.filter(query => query.isError).map(query => query.refetch()))}>
            Retry performance data
          </Button>
        </CardContent>
      </Card>
    );
  }

  const hasAnyValuations = Object.values(valuationsByProperty).some(v => v.length > 0);

  if (!hasAnyValuations) {
    return (
      <Card className="mb-6 sm:mb-8 shadow-lg">
        <CardHeader className="border-b border-slate-200 p-4 sm:p-6">
          <CardTitle className="text-lg sm:text-xl flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-blue-600" />
            Investment Performance
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 text-center">
          <TrendingUp className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600">Performance data will appear here once property valuations are recorded.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Land Appreciation Graph */}
      {landAppreciationData.length > 0 && (
        <Card className="mb-6 sm:mb-8 shadow-lg">
          <CardHeader className="border-b border-slate-200 p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg sm:text-xl flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-green-600" />
                  Land Appreciation
                </CardTitle>
                <p className="text-sm text-slate-600 mt-1">Property value trends based on official valuations</p>
              </div>
              {latestAppreciation && (
                <Badge variant="outline" className={`${Number(latestAppreciation) >= 0 ? 'text-green-700 border-green-300 bg-green-50' : 'text-red-700 border-red-300 bg-red-50'}`}>
                  {Number(latestAppreciation) >= 0 ? '+' : ''}{latestAppreciation}% overall
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            <div className="h-64 sm:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={landAppreciationData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id={`${gradientId}-land`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" stroke="#64748b" style={{ fontSize: '12px' }} />
                  <YAxis stroke="#64748b" style={{ fontSize: '12px' }} tickFormatter={(v) => `₦${(v / 1000000).toFixed(0)}M`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                    formatter={(value: any) => [`₦${Number(value).toLocaleString()}`, 'Property Value']}
                    labelStyle={{ color: '#334155', fontWeight: 600 }}
                  />
                  <Area type="monotone" dataKey="value" stroke="#22c55e" strokeWidth={2} fillOpacity={1} fill={`url(#${gradientId}-land)`} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {latestReportPropertyId && (
              <div className="mt-4 pt-4 border-t border-slate-200">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-blue-700 border-blue-300 hover:bg-blue-50"
                  onClick={async () => {
                    const newTab = window.open('about:blank', '_blank');
                    try {
                      const res = await fetch(`/api/properties/${latestReportPropertyId}/valuation-report`, { credentials: 'include' });
                      if (res.status === 404) {
                        newTab?.close();
                        toast({ title: "No report available", description: "A valuation report has not been uploaded yet." });
                        return;
                      }
                      if (!res.ok) throw new Error('Failed to access report');
                      const data = await res.json();
                      if (newTab) { newTab.location.href = data.url; } else { window.location.href = data.url; }
                    } catch (error: any) {
                      newTab?.close();
                      toast({ title: "Error", description: error.message, variant: "destructive" });
                    }
                  }}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  View Valuation Report
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Investment Performance Graph */}
      {investmentPerformanceData.length > 0 && (
        <Card className="mb-6 sm:mb-8 shadow-lg">
          <CardHeader className="border-b border-slate-200 p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg sm:text-xl flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-blue-600" />
                  Investment Performance
                </CardTitle>
                <p className="text-sm text-slate-600 mt-1">Your investment value over time based on property valuations</p>
              </div>
              {latestPerformance && (
                <Badge variant="outline" className={`${Number(latestPerformance.returnPct) >= 0 ? 'text-green-700 border-green-300 bg-green-50' : 'text-red-700 border-red-300 bg-red-50'}`}>
                  {Number(latestPerformance.returnPct) >= 0 ? '+' : ''}{latestPerformance.returnPct}% return
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            <div className="h-64 sm:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={investmentPerformanceData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id={`${gradientId}-initial`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#94a3b8" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id={`${gradientId}-current`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" stroke="#64748b" style={{ fontSize: '12px' }} />
                  <YAxis stroke="#64748b" style={{ fontSize: '12px' }} tickFormatter={(v) => `${formatCurrency(v / 1000)}k`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                    formatter={(value: any, name: string) => [formatCurrency(Number(value)), name === 'initialValue' ? 'Land principal' : 'Current Value']}
                    labelStyle={{ color: '#334155', fontWeight: 600 }}
                  />
                  <Area type="monotone" dataKey="initialValue" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 4" fillOpacity={1} fill={`url(#${gradientId}-initial)`} />
                  <Area type="monotone" dataKey="currentValue" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill={`url(#${gradientId}-current)`} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            {latestPerformance && (
              <div className="mt-4 grid grid-cols-1 gap-3 pt-4 border-t border-slate-200 sm:grid-cols-3 sm:gap-4">
                <div>
                  <p className="text-xs text-slate-600">Land principal</p>
                  <p className="text-lg font-bold text-slate-900">{formatCurrency(latestPerformance.initial)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-600">Current Value</p>
                  <p className={`text-lg font-bold ${Number(latestPerformance.returnPct) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {formatCurrency(latestPerformance.current)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-600">Return</p>
                  <p className={`text-lg font-bold ${Number(latestPerformance.returnPct) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {Number(latestPerformance.returnPct) >= 0 ? '+' : ''}{latestPerformance.returnPct}%
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}

function PropertyUpdatesPanel({ propertyId, propertyName }: { propertyId: number; propertyName: string }) {
  const { data: updatesByProperty } = useQuery<Record<string, any[]>>({
    queryKey: ["/api/user/project-updates"],
  });
  const updates = (updatesByProperty?.[String(propertyId)] || []) as any[];
  const seenKey = `brikvest:updates-seen:${propertyId}`;
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    const v = localStorage.getItem(seenKey);
    return v ? parseInt(v, 10) || 0 : 0;
  });

  if (updates.length === 0) return null;

  const unseenCount = updates.filter((u) => new Date(u.sentAt || u.createdAt).getTime() > lastSeen).length;

  const TYPE_META: Record<string, { label: string; color: string }> = {
    construction: { label: "Construction", color: "bg-blue-100 text-blue-700" },
    sales:        { label: "Sales",        color: "bg-emerald-100 text-emerald-700" },
    financial:    { label: "Financial",    color: "bg-purple-100 text-purple-700" },
    delay:        { label: "Delay",        color: "bg-red-100 text-red-700" },
    general:      { label: "General",      color: "bg-slate-100 text-slate-700" },
  };

  const handleToggle = () => {
    if (!open && unseenCount > 0) {
      const now = Date.now();
      localStorage.setItem(seenKey, String(now));
      setLastSeen(now);
    }
    setOpen(!open);
  };

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden mb-3" data-testid={`updates-panel-${propertyId}`}>
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors"
        data-testid={`updates-toggle-${propertyId}`}
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Megaphone className="w-4 h-4 text-blue-600" />
          Project updates
          {unseenCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 text-[11px] font-bold rounded-full bg-red-600 text-white" data-testid={`updates-badge-${propertyId}`}>
              {unseenCount} new
            </span>
          )}
          <span className="text-xs font-normal text-slate-500">({updates.length} total)</span>
        </div>
        <span className="text-xs text-slate-500">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
          {updates.map((u: any) => {
            const meta = TYPE_META[u.type] || TYPE_META.general;
            const isNew = new Date(u.sentAt || u.createdAt).getTime() > lastSeen;
            return (
              <div key={u.id} className="p-3" data-testid={`update-${u.id}`}>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${meta.color}`}>{meta.label}</span>
                  {isNew && <span className="text-[10px] font-semibold text-red-600 uppercase tracking-wider">New</span>}
                  <span className="text-xs text-slate-500">{new Date(u.sentAt || u.createdAt).toLocaleDateString()}</span>
                </div>
                <h4 className="text-sm font-semibold text-slate-900 mb-1">{u.subject}</h4>
                <div
                  className="text-sm text-slate-700 prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: u.body }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConstructionProgressBar({ propertyId }: { propertyId: number }) {
  const { data: milestones } = useQuery<any[]>({
    queryKey: [`/api/user/property/${propertyId}/milestones`],
  });
  if (!milestones || milestones.length === 0) return null;
  const avgProgress = Math.round(
    milestones.reduce((sum, m) => sum + (m.percentComplete || 0), 0) / milestones.length
  );
  const activeMilestone = milestones.find((m) => m.status === "in_progress") || milestones.find((m) => m.status !== "done");
  return (
    <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-900">
          <Hammer className="h-3.5 w-3.5" />
          Construction Progress
        </div>
        <span className="text-xs font-bold text-blue-700">{avgProgress}%</span>
      </div>
      <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden">
        <div className="h-full bg-blue-600 transition-all" style={{ width: `${avgProgress}%` }} />
      </div>
      {activeMilestone && (
        <div className="text-xs text-blue-700 mt-1.5 truncate">
          Current phase: <span className="font-medium">{activeMilestone.name}</span>
        </div>
      )}
    </div>
  );
}

// (Project updates are now rendered per-holding via PropertyUpdatesPanel above.)

export default function Portfolio() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const { formatCurrency, userCurrency, convertAmount } = useCurrency();
  const { toast } = useToast();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pendingPaymentReservationId, setPendingPaymentReservationId] = useState<number | null>(null);
  const [legalFocusHoldingId, setLegalFocusHoldingId] = useState<number | null>(null);
  
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation(getDashboardLoginUrl(searchString));
    }
  }, [isLoading, isAuthenticated, setLocation, searchString]);

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const paymentFor = params.get("paymentFor");
    if (paymentFor) {
      const reservationId = parseInt(paymentFor, 10);
      if (!isNaN(reservationId)) {
        setPendingPaymentReservationId(reservationId);
      }
    }
  }, [searchString]);

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
  const [certificateModalOpen, setCertificateModalOpen] = useState(false);
  const [selectedReservationId, setSelectedReservationId] = useState<number | null>(null);
  const certificateRef = useRef<HTMLDivElement>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [selectedPaymentReservation, setSelectedPaymentReservation] = useState<(InvestmentReservation & { property?: Property }) | null>(null);
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
  const [uploadingPayment, setUploadingPayment] = useState(false);

  const [resaleModalOpen, setResaleModalOpen] = useState(false);
  const [resaleReservation, setResaleReservation] = useState<(InvestmentReservation & { property?: Property }) | null>(null);
  const [resaleForm, setResaleForm] = useState({
    units: "",
    sellingType: "fixed_price",
    askingPrice: "",
    minimumPrice: "",
  });
  const [submittingResale, setSubmittingResale] = useState(false);

  // Prefill KYC form with existing data when modal opens (for updates)
  useEffect(() => {
    if (kycModalOpen && user) {
      const userData = user as any;
      // Only prefill if user has existing KYC data
      if (userData.kycFullName) {
        setKycFormData({
          fullName: userData.kycFullName || '',
          dateOfBirth: userData.kycDateOfBirth ? new Date(userData.kycDateOfBirth).toISOString().split('T')[0] : '',
          address: userData.kycAddress || '',
          occupation: userData.kycOccupation || '',
          idType: userData.kycIdType || '',
          idNumber: userData.kycIdNumber || '',
        });
      }
    }
  }, [kycModalOpen, user]);

  // Fetch user's reservations with property details
  const { data: reservations = [], isLoading: holdingsLoading, isError: holdingsError, refetch: refetchHoldings } = useQuery<(InvestmentReservation & { property?: Property })[]>({
    queryKey: ["/api/user/reservations"],
    enabled: isAuthenticated,
  });

  const confirmedHoldings = reservations.filter(r => r.status === "converted_to_investment");
  const summaryPropertyIds = Array.from(new Set(confirmedHoldings.map(r => r.propertyId)));
  const summaryValuations = useQueries({
    queries: summaryPropertyIds.map(propertyValuationQuery),
  });
  const summaryLoading = holdingsLoading || summaryValuations.some(query => query.isLoading);
  const summaryError = holdingsError || summaryValuations.some(query => query.isError);
  // Match the final point in the overall investment-performance graph.
  const summaryDates = [
    ...confirmedHoldings.map(r => new Date(r.createdAt).toISOString().split("T")[0]),
    ...summaryValuations.flatMap(query => (query.data || []).map(v =>
      new Date(v.valuationDate).toISOString().split("T")[0])),
  ].sort();
  const summaryDate = summaryDates.at(-1);
  const currentPortfolioValue = summaryError || summaryLoading ? null : Math.round(
    confirmedHoldings.reduce((sum, holding) => sum + (summaryDate
      ? holdingValueAtDate(holding, summaryValuations[summaryPropertyIds.indexOf(holding.propertyId)]?.data || [], summaryDate, convertAmount)
      : 0), 0));
  const retrySummary = () => {
    if (holdingsError) void refetchHoldings();
    summaryValuations.filter(query => query.isError).forEach(query => void query.refetch());
  };

  useEffect(() => {
    const requestedHolding = new URLSearchParams(searchString).get("holding");
    const holdingId = requestedHolding ? Number(requestedHolding) : NaN;
    if (!Number.isInteger(holdingId) || holdingId <= 0) return;
    const target = reservations.find((reservation) => reservation.id === holdingId)
      || (reservations.filter((reservation) => reservation.propertyId === holdingId).length === 1
        ? reservations.find((reservation) => reservation.propertyId === holdingId)
        : undefined);
    if (!target) return;
    setLegalFocusHoldingId(holdingId);
    const timer = window.setTimeout(() => {
      document.getElementById(`holding-${target.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [searchString, reservations]);

  // Fetch user's payment submissions to show status and rejection reasons
  const { data: paymentSubmissions = [] } = useQuery<any[]>({
    queryKey: ["/api/user/payment-submissions"],
    enabled: isAuthenticated,
  });

  const { data: paymentInstructions, isLoading: paymentInstructionsLoading } = useQuery<any>({
    queryKey: ["/api/user/reservations", selectedPaymentReservation?.id, "payment-instructions"],
    queryFn: async () => {
      const response = await fetch(`/api/user/reservations/${selectedPaymentReservation!.id}/payment-instructions`, {
        credentials: "include",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Payment instructions are unavailable");
      return data;
    },
    enabled: paymentModalOpen && !!selectedPaymentReservation && (user as any)?.kycStatus === "approved",
    retry: false,
  });

  // Helper to get the latest payment submission for a reservation
  const getPaymentSubmission = (reservationId: number) => {
    return paymentSubmissions.find(ps => ps.reservationId === reservationId);
  };

  // Fetch certificate for selected reservation
  const { data: certificateData, isLoading: certificateLoading } = useQuery<{
    certificate: OwnershipCertificate;
    property: { id: number; name: string; location: string; imageUrl: string } | null;
    verificationUrl: string;
  }>({
    queryKey: [`/api/user/certificates/${selectedReservationId}`],
    enabled: !!selectedReservationId && certificateModalOpen,
  });

  const { data: myResaleListings = [] } = useQuery<any[]>({
    queryKey: ["/api/resale-listings/mine"],
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (pendingPaymentReservationId && reservations.length > 0) {
      const reservation = reservations.find(r => r.id === pendingPaymentReservationId);
      if (reservation && reservation.status === 'reserved' && (user as any)?.kycStatus === 'approved') {
        setSelectedPaymentReservation(reservation);
        setPaymentModalOpen(true);
        setPendingPaymentReservationId(null);
        const params = new URLSearchParams(searchString);
        params.delete("paymentFor");
        const newSearch = params.toString();
        setLocation(`/dashboard${newSearch ? `?${newSearch}` : ''}`, { replace: true });
      } else if (reservation && reservation.status !== 'reserved') {
        toast({
          title: "Reservation Status Changed",
          description: "This reservation is no longer awaiting payment.",
        });
        setPendingPaymentReservationId(null);
      } else if (reservation) {
        toast({
          title: "KYC Approval Required",
          description: "Payment details will be available after your KYC is approved.",
        });
        setPendingPaymentReservationId(null);
      }
    }
  }, [pendingPaymentReservationId, reservations, setLocation, searchString, toast, user]);

  const handleOpenPaymentModal = useCallback(async (reservation: InvestmentReservation & { property?: Property }) => {
    try {
      const response = await fetch("/api/auth/user", { credentials: "include" });
      if (!response.ok) {
        toast({
          title: "Session Expired",
          description: "Please sign in again to continue with your payment.",
        });
        const redirectUrl = `/dashboard?paymentFor=${reservation.id}`;
        setLocation(`/login?redirect=${encodeURIComponent(redirectUrl)}`);
        return;
      }
      const freshUser = await response.json();
      if (freshUser.kycStatus !== "approved") {
        toast({
          title: "KYC Approval Required",
          description: freshUser.kycStatus === "submitted"
            ? "Your KYC is under review. Payment details will be available after approval."
            : freshUser.kycStatus === "rejected"
              ? "Please resubmit your KYC and wait for approval before paying."
              : "Complete KYC and wait for approval before paying.",
          variant: "destructive",
        });
        return;
      }
      setSelectedPaymentReservation(reservation);
      setPaymentModalOpen(true);
    } catch (error) {
      toast({
        title: "Connection Error",
        description: "Please check your connection and try again.",
        variant: "destructive",
      });
    }
  }, [setLocation, toast]);

  const handleViewCertificate = (reservationId: number) => {
    setSelectedReservationId(reservationId);
    setCertificateModalOpen(true);
  };

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
    
    const userData = user as any;
    const hasExistingIdDocument = !!userData?.kycIdDocumentUrl;
    const hasExistingSignature = !!userData?.kycSignatureUrl;
    
    // Validation
    if (!kycFormData.fullName || !kycFormData.dateOfBirth || !kycFormData.address || !kycFormData.occupation || !kycFormData.idType || !kycFormData.idNumber) {
      toast({
        title: "Missing Information",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }

    // ID document is only required if user doesn't already have one
    if (!idDocumentFile && !hasExistingIdDocument) {
      toast({
        title: "ID Document Required",
        description: "Please upload your government-issued ID document.",
        variant: "destructive",
      });
      return;
    }

    // Signature is only required if user doesn't already have one
    if (!signatureFile && !hasExistingSignature) {
      toast({
        title: "Signature Required",
        description: "Please upload an image of your signature.",
        variant: "destructive",
      });
      return;
    }

    // Validate ID document file type and size (only if a new file is provided)
    const allowedDocumentTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
    const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    
    if (idDocumentFile) {
      if (!allowedDocumentTypes.includes(idDocumentFile.type)) {
        toast({
          title: "Invalid ID Document File",
          description: "ID document must be a JPG, PNG, WEBP, HEIC, or PDF file.",
          variant: "destructive",
        });
        return;
      }

      // Validate ID document file size (max 10MB)
      const maxIdDocumentSize = 10 * 1024 * 1024; // 10MB
      if (idDocumentFile.size > maxIdDocumentSize) {
        toast({
          title: "ID Document File Too Large",
          description: "ID document must be less than 10MB.",
          variant: "destructive",
        });
        return;
      }
    }

    // Validate signature file type and size (only if a new file is provided)
    if (signatureFile) {
      if (!allowedImageTypes.includes(signatureFile.type)) {
        toast({
          title: "Invalid Signature File",
          description: "Signature must be a JPG, PNG, WEBP, or HEIC image.",
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
      
      // Only append files if they're provided (allows updating without re-uploading)
      if (idDocumentFile) {
        formData.append('idDocument', idDocumentFile);
      }
      if (signatureFile) {
        formData.append('signature', signatureFile);
      }
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

  const handlePaymentProofUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedPaymentReservation || !paymentProofFile) {
      toast({
        title: "Missing Information",
        description: "Please select a payment proof file to upload.",
        variant: "destructive",
      });
      return;
    }

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowedTypes.includes(paymentProofFile.type)) {
      toast({
        title: "Invalid File Type",
        description: "Please upload a JPEG, PNG, WEBP, or PDF file.",
        variant: "destructive",
      });
      return;
    }

    const maxSize = 10 * 1024 * 1024;
    if (paymentProofFile.size > maxSize) {
      toast({
        title: "File Too Large",
        description: "File size must be less than 10MB.",
        variant: "destructive",
      });
      return;
    }

    setUploadingPayment(true);

    try {
      const formData = new FormData();
      formData.append('reservationId', selectedPaymentReservation.id.toString());
      formData.append('paymentProof', paymentProofFile);

      const response = await fetch('/api/user/payment-submission', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Payment proof upload failed');
      }

      toast({
        title: "Payment Proof Submitted",
        description: "Your payment proof is now pending admin review.",
      });

      queryClient.invalidateQueries({ queryKey: ["/api/user/reservations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/payment-submissions"] });
      
      setPaymentModalOpen(false);
      setSelectedPaymentReservation(null);
      setPaymentProofFile(null);
    } catch (error: any) {
      console.error('Payment upload error:', error);
      toast({
        title: "Upload Failed",
        description: error.message || "There was an error uploading your payment proof. Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploadingPayment(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-slate-600">Loading your portfolio...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-slate-600">Redirecting to sign in...</p>
        </div>
      </div>
    );
  }

  const userData = user as any;
  const dashboardSection = getDashboardSection(searchString);

  const navigateToSection = (section: DashboardSection) => {
    setMobileMenuOpen(false);
    setLocation(getDashboardSectionUrl(section));
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  };
  
  // Only count converted investments in total portfolio value
  const totalInvested = reservations
    .filter(res => res.status === 'converted_to_investment')
    .reduce((sum, res) => {
      // Portfolio principal is land only; recorded payment totals remain unchanged.
      const reservationAmount = portfolioLandAmount(res);
      if (reservationAmount === null) return sum;
      const reservationCurrency = res.currency || 'NGN';
      const convertedAmount = convertAmount(reservationAmount, reservationCurrency);
      return sum + convertedAmount;
    }, 0);
  const unclassifiedInvestments = reservations.filter(res =>
    res.status === "converted_to_investment" && portfolioLandAmount(res) === null).length;
  
  // Active reservations are those awaiting payment proof submission
  const activeReservations = reservations.filter(r => 
    r.status === "reserved"
  ).length;
  
  // Completed investments are fully converted
  const completedInvestments = reservations.filter(r => r.status === "converted_to_investment").length;
  const isKycVerified = userData.kycStatus === 'approved';
  
  // Check if KYC needs update (missing new required fields)
  const needsKycUpdate = userData.kycStatus !== 'approved' && userData.kycStatus !== 'submitted' &&
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
            <Link href="/">
              <img src={brikvest_logo} alt="Brikvest" className="h-8 cursor-pointer" />
            </Link>
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
            <button
              onClick={() => navigateToSection("portfolio")}
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg font-medium w-full text-left transition-colors ${dashboardSection === "portfolio" ? "bg-blue-50 text-blue-600" : "text-slate-600 hover:bg-slate-50"}`}
              data-testid="nav-portfolio"
            >
              <PieChart className="h-5 w-5" />
              <span>Portfolio</span>
            </button>
            <button
              onClick={() => navigateToSection("properties")}
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors w-full text-left ${dashboardSection === "properties" ? "bg-blue-50 text-blue-600 font-medium" : "text-slate-600 hover:bg-slate-50"}`}
              data-testid="nav-properties"
            >
              <Building2 className="h-5 w-5" />
              <span>Browse Properties</span>
            </button>
            <button
              onClick={() => navigateToSection("insights")}
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors w-full text-left ${dashboardSection === "insights" ? "bg-blue-50 text-blue-600 font-medium" : "text-slate-600 hover:bg-slate-50"}`}
              data-testid="nav-insights"
            >
              <TrendingUp className="h-5 w-5" />
              <span>Market Insights</span>
            </button>
            
            {/* Currency Selector - Mobile */}
            <div className="px-4 py-3">
              <p className="text-xs text-slate-500 mb-2">Display Currency</p>
              <CurrencySelector />
            </div>
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

              {/* Currency Selector */}
              <div className="hidden sm:block">
                <CurrencySelector compact />
              </div>

              {/* New Investment Button */}
              <Button
                onClick={() => navigateToSection("properties")}
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
        {!needsKycUpdate && userData.kycStatus !== 'approved' && (
          <div className="sticky top-[73px] z-20 bg-blue-600 text-white shadow-md">
            <div className="px-4 sm:px-6 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <AlertCircle className="h-5 w-5 flex-shrink-0" />
                  <p className="text-sm">
                    {userData.kycStatus === 'not_started' && 'Complete identity verification to view your investment details'}
                    {userData.kycStatus === 'submitted' && 'Your verification is under review (1-2 business days)'}
                    {userData.kycStatus === 'rejected' && (
                      <>
                        Please resubmit your verification documents
                        {userData.kycRejectionReason && (
                          <span className="block mt-1 text-xs opacity-90">
                            Reason: {userData.kycRejectionReason}
                          </span>
                        )}
                      </>
                    )}
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

        {/* Dashboard section content */}
        {dashboardSection === "properties" ? (
          <main className="max-w-7xl mx-auto">
            <PropertyBrowsingContent embedded dashboardReturnPath="/dashboard" />
          </main>
        ) : dashboardSection === "insights" ? (
          <main className="max-w-7xl mx-auto">
            <MarketInsightsContent embedded dashboardReturnPath="/dashboard?section=properties" />
          </main>
        ) : (
        <main className="p-4 sm:p-6 max-w-7xl mx-auto">
          {/* Portfolio Header */}
          <div className="mb-6">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">My Portfolio</h1>
            <p className="text-slate-600 mt-1">Track and manage your real estate investments</p>
          </div>
          {/* Pending Payment Banner */}
          {(() => {
            const pendingReservations = reservations.filter(r => r.status === 'reserved');
            if (pendingReservations.length === 0) return null;
            const firstPending = pendingReservations[0];
            return (
              <div className="mb-6 rounded-xl border-2 border-amber-300 bg-gradient-to-r from-amber-50 to-yellow-50 shadow-md overflow-hidden" data-testid="banner-pending-payment">
                <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                  <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0">
                      <Clock className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm sm:text-base font-bold text-amber-900">
                        {pendingReservations.length === 1
                          ? "You have a pending payment"
                          : `You have ${pendingReservations.length} pending payments`}
                      </h3>
                      <p className="text-xs sm:text-sm text-amber-800 mt-0.5 line-clamp-2">
                        Complete your payment{pendingReservations.length > 1 ? 's' : ''} to confirm your investment{pendingReservations.length > 1 ? 's' : ''} and secure your unit{pendingReservations.length > 1 ? 's' : ''}.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 sm:flex-shrink-0">
                    <Button
                      onClick={() => handleOpenPaymentModal(firstPending)}
                      className="flex-1 sm:flex-initial bg-amber-600 hover:bg-amber-700 text-white font-semibold shadow-sm"
                      data-testid="button-banner-make-payment"
                    >
                      Make Payment
                    </Button>
                    {pendingReservations.length > 1 && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          document.getElementById('pending-reservations-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }}
                        className="border-amber-400 text-amber-800 hover:bg-amber-100"
                        data-testid="button-banner-view-all"
                      >
                        View All
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-8">
            <PortfolioValueCards
              currentValue={currentPortfolioValue}
              invested={totalInvested}
              isLoading={summaryLoading}
              isError={summaryError}
              investedLoading={holdingsLoading}
              investedError={holdingsError}
              onRetry={retrySummary}
              isVerified={isKycVerified}
              unclassifiedCount={unclassifiedInvestments}
              formatCurrency={formatCurrency}
            />

            <Card className="shadow-lg hover:shadow-xl transition-all border-0 bg-white relative" data-testid="card-active-reservations">
              <CardContent className="p-4 sm:p-6">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs sm:text-sm text-slate-600 mb-1 font-medium">Properties Owned</p>
                    <p className={`text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900 ${!isKycVerified ? 'blur-md select-none' : ''}`}>
                      {new Set(reservations.filter(r => r.status === 'converted_to_investment').map(r => r.propertyId)).size}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {activeReservations} pending
                    </p>
                  </div>
                  <div className="w-10 h-10 sm:w-12 sm:h-12 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                    <Building2 className="h-5 w-5 sm:h-6 sm:w-6 text-amber-600" />
                  </div>
                </div>
                {!isKycVerified && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-[2px]">
                    <ShieldCheck className="h-6 w-6 text-slate-400" />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-lg hover:shadow-xl transition-all border-0 bg-white relative" data-testid="card-completed">
              <CardContent className="p-4 sm:p-6">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs sm:text-sm text-slate-600 mb-1 font-medium">Total Investments</p>
                    <p className={`text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900 ${!isKycVerified ? 'blur-md select-none' : ''}`}>
                      {reservations.length}
                    </p>
                    <p className="text-xs text-emerald-600 mt-1 font-medium">
                      {completedInvestments} confirmed
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

          {/* Pending Reservations - moved up so payment action is above the fold */}
          {(() => {
            const pendingReservations = reservations.filter(r => 
              r.status === 'reserved'
            );
            
            if (pendingReservations.length > 0) {
              return (
                <Card id="pending-reservations-section" className="mb-6 sm:mb-8 shadow-lg border-yellow-200 scroll-mt-24">
                  <CardHeader className="border-b border-yellow-200 bg-yellow-50 p-4 sm:p-6">
                    <CardTitle className="text-lg sm:text-xl flex items-center gap-2">
                      <Clock className="h-5 w-5 text-yellow-600" />
                      Pending Reservations
                    </CardTitle>
                    <p className="text-sm text-slate-600 mt-1">Make payment and upload proof to confirm your investments</p>
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
                                <p>Amount: {formatCurrency(convertAmount(
                                  typeof reservation.amount === 'string' ? parseFloat(reservation.amount) : (reservation.amount || 0),
                                  reservation.currency || 'NGN'
                                ))}</p>
                                <p className="text-xs text-slate-500">
                                  Created {new Date(reservation.createdAt).toLocaleDateString()}
                                </p>
                              </div>
                            </div>
                            <span className="px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap self-start bg-yellow-100 text-yellow-700">
                              Awaiting Payment
                            </span>
                          </div>
                          
                          {(() => {
                            const paymentSub = getPaymentSubmission(reservation.id);
                            
                            if (paymentSub?.status === 'pending_admin_review') {
                              return (
                                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                  <p className="text-sm font-medium text-blue-900 mb-2">Payment Proof Under Review</p>
                                  <p className="text-xs text-blue-700">
                                    Your payment proof has been submitted and is pending admin review. You'll be notified once it's approved.
                                  </p>
                                </div>
                              );
                            }
                            
                            if (paymentSub?.status === 'rejected') {
                              return (
                                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                                  <p className="text-sm font-medium text-red-900 mb-2">Payment Proof Rejected</p>
                                  {paymentSub.rejectionReason && (
                                    <p className="text-xs text-red-700 bg-white p-2 rounded mb-3 border border-red-100">
                                      <strong>Reason:</strong> {paymentSub.rejectionReason}
                                    </p>
                                  )}
                                  <p className="text-xs text-red-700 mb-3">
                                    Please upload a new payment proof to continue.
                                  </p>
                                  <Button 
                                    size="sm" 
                                    className="w-full sm:w-auto bg-red-600 hover:bg-red-700"
                                    onClick={() => handleOpenPaymentModal(reservation)}
                                  >
                                    Re-upload Payment Proof
                                  </Button>
                                </div>
                              );
                            }
                            
                            if (isKycVerified) {
                              return (
                                <div className="mt-4 p-3 bg-white border border-green-200 rounded-lg">
                                  <p className="text-sm font-medium text-green-900 mb-2">Ready to Make Payment</p>
                                  <p className="text-xs text-green-700 mb-3">
                                    Your KYC is approved. Make your payment and upload proof to complete this investment.
                                  </p>
                                  <Button 
                                    size="sm" 
                                    className="w-full sm:w-auto"
                                    onClick={() => handleOpenPaymentModal(reservation)}
                                  >
                                    Make Payment
                                  </Button>
                                </div>
                              );
                            }
                            
                            return null;
                          })()}
                          
                          {!isKycVerified && !getPaymentSubmission(reservation.id) && userData.kycStatus === 'rejected' ? (
                            <div className="mt-4 p-3 bg-white border border-red-200 rounded-lg">
                              <p className="text-sm font-medium text-red-900 mb-2">KYC Verification Required</p>
                              <p className="text-xs text-red-700 mb-2">
                                Your KYC was rejected. Please resubmit your verification documents to proceed with payment.
                              </p>
                              {userData.kycRejectionReason && (
                                <p className="text-xs text-red-600 bg-red-50 p-2 rounded mb-3 border border-red-100">
                                  <strong>Reason:</strong> {userData.kycRejectionReason}
                                </p>
                              )}
                              <Button 
                                size="sm" 
                                variant="outline"
                                className="w-full sm:w-auto border-red-200 text-red-700 hover:bg-red-50"
                                onClick={() => setKycModalOpen(true)}
                              >
                                Resubmit KYC
                              </Button>
                            </div>
                          ) : userData.kycStatus === 'submitted' ? (
                            <div className="mt-4 p-3 bg-white border border-blue-200 rounded-lg">
                              <p className="text-sm font-medium text-blue-900 mb-2">KYC Under Review</p>
                              <p className="text-xs text-blue-700">
                                Your KYC documents are being reviewed. You'll be able to upload payment proof once approved.
                              </p>
                            </div>
                          ) : (
                            <div className="mt-4 p-3 bg-white border border-yellow-200 rounded-lg">
                              <p className="text-sm font-medium text-slate-900 mb-2">Complete KYC First</p>
                              <p className="text-xs text-slate-600 mb-3">
                                You must complete KYC verification and get approval before uploading payment proof.
                              </p>
                              <Button 
                                size="sm" 
                                variant="outline"
                                className="w-full sm:w-auto"
                                onClick={() => setKycModalOpen(true)}
                              >
                                Start KYC Verification
                              </Button>
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

          {/* Valuation-Driven Performance Charts */}
          {isKycVerified && reservations.filter(r => r.status === 'converted_to_investment').length > 0 && (
            <>
              <section aria-label="Overall portfolio performance" data-testid="overall-portfolio-performance">
                <h2 className="mb-4 text-lg font-semibold text-slate-900 sm:text-xl">Overall portfolio performance</h2>
                <InvestmentPerformanceCharts
                  reservations={reservations}
                  formatCurrency={formatCurrency}
                  convertAmount={convertAmount}
                  totalInvested={totalInvested}
                  toast={toast}
                />
              </section>
              <AssetPerformanceSection
                assets={Array.from(new Set(reservations.filter(holding => holding.status === "converted_to_investment").map(holding => holding.propertyId)))
                  .map(id => ({ id, name: reservations.find(holding => holding.propertyId === id)?.property?.name || `Property #${id}` }))}
                renderCharts={(propertyId) => {
                  const assetHoldings = reservations.filter(holding => holding.propertyId === propertyId && holding.status === "converted_to_investment");
                  return <InvestmentPerformanceCharts
                    reservations={assetHoldings}
                    formatCurrency={formatCurrency}
                    convertAmount={convertAmount}
                    totalInvested={summarizeLandPortfolio(assetHoldings, convertAmount).totalPortfolioValue}
                    toast={toast}
                  />;
                }}
              />
            </>
          )}

          {/* My Holdings */}
          {(() => {
            const confirmedInvestments = reservations.filter(r => r.status === 'converted_to_investment');
            
            return (
              <Card className="mb-6 sm:mb-8 shadow-lg">
                <CardHeader className="border-b border-slate-200 p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg sm:text-xl">My Property Holdings</CardTitle>
                      <p className="text-sm text-slate-600 mt-1">Your confirmed real estate investments</p>
                    </div>
                    <div className="flex flex-wrap gap-2 self-start sm:self-auto">
                      <Button
                        variant="ghost"
                        onClick={() => setLocation('/marketplace')}
                        className="text-purple-600 hover:text-purple-700 text-sm"
                      >
                        <Tag className="h-4 w-4 mr-1" />
                        Marketplace
                      </Button>
                      {reservations.length > 0 && (
                        <Button
                          variant="ghost"
                          onClick={() => navigateToSection("properties")}
                          className="text-blue-600 hover:text-blue-700 text-sm"
                        >
                          View All Properties
                          <ArrowRight className="h-4 w-4 ml-2" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4 sm:p-6">
                  {confirmedInvestments.length === 0 ? (
                    <div className="text-center py-8 sm:py-12">
                      <Building2 className="h-12 w-12 sm:h-16 sm:w-16 text-slate-300 mx-auto mb-4" />
                      <h3 className="text-base sm:text-lg font-semibold text-slate-900 mb-2">No confirmed investments yet</h3>
                      <p className="text-sm sm:text-base text-slate-600 mb-6">Start building your real estate portfolio today</p>
                      <Button
                        onClick={() => navigateToSection("properties")}
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                        data-testid="button-browse-properties"
                      >
                        Browse Properties
                      </Button>
                    </div>
                  ) : (
                    <div className="grid gap-4 sm:gap-6">
                      {confirmedInvestments.map((reservation) => (
                        <div
                          key={reservation.id}
                          className="bg-white border border-slate-200 rounded-xl overflow-hidden hover:shadow-lg transition-all duration-200"
                          data-testid={`holding-${reservation.id}`}
                        >
                          <div className="flex flex-col md:flex-row">
                            {/* Property Image */}
                            <div className="md:w-48 h-40 md:h-auto bg-gradient-to-br from-blue-100 to-blue-50 flex-shrink-0">
                              {reservation.property?.imageUrl ? (
                                <img 
                                  src={reservation.property.imageUrl} 
                                  alt={reservation.property.name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <Building2 className="h-12 w-12 text-blue-300" />
                                </div>
                              )}
                            </div>
                            
                            {/* Property Details */}
                            <div className="flex-1 p-4 sm:p-5">
                              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
                                <div>
                                  <div className="flex items-center gap-2 mb-1">
                                    <h4 className="font-bold text-slate-900 text-lg">
                                      {reservation.property?.name || `Property #${reservation.propertyId}`}
                                    </h4>
                                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                                      Active
                                    </span>
                                  </div>
                                  {reservation.property?.location && (
                                    <p className="text-sm text-slate-500">{reservation.property.location}</p>
                                  )}
                                </div>
                              </div>
                              
                              {/* Construction progress (only shows if property has milestones) */}
                              <ConstructionProgressBar propertyId={reservation.propertyId} />

                              {/* Project updates from developer (collapsible) */}
                              <PropertyUpdatesPanel propertyId={reservation.propertyId} propertyName={reservation.property?.name || ""} />

                              {/* Investment Stats */}
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
                                <div className="bg-slate-50 rounded-lg p-3">
                                  <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Units Owned</p>
                                  <p className="text-lg font-bold text-slate-900">{reservation.units}</p>
                                </div>
                                <div className="bg-slate-50 rounded-lg p-3">
                                  <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Land cost</p>
                                  <p className="text-lg font-bold text-blue-600">
                                    {portfolioLandAmount(reservation) === null ? "Not recorded" : formatCurrency(convertAmount(
                                      portfolioLandAmount(reservation)!,
                                      reservation.currency || 'NGN'
                                    ))}
                                  </p>
                                  <p className="text-xs text-slate-500 mt-1">
                                    Total paid including fees: {formatCurrency(convertAmount(Number(reservation.amount), reservation.currency || "NGN"))}
                                  </p>
                                </div>
                                <div className="bg-slate-50 rounded-lg p-3 col-span-2 sm:col-span-1">
                                  <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Confirmed</p>
                                  <p className="text-sm font-semibold text-slate-700">
                                    {new Date(reservation.createdAt).toLocaleDateString('en-US', {
                                      year: 'numeric',
                                      month: 'short',
                                      day: 'numeric'
                                    })}
                                  </p>
                                </div>
                              </div>
                              
                              {/* Actions */}
                              <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleViewCertificate(reservation.id)}
                                  className="text-amber-700 border-amber-300 hover:bg-amber-50"
                                  data-testid={`button-view-certificate-${reservation.id}`}
                                >
                                  <Award className="h-4 w-4 mr-2" />
                                  View Certificate
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={async () => {
                                    const newTab = window.open('about:blank', '_blank');
                                    try {
                                      const res = await fetch(`/api/properties/${reservation.propertyId}/valuation-report`, { credentials: 'include' });
                                      if (res.status === 404) {
                                        newTab?.close();
                                        toast({ title: "No valuation report", description: "A valuation report has not been uploaded for this property yet." });
                                        return;
                                      }
                                      if (!res.ok) {
                                        const data = await res.json();
                                        throw new Error(data.error || 'Failed to access report');
                                      }
                                      const data = await res.json();
                                      if (newTab) { newTab.location.href = data.url; } else { window.location.href = data.url; }
                                    } catch (error: any) {
                                      newTab?.close();
                                      toast({ title: "Error", description: error.message, variant: "destructive" });
                                    }
                                  }}
                                  className="text-blue-700 border-blue-300 hover:bg-blue-50"
                                >
                                  <FileText className="h-4 w-4 mr-2" />
                                  Valuation Report
                                </Button>
                                {reservation.property?.isTransferable && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setResaleReservation(reservation);
                                      setResaleForm({
                                        units: "",
                                        sellingType: "fixed_price",
                                        askingPrice: "",
                                        minimumPrice: "",
                                      });
                                      setResaleModalOpen(true);
                                    }}
                                    className="text-purple-700 border-purple-300 hover:bg-purple-50"
                                  >
                                    <Tag className="h-4 w-4 mr-2" />
                                    Sell Units
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    if (reservation.property) {
                                      setLocation(`/properties/${reservation.propertyId}`);
                                    }
                                  }}
                                  className="text-slate-600 hover:text-slate-900"
                                >
                                  Property Details
                                  <ArrowRight className="h-4 w-4 ml-1" />
                                </Button>
                              </div>
                              <InvestorLegalDocuments
                                reservationId={reservation.id}
                                focus={legalFocusHoldingId === reservation.id || legalFocusHoldingId === reservation.propertyId}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {/* My Resale Listings */}
          {myResaleListings.length > 0 && (
            <Card className="mb-6 sm:mb-8 shadow-lg">
              <CardHeader className="border-b border-slate-200 p-4 sm:p-6">
                <CardTitle className="text-lg sm:text-xl flex items-center gap-2">
                  <Tag className="h-5 w-5 text-purple-600" />
                  My Resale Listings
                </CardTitle>
                <p className="text-sm text-slate-600 mt-1">Track the status of your unit resale listings</p>
              </CardHeader>
              <CardContent className="p-4 sm:p-6">
                <div className="space-y-3">
                  {myResaleListings.map((listing: any) => {
                    const property = reservations.find((r: any) => r.id === listing.reservationId)?.property;
                    const statusConfig: Record<string, { label: string; color: string }> = {
                      pending_review: { label: "Pending Review", color: "bg-yellow-100 text-yellow-800" },
                      approved: { label: "Live", color: "bg-green-100 text-green-700" },
                      rejected: { label: "Rejected", color: "bg-red-100 text-red-700" },
                      sold: { label: "Sold", color: "bg-blue-100 text-blue-700" },
                      cancelled: { label: "Cancelled", color: "bg-slate-100 text-slate-600" },
                    };
                    const statusInfo = statusConfig[listing.status] || { label: listing.status, color: "bg-slate-100 text-slate-600" };

                    return (
                      <div key={listing.id} className="border border-slate-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-semibold text-slate-900">{property?.name || `Property #${listing.propertyId}`}</h4>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusInfo.color}`}>
                              {statusInfo.label}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-4 text-sm text-slate-600">
                            <span>{listing.units} units</span>
                            <span className="flex items-center gap-1">
                              {listing.sellingType === "fixed_price" ? (
                                <><Tag className="h-3.5 w-3.5" /> Fixed: {formatCurrency(convertAmount(parseFloat(listing.askingPrice || 0), listing.currency || 'NGN'))}</>
                              ) : (
                                <><Gavel className="h-3.5 w-3.5" /> Auction{listing.minimumPrice ? ` (Min: ${formatCurrency(convertAmount(parseFloat(listing.minimumPrice), listing.currency || 'NGN'))})` : ""}</>
                              )}
                            </span>
                            <span>Listed {new Date(listing.createdAt).toLocaleDateString()}</span>
                          </div>
                          {listing.status === "rejected" && listing.adminReviewNote && (
                            <p className="text-sm text-red-600 mt-1">Reason: {listing.adminReviewNote}</p>
                          )}
                        </div>
                        <div className="flex gap-2 self-start flex-wrap">
                          {listing.status === "approved" && listing.shareToken && (
                            <div className="flex gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-emerald-600 border-emerald-300 hover:bg-emerald-50"
                                onClick={() => {
                                  const url = `${window.location.origin}/listing/${listing.shareToken}`;
                                  navigator.clipboard.writeText(url);
                                  toast({ title: "Link copied!", description: "Share this link with potential buyers." });
                                }}
                              >
                                <Copy className="h-4 w-4 mr-1" />
                                Copy Link
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-green-600 border-green-300 hover:bg-green-50"
                                onClick={() => {
                                  const url = `${window.location.origin}/listing/${listing.shareToken}`;
                                  const text = `Check out this investment opportunity on Brikvest: ${property?.name || "Property"} - ${listing.units} units`;
                                  window.open(`https://wa.me/?text=${encodeURIComponent(text + " " + url)}`, "_blank");
                                }}
                              >
                                <Share2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                          {["pending_review", "approved"].includes(listing.status) && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-red-600 border-red-300 hover:bg-red-50"
                              onClick={async () => {
                                try {
                                  await apiRequest("POST", `/api/resale-listings/${listing.id}/cancel`);
                                  queryClient.invalidateQueries({ queryKey: ["/api/resale-listings/mine"] });
                                  toast({ title: "Listing cancelled", description: "Your units have been unlocked." });
                                } catch (error: any) {
                                  toast({ title: "Error", description: error?.message || "Failed to cancel", variant: "destructive" });
                                }
                              }}
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              Cancel
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </main>
        )}
      </div>

      {/* Resale Listing Modal */}
      <Dialog open={resaleModalOpen} onOpenChange={setResaleModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Tag className="h-5 w-5 text-purple-600" />
              List Units for Resale
            </DialogTitle>
            <DialogDescription>
              {resaleReservation?.property?.name} — You own {resaleReservation?.units} units
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {(() => {
              const existingListings = myResaleListings.filter(
                (l: any) => l.reservationId === resaleReservation?.id && ["pending_review", "approved"].includes(l.status)
              );
              const lockedUnits = existingListings.reduce((sum: number, l: any) => sum + parseFloat(l.units), 0);
              const totalOwned = parseFloat(resaleReservation?.units || "0");
              const availableUnits = totalOwned - lockedUnits;

              return (
                <>
                  {lockedUnits > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                      {lockedUnits} units already listed. {availableUnits} units available to list.
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Units to Sell *</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={availableUnits}
                      placeholder={`Max ${availableUnits}`}
                      value={resaleForm.units}
                      onChange={(e) => setResaleForm(prev => ({ ...prev, units: e.target.value }))}
                    />
                    <p className="text-xs text-slate-500">Up to {availableUnits} units available</p>
                  </div>
                </>
              );
            })()}

            <div className="space-y-2">
              <Label>Selling Type *</Label>
              <Select value={resaleForm.sellingType} onValueChange={(value) => setResaleForm(prev => ({ ...prev, sellingType: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed_price">Fixed Price</SelectItem>
                  <SelectItem value="bidding">Bidding (Auction)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {resaleForm.sellingType === "fixed_price" && (
              <div className="space-y-2">
                <Label>Asking Price ({resaleReservation?.currency || "NGN"}) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Enter your asking price"
                  value={resaleForm.askingPrice}
                  onChange={(e) => setResaleForm(prev => ({ ...prev, askingPrice: e.target.value }))}
                />
              </div>
            )}

            {resaleForm.sellingType === "bidding" && (
              <div className="space-y-2">
                <Label>Minimum Price / Reserve ({resaleReservation?.currency || "NGN"})</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Optional — minimum acceptable bid"
                  value={resaleForm.minimumPrice}
                  onChange={(e) => setResaleForm(prev => ({ ...prev, minimumPrice: e.target.value }))}
                />
                <p className="text-xs text-slate-500">Leave empty for no reserve price</p>
              </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
              Your listed units will be locked and unavailable for other actions until the listing is sold or cancelled. Listings require admin approval before going live.
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setResaleModalOpen(false)}>
                Cancel
              </Button>
              <Button
                className="bg-purple-600 hover:bg-purple-700 text-white"
                disabled={submittingResale}
                onClick={async () => {
                  if (!resaleReservation) return;
                  const unitsVal = parseFloat(resaleForm.units);
                  if (!unitsVal || unitsVal <= 0) {
                    toast({ title: "Invalid units", description: "Please enter a valid number of units", variant: "destructive" });
                    return;
                  }
                  if (resaleForm.sellingType === "fixed_price" && (!resaleForm.askingPrice || parseFloat(resaleForm.askingPrice) <= 0)) {
                    toast({ title: "Price required", description: "Please enter an asking price", variant: "destructive" });
                    return;
                  }
                  setSubmittingResale(true);
                  try {
                    await apiRequest("POST", "/api/resale-listings", {
                      reservationId: resaleReservation.id,
                      units: resaleForm.units,
                      sellingType: resaleForm.sellingType,
                      askingPrice: resaleForm.sellingType === "fixed_price" ? resaleForm.askingPrice : null,
                      minimumPrice: resaleForm.sellingType === "bidding" && resaleForm.minimumPrice ? resaleForm.minimumPrice : null,
                    });
                    queryClient.invalidateQueries({ queryKey: ["/api/resale-listings/mine"] });
                    toast({ title: "Listing submitted", description: "Your resale listing has been submitted for admin review." });
                    setResaleModalOpen(false);
                  } catch (error: any) {
                    const msg = error?.message || "Failed to create listing";
                    toast({ title: "Error", description: msg, variant: "destructive" });
                  } finally {
                    setSubmittingResale(false);
                  }
                }}
              >
                {submittingResale ? "Submitting..." : "Submit Listing"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
                  Upload ID Document {!((user as any)?.kycIdDocumentUrl) && <span className="text-red-500">*</span>}
                </Label>
                <div className="mt-1">
                  {((user as any)?.kycIdDocumentUrl) && (
                    <p className="text-xs text-blue-600 mb-2 flex items-center gap-1 font-medium">
                      <CheckCircle className="h-4 w-4" />
                      Document already uploaded. Upload a new one only if you want to replace it.
                    </p>
                  )}
                  <Input
                    id="idDocument"
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => setIdDocumentFile(e.target.files?.[0] || null)}
                    className="cursor-pointer"
                    data-testid="input-kyc-document"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Clear photo or scan of your ID (JPG, PNG, WEBP, HEIC, or PDF, max 10MB)
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
              <h3 className="font-semibold text-lg text-slate-900">Signature {!((user as any)?.kycSignatureUrl) && <span className="text-red-500">*</span>}</h3>
              
              <div>
                <Label htmlFor="signature" className="text-sm font-medium">
                  Upload Signature {!((user as any)?.kycSignatureUrl) && <span className="text-red-500">*</span>}
                </Label>
                <div className="mt-1">
                  {((user as any)?.kycSignatureUrl) && (
                    <p className="text-xs text-blue-600 mb-2 flex items-center gap-1 font-medium">
                      <CheckCircle className="h-4 w-4" />
                      Signature already uploaded. Upload a new one only if you want to replace it.
                    </p>
                  )}
                  <Input
                    id="signature"
                    type="file"
                    accept="image/*"
                    onChange={(e) => setSignatureFile(e.target.files?.[0] || null)}
                    className="cursor-pointer"
                    data-testid="input-kyc-signature"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Upload a clear image of your signature (JPG, PNG, WEBP, or HEIC, max 5MB)
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
                  {((user as any)?.kycSelfieUrl) && (
                    <p className="text-xs text-blue-600 mb-2 flex items-center gap-1 font-medium">
                      <CheckCircle className="h-4 w-4" />
                      Selfie already uploaded. Upload a new one only if you want to replace it.
                    </p>
                  )}
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

      {/* Certificate View Modal */}
      <Dialog open={certificateModalOpen} onOpenChange={(open) => {
        setCertificateModalOpen(open);
        if (!open) setSelectedReservationId(null);
      }}>
        <DialogContent className="max-w-[900px] max-h-[95vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Award className="h-6 w-6 text-amber-600" />
              Ownership Certificate
            </DialogTitle>
            <DialogDescription>
              Your verified proof of property ownership. Download or share this certificate.
            </DialogDescription>
          </DialogHeader>

          {certificateLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600"></div>
              <span className="ml-3 text-slate-600">Loading certificate...</span>
            </div>
          ) : certificateData?.certificate ? (
            <div className="space-y-4">
              {/* Certificate Preview */}
              <div className="overflow-x-auto bg-slate-100 rounded-lg p-4">
                <div ref={certificateRef} className="mx-auto" style={{ width: 'fit-content' }}>
                  <CertificateComponent 
                    certificate={{
                      ...certificateData.certificate,
                      verificationToken: certificateData.certificate.verificationToken
                    }} 
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t">
                <CertificateDownloadButton certificateRef={certificateRef} />
                <Button
                  variant="outline"
                  onClick={() => {
                    const url = `${window.location.origin}/verify/${certificateData.certificate.verificationToken}`;
                    navigator.clipboard.writeText(url);
                    toast({
                      title: "Link copied!",
                      description: "Verification link copied to clipboard.",
                    });
                  }}
                  className="flex items-center gap-2"
                  data-testid="button-copy-verification-link"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy Verification Link
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center py-12">
              <AlertCircle className="h-12 w-12 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Certificate Not Found</h3>
              <p className="text-slate-600">
                The ownership certificate for this investment is not available yet. 
                Please contact support if this is unexpected.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Payment Proof Upload Modal */}
      <Dialog open={paymentModalOpen} onOpenChange={(open) => {
        setPaymentModalOpen(open);
        if (!open) {
          setSelectedPaymentReservation(null);
          setPaymentProofFile(null);
        }
      }}>
        <DialogContent className="max-w-lg max-h-[95vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Upload className="h-5 w-5 text-green-600" />
              Make Payment
            </DialogTitle>
            <DialogDescription>
              Transfer the amount to the bank account below, then scroll down to upload your payment proof.
            </DialogDescription>
          </DialogHeader>

          <p className="text-sm text-slate-600">
            Your reservation remains valid for 24 hours from creation.
          </p>

          {selectedPaymentReservation && (
            <form onSubmit={handlePaymentProofUpload} className="space-y-6">
              {/* Investment Details */}
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h4 className="font-semibold text-blue-900 mb-2">Investment Details</h4>
                <div className="text-sm text-blue-800 space-y-1">
                  <p><span className="font-medium">Property:</span> {selectedPaymentReservation.property?.name}</p>
                  <p><span className="font-medium">Units:</span> {selectedPaymentReservation.units}</p>
                  <p><span className="font-medium">Amount:</span> {formatCurrency(convertAmount(
                    typeof selectedPaymentReservation.amount === 'string' 
                      ? parseFloat(selectedPaymentReservation.amount) 
                      : (selectedPaymentReservation.amount || 0),
                    selectedPaymentReservation.currency || 'NGN'
                  ))}</p>
                </div>
              </div>

              {/* Step 1: Bank Details */}
              <div className="space-y-4">
                <h4 className="font-semibold text-slate-900">Step 1: Make Payment</h4>
                <p className="text-xs text-slate-500 -mt-2">Transfer the exact amount to one of the accounts below.</p>
                
                {paymentInstructionsLoading && <p className="text-sm text-slate-500">Loading secure payment details...</p>}
                {paymentInstructions?.method && (() => {
                  const method = paymentInstructions.method;
                  return (
                  <div className="p-4 border border-slate-200 rounded-lg">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-lg font-bold text-slate-700">{method.icon}</span>
                      <h5 className="font-medium text-slate-900">{method.title}</h5>
                    </div>
                    <div className="space-y-2 text-sm">
                      {method.details.map((detail: { label: string; value: string }, idx: number) => (
                        <div key={idx} className="flex justify-between">
                          <span className="text-slate-600">{detail.label}:</span>
                          <span className="font-medium text-slate-900 text-right">{detail.value}</span>
                        </div>
                      ))}
                    </div>
                    {'alternative' in method && method.alternative && (
                      <div className="mt-3 pt-3 border-t border-slate-200">
                        <p className="text-sm font-medium text-slate-700 mb-2">{method.alternative.title}</p>
                        <div className="space-y-1 text-sm">
                          {method.alternative.details.map((detail: { label: string; value: string }, idx: number) => (
                            <div key={idx} className="flex justify-between">
                              <span className="text-slate-600">{detail.label}:</span>
                              <span className="font-medium text-slate-900">{detail.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  );
                })()}
              </div>

              {/* Step 2: Upload Proof */}
              <div className="border-t border-slate-200 pt-4">
                <h4 className="font-semibold text-slate-900 mb-1">Step 2: Upload Payment Proof</h4>
                <p className="text-xs text-slate-500 mb-3">After making your payment, upload proof below to confirm your investment.</p>
                <Label htmlFor="paymentProof" className="text-sm font-medium">
                  Payment Proof <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="paymentProof"
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setPaymentProofFile(e.target.files?.[0] || null)}
                  className="mt-1 cursor-pointer"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Bank transfer receipt, screenshot, or confirmation (JPG, PNG, WEBP, or PDF, max 10MB)
                </p>
                {paymentProofFile && (
                  <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    {paymentProofFile.name} selected
                  </p>
                )}
              </div>

              {/* Submit Buttons */}
              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPaymentModalOpen(false)}
                  className="flex-1"
                  disabled={uploadingPayment}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="flex-1 bg-green-600 hover:bg-green-700"
                  disabled={uploadingPayment || !paymentProofFile}
                >
                  {uploadingPayment ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Submit Payment Proof
                    </>
                  )}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}