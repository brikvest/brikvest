import { useState, type CSSProperties } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import DeveloperLayout from "@/components/developer/DeveloperLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toastFromError } from "@/lib/planErrors";
import HelpTip from "@/components/developer/HelpTip";
import { RichTextEditor } from "@/components/RichTextEditor";
import {
  Building2, TrendingUp, Hammer, Users, BarChart3, Mail, Plus, Pencil, Trash2,
  CheckCircle2, Clock, AlertTriangle, Send, Download, Calendar, Loader2, Save, Megaphone,
  GripVertical, ImagePlus, X, UserPlus,
} from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  draft:            { label: "Draft",            className: "bg-slate-100 text-slate-700 border-slate-200" },
  pending_approval: { label: "Pending Approval", className: "bg-amber-100 text-amber-700 border-amber-200" },
  live:             { label: "Live",             className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  sold_out:         { label: "Sold Out",         className: "bg-blue-100 text-blue-700 border-blue-200" },
  archived:         { label: "Archived",         className: "bg-slate-200 text-slate-600 border-slate-300" },
};

const MILESTONE_STATUS: Record<string, { label: string; className: string; icon: any }> = {
  not_started: { label: "Not Started",  className: "bg-slate-100 text-slate-700",     icon: Clock },
  in_progress: { label: "In Progress",  className: "bg-blue-100 text-blue-700",       icon: Hammer },
  done:        { label: "Done",         className: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  delayed:     { label: "Delayed",      className: "bg-amber-100 text-amber-700",     icon: AlertTriangle },
};

const UPDATE_TYPE: Record<string, { label: string; className: string }> = {
  construction: { label: "Construction", className: "bg-blue-100 text-blue-700" },
  sales:        { label: "Sales",        className: "bg-emerald-100 text-emerald-700" },
  financial:    { label: "Financial",    className: "bg-purple-100 text-purple-700" },
  delay:        { label: "Delay/Risk",   className: "bg-red-100 text-red-700" },
  general:      { label: "General",      className: "bg-slate-100 text-slate-700" },
};

const TAB_ITEMS = [
  { value: "overview",     label: "Overview",       short: "Overview", icon: BarChart3,    requires: null },
  { value: "fundraising",  label: "Fundraising",    short: "Funding",  icon: TrendingUp,   requires: "fundraising" },
  { value: "construction", label: "Construction",   short: "Build",    icon: Hammer,       requires: "construction" },
  { value: "sales",        label: "Sales",          short: "Sales",    icon: Building2,    requires: "sales" },
  { value: "captable",     label: "Cap Table",      short: "Cap",      icon: Users,        requires: "cap_table" },
  { value: "comms",        label: "Communications", short: "Comms",    icon: Mail,         requires: "comms" },
] as const;

function fmt(currency: string | null | undefined, amount: number | string) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `${currency || "NGN"} ${(isNaN(n) ? 0 : n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

// Format a units value (decimal column from DB serializes as a string like "2.00").
// Whole numbers render without decimals; fractional values keep up to 2 dp.
function fmtUnits(v: number | string | null | undefined): string {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  if (!isFinite(n as number)) return "0";
  return (n as number).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function DeveloperProjectDetail() {
  const [, params] = useRoute("/developer/projects/:id");
  // `projectKey` is what we put into the URL — either a numeric id or a slug.
  // The backend resolves slugs to ids; the numeric `project.id` returned from
  // the API is used for cache keys and any places that need a stable handle.
  const projectKey = params?.id || "";
  const [tab, setTab] = useState("overview");

  const { data: me } = useQuery<any>({ queryKey: ["/api/developer/me"] });
  const isOwner = !!me?.isOwner;
  const myPermissions: string[] = Array.isArray(me?.permissions) ? me.permissions : [];
  const visibleTabs = TAB_ITEMS.filter((t) => !t.requires || isOwner || myPermissions.includes(t.requires));

  const { data: project, isLoading } = useQuery<any>({
    queryKey: ["/api/developer/projects", projectKey],
    enabled: !!projectKey,
    queryFn: async () => {
      const res = await fetch(`/api/developer/projects/${projectKey}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });
  // Children fetch via the URL segment so backend slug-resolution is applied
  // and all React Query cache keys agree (slug vs numeric id would mismatch).
  const projectId = projectKey;
  const { data: rollup } = useQuery<any>({
    queryKey: ["/api/developer/projects", projectKey, "rollup"],
    enabled: !!projectKey,
    queryFn: async () => {
      const res = await fetch(`/api/developer/projects/${projectKey}/rollup`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <DeveloperLayout backTo="/developer">
        <div className="animate-pulse space-y-4">
          <div className="h-32 bg-white rounded-xl" />
          <div className="h-64 bg-white rounded-xl" />
        </div>
      </DeveloperLayout>
    );
  }

  if (!project) {
    return (
      <DeveloperLayout backTo="/developer" title="Project not found">
        <p className="text-slate-500">This project does not exist or you do not have access.</p>
      </DeveloperLayout>
    );
  }

  const status = STATUS_BADGE[project.projectStatus] || STATUS_BADGE.draft;

  return (
    <DeveloperLayout
      backTo="/developer"
      title={project.name}
      subtitle={project.location}
      actions={<Badge className={`${status.className} border`} data-testid="badge-status">{status.label}</Badge>}
    >
      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        {/* Mobile: compact dropdown picker */}
        <div className="md:hidden">
          <Select value={tab} onValueChange={setTab}>
            <SelectTrigger
              className="w-full bg-white border-slate-200 h-11 font-medium"
              data-testid="select-tab-mobile"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {visibleTabs.map((t) => (
                <SelectItem key={t.value} value={t.value} data-testid={`tab-mobile-${t.value}`}>
                  <span className="inline-flex items-center">
                    <t.icon className="w-4 h-4 mr-2 text-slate-500" />
                    {t.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Tablet+ : tab strip — equal-width grid so labels never crowd */}
        <TabsList
          className="hidden md:grid w-full bg-white border border-slate-200 p-1 h-auto"
          style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` }}
        >
          {visibleTabs.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              data-testid={`tab-${t.value}`}
              className="data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700 data-[state=active]:shadow-sm py-2 text-sm"
            >
              <t.icon className="w-4 h-4 mr-2" />
              <span className="hidden lg:inline">{t.label}</span>
              <span className="lg:hidden">{t.short}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview"><OverviewTab project={project} rollup={rollup} /></TabsContent>
        {visibleTabs.some(t => t.value === "fundraising")  && <TabsContent value="fundraising"><FundraisingTab project={project} rollup={rollup} /></TabsContent>}
        {visibleTabs.some(t => t.value === "construction") && <TabsContent value="construction"><ConstructionTab projectId={projectId} project={project} /></TabsContent>}
        {visibleTabs.some(t => t.value === "sales")        && <TabsContent value="sales"><SalesTab projectId={projectId} project={project} /></TabsContent>}
        {visibleTabs.some(t => t.value === "captable")     && <TabsContent value="captable"><CapTableTab project={project} rollup={rollup} /></TabsContent>}
        {visibleTabs.some(t => t.value === "comms")        && <TabsContent value="comms"><CommunicationsTab projectId={projectId} project={project} /></TabsContent>}
      </Tabs>
    </DeveloperLayout>
  );
}

// ======================= OVERVIEW =======================
function OverviewTab({ project, rollup }: { project: any; rollup: any }) {
  const { toast } = useToast();
  const submitMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/developer/projects/${project.id}/submit`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", project.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects"] });
      toast({ title: "Submitted for approval", description: "Brikvest admin will review your project." });
    },
    onError: () => toast({ title: "Submission failed", variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      {project.projectStatus === "draft" && (
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="flex items-center justify-between py-4 px-6">
            <div>
              <div className="font-semibold text-amber-900">This project is in draft mode</div>
              <div className="text-sm text-amber-800 mt-0.5">It is not visible to investors. Submit it to Brikvest for approval to go live.</div>
            </div>
            <Button onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending} className="bg-amber-600 hover:bg-amber-700" data-testid="button-submit-approval">
              {submitMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit for approval"}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard icon={TrendingUp} label="Funding raised" value={fmt(project.currency, rollup?.funding?.totalRaised || 0)} sub={`${rollup?.funding?.percent || 0}% of target`} />
        <StatCard icon={Users} label="Investors" value={String(rollup?.funnel?.confirmed || 0)} sub={`${rollup?.funnel?.reserved || 0} total reservations`} />
        <StatCard icon={Hammer} label="Construction" value={`${rollup?.construction?.overall || 0}%`} sub={rollup?.construction?.nextMilestone?.name || "No milestones"} />
        <StatCard icon={Building2} label="Units sold" value={`${rollup?.sales?.investorUnits || 0} / ${rollup?.sales?.totalUnits || 0}`} sub={`${rollup?.sales?.availableUnits || 0} available`} />
      </div>

      <FundingModelCard project={project} />

      <Card>
        <CardHeader>
          <CardTitle>Project description</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-slate-700 whitespace-pre-wrap" data-testid="text-description">{project.description}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function FundingModelCard({ project }: { project: any }) {
  const FUNDING_LABELS: Record<string, { label: string; tone: string; blurb: string }> = {
    equity:       { label: "Equity / Co-ownership", tone: "bg-blue-100 text-blue-700",       blurb: "Investors own a fractional share of the SPV." },
    fixed_return: { label: "Fixed return",          tone: "bg-emerald-100 text-emerald-700", blurb: "You've committed a fixed % return to investors." },
    profit_share: { label: "Profit share",          tone: "bg-purple-100 text-purple-700",   blurb: "Investors share a % of net profit at exit." },
    loan:         { label: "Loan / Debt",           tone: "bg-amber-100 text-amber-700",     blurb: "Capital is repaid with interest at the end of the term." },
    hybrid:       { label: "Hybrid",                tone: "bg-indigo-100 text-indigo-700",   blurb: "Combined model — see funding notes for details." },
    self_funded:  { label: "Self-funded",           tone: "bg-slate-100 text-slate-600",     blurb: "No external investors on this project." },
  };
  const PAYOUT: Record<string, string> = {
    on_exit: "On exit", lump_sum: "Lump sum", monthly: "Monthly", quarterly: "Quarterly", annually: "Annually",
  };
  const EXIT: Record<string, string> = {
    sale: "Sale at completion", land_appreciation: "Land appreciation", rental_income: "Rental income",
    buyback: "Developer buyback", refinance: "Refinance", other: "Other",
  };
  const PERIOD: Record<string, string> = {
    annual: "p.a.", project_lifetime: "total", monthly: "per month", quarterly: "per quarter",
  };
  const fundingType = project.fundingType || "equity";
  const meta = FUNDING_LABELS[fundingType] || FUNDING_LABELS.equity;
  const isSelfFunded = fundingType === "self_funded" || project.acceptsExternalInvestors === false;

  const returnText = project.expectedReturnPercent
    ? `${parseFloat(project.expectedReturnPercent).toLocaleString()}% ${PERIOD[project.returnPeriod || "annual"] || ""}`.trim()
    : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle>Funding model</CardTitle>
          <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full ${meta.tone}`} data-testid="badge-funding-type">
            {meta.label}
          </span>
        </div>
        <p className="text-sm text-slate-500 mt-1">{meta.blurb}</p>
      </CardHeader>
      <CardContent>
        {isSelfFunded ? (
          <p className="text-sm text-slate-600">
            This project isn't accepting external investors. You can still track milestones, photos, and updates here.
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {returnText && (
              <FundingMetric label="Expected return" value={returnText} />
            )}
            {project.investmentTermMonths && (
              <FundingMetric label="Investment term" value={`${project.investmentTermMonths} mo`} />
            )}
            {project.payoutFrequency && (
              <FundingMetric label="Payout" value={PAYOUT[project.payoutFrequency] || project.payoutFrequency} />
            )}
            {project.exitStrategy && (
              <FundingMetric label="Exit / earnings" value={EXIT[project.exitStrategy] || project.exitStrategy} />
            )}
            {!returnText && !project.investmentTermMonths && !project.payoutFrequency && !project.exitStrategy && (
              <div className="col-span-full text-sm text-slate-500">
                No detailed return terms set. Edit the project to add them.
              </div>
            )}
          </div>
        )}
        {project.fundingNotes && (
          <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 p-3">
            <div className="text-xs font-semibold text-slate-700 mb-1">Funding notes</div>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{project.fundingNotes}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FundingMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
      <div className="text-base font-semibold text-slate-900 mt-0.5">{value}</div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
            <Icon className="w-4 h-4 text-blue-600" />
          </div>
        </div>
        <div className="text-2xl font-bold text-slate-900">{value}</div>
        {sub && <div className="text-xs text-slate-500 mt-1 truncate">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ======================= FUNDRAISING =======================
function FundraisingTab({ project, rollup }: { project: any; rollup: any }) {
  const f = rollup?.funding || {};
  const funnel = rollup?.funnel || {};
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [drillIn, setDrillIn] = useState<any | null>(null);

  const { data: investors = [] } = useQuery<any[]>({
    queryKey: ["/api/developer/projects", project.id, "investors"],
    enabled: !!project.id,
    queryFn: async () => {
      const res = await fetch(`/api/developer/projects/${project.id}/investors`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const STAGE_LABEL: Record<string, { label: string; className: string }> = {
    reserved:                { label: "Reserved",          className: "bg-amber-100 text-amber-700" },
    payment_pending:         { label: "Payment Pending",   className: "bg-orange-100 text-orange-700" },
    converted_to_investment: { label: "Confirmed",         className: "bg-emerald-100 text-emerald-700" },
    expired:                 { label: "Expired",           className: "bg-red-100 text-red-700" },
    cancelled:               { label: "Cancelled",         className: "bg-slate-100 text-slate-600" },
  };

  const funnelData = [
    { stage: "Reserved",          count: funnel.reserved || 0 },
    { stage: "KYC Complete",      count: funnel.kycComplete || 0 },
    { stage: "Payment Submitted", count: funnel.paymentSubmitted || 0 },
    { stage: "Confirmed",         count: funnel.confirmed || 0 },
  ];

  const stuckInFunnel = (investors || []).filter((i) => {
    if (i.status === "converted_to_investment" || i.status === "expired" || i.status === "cancelled") return false;
    if (!i.createdAt) return false;
    const ageMs = Date.now() - new Date(i.createdAt).getTime();
    return ageMs > 3 * 24 * 60 * 60 * 1000; // > 3 days in non-terminal state
  });

  const filtered = (investors || []).filter((i) => {
    if (stageFilter !== "all" && i.status !== stageFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (i.name || "").toLowerCase().includes(q) || (i.email || "").toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Funding progress</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex justify-between mb-2">
              <span className="text-sm text-slate-600">Raised</span>
              <span className="text-sm font-semibold text-slate-900">
                {fmt(f.currency, f.totalRaised || 0)} / {fmt(f.currency, f.fundingTarget || 0)}
              </span>
            </div>
            <Progress value={f.percent || 0} className="h-3" />
            <div className="text-xs text-slate-500 mt-1">{f.percent || 0}% funded</div>
            {f.equivalents && (
              <div className="grid grid-cols-3 gap-2 mt-3 text-xs" data-testid="funding-equivalents">
                {(["NGN", "USD", "GBP"] as const).map((c) => (
                  <div key={c} className="rounded-md border border-slate-200 bg-slate-50 p-2">
                    <div className="font-semibold text-slate-700">{c}</div>
                    <div className="text-slate-900">{fmt(c, f.equivalents[c]?.raised || 0)}</div>
                    <div className="text-slate-500">of {fmt(c, f.equivalents[c]?.target || 0)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-4 pt-4">
            <div>
              <div className="text-xs text-slate-500">Unit price</div>
              <div className="text-lg font-semibold text-slate-900">{fmt(project.currency, project.unitPrice)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Total units</div>
              <div className="text-lg font-semibold text-slate-900">{project.totalUnits}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Available</div>
              <div className="text-lg font-semibold text-slate-900">{rollup?.sales?.availableUnits || 0}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conversion funnel</CardTitle>
          <CardDescription>From reservation to confirmed investment.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={funnelData} layout="vertical" margin={{ left: 60 }}>
                <XAxis type="number" allowDecimals={false} />
                <YAxis dataKey="stage" type="category" width={140} />
                <Tooltip />
                <Bar dataKey="count" fill="#2563eb" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {stuckInFunnel.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/40" data-testid="card-stuck-funnel">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-900">
              <AlertTriangle className="w-4 h-4" />
              Stuck in funnel ({stuckInFunnel.length})
            </CardTitle>
            <CardDescription className="text-amber-800">
              Investors who reserved more than 3 days ago and have not yet confirmed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stuckInFunnel.slice(0, 6).map((i) => (
                <div key={i.reservationId} className="flex items-center justify-between bg-white border border-amber-200 rounded-lg px-4 py-2">
                  <div className="flex items-center gap-3">
                    <Avatar className="w-7 h-7"><AvatarFallback className="text-xs bg-amber-100 text-amber-700">{(i.name?.[0] || "?").toUpperCase()}</AvatarFallback></Avatar>
                    <div>
                      <div className="text-sm font-medium text-slate-900">{i.name}</div>
                      <div className="text-xs text-slate-500">{i.email}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge className={STAGE_LABEL[i.status]?.className || "bg-slate-100"}>{STAGE_LABEL[i.status]?.label || i.status}</Badge>
                    <Button size="sm" variant="outline" onClick={() => setDrillIn(i)} data-testid={`button-drill-${i.reservationId}`}>View</Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Investors</CardTitle>
          <CardDescription>Search, filter, and drill down to see each investor's reservation and payment history.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder="Search by name or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="sm:max-w-sm"
              data-testid="input-investor-search"
            />
            <Select value={stageFilter} onValueChange={setStageFilter}>
              <SelectTrigger className="sm:w-56" data-testid="select-stage-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stages ({investors.length})</SelectItem>
                <SelectItem value="reserved">Reserved</SelectItem>
                <SelectItem value="payment_pending">Payment Pending</SelectItem>
                <SelectItem value="converted_to_investment">Confirmed</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-10 text-slate-500">No investors match the current filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Investor</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Reserved</TableHead>
                    <TableHead className="text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((i) => {
                    const meta = STAGE_LABEL[i.status] || { label: i.status, className: "bg-slate-100" };
                    return (
                      <TableRow key={i.reservationId} data-testid={`row-investor-${i.reservationId}`}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="w-8 h-8"><AvatarFallback className="text-xs bg-blue-100 text-blue-700">{(i.name?.[0] || "?").toUpperCase()}</AvatarFallback></Avatar>
                            <div>
                              <div className="font-medium text-slate-900">{i.name}</div>
                              <div className="text-xs text-slate-500">{i.email}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell><Badge className={meta.className}>{meta.label}</Badge></TableCell>
                        <TableCell className="text-right font-medium">{fmtUnits(i.units)}</TableCell>
                        <TableCell className="text-right">{fmt(i.currency, i.amount)}</TableCell>
                        <TableCell className="text-right text-xs text-slate-500">{i.createdAt ? new Date(i.createdAt).toLocaleDateString() : "—"}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => setDrillIn(i)} data-testid={`button-view-investor-${i.reservationId}`}>View</Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!drillIn} onOpenChange={(open) => !open && setDrillIn(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{drillIn?.name}</DialogTitle>
            <DialogDescription>{drillIn?.email}</DialogDescription>
          </DialogHeader>
          {drillIn && (
            <div className="space-y-4">
              {/* Identity */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-slate-500 uppercase">Phone</div>
                  <div className="text-slate-900" data-testid="drill-phone">{drillIn.phone || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 uppercase">Country</div>
                  <div className="text-slate-900" data-testid="drill-country">{drillIn.country || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 uppercase">KYC</div>
                  <Badge
                    className={`mt-1 ${
                      drillIn.kycStatus === "approved"
                        ? "bg-emerald-100 text-emerald-700"
                        : drillIn.kycStatus === "pending" || drillIn.kycStatus === "submitted"
                        ? "bg-amber-100 text-amber-700"
                        : drillIn.kycStatus === "rejected"
                        ? "bg-red-100 text-red-700"
                        : "bg-slate-100 text-slate-700"
                    }`}
                    data-testid="drill-kyc"
                  >
                    {(drillIn.kycStatus || "not started").replace(/_/g, " ")}
                  </Badge>
                </div>
                <div>
                  <div className="text-xs text-slate-500 uppercase">Reservation ID</div>
                  <div className="font-mono text-xs text-slate-700">#{drillIn.reservationId}</div>
                </div>
              </div>

              {/* Investment summary */}
              <div className="grid grid-cols-3 gap-3 text-sm border-t border-slate-200 pt-3">
                <div>
                  <div className="text-xs text-slate-500 uppercase">Stage</div>
                  <Badge className={`mt-1 ${STAGE_LABEL[drillIn.status]?.className || "bg-slate-100"}`}>{STAGE_LABEL[drillIn.status]?.label || drillIn.status}</Badge>
                </div>
                <div>
                  <div className="text-xs text-slate-500 uppercase">Units</div>
                  <div className="font-semibold text-slate-900">{fmtUnits(drillIn.units)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 uppercase">Amount</div>
                  <div className="font-semibold text-slate-900">{fmt(drillIn.currency, drillIn.amount)}</div>
                </div>
              </div>

              {/* Reservation timeline */}
              <div className="border-t border-slate-200 pt-4">
                <div className="text-xs text-slate-500 uppercase mb-2">Reservation timeline</div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full bg-blue-500 mt-2" />
                    <div>
                      <div className="font-medium text-slate-900">Reservation created</div>
                      <div className="text-xs text-slate-500">{drillIn.createdAt ? new Date(drillIn.createdAt).toLocaleString() : "—"}</div>
                    </div>
                  </div>
                  {drillIn.confirmedAt && (
                    <div className="flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 mt-2" />
                      <div>
                        <div className="font-medium text-slate-900">Confirmed as investment</div>
                        <div className="text-xs text-slate-500">{new Date(drillIn.confirmedAt).toLocaleString()}</div>
                      </div>
                    </div>
                  )}
                  {drillIn.status === "expired" && (
                    <div className="flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full bg-red-500 mt-2" />
                      <div>
                        <div className="font-medium text-slate-900">Reservation expired</div>
                        <div className="text-xs text-slate-500">Did not convert in time</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Payment history */}
              <div className="border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-slate-500 uppercase">Payment history</div>
                  {drillIn.paymentStatus && (
                    <Badge
                      className={
                        drillIn.paymentStatus === "approved"
                          ? "bg-emerald-100 text-emerald-700"
                          : drillIn.paymentStatus === "pending" || drillIn.paymentStatus === "pending_verification"
                          ? "bg-amber-100 text-amber-700"
                          : drillIn.paymentStatus === "rejected"
                          ? "bg-red-100 text-red-700"
                          : "bg-slate-100 text-slate-700"
                      }
                      data-testid="drill-payment-status"
                    >
                      latest: {drillIn.paymentStatus.replace(/_/g, " ")}
                    </Badge>
                  )}
                </div>
                {(!Array.isArray(drillIn.paymentHistory) || drillIn.paymentHistory.length === 0) ? (
                  <div className="text-xs text-slate-500 italic" data-testid="drill-no-payments">No payment submissions yet.</div>
                ) : (
                  <div className="space-y-2" data-testid="drill-payment-history">
                    {drillIn.paymentHistory.map((p: any) => (
                      <div key={p.id} className="border border-slate-200 rounded p-3 text-sm bg-slate-50">
                        <div className="flex items-center justify-between mb-1">
                          <div className="font-semibold text-slate-900">{fmt(p.currency || drillIn.currency, p.amount)}</div>
                          <Badge
                            className={
                              p.status === "approved"
                                ? "bg-emerald-100 text-emerald-700"
                                : p.status === "pending" || p.status === "pending_verification"
                                ? "bg-amber-100 text-amber-700"
                                : p.status === "rejected"
                                ? "bg-red-100 text-red-700"
                                : "bg-slate-100 text-slate-700"
                            }
                          >
                            {String(p.status || "").replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <div className="text-xs text-slate-600 space-y-0.5">
                          <div>Method: {p.paymentMethod || "—"}</div>
                          {p.transactionRef && <div>Ref: <span className="font-mono">{p.transactionRef}</span></div>}
                          <div>Submitted: {p.submittedAt ? new Date(p.submittedAt).toLocaleString() : "—"}</div>
                          {p.reviewedAt && <div>Reviewed: {new Date(p.reviewedAt).toLocaleString()}</div>}
                          {p.rejectionReason && <div className="text-red-600">Reason: {p.rejectionReason}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ======================= CONSTRUCTION =======================
function ConstructionTab({ projectId, project }: { projectId: string | number; project: any }) {
  const { toast } = useToast();
  const { data: milestones, isLoading } = useQuery<any[]>({
    queryKey: ["/api/developer/projects", projectId, "milestones"],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/developer/projects/${projectId}/milestones`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);

  // Project-level construction fields
  const [projectFields, setProjectFields] = useState({
    currentStage: project?.currentStage || "",
    expectedCompletionDate: project?.expectedCompletionDate ? new Date(project.expectedCompletionDate).toISOString().slice(0, 10) : "",
    risksDelays: project?.risksDelays || "",
    latestUpdateText: project?.latestUpdateText || "",
  });
  const [fieldsDirty, setFieldsDirty] = useState(false);

  const saveProjectFields = useMutation({
    mutationFn: async () => apiRequest("PATCH", `/api/developer/projects/${projectId}`, {
      currentStage: projectFields.currentStage || null,
      expectedCompletionDate: projectFields.expectedCompletionDate || null,
      risksDelays: projectFields.risksDelays || null,
      latestUpdateText: projectFields.latestUpdateText || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId] });
      setFieldsDirty(false);
      toast({ title: "Project details saved" });
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (data.id) return apiRequest("PATCH", `/api/developer/milestones/${data.id}`, data);
      return apiRequest("POST", `/api/developer/projects/${projectId}/milestones`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "milestones"] });
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "rollup"] });
      setOpen(false);
      setEditing(null);
      toast({ title: "Milestone saved" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/developer/milestones/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "milestones"] });
      toast({ title: "Milestone deleted" });
    },
  });

  const milestonesKey = ["/api/developer/projects", projectId, "milestones"];

  const reorderMutation = useMutation({
    mutationFn: async (items: { id: number; sortOrder: number }[]) => {
      return apiRequest("POST", `/api/developer/projects/${projectId}/milestones/reorder`, { items });
    },
    onMutate: async (items) => {
      await queryClient.cancelQueries({ queryKey: milestonesKey });
      const previous = queryClient.getQueryData<any[]>(milestonesKey);
      const orderById = new Map(items.map(i => [i.id, i.sortOrder]));
      queryClient.setQueryData<any[]>(milestonesKey, (current) => {
        if (!current) return current;
        return current.map(m =>
          orderById.has(m.id) ? { ...m, sortOrder: orderById.get(m.id)! } : m
        );
      });
      return { previous };
    },
    onError: (_err, _items, context) => {
      if (context?.previous) {
        queryClient.setQueryData(milestonesKey, context.previous);
      }
      toast({ title: "Failed to reorder milestones", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: milestonesKey });
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const sortedMilestones = milestones ? [...milestones].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)) : [];

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sortedMilestones.findIndex(m => m.id === active.id);
    const newIndex = sortedMilestones.findIndex(m => m.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(sortedMilestones, oldIndex, newIndex);
    const items = reordered.map((m, i) => ({ id: m.id, sortOrder: i }));
    reorderMutation.mutate(items);
  };
  const overall = sortedMilestones.length === 0 ? 0 : Math.round(sortedMilestones.reduce((s, m) => s + (m.percentComplete || 0), 0) / sortedMilestones.length);

  const updateField = (k: keyof typeof projectFields, v: string) => {
    setProjectFields((prev) => ({ ...prev, [k]: v }));
    setFieldsDirty(true);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex items-center justify-between py-5">
          <div>
            <div className="text-sm text-slate-500">Overall construction progress</div>
            <div className="text-3xl font-bold text-slate-900 mt-1">{overall}%</div>
          </div>
          <div className="w-1/2">
            <Progress value={overall} className="h-3" />
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-project-fields">
        <CardHeader>
          <CardTitle>Project status</CardTitle>
          <CardDescription>High-level status visible to your investors. Updated independently of milestones.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-1.5">
                <Label>Current stage</Label>
                <HelpTip>
                  The high-level construction phase shown to investors on their dashboard.
                  This is independent of the detailed milestone list below — pick whichever
                  phase best describes where the project is right now.
                </HelpTip>
              </div>
              <Select value={projectFields.currentStage} onValueChange={(v) => updateField("currentStage", v)}>
                <SelectTrigger data-testid="select-current-stage"><SelectValue placeholder="Select stage" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Land prep">Land prep</SelectItem>
                  <SelectItem value="Foundation">Foundation</SelectItem>
                  <SelectItem value="Structural frame">Structural frame</SelectItem>
                  <SelectItem value="Roofing & facade">Roofing & facade</SelectItem>
                  <SelectItem value="Finishes">Finishes</SelectItem>
                  <SelectItem value="Handover">Handover</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Expected completion date</Label>
              <Input
                type="date"
                value={projectFields.expectedCompletionDate}
                onChange={(e) => updateField("expectedCompletionDate", e.target.value)}
                data-testid="input-expected-completion"
              />
            </div>
          </div>
          <div>
            <Label>Latest update headline</Label>
            <Input
              value={projectFields.latestUpdateText}
              onChange={(e) => updateField("latestUpdateText", e.target.value)}
              placeholder="e.g. Floor 7 slab poured this week — on schedule"
              maxLength={200}
              data-testid="input-latest-update"
            />
            <p className="text-xs text-slate-500 mt-1">Shown on investor dashboards above the milestone list.</p>
          </div>
          <div>
            <Label>Risks & delays</Label>
            <Textarea
              rows={3}
              value={projectFields.risksDelays}
              onChange={(e) => updateField("risksDelays", e.target.value)}
              placeholder="Document any current risks, weather impacts, supply chain issues, or schedule slippage."
              data-testid="textarea-risks-delays"
            />
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => saveProjectFields.mutate()}
              disabled={!fieldsDirty || saveProjectFields.isPending}
              className="bg-blue-600 hover:bg-blue-700"
              data-testid="button-save-project-fields"
            >
              {saveProjectFields.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              Save project status
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Milestones</CardTitle>
            <CardDescription>Track construction phases and update investors.</CardDescription>
          </div>
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700" data-testid="button-add-milestone">
                <Plus className="w-4 h-4 mr-2" /> Add milestone
              </Button>
            </DialogTrigger>
            <MilestoneDialog editing={editing} onSave={(d) => saveMutation.mutate(d)} saving={saveMutation.isPending} />
          </Dialog>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-20 bg-slate-100 rounded-lg animate-pulse" />)}</div>
          ) : sortedMilestones.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <Hammer className="w-10 h-10 mx-auto mb-3 text-slate-300" />
              <p>No milestones yet. Add your first one to start tracking progress.</p>
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={sortedMilestones.map(m => m.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-3">
                  {sortedMilestones.map((m, idx) => (
                    <SortableMilestoneItem
                      key={m.id}
                      milestone={m}
                      index={idx}
                      onEdit={(mil) => { setEditing(mil); setOpen(true); }}
                      onDelete={(id) => deleteMutation.mutate(id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SortableMilestoneItem({
  milestone: m,
  index: idx,
  onEdit,
  onDelete,
}: {
  milestone: any;
  index: number;
  onEdit: (m: any) => void;
  onDelete: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: m.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : "auto",
  };
  const meta = MILESTONE_STATUS[m.status] || MILESTONE_STATUS.not_started;
  const Icon = meta.icon;
  const media: string[] = Array.isArray(m.mediaUrls) ? m.mediaUrls : [];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`border border-slate-200 rounded-lg p-4 bg-white ${isDragging ? "shadow-lg ring-2 ring-blue-300" : ""}`}
      data-testid={`milestone-${m.id}`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="flex items-center justify-center h-8 w-6 mt-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-grab active:cursor-grabbing touch-none"
          aria-label={`Drag to reorder ${m.name}`}
          data-testid={`drag-handle-${m.id}`}
        >
          <GripVertical className="w-4 h-4" />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <span className="text-xs font-mono text-slate-400">#{idx + 1}</span>
                <h4 className="font-semibold text-slate-900">{m.name}</h4>
                <Badge className={meta.className}><Icon className="w-3 h-3 mr-1" />{meta.label}</Badge>
              </div>
              {m.description && <p className="text-sm text-slate-600 mb-2">{m.description}</p>}
              <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
                {m.targetDate && <span><Calendar className="w-3 h-3 inline mr-1" />Target: {new Date(m.targetDate).toLocaleDateString()}</span>}
                {m.completedDate && <span className="text-emerald-600"><CheckCircle2 className="w-3 h-3 inline mr-1" />Done: {new Date(m.completedDate).toLocaleDateString()}</span>}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-lg font-bold text-slate-900 mb-1">{m.percentComplete || 0}%</div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => onEdit(m)} data-testid={`button-edit-${m.id}`}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onDelete(m.id)} data-testid={`button-delete-${m.id}`}>
                  <Trash2 className="w-3.5 h-3.5 text-red-500" />
                </Button>
              </div>
            </div>
          </div>
          {media.length > 0 && (
            <div className="flex gap-2 mt-3 overflow-x-auto" data-testid={`media-gallery-${m.id}`}>
              {media.map((url, i) => (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block flex-shrink-0 w-20 h-20 rounded border border-slate-200 overflow-hidden bg-slate-50 hover:ring-2 hover:ring-blue-400"
                >
                  <img src={url} alt={`Milestone media ${i + 1}`} className="w-full h-full object-cover" />
                </a>
              ))}
            </div>
          )}
          <Progress value={m.percentComplete || 0} className="h-1.5 mt-3" />
        </div>
      </div>
    </div>
  );
}

function MilestoneDialog({ editing, onSave, saving }: { editing: any; onSave: (d: any) => void; saving: boolean }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: editing?.name || "",
    description: editing?.description || "",
    targetDate: editing?.targetDate ? new Date(editing.targetDate).toISOString().slice(0, 10) : "",
    completedDate: editing?.completedDate ? new Date(editing.completedDate).toISOString().slice(0, 10) : "",
    status: editing?.status || "not_started",
    percentComplete: editing?.percentComplete || 0,
    notes: editing?.notes || "",
    mediaUrls: (Array.isArray(editing?.mediaUrls) ? editing.mediaUrls : []) as string[],
  });
  const [uploading, setUploading] = useState(false);

  function detectKind(file: File): { kind: "image" | "video" | "document"; field: string; endpoint: string; max: number } | null {
    if (file.type.startsWith("image/")) return { kind: "image",    field: "image",    endpoint: "/api/upload/image",    max: 5  * 1024 * 1024 };
    if (file.type.startsWith("video/")) return { kind: "video",    field: "video",    endpoint: "/api/upload/video",    max: 100 * 1024 * 1024 };
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))
      return { kind: "document", field: "document", endpoint: "/api/upload/document", max: 20 * 1024 * 1024 };
    return null;
  }

  const handleUpload = async (file: File) => {
    const k = detectKind(file);
    if (!k) {
      toast({ title: "Unsupported file type", description: "Allowed: image, video, or PDF.", variant: "destructive" });
      return;
    }
    if (file.size > k.max) {
      toast({ title: "File too large", description: `Max ${Math.round(k.max / (1024 * 1024))} MB for ${k.kind}.`, variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append(k.field, file);
      const res = await fetch(k.endpoint, { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const url: string | undefined = data.url || data.documentUrl || data.videoUrl;
      if (!url) throw new Error("Server did not return a URL");
      setForm((prev) => ({ ...prev, mediaUrls: [...prev.mediaUrls, url] }));
      toast({ title: `${k.kind[0].toUpperCase()}${k.kind.slice(1)} uploaded` });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message || "Try again", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const removeMedia = (idx: number) => {
    setForm((prev) => ({ ...prev, mediaUrls: prev.mediaUrls.filter((_, i) => i !== idx) }));
  };

  const mediaSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleMediaDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setForm((prev) => {
      const oldIndex = prev.mediaUrls.findIndex((u, i) => `${i}:${u}` === active.id);
      const newIndex = prev.mediaUrls.findIndex((u, i) => `${i}:${u}` === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return { ...prev, mediaUrls: arrayMove(prev.mediaUrls, oldIndex, newIndex) };
    });
  };

  function classifyUrl(url: string): "image" | "video" | "document" {
    const u = url.toLowerCase().split("?")[0];
    if (/\.(png|jpe?g|webp|gif|avif)$/i.test(u)) return "image";
    if (/\.(mp4|webm|mov|m4v|avi)$/i.test(u))    return "video";
    return "document";
  }

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{editing ? "Edit milestone" : "Add milestone"}</DialogTitle>
        <DialogDescription>Construction milestones appear on the investor dashboard.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <div className="flex items-center gap-1.5">
            <Label>Name *</Label>
            <HelpTip>
              The construction milestone, e.g. "Foundation poured", "Roof complete",
              "Handover to investors". Investors see these as a timeline of progress.
            </HelpTip>
          </div>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Foundation poured" data-testid="input-milestone-name" />
        </div>
        <div>
          <Label>Description</Label>
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} data-testid="input-milestone-description" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="flex items-center gap-1.5">
              <Label>Target date</Label>
              <HelpTip>When you originally planned to complete this milestone.</HelpTip>
            </div>
            <Input type="date" value={form.targetDate} onChange={(e) => setForm({ ...form, targetDate: e.target.value })} data-testid="input-milestone-target" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <Label>Completed date</Label>
              <HelpTip>The actual date this milestone was finished. Leave blank if it isn't done yet.</HelpTip>
            </div>
            <Input type="date" value={form.completedDate} onChange={(e) => setForm({ ...form, completedDate: e.target.value })} data-testid="input-milestone-completed" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger data-testid="select-milestone-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="not_started">Not started</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="done">Done</SelectItem>
                <SelectItem value="delayed">Delayed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <Label>% Complete</Label>
              <HelpTip>
                Roughly how far along this milestone is, from 0 to 100. Used by the project
                progress bar shown to investors.
              </HelpTip>
            </div>
            <Input type="number" min={0} max={100} value={form.percentComplete} onChange={(e) => setForm({ ...form, percentComplete: parseInt(e.target.value) || 0 })} data-testid="input-milestone-percent" />
          </div>
        </div>

        {/* Media uploader */}
        <div>
          <Label>Site photos, videos & documents</Label>
          <p className="text-xs text-slate-500 mb-2">Images (max 5 MB), videos (max 100 MB), or PDFs (max 20 MB). Drag thumbnails to set the order investors see. The first item is featured.</p>
          <div className="flex flex-wrap gap-2 mb-2">
            <DndContext sensors={mediaSensors} collisionDetection={closestCenter} onDragEnd={handleMediaDragEnd}>
              <SortableContext items={form.mediaUrls.map((u, i) => `${i}:${u}`)} strategy={rectSortingStrategy}>
                {form.mediaUrls.map((url, i) => (
                  <SortableMediaThumb
                    key={`${i}:${url}`}
                    id={`${i}:${url}`}
                    url={url}
                    index={i}
                    kind={classifyUrl(url)}
                    onRemove={() => removeMedia(i)}
                  />
                ))}
              </SortableContext>
            </DndContext>
            <label className="w-20 h-20 rounded border-2 border-dashed border-slate-300 flex items-center justify-center cursor-pointer hover:bg-slate-50 hover:border-blue-400 transition" data-testid="button-upload-media">
              {uploading ? (
                <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
              ) : (
                <ImagePlus className="w-5 h-5 text-slate-400" />
              )}
              <input
                type="file"
                accept="image/*,video/*,application/pdf,.pdf"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={() => onSave({ ...form, id: editing?.id })} disabled={saving || !form.name} data-testid="button-save-milestone">
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
          Save milestone
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function SortableMediaThumb({
  id,
  url,
  index,
  kind,
  onRemove,
}: {
  id: string;
  url: string;
  index: number;
  kind: "image" | "video" | "document";
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : "auto",
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`relative w-20 h-20 rounded border border-slate-200 overflow-hidden bg-slate-50 cursor-grab active:cursor-grabbing touch-none ${isDragging ? "ring-2 ring-blue-400 shadow-lg" : ""}`}
      data-testid={`milestone-media-thumb-${index}`}
      aria-label={`Drag to reorder media ${index + 1}`}
    >
      {kind === "image" ? (
        <img src={url} alt={`Media ${index + 1}`} className="w-full h-full object-cover pointer-events-none select-none" draggable={false} />
      ) : kind === "video" ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => { if (isDragging) e.preventDefault(); }}
          className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-white"
          draggable={false}
        >
          <span className="text-2xl">▶</span>
          <span className="text-[10px] mt-1">Video</span>
        </a>
      ) : (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => { if (isDragging) e.preventDefault(); }}
          className="w-full h-full flex flex-col items-center justify-center bg-red-50 text-red-700"
          draggable={false}
        >
          <span className="text-xs font-bold">PDF</span>
          <span className="text-[10px] mt-0.5">Open</span>
        </a>
      )}
      {index === 0 && (
        <span className="absolute bottom-0.5 left-0.5 bg-blue-600 text-white text-[9px] font-semibold px-1 py-px rounded pointer-events-none">
          1st
        </span>
      )}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="absolute top-0.5 right-0.5 bg-white/90 rounded-full p-0.5 shadow hover:bg-red-50"
        data-testid={`button-remove-media-${index}`}
        aria-label={`Remove media ${index + 1}`}
      >
        <X className="w-3 h-3 text-red-600" />
      </button>
    </div>
  );
}

// ======================= SALES (analytics + client list with notes) =======================
// In a sales context, the people buying are "clients" (not investors), and they're buying
// apartments/plots/spaces (whatever the property type is) — not "units". These helpers
// surface the right wording per project so the Sales tab feels native to a real estate
// sales team.
function unitNoun(propertyType?: string): { singular: string; plural: string; Plural: string } {
  switch ((propertyType || "").toLowerCase()) {
    case "land":
      return { singular: "plot", plural: "plots", Plural: "Plots" };
    case "residential":
      return { singular: "apartment", plural: "apartments", Plural: "Apartments" };
    case "commercial":
      return { singular: "space", plural: "spaces", Plural: "Spaces" };
    case "mixed_use":
    default:
      return { singular: "unit", plural: "units", Plural: "Units" };
  }
}

type SalesStage = "all" | "reserved" | "converted_to_investment" | "expired" | "cancelled";
type LeadStage = "lead" | "contacted" | "qualified" | "converted" | "lost";
type LeadFilter = "all" | LeadStage;

function SalesTab({ projectId, project }: { projectId: string | number; project: any }) {
  const { toast } = useToast();
  const { data: investors, isLoading } = useQuery<any[]>({
    queryKey: ["/api/developer/projects", projectId, "investors"],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/developer/projects/${projectId}/investors`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });
  const { data: leadsData, isLoading: leadsLoading } = useQuery<any[]>({
    queryKey: ["/api/developer/projects", projectId, "leads"],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/developer/projects/${projectId}/leads`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });
  const [stage, setStage] = useState<SalesStage>("all");
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteInvestor, setNoteInvestor] = useState<any | null>(null);
  const [noteText, setNoteText] = useState("");

  const saveNote = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/developer/projects/${projectId}/notes`, {
      investorUserId: noteInvestor?.investorUserId,
      notes: noteText,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "investors"] });
      setNoteOpen(false);
      toast({ title: "Note saved" });
    },
  });

  const list = investors || [];
  const leads = leadsData || [];

  // Stage counts
  const counts = {
    all: list.length,
    reserved: list.filter((i) => i.status === "reserved").length,
    converted_to_investment: list.filter((i) => i.status === "converted_to_investment").length,
    expired: list.filter((i) => i.status === "expired").length,
    cancelled: list.filter((i) => i.status === "cancelled").length,
  };

  // Filter
  const filtered = stage === "all" ? list : list.filter((i) => i.status === stage);

  // Velocity (units sold per week, last 4 calendar weeks)
  // NOTE: i.units is a decimal column serialized as a string ("2.00") — always coerce with Number.
  const confirmed = list.filter((i) => i.status === "converted_to_investment" && i.confirmedAt);
  const totalUnits = Number(project.totalUnits) || 0;
  const soldUnits = confirmed.reduce((s, i) => s + (Number(i.units) || 0), 0);
  const remainingUnits = Math.max(0, totalUnits - soldUnits);

  const now = new Date();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const weekBuckets: { label: string; units: number; cumulative: number }[] = [];
  for (let w = 3; w >= 0; w--) {
    const end = new Date(now.getTime() - w * weekMs);
    const start = new Date(end.getTime() - weekMs);
    const units = confirmed
      .filter((i) => {
        const d = new Date(i.confirmedAt);
        return d >= start && d < end;
      })
      .reduce((s, i) => s + (Number(i.units) || 0), 0);
    const label = `W-${w}`;
    weekBuckets.push({ label, units, cumulative: 0 });
  }
  // Cumulative across the 4-week window (running total of units up to bucket end)
  const cutoff = new Date(now.getTime() - 4 * weekMs);
  const baseSold = confirmed
    .filter((i) => new Date(i.confirmedAt) < cutoff)
    .reduce((s, i) => s + (Number(i.units) || 0), 0);
  let running = baseSold;
  for (const b of weekBuckets) {
    running += b.units;
    b.cumulative = running;
  }
  const totalLast4 = weekBuckets.reduce((s, b) => s + b.units, 0);
  const avgVelocity = totalLast4 / 4; // units per week
  const weeksToSellOut = avgVelocity > 0 ? remainingUnits / avgVelocity : null;
  const forecastDays = weeksToSellOut !== null ? Math.round(weeksToSellOut * 7) : null;
  const forecastDate = forecastDays !== null ? new Date(now.getTime() + forecastDays * 24 * 60 * 60 * 1000) : null;

  // Lead funnel + qualified-lead conversion rate
  const leadCounts: Record<LeadStage, number> = {
    lead: leads.filter((l) => l.stage === "lead").length,
    contacted: leads.filter((l) => l.stage === "contacted").length,
    qualified: leads.filter((l) => l.stage === "qualified").length,
    converted: leads.filter((l) => l.stage === "converted").length,
    lost: leads.filter((l) => l.stage === "lost").length,
  };
  // Conversion rate = qualified leads that became reservations / all leads that ever reached qualified.
  const qualifiedDenom = leadCounts.qualified + leadCounts.converted;
  const qualifiedConversionRate = qualifiedDenom > 0 ? leadCounts.converted / qualifiedDenom : 0;
  // Pipeline demand from qualified leads (use estimated units if provided, otherwise avg confirmed units)
  const avgUnitsPerSale = confirmed.length > 0 ? soldUnits / confirmed.length : 1;
  const qualifiedLeads = leads.filter((l) => l.stage === "qualified");
  const pipelineUnits = qualifiedLeads.reduce((s, l) => {
    const est = l.estimatedUnits != null && l.estimatedUnits !== "" ? Number(l.estimatedUnits) : NaN;
    return s + (isNaN(est) ? avgUnitsPerSale : est);
  }, 0);
  const expectedConversions = pipelineUnits * qualifiedConversionRate;
  const adjustedRemaining = Math.max(0, remainingUnits - expectedConversions);
  const adjustedWeeksToSellOut = avgVelocity > 0 ? adjustedRemaining / avgVelocity : null;
  const adjustedForecastDays = adjustedWeeksToSellOut !== null ? Math.round(adjustedWeeksToSellOut * 7) : null;
  const adjustedForecastDate = adjustedForecastDays !== null ? new Date(now.getTime() + adjustedForecastDays * 24 * 60 * 60 * 1000) : null;

  const updateSalesStage = useMutation({
    mutationFn: async (newStage: "off_plan" | "completed") =>
      apiRequest("PATCH", `/api/developer/projects/${projectId}`, { salesStage: newStage }),
    onSuccess: (_d, newStage) => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects"] });
      toast({ title: "Sales stage updated", description: newStage === "completed" ? "Marked as Completed" : "Marked as Off-plan" });
    },
    onError: (err: any) => toast({ title: "Update failed", description: err?.message || "Could not update sales stage", variant: "destructive" }),
  });
  const currentSalesStage: "off_plan" | "completed" = project.salesStage === "completed" ? "completed" : "off_plan";

  const noun = unitNoun(project?.propertyType);

  const STAGE_LABELS: Record<SalesStage, string> = {
    all: "All",
    reserved: "Reserved",
    converted_to_investment: "Confirmed",
    expired: "Expired",
    cancelled: "Cancelled",
  };
  const STAGE_COLORS: Record<SalesStage, string> = {
    all: "bg-slate-100 text-slate-700 border-slate-200",
    reserved: "bg-amber-50 text-amber-700 border-amber-200",
    converted_to_investment: "bg-emerald-50 text-emerald-700 border-emerald-200",
    expired: "bg-red-50 text-red-700 border-red-200",
    cancelled: "bg-slate-50 text-slate-600 border-slate-200",
  };

  return (
    <div className="space-y-6">
      {/* Sales lifecycle stage */}
      <Card>
        <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">Sales lifecycle stage</div>
            <div className="text-xs text-slate-500 mt-0.5">
              Controls how this project is presented to investors. Off-plan = pre-handover; Completed = handed over / available now.
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={currentSalesStage === "off_plan" ? "default" : "outline"}
              disabled={updateSalesStage.isPending || currentSalesStage === "off_plan"}
              onClick={() => updateSalesStage.mutate("off_plan")}
              data-testid="button-sales-stage-off-plan"
            >
              Off-plan
            </Button>
            <Button
              type="button"
              size="sm"
              variant={currentSalesStage === "completed" ? "default" : "outline"}
              disabled={updateSalesStage.isPending || currentSalesStage === "completed"}
              onClick={() => updateSalesStage.mutate("completed")}
              data-testid="button-sales-stage-completed"
            >
              Completed
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Velocity / Forecast cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="py-5">
            <div className="text-xs uppercase tracking-wide text-slate-500">Sold {noun.plural}</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{fmtUnits(soldUnits)} <span className="text-sm font-normal text-slate-500">/ {fmtUnits(totalUnits)}</span></div>
            <Progress value={totalUnits > 0 ? (soldUnits / totalUnits) * 100 : 0} className="h-1.5 mt-2" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <div className="text-xs uppercase tracking-wide text-slate-500">Remaining</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{fmtUnits(remainingUnits)}</div>
            <div className="text-xs text-slate-500 mt-2">{noun.plural} available</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <div className="text-xs uppercase tracking-wide text-slate-500">Velocity (4-wk avg)</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{avgVelocity.toFixed(1)} <span className="text-sm font-normal text-slate-500">{noun.plural}/wk</span></div>
            <div className="text-xs text-slate-500 mt-2">{fmtUnits(totalLast4)} sold in last 4 weeks</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <div className="text-xs uppercase tracking-wide text-slate-500">Sell-out forecast</div>
            {forecastDate && remainingUnits > 0 ? (
              <>
                <div className="text-2xl font-bold text-slate-900 mt-1" data-testid="text-forecast-date">{forecastDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
                <div className="text-xs text-slate-500 mt-2">~{forecastDays} days at current pace</div>
                {expectedConversions > 0 && adjustedForecastDate && (
                  <div className="text-xs text-blue-700 mt-1.5 border-t border-slate-100 pt-1.5" data-testid="text-forecast-with-pipeline">
                    With qualified pipeline: <span className="font-semibold">{adjustedForecastDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                    <span className="text-slate-500"> (~{adjustedForecastDays}d • {Math.round(qualifiedConversionRate * 100)}% conv.)</span>
                  </div>
                )}
              </>
            ) : remainingUnits === 0 ? (
              <>
                <div className="text-2xl font-bold text-emerald-600 mt-1">Sold out</div>
                <div className="text-xs text-slate-500 mt-2">All {noun.plural} allocated</div>
              </>
            ) : (
              <>
                <div className="text-2xl font-bold text-slate-400 mt-1">—</div>
                <div className="text-xs text-slate-500 mt-2">No recent sales to forecast</div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sales chart */}
      <Card>
        <CardHeader>
          <CardTitle>Sales velocity (last 4 weeks)</CardTitle>
          <CardDescription>{noun.Plural} confirmed per week and cumulative trend.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weekBuckets} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <XAxis dataKey="label" stroke="#64748b" fontSize={12} />
                <YAxis stroke="#64748b" fontSize={12} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="units" stroke="#2563eb" strokeWidth={2} name={`${noun.Plural} / week`} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="cumulative" stroke="#15803d" strokeWidth={2} name="Cumulative" dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* CRM Leads sub-section (pre-reservation funnel) */}
      <LeadsSection
        projectId={projectId}
        leads={leads}
        leadCounts={leadCounts}
        qualifiedConversionRate={qualifiedConversionRate}
        isLoading={leadsLoading}
      />

      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle>Clients</CardTitle>
            <CardDescription>{filtered.length} of {list.length} {list.length === 1 ? "client" : "clients"} shown</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <AddInvestorDialog projectId={projectId} project={project} noun={noun} />
            <a
              href={`/api/developer/projects/${projectId}/investors.csv`}
              className="inline-flex items-center px-3 py-1.5 text-sm font-medium border border-slate-300 rounded-md hover:bg-slate-50"
              data-testid="link-export-csv"
            >
              <Download className="w-4 h-4 mr-2" /> Export CSV
            </a>
          </div>
        </CardHeader>
        <CardContent>
          {/* Stage filter chips */}
          <div className="flex flex-wrap gap-2 mb-4">
            {(["all", "reserved", "converted_to_investment", "expired", "cancelled"] as SalesStage[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStage(s)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full border transition ${
                  stage === s ? `${STAGE_COLORS[s]} ring-2 ring-offset-1 ring-blue-300` : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
                data-testid={`filter-stage-${s}`}
              >
                {STAGE_LABELS[s]} <span className="ml-1 text-slate-500">({counts[s]})</span>
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="h-40 bg-slate-100 rounded animate-pulse" />
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-500">No clients in this stage.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>{noun.Plural}</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>KYC</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((inv) => (
                    <TableRow key={inv.reservationId} data-testid={`row-investor-${inv.reservationId}`}>
                      <TableCell>
                        <div className="font-medium text-slate-900">{inv.name}</div>
                        <div className="text-xs text-slate-500">{inv.email}</div>
                      </TableCell>
                      <TableCell>{fmtUnits(inv.units)}</TableCell>
                      <TableCell>{fmt(inv.currency, inv.amount)}</TableCell>
                      <TableCell>
                        <Badge className={inv.kycStatus === "approved" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700"}>
                          {inv.kycStatus}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={
                          inv.status === "converted_to_investment" ? "bg-emerald-100 text-emerald-700"
                          : inv.status === "reserved" ? "bg-amber-100 text-amber-700"
                          : "bg-slate-100 text-slate-700"
                        }>{inv.status.replace(/_/g, " ")}</Badge>
                      </TableCell>
                      <TableCell>
                        {inv.investorUserId ? (
                          <Button size="sm" variant="ghost" onClick={() => {
                            setNoteInvestor(inv); setNoteText(inv.notes || ""); setNoteOpen(true);
                          }} data-testid={`button-note-${inv.reservationId}`}>
                            <Pencil className="w-3.5 h-3.5 mr-1" />{inv.notes ? "Edit" : "Add"}
                          </Button>
                        ) : <span className="text-xs text-slate-400">—</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Note for {noteInvestor?.name}</DialogTitle>
                <DialogDescription>Internal note — only you can see this.</DialogDescription>
              </DialogHeader>
              <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={6} placeholder="Conversation notes, follow-ups, or context…" data-testid="input-note-text" />
              <DialogFooter>
                <Button onClick={() => saveNote.mutate()} disabled={saveNote.isPending} data-testid="button-save-note">
                  {saveNote.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                  Save note
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    </div>
  );
}

// ======================= LEADS (CRM funnel sub-section) =======================
const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  lead: "Lead",
  contacted: "Contacted",
  qualified: "Qualified",
  converted: "Converted",
  lost: "Lost",
};
const LEAD_STAGE_COLORS: Record<LeadStage, string> = {
  lead:      "bg-sky-50 text-sky-700 border-sky-200",
  contacted: "bg-violet-50 text-violet-700 border-violet-200",
  qualified: "bg-blue-50 text-blue-700 border-blue-200",
  converted: "bg-emerald-50 text-emerald-700 border-emerald-200",
  lost:      "bg-slate-100 text-slate-600 border-slate-200",
};

function AddInvestorDialog({ projectId, project, noun }: { projectId: string | number; project: any; noun: { singular: string; plural: string; Plural: string } }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [units, setUnits] = useState<string>("1");
  const [amount, setAmount] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<string>("bank_transfer");
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [paymentReference, setPaymentReference] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const reset = () => {
    setEmail(""); setFullName(""); setPhone("");
    setUnits("1"); setAmount(""); setPaymentMethod("bank_transfer");
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setPaymentReference(""); setNote("");
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        email: email.trim(),
        fullName: fullName.trim(),
        phone: phone.trim() || undefined,
        units: Number(units),
        paymentMethod,
        paymentDate,
        paymentReference: paymentReference.trim() || undefined,
        note: note.trim() || undefined,
      };
      if (amount.trim()) payload.amount = Number(amount);
      return await apiRequest("POST", `/api/developer/projects/${projectId}/investors`, payload);
    },
    onSuccess: (res: any) => {
      toast({
        title: "Client recorded",
        description: res?.isNewAccount
          ? `Account created and login email sent to ${email}. Certificate ${res?.certificateNumber || ""}.`
          : `Purchase added for existing account. Confirmation email sent.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "investors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "rollup"] });
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects"] });
      reset();
      setOpen(false);
    },
    onError: (err: any) => toast(toastFromError(err, "Could not record client")),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !fullName.trim() || !Number(units)) {
      toast({ title: "Missing details", description: `Email, name, and number of ${noun.plural} are required.`, variant: "destructive" });
      return;
    }
    mutation.mutate();
  };

  const unitPrice = Number(project?.unitPrice ?? project?.minInvestment ?? 0);
  const computedAmount = Number(units) > 0 && unitPrice > 0 ? Number(units) * unitPrice : null;
  const currency = project?.currency || "NGN";

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid="button-add-investor">
          <UserPlus className="w-4 h-4 mr-2" /> Add client
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record off-platform client</DialogTitle>
          <DialogDescription>
            Use this when a client has paid you directly for {noun.plural}. We'll create or link their Brikvest account, issue an ownership certificate, and email them a login link to track their purchase.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ai-name">Full name *</Label>
              <Input id="ai-name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Doe" data-testid="input-investor-name" />
            </div>
            <div>
              <Label htmlFor="ai-email">Email *</Label>
              <Input id="ai-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" data-testid="input-investor-email" />
            </div>
          </div>
          <div>
            <Label htmlFor="ai-phone">Phone (optional)</Label>
            <Input id="ai-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+234..." data-testid="input-investor-phone" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center gap-1.5">
                <Label htmlFor="ai-units">{noun.Plural} *</Label>
                <HelpTip>
                  How many {noun.plural} this client is buying. Each {noun.singular}
                  represents one allocation in the project. We'll automatically reduce the
                  {" "}{noun.plural} still available for sale.
                </HelpTip>
              </div>
              <Input id="ai-units" type="number" min={1} step={1} value={units} onChange={(e) => setUnits(e.target.value)} data-testid="input-investor-units" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <Label htmlFor="ai-amount">Amount paid ({currency})</Label>
                <HelpTip>
                  The actual amount you collected from this client, in {currency}. Leave
                  blank and we'll auto-calculate it as {noun.plural} × {noun.singular} price.
                  Override this if you offered a discount or a custom price.
                </HelpTip>
              </div>
              <Input
                id="ai-amount"
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={computedAmount ? computedAmount.toLocaleString() : "Auto from unit price"}
                data-testid="input-investor-amount"
              />
              <p className="text-xs text-slate-500 mt-1">
                Leave blank to auto-calculate as {noun.plural} × {noun.singular} price.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ai-method">Payment method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger id="ai-method" data-testid="select-payment-method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="ai-date">Payment date</Label>
              <Input id="ai-date" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} data-testid="input-payment-date" />
            </div>
          </div>
          <div>
            <Label htmlFor="ai-ref">Payment reference (optional)</Label>
            <Input id="ai-ref" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} placeholder="Bank ref / receipt number" data-testid="input-payment-ref" />
          </div>
          <div>
            <Label htmlFor="ai-note">Internal note (optional)</Label>
            <Textarea id="ai-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Visible only to you" data-testid="textarea-investor-note" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending} data-testid="button-submit-investor">
              {mutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</> : "Record client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LeadsSection({
  projectId,
  leads,
  leadCounts,
  qualifiedConversionRate,
  isLoading,
}: {
  projectId: string | number;
  leads: any[];
  leadCounts: Record<LeadStage, number>;
  qualifiedConversionRate: number;
  isLoading: boolean;
}) {
  const { toast } = useToast();
  const [filter, setFilter] = useState<LeadFilter>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertLead, setConvertLead] = useState<any | null>(null);
  const [convertUnits, setConvertUnits] = useState<string>("");
  const [form, setForm] = useState({ fullName: "", email: "", phone: "", stage: "lead" as LeadStage, estimatedUnits: "", notes: "" });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "leads"] });
    queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "investors"] });
    queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "rollup"] });
  };

  const createLead = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/developer/projects/${projectId}/leads`, form),
    onSuccess: () => {
      invalidate();
      setAddOpen(false);
      setForm({ fullName: "", email: "", phone: "", stage: "lead", estimatedUnits: "", notes: "" });
      toast({ title: "Lead added" });
    },
    onError: (err: any) => toast({ title: "Could not add lead", description: err?.message || "Please try again", variant: "destructive" }),
  });

  const updateLead = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: any }) =>
      apiRequest("PATCH", `/api/developer/projects/${projectId}/leads/${id}`, updates),
    onSuccess: () => {
      invalidate();
      toast({ title: "Lead updated" });
    },
    onError: (err: any) => toast({ title: "Could not update lead", description: err?.message || "Please try again", variant: "destructive" }),
  });

  const deleteLead = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/developer/projects/${projectId}/leads/${id}`),
    onSuccess: () => {
      invalidate();
      toast({ title: "Lead removed" });
    },
    onError: (err: any) => toast({ title: "Could not remove lead", description: err?.message || "Please try again", variant: "destructive" }),
  });

  const convertLeadMut = useMutation({
    mutationFn: async ({ id, units }: { id: number; units: string }) =>
      apiRequest("POST", `/api/developer/projects/${projectId}/leads/${id}/convert`, { units }),
    onSuccess: () => {
      invalidate();
      setConvertOpen(false);
      setConvertLead(null);
      setConvertUnits("");
      toast({ title: "Lead converted to a reservation" });
    },
    onError: (err: any) => toast({ title: "Conversion failed", description: err?.message || "Please try again", variant: "destructive" }),
  });

  const filtered = filter === "all" ? leads : leads.filter((l) => l.stage === filter);
  const STAGES: LeadFilter[] = ["all", "lead", "contacted", "qualified", "converted", "lost"];

  return (
    <Card data-testid="card-leads">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Leads</CardTitle>
          <CardDescription>
            Track demand before it becomes a reservation. {leadCounts.qualified} qualified •{" "}
            {Math.round(qualifiedConversionRate * 100)}% historical conversion to reservation.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)} data-testid="button-add-lead">
          <Plus className="w-4 h-4 mr-1.5" /> Add lead
        </Button>
      </CardHeader>
      <CardContent>
        {/* Lead stage filter chips */}
        <div className="flex flex-wrap gap-2 mb-4">
          {STAGES.map((s) => {
            const label = s === "all" ? "All" : LEAD_STAGE_LABELS[s as LeadStage];
            const count = s === "all" ? leads.length : leadCounts[s as LeadStage];
            const cls = s === "all"
              ? "bg-slate-100 text-slate-700 border-slate-200"
              : LEAD_STAGE_COLORS[s as LeadStage];
            return (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(s)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full border transition ${
                  filter === s ? `${cls} ring-2 ring-offset-1 ring-blue-300` : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
                data-testid={`filter-lead-stage-${s}`}
              >
                {label} <span className="ml-1 text-slate-500">({count})</span>
              </button>
            );
          })}
        </div>

        {isLoading ? (
          <div className="h-24 bg-slate-100 rounded animate-pulse" />
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-sm text-slate-500" data-testid="text-leads-empty">
            {leads.length === 0 ? "No leads yet. Add one to start tracking pre-reservation demand." : "No leads in this stage."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Est. units</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((lead) => (
                  <TableRow key={lead.id} data-testid={`row-lead-${lead.id}`}>
                    <TableCell>
                      <div className="font-medium text-slate-900">{lead.fullName}</div>
                      <div className="text-xs text-slate-500">{lead.email}</div>
                      {lead.phone && <div className="text-xs text-slate-500">{lead.phone}</div>}
                    </TableCell>
                    <TableCell>
                      {lead.stage === "converted" ? (
                        <Badge className={LEAD_STAGE_COLORS.converted}>Converted</Badge>
                      ) : (
                        <Select
                          value={lead.stage}
                          onValueChange={(v) => updateLead.mutate({ id: lead.id, updates: { stage: v } })}
                        >
                          <SelectTrigger className="h-8 w-32" data-testid={`select-lead-stage-${lead.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="lead">Lead</SelectItem>
                            <SelectItem value="contacted">Contacted</SelectItem>
                            <SelectItem value="qualified">Qualified</SelectItem>
                            <SelectItem value="lost">Lost</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-slate-700">{lead.estimatedUnits ? Number(lead.estimatedUnits) : "—"}</span>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs text-slate-600 max-w-[260px] truncate" title={lead.notes || ""}>
                        {lead.notes || <span className="text-slate-400">—</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {lead.stage !== "converted" && lead.stage !== "lost" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setConvertLead(lead);
                              setConvertUnits(lead.estimatedUnits ? String(Number(lead.estimatedUnits)) : "");
                              setConvertOpen(true);
                            }}
                            data-testid={`button-convert-lead-${lead.id}`}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Convert
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => {
                            if (confirm(`Remove lead ${lead.fullName}?`)) deleteLead.mutate(lead.id);
                          }}
                          data-testid={`button-delete-lead-${lead.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Add lead dialog */}
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add a lead</DialogTitle>
              <DialogDescription>Capture interest before it becomes a reservation.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="lead-name">Full name</Label>
                <Input id="lead-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} data-testid="input-lead-name" />
              </div>
              <div>
                <Label htmlFor="lead-email">Email</Label>
                <Input id="lead-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="input-lead-email" />
              </div>
              <div>
                <Label htmlFor="lead-phone">Phone (optional)</Label>
                <Input id="lead-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-lead-phone" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center gap-1.5">
                  <Label htmlFor="lead-stage">Stage</Label>
                  <HelpTip>
                    Where this lead is in your sales funnel. <strong>Lead</strong> = just inquired,
                    <strong> Contacted</strong> = you've reached out, <strong>Qualified</strong> = serious
                    buyer ready to commit, <strong>Converted</strong> = paid (becomes an investor),
                    <strong> Lost</strong> = no longer pursuing.
                  </HelpTip>
                </div>
                  <Select value={form.stage} onValueChange={(v) => setForm({ ...form, stage: v as LeadStage })}>
                    <SelectTrigger id="lead-stage" data-testid="select-new-lead-stage">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lead">Lead</SelectItem>
                      <SelectItem value="contacted">Contacted</SelectItem>
                      <SelectItem value="qualified">Qualified</SelectItem>
                      <SelectItem value="lost">Lost</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                  <Label htmlFor="lead-units">Estimated units</Label>
                  <HelpTip>
                    Roughly how many units you think this lead will buy. Used for the
                    sell-out forecast at the top of the Sales tab.
                  </HelpTip>
                </div>
                  <Input id="lead-units" type="number" step="0.01" min="0" value={form.estimatedUnits} onChange={(e) => setForm({ ...form, estimatedUnits: e.target.value })} data-testid="input-lead-units" />
                </div>
              </div>
              <div>
                <Label htmlFor="lead-notes">Notes</Label>
                <Textarea id="lead-notes" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Source, follow-up plan, context…" data-testid="input-lead-notes" />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => createLead.mutate()}
                disabled={createLead.isPending || !form.fullName || !form.email}
                data-testid="button-save-lead"
              >
                {createLead.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                Save lead
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Convert lead dialog */}
        <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Convert {convertLead?.fullName} to a reservation</DialogTitle>
              <DialogDescription>
                A new reserved entry will be created in the reservation list. The lead will be marked as Converted.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="convert-units">Units</Label>
                <Input
                  id="convert-units"
                  type="number"
                  step="0.01"
                  min="0"
                  value={convertUnits}
                  onChange={(e) => setConvertUnits(e.target.value)}
                  data-testid="input-convert-units"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => convertLead && convertLeadMut.mutate({ id: convertLead.id, units: convertUnits })}
                disabled={convertLeadMut.isPending || !convertUnits || Number(convertUnits) <= 0}
                data-testid="button-confirm-convert-lead"
              >
                {convertLeadMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                Create reservation
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ======================= CAP TABLE =======================
function CapTableTab({ project, rollup }: { project: any; rollup: any }) {
  const cap = rollup?.capTable || {};
  const data = [
    { name: "Investors",         value: cap.investorEquityPercent || 0,  fill: "#2563eb" },
    { name: "Developer (kept)",  value: cap.developerEquityPercent || 0, fill: "#15803d" },
    { name: "Available",         value: cap.availableEquityPercent || 0, fill: "#cbd5e1" },
  ];
  const { data: investors } = useQuery<any[]>({
    queryKey: ["/api/developer/projects", project.id, "investors"],
    enabled: !!project.id,
    queryFn: async () => {
      const res = await fetch(`/api/developer/projects/${project.id}/investors`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });
  const confirmed = (investors || []).filter((i) => i.status === "converted_to_investment");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Equity distribution</CardTitle></CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(d) => `${d.value}%`}>
                    {data.map((entry, idx) => <Cell key={idx} fill={entry.fill} />)}
                  </Pie>
                  <Legend />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <RowKV label="Total units" value={String(rollup?.sales?.totalUnits || 0)} />
            <RowKV label="Investor units" value={String(rollup?.sales?.investorUnits || 0)} />
            <RowKV label="Developer-retained units" value={String(rollup?.sales?.developerEquityUnits || 0)} />
            <RowKV label="Available units" value={String(rollup?.sales?.availableUnits || 0)} />
            <RowKV label="Shareholders" value={String(cap.shareholderCount || 0)} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Confirmed shareholders</CardTitle>
          <CardDescription>Investors with confirmed equity in this project.</CardDescription>
        </CardHeader>
        <CardContent>
          {confirmed.length === 0 ? (
            <div className="text-center py-10 text-slate-500">No confirmed shareholders yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Investor</TableHead>
                    <TableHead className="text-right">Units</TableHead>
                    <TableHead className="text-right">Equity %</TableHead>
                    <TableHead className="text-right">Invested</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {confirmed.map((c) => {
                    const equityPct = (rollup?.sales?.totalUnits || 0) > 0
                      ? ((Number(c.units) / rollup.sales.totalUnits) * 100).toFixed(2)
                      : "0";
                    return (
                      <TableRow key={c.reservationId} data-testid={`row-shareholder-${c.reservationId}`}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="w-8 h-8"><AvatarFallback className="text-xs bg-blue-100 text-blue-700">{(c.name?.[0] || "?").toUpperCase()}</AvatarFallback></Avatar>
                            <div>
                              <div className="font-medium text-slate-900">{c.name}</div>
                              <div className="text-xs text-slate-500">{c.email}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium">{fmtUnits(c.units)}</TableCell>
                        <TableCell className="text-right font-medium">{equityPct}%</TableCell>
                        <TableCell className="text-right">{fmt(c.currency, c.amount)}</TableCell>
                      </TableRow>
                    );
                  })}
                  {/* Developer (retained) row */}
                  <TableRow className="bg-emerald-50/50" data-testid="row-shareholder-developer">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="w-8 h-8"><AvatarFallback className="text-xs bg-emerald-100 text-emerald-700">D</AvatarFallback></Avatar>
                        <div>
                          <div className="font-medium text-slate-900">Developer (retained)</div>
                          <div className="text-xs text-slate-500">Sponsor equity kept off-market</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">{rollup?.sales?.developerEquityUnits || 0}</TableCell>
                    <TableCell className="text-right font-medium">{(cap.developerEquityPercent || 0).toFixed ? cap.developerEquityPercent.toFixed(2) : cap.developerEquityPercent || 0}%</TableCell>
                    <TableCell className="text-right text-slate-500">—</TableCell>
                  </TableRow>
                  {/* Available (unsold) row */}
                  <TableRow className="bg-slate-50/50" data-testid="row-shareholder-available">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="w-8 h-8"><AvatarFallback className="text-xs bg-slate-100 text-slate-600">A</AvatarFallback></Avatar>
                        <div>
                          <div className="font-medium text-slate-900">Available (unsold)</div>
                          <div className="text-xs text-slate-500">Open for investor purchase</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium">{rollup?.sales?.availableUnits || 0}</TableCell>
                    <TableCell className="text-right font-medium">{(cap.availableEquityPercent || 0).toFixed ? cap.availableEquityPercent.toFixed(2) : cap.availableEquityPercent || 0}%</TableCell>
                    <TableCell className="text-right text-slate-500">—</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RowKV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="text-sm font-semibold text-slate-900">{value}</span>
    </div>
  );
}

// ======================= COMMUNICATIONS =======================
function CommunicationsTab({ projectId, project }: { projectId: string | number; project: any }) {
  const { toast } = useToast();
  const { data: updates, isLoading } = useQuery<any[]>({
    queryKey: ["/api/developer/projects", projectId, "updates"],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/developer/projects/${projectId}/updates`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ type: string; subject: string; body: string; mediaUrls: string[] }>({
    type: "general", subject: "", body: "", mediaUrls: [],
  });
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  function classifyAttachment(url: string): "image" | "video" | "document" {
    const u = url.toLowerCase().split("?")[0];
    if (/\.(png|jpe?g|webp|gif|avif)$/i.test(u)) return "image";
    if (/\.(mp4|webm|mov|m4v|avi)$/i.test(u))    return "video";
    return "document";
  }

  async function handleAttachmentUpload(file: File) {
    const isImage    = file.type.startsWith("image/");
    const isVideo    = file.type.startsWith("video/");
    const isDocument = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isImage && !isVideo && !isDocument) {
      toast({ title: "Unsupported file", description: "Allowed: image, video, or PDF.", variant: "destructive" });
      return;
    }
    const max = isImage ? 5 * 1024 * 1024 : isVideo ? 100 * 1024 * 1024 : 20 * 1024 * 1024;
    if (file.size > max) {
      toast({ title: "File too large", description: `Max ${Math.round(max / (1024 * 1024))} MB.`, variant: "destructive" });
      return;
    }
    setUploadingAttachment(true);
    try {
      const fd = new FormData();
      fd.append(isImage ? "image" : isVideo ? "video" : "document", file);
      const endpoint = isImage ? "/api/upload/image" : isVideo ? "/api/upload/video" : "/api/upload/document";
      const res = await fetch(endpoint, { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const url: string | undefined = data.url || data.documentUrl || data.videoUrl;
      if (!url) throw new Error("Server did not return a URL");
      setForm((prev) => ({ ...prev, mediaUrls: [...prev.mediaUrls, url] }));
      toast({ title: "Attachment uploaded" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message || "Try again", variant: "destructive" });
    } finally {
      setUploadingAttachment(false);
    }
  }

  function removeAttachment(idx: number) {
    setForm((prev) => ({ ...prev, mediaUrls: prev.mediaUrls.filter((_, i) => i !== idx) }));
  }

  const sendMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/developer/projects/${projectId}/updates`, form),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "updates"] });
      setOpen(false);
      setForm({ type: "general", subject: "", body: "", mediaUrls: [] });
      toast({ title: "Update sent", description: `Broadcast to investors of ${project.name}.` });
    },
    onError: (err: any) => toast(toastFromError(err, "Failed to send update")),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Project updates</CardTitle>
            <CardDescription>Email broadcasts sent to all confirmed investors in this project.</CardDescription>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700" data-testid="button-new-update">
                <Megaphone className="w-4 h-4 mr-2" /> Post update
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Post a project update</DialogTitle>
                <DialogDescription>Confirmed investors receive an email. The update is also posted to their dashboard.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Type</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger data-testid="select-update-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="general">General announcement</SelectItem>
                      <SelectItem value="construction">Construction update</SelectItem>
                      <SelectItem value="sales">Sales update</SelectItem>
                      <SelectItem value="financial">Financial update</SelectItem>
                      <SelectItem value="delay">Delay or risk</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Subject *</Label>
                  <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Foundation work complete" data-testid="input-update-subject" />
                </div>
                <div>
                  <Label>Message *</Label>
                  <div data-testid="input-update-body">
                    <RichTextEditor
                      content={form.body}
                      onChange={(html) => setForm({ ...form, body: html })}
                      placeholder="Share details, photos, or next steps. Use the toolbar to format your message."
                    />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">Investors receive this as an email and see it on their dashboard. Formatting and links are preserved.</p>
                </div>

                {/* Attachments */}
                <div>
                  <Label>Attachments</Label>
                  <p className="text-xs text-slate-500 mb-2">Photos (max 5 MB), videos (max 100 MB), or PDF documents (max 20 MB). Links are included in the email and shown on the investor dashboard.</p>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {form.mediaUrls.map((url, i) => {
                      const k = classifyAttachment(url);
                      return (
                        <div key={i} className="relative w-20 h-20 rounded border border-slate-200 overflow-hidden bg-slate-50" data-testid={`update-attachment-${i}`}>
                          {k === "image" ? (
                            <img src={url} alt={`Attachment ${i + 1}`} className="w-full h-full object-cover" />
                          ) : k === "video" ? (
                            <a href={url} target="_blank" rel="noopener noreferrer" className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-white">
                              <span className="text-2xl">▶</span>
                              <span className="text-[10px] mt-1">Video</span>
                            </a>
                          ) : (
                            <a href={url} target="_blank" rel="noopener noreferrer" className="w-full h-full flex flex-col items-center justify-center bg-red-50 text-red-700">
                              <span className="text-xs font-bold">PDF</span>
                              <span className="text-[10px] mt-0.5">Open</span>
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => removeAttachment(i)}
                            className="absolute top-0.5 right-0.5 bg-white/90 rounded-full p-0.5 shadow hover:bg-red-50"
                            data-testid={`button-remove-attachment-${i}`}
                          >
                            <X className="w-3 h-3 text-red-600" />
                          </button>
                        </div>
                      );
                    })}
                    <label className="w-20 h-20 rounded border-2 border-dashed border-slate-300 flex items-center justify-center cursor-pointer hover:bg-slate-50 hover:border-blue-400 transition" data-testid="button-add-attachment">
                      {uploadingAttachment ? (
                        <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                      ) : (
                        <ImagePlus className="w-5 h-5 text-slate-400" />
                      )}
                      <input
                        type="file"
                        accept="image/*,video/*,application/pdf,.pdf"
                        className="hidden"
                        disabled={uploadingAttachment}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleAttachmentUpload(file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => sendMutation.mutate()} disabled={!form.subject || !form.body || sendMutation.isPending} className="bg-blue-600 hover:bg-blue-700" data-testid="button-send-update">
                  {sendMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                  Send broadcast
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-32 bg-slate-100 rounded animate-pulse" />
          ) : !updates || updates.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <Mail className="w-10 h-10 mx-auto mb-3 text-slate-300" />
              <p>No updates posted yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {updates.map((u) => {
                const meta = UPDATE_TYPE[u.type] || UPDATE_TYPE.general;
                return (
                  <div key={u.id} className="border border-slate-200 rounded-lg p-5 bg-white" data-testid={`update-${u.id}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge className={meta.className}>{meta.label}</Badge>
                        <span className="text-xs text-slate-500">{u.sentAt ? new Date(u.sentAt).toLocaleString() : ""}</span>
                      </div>
                      <span className="text-xs text-slate-500">{u.recipientCount} recipient{u.recipientCount === 1 ? "" : "s"}</span>
                    </div>
                    <h4 className="font-semibold text-slate-900 mb-1">{u.subject}</h4>
                    <div className="text-sm text-slate-700 prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: u.body }} />
                    {Array.isArray(u.mediaUrls) && u.mediaUrls.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2" data-testid={`update-attachments-${u.id}`}>
                        {u.mediaUrls.map((url: string, i: number) => {
                          const k = classifyAttachment(url);
                          return (
                            <a
                              key={i}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block w-20 h-20 rounded border border-slate-200 overflow-hidden bg-slate-50 hover:border-blue-400"
                              data-testid={`update-${u.id}-attachment-${i}`}
                            >
                              {k === "image" ? (
                                <img src={url} alt={`Attachment ${i + 1}`} className="w-full h-full object-cover" />
                              ) : k === "video" ? (
                                <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-white">
                                  <span className="text-2xl">▶</span>
                                  <span className="text-[10px] mt-1">Video</span>
                                </div>
                              ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center bg-red-50 text-red-700">
                                  <span className="text-xs font-bold">PDF</span>
                                  <span className="text-[10px] mt-0.5">Open</span>
                                </div>
                              )}
                            </a>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
