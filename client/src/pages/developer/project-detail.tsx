import { useState, useEffect, type CSSProperties } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import DeveloperLayout from "@/components/developer/DeveloperLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
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
  GripVertical, ImagePlus, X, UserPlus, Wallet, Receipt, FileText as FileTextIcon,
} from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, Area, CartesianGrid, ComposedChart, ReferenceLine } from "recharts";
import { FileUpload } from "@/components/FileUpload";
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

function ReminderHistoryCell({
  reservationId,
  count,
  history,
  lastReminderSentAt,
}: {
  reservationId: number;
  count: number;
  history: { sentAt: string; sentByName?: string }[];
  lastReminderSentAt: string | null;
}) {
  const effectiveCount = count || history.length;
  if (effectiveCount === 0 && !lastReminderSentAt) {
    return <span className="text-xs text-slate-400">Never</span>;
  }
  const sorted = [...history].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
  const recent = sorted.slice(0, 3);
  const last = sorted[0]?.sentAt
    ? new Date(sorted[0].sentAt)
    : lastReminderSentAt
      ? new Date(lastReminderSentAt)
      : null;
  const heavy = effectiveCount >= 3;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-left hover:underline"
          data-testid={`button-reminder-history-${reservationId}`}
        >
          <span
            className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[11px] font-semibold border ${
              heavy
                ? "bg-amber-50 text-amber-700 border-amber-200"
                : "bg-blue-50 text-blue-700 border-blue-200"
            }`}
          >
            {effectiveCount}
          </span>
          <span className="text-xs text-slate-600">
            {last ? last.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-3"
        align="start"
        data-testid={`popover-reminder-history-${reservationId}`}
      >
        <div className="text-xs font-semibold text-slate-900 mb-1">
          Reminder history ({effectiveCount})
        </div>
        {heavy && (
          <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-2">
            You've reminded this investor {effectiveCount} times. Consider a phone call instead.
          </div>
        )}
        {recent.length > 0 ? (
          <ul className="space-y-1">
            {recent.map((r, i) => (
              <li key={i} className="text-xs text-slate-700 flex items-center gap-1.5">
                <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                <span>
                  {new Date(r.sentAt).toLocaleString(undefined, {
                    month: "short", day: "numeric",
                    hour: "numeric", minute: "2-digit",
                  })}
                  {r.sentByName && (
                    <span className="text-slate-500"> · {r.sentByName}</span>
                  )}
                </span>
              </li>
            ))}
            {effectiveCount > recent.length && (
              <li className="text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                + {effectiveCount - recent.length} earlier reminder{effectiveCount - recent.length === 1 ? "" : "s"}
              </li>
            )}
          </ul>
        ) : last ? (
          <div className="text-xs text-slate-600">
            Last sent {last.toLocaleString(undefined, {
              month: "short", day: "numeric", year: "numeric",
              hour: "numeric", minute: "2-digit",
            })}
          </div>
        ) : (
          <div className="text-xs text-slate-500">No reminders sent yet.</div>
        )}
      </PopoverContent>
    </Popover>
  );
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

        <TabsContent value="overview"><OverviewTab project={project} rollup={rollup} canDelete={isOwner || myPermissions.includes("settings")} /></TabsContent>
        {visibleTabs.some(t => t.value === "fundraising")  && <TabsContent value="fundraising"><FundraisingTab project={project} rollup={rollup} projectKey={projectKey} /></TabsContent>}
        {visibleTabs.some(t => t.value === "construction") && <TabsContent value="construction"><ConstructionTab projectId={projectId} project={project} /></TabsContent>}
        {visibleTabs.some(t => t.value === "sales")        && <TabsContent value="sales"><SalesTab projectId={projectId} project={project} /></TabsContent>}
        {visibleTabs.some(t => t.value === "captable")     && <TabsContent value="captable"><CapTableTab project={project} rollup={rollup} /></TabsContent>}
        {visibleTabs.some(t => t.value === "comms")        && <TabsContent value="comms"><CommunicationsTab projectId={projectId} project={project} /></TabsContent>}
      </Tabs>
    </DeveloperLayout>
  );
}

// ======================= OVERVIEW =======================
function OverviewTab({ project, rollup, canDelete }: { project: any; rollup: any; canDelete: boolean }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const submitMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/developer/projects/${project.id}/submit`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", project.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects"] });
      toast({ title: "Submitted for approval", description: "Brikvest admin will review your project." });
    },
    onError: () => toast({ title: "Submission failed", variant: "destructive" }),
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/developer/projects/${project.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects"] });
      toast({ title: "Project deleted", description: `"${project.name}" has been removed.` });
      setLocation("/developer");
    },
    onError: (err: any) => toast(toastFromError(err, "Couldn't delete project")),
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
        <StatCard icon={Users} label="Investors" value={String(rollup?.funnel?.confirmed || 0)} sub={`${(rollup?.funnel?.prospective || 0) + (rollup?.funnel?.dueDiligence || 0) + (rollup?.funnel?.documentation || 0) + (rollup?.funnel?.paymentIncomplete || 0)} prospective investors`} />
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

      {canDelete && (
        <Card className="border-rose-200">
          <CardHeader>
            <CardTitle className="text-rose-900 text-base">Danger zone</CardTitle>
            <CardDescription>
              Deleting this project removes its milestones, updates, leads, notes and any pending prospective investors. Confirmed investors block deletion — contact Brikvest support to unwind those.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" data-testid="button-delete-project" disabled={deleteProjectMutation.isPending}>
                  {deleteProjectMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                  Delete project
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete "{project.name}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes the project and all its data — milestones, updates, leads, investor notes, valuations and any pending prospective investors. This can't be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteProjectMutation.mutate()}
                    className="bg-rose-600 hover:bg-rose-700"
                    data-testid="button-confirm-delete"
                  >
                    Yes, delete it
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function FundingModelCard({ project }: { project: any }) {
  const FUNDING_LABELS: Record<string, { label: string; tone: string; blurb: string }> = {
    equity:       { label: "Equity / Co-ownership", tone: "bg-blue-100 text-blue-700",       blurb: "Investors own a fractional share of the SPV." },
    fixed_return: { label: "Fixed return",          tone: "bg-emerald-100 text-emerald-700", blurb: "You've committed a fixed % return to investors." },
    profit_share: { label: "Profit share",          tone: "bg-purple-100 text-purple-700",   blurb: "Investors share a % of net profit at exit." },
    loan:         { label: "Loan / Debt",           tone: "bg-amber-100 text-amber-700",     blurb: "Capital is repaid with interest at the end of the term." },
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
  const rawTypes: string[] = Array.isArray(project.fundingTypes) && project.fundingTypes.length > 0
    ? project.fundingTypes
    : (project.fundingType ? [project.fundingType] : ["equity"]);
  const isSelfFunded = rawTypes.includes("self_funded") || project.acceptsExternalInvestors === false;
  const types = isSelfFunded ? ["self_funded"] : rawTypes.filter(t => t !== "self_funded");
  const isCombo = types.length > 1;
  const blurb = isCombo
    ? "Combined model — see funding notes for the full structure."
    : (FUNDING_LABELS[types[0]] || FUNDING_LABELS.equity).blurb;

  const returnText = project.expectedReturnPercent
    ? `${parseFloat(project.expectedReturnPercent).toLocaleString()}% ${PERIOD[project.returnPeriod || "annual"] || ""}`.trim()
    : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle>Funding model</CardTitle>
          <div className="flex items-center gap-1.5 flex-wrap">
            {types.map((t) => {
              const m = FUNDING_LABELS[t] || FUNDING_LABELS.equity;
              return (
                <span
                  key={t}
                  className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full ${m.tone}`}
                  data-testid={`badge-funding-${t}`}
                >
                  {m.label}
                </span>
              );
            })}
          </div>
        </div>
        <p className="text-sm text-slate-500 mt-1">{blurb}</p>
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
function FundraisingTab({ project, rollup, projectKey }: { project: any; rollup: any; projectKey: string }) {
  const { toast } = useToast();
  const f = rollup?.funding || {};
  const funnel = rollup?.funnel || {};
  const velocityData: { weekStart: string; cumulativeRaised: number; targetCumulative: number | null }[] = rollup?.velocity || [];
  const weeklyTarget: number | null = rollup?.weeklyTarget ?? null;
  const conversionEfficiency: { month: string; percent: number; confirmed: number; total: number }[] = rollup?.conversionEfficiency || [];
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

  const updateStageMutation = useMutation({
    mutationFn: async (args: { reservationId: number; funnelStage: string | null }) =>
      apiRequest("PATCH", `/api/developer/reservations/${args.reservationId}/stage`, { funnelStage: args.funnelStage }),
    onSuccess: () => {
      // The parent rollup + investors queries are keyed by the URL projectKey
      // (slug or numeric id), not project.id, so invalidate using projectKey.
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", project.id, "investors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectKey, "investors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectKey, "rollup"] });
      toast({ title: "Stage updated" });
    },
    onError: (err: any) => toast(toastFromError(err, "Couldn't update stage")),
  });

  const STAGE_LABEL: Record<string, { label: string; className: string }> = {
    reserved:                { label: "Reserved",          className: "bg-amber-100 text-amber-700" },
    payment_pending:         { label: "Payment Pending",   className: "bg-orange-100 text-orange-700" },
    converted_to_investment: { label: "Confirmed",         className: "bg-emerald-100 text-emerald-700" },
    expired:                 { label: "Expired",           className: "bg-red-100 text-red-700" },
    cancelled:               { label: "Cancelled",         className: "bg-slate-100 text-slate-600" },
  };

  const FUNNEL_STAGE_OPTIONS: { value: string; label: string }[] = [
    { value: "prospective",        label: "Prospective" },
    { value: "due_diligence",      label: "Due Diligence" },
    { value: "documentation",      label: "Documentation" },
    { value: "payment_incomplete", label: "Payment Incomplete" },
    { value: "confirmed",          label: "Confirmed" },
  ];

  const funnelData = [
    { stage: "Prospective",        count: funnel.prospective || 0 },
    { stage: "Due Diligence",      count: funnel.dueDiligence || 0 },
    { stage: "Documentation",      count: funnel.documentation || 0 },
    { stage: "Payment Incomplete", count: funnel.paymentIncomplete || 0 },
    { stage: "Confirmed",          count: funnel.confirmed || 0 },
  ];
  const funnelTotal = funnelData.reduce((s, x) => s + x.count, 0);
  const dropOff = funnelData.map((d, i) => {
    if (i === 0) return null;
    const prev = funnelData[i - 1].count;
    if (prev === 0) return null;
    return Math.round(((prev - d.count) / prev) * 100);
  });

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

      <Card data-testid="card-velocity">
        <CardHeader>
          <CardTitle>Fundraising velocity</CardTitle>
          <CardDescription>
            Cumulative {project.currency || "NGN"} raised over the last 12 weeks
            {weeklyTarget ? ` — target ${fmt(project.currency, weeklyTarget)} per week to hit your planned completion` : ""}
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          {velocityData.every(v => v.cumulativeRaised === 0) ? (
            <div className="text-center py-10 text-slate-500 text-sm" data-testid="empty-velocity">
              No prospective investors yet — share your project link to start tracking conversion.
            </div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={velocityData} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
                  <defs>
                    <linearGradient id="velocityFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="#2563eb" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis
                    dataKey="weekStart"
                    tickFormatter={(d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    tickFormatter={(v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${Math.round(v / 1_000)}k` : String(v)}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    formatter={(v: number) => fmt(project.currency, v)}
                    labelFormatter={(d: string) => `Week of ${new Date(d).toLocaleDateString()}`}
                  />
                  <Area type="monotone" dataKey="cumulativeRaised" name="Raised" stroke="#2563eb" strokeWidth={2} fill="url(#velocityFill)" />
                  {weeklyTarget && velocityData.some(v => v.targetCumulative !== null) && (
                    <Line
                      type="monotone"
                      dataKey="targetCumulative"
                      name="Target pace"
                      stroke="#10b981"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}
                  <Legend verticalAlign="top" height={24} iconType="line" wrapperStyle={{ fontSize: 11 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-funnel">
        <CardHeader>
          <CardTitle>Conversion funnel</CardTitle>
          <CardDescription>From prospective investor to confirmed investment. Drop-off shown between stages.</CardDescription>
        </CardHeader>
        <CardContent>
          {funnelTotal === 0 ? (
            <div className="text-center py-10 text-slate-500 text-sm" data-testid="empty-funnel">
              No prospective investors yet — share your project link to start tracking conversion.
            </div>
          ) : (
            <div className="space-y-2">
              {funnelData.map((d, i) => {
                const widthPct = funnelData[0].count > 0 ? Math.max(8, Math.round((d.count / funnelData[0].count) * 100)) : 8;
                return (
                  <div key={d.stage} data-testid={`funnel-row-${i}`}>
                    {i > 0 && dropOff[i] !== null && (
                      <div className="flex items-center gap-2 pl-2 mb-1 text-xs text-rose-600">
                        <span>↓ {dropOff[i]}% drop-off</span>
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      <div className="w-40 text-sm font-medium text-slate-700">{d.stage}</div>
                      <div className="flex-1 bg-slate-100 rounded-md h-9 relative overflow-hidden">
                        <div
                          className="h-full bg-blue-600 transition-all rounded-md flex items-center justify-end pr-3 text-xs font-semibold text-white"
                          style={{ width: `${widthPct}%` }}
                        >
                          {d.count}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-conversion-efficiency">
        <CardHeader>
          <CardTitle>Investor Conversion Efficiency</CardTitle>
          <CardDescription>Confirmed ÷ total prospects each month, last 12 months.</CardDescription>
        </CardHeader>
        <CardContent>
          {conversionEfficiency.every(c => c.total === 0) ? (
            <div className="text-center py-10 text-slate-500 text-sm" data-testid="empty-efficiency">
              No prospective investors yet — share your project link to start tracking conversion.
            </div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={conversionEfficiency} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis
                    dataKey="month"
                    tickFormatter={(m: string) => {
                      const [y, mo] = m.split("-");
                      return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString(undefined, { month: "short" });
                    }}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11 }} domain={[0, 100]} />
                  <Tooltip
                    formatter={(_v: any, _name: any, ctx: any) => {
                      const p = ctx?.payload as { percent: number; confirmed: number; total: number };
                      return [`${p.percent}% (${p.confirmed}/${p.total})`, "Efficiency"];
                    }}
                    labelFormatter={(m: string) => {
                      const [y, mo] = m.split("-");
                      return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
                    }}
                  />
                  <Line type="monotone" dataKey="percent" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
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
          <CardDescription>Search, filter, and drill down to see each prospective investor's history and payment activity.</CardDescription>
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

          {investors.length === 0 ? (
            <div className="text-center py-10 text-slate-500" data-testid="empty-investors">
              No prospective investors yet — share your project link to start tracking conversion.
            </div>
          ) : filtered.length === 0 ? (
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
                    <TableHead className="text-right">Created</TableHead>
                    <TableHead className="text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((i) => {
                    const meta = STAGE_LABEL[i.status] || { label: i.status, className: "bg-slate-100" };
                    const isTerminal = i.status === "expired" || i.status === "cancelled";
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
                        <TableCell>
                          {isTerminal ? (
                            <Badge className={meta.className}>{meta.label}</Badge>
                          ) : (
                            <Select
                              value={i.funnelStage || "prospective"}
                              onValueChange={(v) => updateStageMutation.mutate({ reservationId: i.reservationId, funnelStage: v })}
                              disabled={updateStageMutation.isPending}
                            >
                              <SelectTrigger className="h-8 w-44 text-xs" data-testid={`select-stage-${i.reservationId}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {FUNNEL_STAGE_OPTIONS.map(o => (
                                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
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
                  <div className="text-xs text-slate-500 uppercase">Investor ID</div>
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

              {/* Funnel timeline */}
              <div className="border-t border-slate-200 pt-4">
                <div className="text-xs text-slate-500 uppercase mb-2">Funnel timeline</div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full bg-blue-500 mt-2" />
                    <div>
                      <div className="font-medium text-slate-900">Prospect created</div>
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
                        <div className="font-medium text-slate-900">Expired</div>
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

const STAGE_STATUS_META: Record<string, { label: string; className: string }> = {
  not_started: { label: "Not started", className: "bg-slate-100 text-slate-700" },
  in_progress: { label: "In progress", className: "bg-blue-100 text-blue-700" },
  done:        { label: "Done",        className: "bg-emerald-100 text-emerald-700" },
  delayed:     { label: "Delayed",     className: "bg-amber-100 text-amber-700" },
};

function fmtDate(d: any): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function stageVariance(stage: any): { label: string; className: string; days: number | null } {
  // Variance compares plannedCompletion against (actualCompletion ?? today):
  //   green  → on time or early (days <= 0, including incomplete stages still on track)
  //   amber  → up to 7 days late / overdue
  //   red    → more than 7 days late / overdue
  if (!stage.plannedCompletionDate) return { label: "No plan", className: "bg-slate-100 text-slate-500", days: null };
  const planned = new Date(stage.plannedCompletionDate);
  const ref = stage.actualCompletionDate ? new Date(stage.actualCompletionDate) : new Date();
  const days = daysBetween(planned, ref);
  const isComplete = !!stage.actualCompletionDate;
  if (days <= 0) {
    // On schedule (incomplete) or completed on/before plan
    let label: string;
    if (isComplete) label = days === 0 ? "On time" : `${-days}d early`;
    else            label = days === 0 ? "Due today" : `${-days}d to go`;
    return { label, className: "bg-emerald-100 text-emerald-700", days };
  }
  const suffix = isComplete ? "late" : "overdue";
  if (days <= 7) return { label: `${days}d ${suffix}`, className: "bg-amber-100 text-amber-700", days };
  return { label: `${days}d ${suffix}`, className: "bg-red-100 text-red-700", days };
}

function ScheduleGantt({ stages }: { stages: any[] }) {
  // Compute the timeline bounds across all planned + actual dates.
  const dates: number[] = [];
  for (const s of stages) {
    for (const k of ["plannedStartDate", "plannedCompletionDate", "actualStartDate", "actualCompletionDate"]) {
      if (s[k]) dates.push(new Date(s[k]).getTime());
    }
  }
  if (dates.length < 2) {
    return (
      <div className="text-center py-8 text-sm text-slate-500">
        Add planned dates to your stages to see a timeline.
      </div>
    );
  }
  const min = Math.min(...dates);
  const max = Math.max(...dates, Date.now());
  const span = Math.max(max - min, 1);
  const pct = (t: number) => `${((t - min) / span) * 100}%`;
  const todayPct = pct(Date.now());
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
        <span>{fmtDate(min)}</span>
        <span>Today: {fmtDate(Date.now())}</span>
        <span>{fmtDate(max)}</span>
      </div>
      <div className="relative">
        {/* Today reference line */}
        <div
          className="absolute top-0 bottom-0 w-px bg-blue-500 z-10 pointer-events-none"
          style={{ left: todayPct }}
          aria-hidden
        >
          <div className="absolute -top-1 -translate-x-1/2 w-2 h-2 rounded-full bg-blue-500" />
        </div>
        <div className="space-y-2">
          {stages.map((s) => {
            const ps = s.plannedStartDate      ? new Date(s.plannedStartDate).getTime()      : null;
            const pe = s.plannedCompletionDate ? new Date(s.plannedCompletionDate).getTime() : null;
            const as = s.actualStartDate       ? new Date(s.actualStartDate).getTime()       : null;
            const ae = s.actualCompletionDate  ? new Date(s.actualCompletionDate).getTime()  : (as ? Date.now() : null);
            return (
              <div key={s.id} className="grid grid-cols-12 gap-2 items-center text-xs" data-testid={`gantt-row-${s.stageKey}`}>
                <div className="col-span-3 truncate text-slate-700 font-medium">{s.name}</div>
                <div className="col-span-9 relative h-6 bg-slate-50 rounded">
                  {ps !== null && pe !== null && pe > ps && (
                    <div
                      className="absolute top-0.5 h-2 rounded bg-blue-200"
                      style={{ left: pct(ps), width: `calc(${pct(pe)} - ${pct(ps)})` }}
                      title={`Planned: ${fmtDate(ps)} → ${fmtDate(pe)}`}
                    />
                  )}
                  {as !== null && ae !== null && ae > as && (
                    <div
                      className={`absolute bottom-0.5 h-2 rounded ${s.actualCompletionDate ? "bg-emerald-500" : "bg-blue-500"}`}
                      style={{ left: pct(as), width: `calc(${pct(ae)} - ${pct(as)})` }}
                      title={`Actual: ${fmtDate(as)} → ${s.actualCompletionDate ? fmtDate(ae) : "in progress"}`}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-4 pt-2 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-2 rounded bg-blue-200" /> Planned</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-2 rounded bg-blue-500" /> In progress</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-2 rounded bg-emerald-500" /> Completed</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-0.5 h-3 bg-blue-500" /> Today</span>
      </div>
    </div>
  );
}

function StageEditDialog({
  stage,
  onClose,
  onSave,
  saving,
}: {
  stage: any | null;
  onClose: () => void;
  onSave: (updates: any) => void;
  saving: boolean;
}) {
  const toIso = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : "");
  const [form, setForm] = useState({
    plannedStartDate: toIso(stage?.plannedStartDate),
    plannedCompletionDate: toIso(stage?.plannedCompletionDate),
    actualStartDate: toIso(stage?.actualStartDate),
    actualCompletionDate: toIso(stage?.actualCompletionDate),
    status: stage?.status || "not_started",
    notes: stage?.notes || "",
  });
  // Re-sync state when a different stage opens
  const stageId = stage?.id;
  useEffect(() => {
    setForm({
      plannedStartDate: toIso(stage?.plannedStartDate),
      plannedCompletionDate: toIso(stage?.plannedCompletionDate),
      actualStartDate: toIso(stage?.actualStartDate),
      actualCompletionDate: toIso(stage?.actualCompletionDate),
      status: stage?.status || "not_started",
      notes: stage?.notes || "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageId]);

  if (!stage) return null;
  return (
    <Dialog open={!!stage} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit stage — {stage.name}</DialogTitle>
          <DialogDescription>Set planned and actual dates. Variance and overall completion update automatically.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Planned start</Label>
              <Input type="date" value={form.plannedStartDate} onChange={(e) => setForm({ ...form, plannedStartDate: e.target.value })} data-testid="input-planned-start" />
            </div>
            <div>
              <Label>Planned completion</Label>
              <Input type="date" value={form.plannedCompletionDate} onChange={(e) => setForm({ ...form, plannedCompletionDate: e.target.value })} data-testid="input-planned-completion" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Actual start</Label>
              <Input type="date" value={form.actualStartDate} onChange={(e) => setForm({ ...form, actualStartDate: e.target.value })} data-testid="input-actual-start" />
            </div>
            <div>
              <Label>Actual completion</Label>
              <Input type="date" value={form.actualCompletionDate} onChange={(e) => setForm({ ...form, actualCompletionDate: e.target.value })} data-testid="input-actual-completion" />
            </div>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger data-testid="select-stage-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="not_started">Not started</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="done">Done</SelectItem>
                <SelectItem value="delayed">Delayed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes about this stage" data-testid="textarea-stage-notes" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="bg-blue-600 hover:bg-blue-700"
            disabled={saving}
            onClick={() => onSave({
              plannedStartDate: form.plannedStartDate || null,
              plannedCompletionDate: form.plannedCompletionDate || null,
              actualStartDate: form.actualStartDate || null,
              actualCompletionDate: form.actualCompletionDate || null,
              status: form.status,
              notes: form.notes,
            })}
            data-testid="button-save-stage"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            Save stage
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConstructionTab({ projectId, project }: { projectId: string | number; project: any }) {
  const { toast } = useToast();
  const { data: stages, isLoading: stagesLoading } = useQuery<any[]>({
    queryKey: ["/api/developer/projects", projectId, "stages"],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/developer/projects/${projectId}/stages`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });
  const [editingStage, setEditingStage] = useState<any | null>(null);

  const updateStageMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: any }) =>
      apiRequest("PATCH", `/api/developer/projects/${projectId}/stages/${id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "stages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId] });
      setEditingStage(null);
      toast({ title: "Stage updated" });
    },
    onError: (e: any) => toast(toastFromError(e, "Failed to update stage")),
  });

  const sortedStages = stages ? [...stages].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)) : [];
  const completedCount = sortedStages.filter(s => !!s.actualCompletionDate).length;
  const totalStages = sortedStages.length || 8;
  const completionPct = totalStages > 0 ? Math.round((completedCount / totalStages) * 100) : 0;
  const nextStage = sortedStages.find(s => !s.actualCompletionDate);

  // Project-level duration in months (planned)
  const projectDurationMonths = (() => {
    if (!project?.plannedStartDate || !project?.plannedCompletionDate) return null;
    const s = new Date(project.plannedStartDate);
    const e = new Date(project.plannedCompletionDate);
    const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
    return Math.max(months, 0);
  })();

  return (
    <div className="space-y-6">
      {/* Schedule overview (read-only — project-level dates are edited in project settings) */}
      <Card data-testid="card-schedule-overview">
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
          <CardDescription>Project-level dates that frame the construction timeline. Stage dates live below.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-slate-500 uppercase">Planned start</div>
              <div className="mt-2 text-sm text-slate-900" data-testid="text-project-planned-start">{fmtDate(project?.plannedStartDate)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 uppercase">Planned completion</div>
              <div className="mt-2 text-sm text-slate-900" data-testid="text-project-planned-completion">{fmtDate(project?.plannedCompletionDate)}</div>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <div className="text-xs text-slate-500 uppercase">Actual completion</div>
                <HelpTip>Auto-set when every stage below has an actual completion date.</HelpTip>
              </div>
              <div className="mt-2 text-sm text-slate-900" data-testid="text-actual-completion">{fmtDate(project?.actualCompletionDate)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 uppercase">Duration (planned)</div>
              <div className="mt-2 text-sm text-slate-900" data-testid="text-project-duration">
                {projectDurationMonths === null ? "—" : `${projectDurationMonths} month${projectDurationMonths === 1 ? "" : "s"}`}
              </div>
            </div>
          </div>
          {!project?.plannedStartDate && !project?.plannedCompletionDate && (
            <p className="text-xs text-slate-500 mt-3">
              Set planned start and completion dates in project settings to populate the timeline.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Completion progress */}
      <Card data-testid="card-completion-progress">
        <CardContent className="py-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm text-slate-500">Project completion</div>
              <div className="text-3xl font-bold text-slate-900 mt-1">{completionPct}%</div>
              <div className="text-xs text-slate-500 mt-0.5">{completedCount} of {totalStages} stages complete</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500 uppercase">Next stage</div>
              <div className="text-sm font-medium text-slate-900 mt-1">{nextStage?.name || "All complete"}</div>
              {nextStage?.plannedCompletionDate && (
                <div className="text-xs text-slate-500 mt-0.5">by {fmtDate(nextStage.plannedCompletionDate)}</div>
              )}
            </div>
          </div>
          <Progress value={completionPct} className="h-3" />
        </CardContent>
      </Card>

      {/* Stages table */}
      <Card>
        <CardHeader>
          <CardTitle>Construction stages</CardTitle>
          <CardDescription>Track each of the 8 stages — planned vs actual dates and delay variance.</CardDescription>
        </CardHeader>
        <CardContent>
          {stagesLoading ? (
            <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stage</TableHead>
                    <TableHead>Planned</TableHead>
                    <TableHead>Actual</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Variance</TableHead>
                    <TableHead className="text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedStages.map((s) => {
                    const meta = STAGE_STATUS_META[s.status] || STAGE_STATUS_META.not_started;
                    const variance = stageVariance(s);
                    const ps = s.plannedStartDate ? new Date(s.plannedStartDate) : null;
                    const pe = s.plannedCompletionDate ? new Date(s.plannedCompletionDate) : null;
                    const durationDays = ps && pe ? Math.max(daysBetween(ps, pe), 0) : null;
                    return (
                      <TableRow key={s.id} data-testid={`row-stage-${s.stageKey}`}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell className="text-xs text-slate-600 whitespace-nowrap">
                          {fmtDate(s.plannedStartDate)} → {fmtDate(s.plannedCompletionDate)}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 whitespace-nowrap">
                          {fmtDate(s.actualStartDate)} → {fmtDate(s.actualCompletionDate)}
                        </TableCell>
                        <TableCell className="text-right text-xs text-slate-600">
                          {durationDays === null ? "—" : `${durationDays}d`}
                        </TableCell>
                        <TableCell><Badge className={meta.className}>{meta.label}</Badge></TableCell>
                        <TableCell><Badge className={variance.className} data-testid={`variance-${s.stageKey}`}>{variance.label}</Badge></TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => setEditingStage(s)} data-testid={`button-edit-stage-${s.stageKey}`}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
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

      {/* Planned vs actual timeline */}
      <Card>
        <CardHeader>
          <CardTitle>Planned vs actual timeline</CardTitle>
          <CardDescription>Top bar (light blue) is the plan, bottom bar is what actually happened. Slippage is the gap.</CardDescription>
        </CardHeader>
        <CardContent>
          {stagesLoading ? (
            <div className="h-40 bg-slate-100 rounded animate-pulse" />
          ) : (
            <ScheduleGantt stages={sortedStages} />
          )}
        </CardContent>
      </Card>

      <StageEditDialog
        stage={editingStage}
        onClose={() => setEditingStage(null)}
        onSave={(updates) => editingStage && updateStageMutation.mutate({ id: editingStage.id, updates })}
        saving={updateStageMutation.isPending}
      />

      {/* Budget & vendor tracking. The tab itself is only rendered to users with the
          `construction` permission, so all mutations within are safe to expose. */}
      <BudgetSection projectId={projectId} project={project} stages={sortedStages} />

      {/* Legacy: project status fields + free-form milestones, collapsed by default */}
      <Accordion type="single" collapsible>
        <AccordionItem value="detailed-milestones" className="border border-slate-200 rounded-lg bg-white">
          <AccordionTrigger className="px-4 py-3 hover:no-underline" data-testid="accordion-detailed-milestones">
            <div className="text-left">
              <div className="font-semibold text-slate-900">Detailed milestones</div>
              <div className="text-xs text-slate-500 font-normal">Optional free-form milestone list with photos and a public status summary.</div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <LegacyMilestonesSection projectId={projectId} project={project} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

// Legacy free-form milestone list + project-status fields, preserved per task spec.
function LegacyMilestonesSection({ projectId, project }: { projectId: string | number; project: any }) {
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
    plannedStartDate: project?.plannedStartDate ? new Date(project.plannedStartDate).toISOString().slice(0, 10) : "",
    plannedCompletionDate: project?.plannedCompletionDate ? new Date(project.plannedCompletionDate).toISOString().slice(0, 10) : "",
    risksDelays: project?.risksDelays || "",
    latestUpdateText: project?.latestUpdateText || "",
  });
  const [fieldsDirty, setFieldsDirty] = useState(false);

  const saveProjectFields = useMutation({
    mutationFn: async () => apiRequest("PATCH", `/api/developer/projects/${projectId}`, {
      currentStage: projectFields.currentStage || null,
      expectedCompletionDate: projectFields.expectedCompletionDate || null,
      plannedStartDate: projectFields.plannedStartDate || null,
      plannedCompletionDate: projectFields.plannedCompletionDate || null,
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

  const updateField = (k: keyof typeof projectFields, v: string) => {
    setProjectFields((prev) => ({ ...prev, [k]: v }));
    setFieldsDirty(true);
  };

  return (
    <div className="space-y-6">
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-1.5">
                <Label>Planned start date</Label>
                <HelpTip>Used by the Construction schedule (top of this tab) as the start of the project timeline.</HelpTip>
              </div>
              <Input
                type="date"
                value={projectFields.plannedStartDate}
                onChange={(e) => updateField("plannedStartDate", e.target.value)}
                data-testid="input-edit-planned-start"
              />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <Label>Planned completion date</Label>
                <HelpTip>The target end date for construction. Drives the schedule's planned duration and slippage indicators.</HelpTip>
              </div>
              <Input
                type="date"
                value={projectFields.plannedCompletionDate}
                onChange={(e) => updateField("plannedCompletionDate", e.target.value)}
                data-testid="input-edit-planned-completion"
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
  const { data: rollup } = useQuery<any>({
    queryKey: ["/api/developer/projects", projectId, "rollup"],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/developer/projects/${projectId}/rollup`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });
  const sendReminder = useMutation({
    mutationFn: async (reservationId: number) =>
      apiRequest("POST", `/api/developer/projects/${projectId}/reservations/${reservationId}/remind`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "investors"] });
      toast({ title: "Reminder sent", description: "The investor has been emailed a payment reminder." });
    },
    onError: (err: any) => toast(toastFromError(err, "Could not send reminder")),
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
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
        <Card data-testid="card-lead-conversion">
          <CardContent className="py-5">
            <div className="text-xs uppercase tracking-wide text-slate-500">Lead conversion</div>
            {rollup?.leadConversionRate ? (
              <>
                <div className="text-2xl font-bold text-slate-900 mt-1">
                  {rollup.leadConversionRate.percent}<span className="text-base font-normal text-slate-500">%</span>
                </div>
                <div className="text-xs text-slate-500 mt-2">
                  {rollup.leadConversionRate.confirmed} confirmed / {rollup.leadConversionRate.totalProspects} prospects
                </div>
              </>
            ) : (
              <>
                <div className="text-2xl font-bold text-slate-400 mt-1">—</div>
                <div className="text-xs text-slate-500 mt-2">No pipeline data yet</div>
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

      {/* Unit mix — Sold vs Remaining by unit type */}
      <Card>
        <CardHeader>
          <CardTitle>Sold vs Remaining by unit type</CardTitle>
          <CardDescription>
            {Array.isArray(rollup?.unitMix) && rollup.unitMix.length > 0
              ? `Inventory breakdown across the ${rollup.unitMix.length} configured unit type${rollup.unitMix.length === 1 ? "" : "s"}.`
              : "Configure unit types in project settings to see this breakdown."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {Array.isArray(rollup?.unitMix) && rollup.unitMix.length > 0 ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rollup.unitMix} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="label" stroke="#64748b" fontSize={12} />
                  <YAxis stroke="#64748b" fontSize={12} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="sold" name="Sold" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="remaining" name="Remaining" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-center py-12 text-sm text-slate-500" data-testid="empty-unit-mix">
              Add unit types in project settings to see this breakdown.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Clients still owing — reservations pending payment */}
      {(() => {
        const owing = list.filter((i: any) => i.status === "reserved" || i.funnelStage === "payment_incomplete");
        if (owing.length === 0) return null;
        return (
          <Card data-testid="card-owing-clients">
            <CardHeader>
              <CardTitle>Clients still owing</CardTitle>
              <CardDescription>{owing.length} {owing.length === 1 ? "reservation" : "reservations"} with pending payment. Reminders are throttled to one per 24 hours.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>{noun.Plural}</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead>Days overdue</TableHead>
                      <TableHead>Reminders</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {owing.map((inv: any) => {
                      const due = inv.expiresAt ? new Date(inv.expiresAt) : null;
                      const overdue = due ? due.getTime() < Date.now() : false;
                      const daysOverdue = overdue && due
                        ? Math.floor((Date.now() - due.getTime()) / (24 * 60 * 60 * 1000))
                        : 0;
                      const last = inv.lastReminderSentAt ? new Date(inv.lastReminderSentAt) : null;
                      const throttled = last ? (Date.now() - last.getTime()) < 24 * 60 * 60 * 1000 : false;
                      const isSending = sendReminder.isPending && sendReminder.variables === inv.reservationId;
                      return (
                        <TableRow key={inv.reservationId} data-testid={`row-owing-${inv.reservationId}`}>
                          <TableCell>
                            <div className="font-medium text-slate-900">{inv.name}</div>
                            <div className="text-xs text-slate-500">{inv.email}</div>
                          </TableCell>
                          <TableCell>{fmtUnits(inv.units)}</TableCell>
                          <TableCell>{fmt(inv.currency, inv.amount)}</TableCell>
                          <TableCell>
                            {due ? (
                              <span className={overdue ? "text-red-600 font-medium" : "text-slate-700"}>
                                {due.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                              </span>
                            ) : <span className="text-slate-400">—</span>}
                          </TableCell>
                          <TableCell data-testid={`cell-days-overdue-${inv.reservationId}`}>
                            {overdue ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-50 text-red-700 text-xs font-semibold border border-red-200">
                                {daysOverdue} {daysOverdue === 1 ? "day" : "days"}
                              </span>
                            ) : due ? (
                              <span className="text-xs text-slate-500">—</span>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <ReminderHistoryCell
                              reservationId={inv.reservationId}
                              count={inv.reminderCount ?? (inv.reminderHistory?.length ?? 0)}
                              history={inv.reminderHistory || []}
                              lastReminderSentAt={inv.lastReminderSentAt}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={throttled || isSending}
                              onClick={() => sendReminder.mutate(inv.reservationId)}
                              data-testid={`button-send-reminder-${inv.reservationId}`}
                              title={throttled ? "A reminder was already sent in the last 24 hours" : "Send a payment reminder email"}
                            >
                              {isSending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Mail className="w-3.5 h-3.5 mr-1.5" />}
                              {throttled ? "Sent recently" : "Send reminder"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        );
      })()}

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
                    <TableHead>Last contacted</TableHead>
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
                        <ReminderHistoryCell
                          reservationId={inv.reservationId}
                          count={inv.reminderCount ?? (inv.reminderHistory?.length ?? 0)}
                          history={inv.reminderHistory || []}
                          lastReminderSentAt={inv.lastReminderSentAt ?? null}
                        />
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
      toast({ title: "Lead converted to a prospective investor" });
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
            Track demand before it becomes a prospective investor. {leadCounts.qualified} qualified •{" "}
            {Math.round(qualifiedConversionRate * 100)}% historical conversion to prospective investor.
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
            {leads.length === 0 ? "No leads yet. Add one to start tracking early demand before it becomes a prospective investor." : "No leads in this stage."}
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
              <DialogDescription>Capture interest before it becomes a prospective investor.</DialogDescription>
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
              <DialogTitle>Convert {convertLead?.fullName} to a prospective investor</DialogTitle>
              <DialogDescription>
                A new prospective investor entry will be created in your investor list. The lead will be marked as Converted.
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
                Create prospective investor
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

// ============================================================================
// BUDGET & VENDOR TRACKING (Construction tab)
// ============================================================================

interface BudgetStageRow {
  stageId: number | null;
  stageKey: string;
  name: string;
  sortOrder: number;
  budgetAmount: number;
  vendorContract: number;
  spent: number;
  outstanding: number;
  vendorCount: number;
}
interface BudgetVendorRow {
  id: number;
  name: string;
  workCategory: string | null;
  stageId: number | null;
  currency: string;
  contractAmount: number;
  paid: number;
  outstanding: number;
  status: string;
}
interface BudgetRollup {
  currency: string;
  totalBudget: number;
  totalContract: number;
  totalSpent: number;
  totalOutstanding: number;
  remaining: number;
  plannedCompletionDate: string | null;
  stages: BudgetStageRow[];
  vendors: BudgetVendorRow[];
  monthlyBurn: { ym: string; spent: number; cumulative: number }[];
  requiredMonthlyBurn: number | null;
}

const STAGE_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6",
  "#ef4444", "#06b6d4", "#ec4899", "#84cc16", "#64748b",
];

function fmtMoney(currency: string, n: number): string {
  return `${currency} ${(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function BudgetSection({
  projectId, project, stages,
}: {
  projectId: string | number;
  project: any;
  stages: any[];
}) {
  const { toast } = useToast();
  const currency: string = project?.currency || "NGN";

  const { data: budget, isLoading: budgetLoading } = useQuery<BudgetRollup>({
    queryKey: ["/api/developer/projects", projectId, "budget"],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/developer/projects/${projectId}/budget`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });
  const { data: vendors } = useQuery<BudgetVendorRow[]>({
    queryKey: ["/api/developer/projects", projectId, "vendors"],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/developer/projects/${projectId}/vendors`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });
  const { data: rates } = useQuery<any>({ queryKey: ["/api/exchange-rates"] });

  // Inline edit for project's totalBudget
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState<string>("");
  useEffect(() => {
    if (project?.totalBudget != null) setBudgetInput(String(project.totalBudget));
  }, [project?.totalBudget]);

  const saveBudget = useMutation({
    mutationFn: async (value: number | null) =>
      apiRequest("PATCH", `/api/developer/projects/${projectId}`, { totalBudget: value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "budget"] });
      setEditingBudget(false);
      toast({ title: "Total budget saved" });
    },
    onError: (e: any) => toast(toastFromError(e, "Failed to save total budget")),
  });

  const [addVendorStageId, setAddVendorStageId] = useState<number | null | "open">(null);
  const [vendorDetail, setVendorDetail] = useState<BudgetVendorRow | null>(null);

  // Convert project-currency amount to the three display currencies using
  // /api/exchange-rates (rates are USD-based). Skip if rates not loaded yet.
  function toEquivalents(amount: number): { NGN: number; USD: number; GBP: number } | null {
    if (!rates?.rates) return null;
    const fromRate = currency === "USD" ? 1 : rates.rates[currency];
    const ngnRate = rates.rates["NGN"];
    const gbpRate = rates.rates["GBP"];
    if (!fromRate || !ngnRate || !gbpRate) return null;
    const usd = amount / fromRate;
    return { USD: usd, NGN: usd * ngnRate, GBP: usd * gbpRate };
  }

  const totalBudget = budget?.totalBudget ?? 0;
  const totalSpent = budget?.totalSpent ?? 0;
  const remaining = Math.max(totalBudget - totalSpent, 0);
  const overspent = totalBudget > 0 && totalSpent > totalBudget;

  // Per-stage vendor groupings for the cards
  const vendorsByStageId = new Map<number | null, BudgetVendorRow[]>();
  for (const v of vendors || []) {
    const k = v.stageId ?? null;
    if (!vendorsByStageId.has(k)) vendorsByStageId.set(k, []);
    vendorsByStageId.get(k)!.push(v);
  }

  // Chart data: Budget vs Actual (per stage)
  const budgetVsActualData = (budget?.stages || []).map(s => ({
    name: s.name.length > 12 ? s.name.slice(0, 12) + "…" : s.name,
    Budget: s.vendorContract,
    Spent: s.spent,
  }));

  // Chart data: Cost Breakdown donut (spend share per stage)
  const costBreakdownData = (budget?.stages || [])
    .filter(s => s.spent > 0)
    .map(s => ({ name: s.name, value: s.spent }));

  // Chart data: Vendor spend (per-vendor: contract, spent, outstanding shown as 3 series)
  const vendorSpendData = (budget?.vendors || [])
    .slice()
    .sort((a, b) => b.contractAmount - a.contractAmount)
    .slice(0, 10)
    .map(v => ({
      name: v.name.length > 18 ? v.name.slice(0, 18) + "…" : v.name,
      Contract: v.contractAmount,
      Spent: v.paid,
      Outstanding: v.outstanding,
    }));

  // Chart data: monthly cumulative burn + a linear "Target" cumulative trajectory.
  // Target trajectory goes from (plannedStartDate, 0) → (plannedCompletionDate, totalBudget)
  // so it can be compared like-for-like against actual cumulative spend.
  const planStart = project?.plannedStartDate ? new Date(project.plannedStartDate) : null;
  const planEnd = budget?.plannedCompletionDate ? new Date(budget.plannedCompletionDate) : null;
  const targetSpan = planStart && planEnd ? planEnd.getTime() - planStart.getTime() : 0;
  const burnData = (budget?.monthlyBurn || []).map(m => {
    const [y, mo] = m.ym.split("-");
    const monthEnd = new Date(Number(y), Number(mo), 0); // last day of that month
    const label = new Date(Number(y), Number(mo) - 1, 1).toLocaleString(undefined, { month: "short", year: "2-digit" });
    let target: number | null = null;
    if (planStart && planEnd && targetSpan > 0 && totalBudget > 0) {
      if (monthEnd <= planStart) target = 0;
      else if (monthEnd >= planEnd) target = totalBudget;
      else target = totalBudget * ((monthEnd.getTime() - planStart.getTime()) / targetSpan);
    }
    return { name: label, Cumulative: m.cumulative, Monthly: m.spent, Target: target };
  });
  const showTargetLine = burnData.some(d => d.Target !== null);

  const equivalents = toEquivalents(totalBudget);
  const spentEq = toEquivalents(totalSpent);
  const remainingEq = toEquivalents(remaining);

  return (
    <Card className="border-blue-100" data-testid="card-budget-section">
      <CardHeader>
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="flex items-center gap-2"><Wallet className="w-5 h-5 text-blue-600" /> Budget & vendors</CardTitle>
            <CardDescription>Track total construction budget, vendor contracts, and payments with proof of payment.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* KPI cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Total budget */}
          <div className="border rounded-lg p-4 bg-white" data-testid="kpi-total-budget">
            <div className="flex items-center justify-between mb-1">
              <div className="text-xs uppercase text-slate-500">Total budget</div>
              {!editingBudget && (
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setEditingBudget(true)} data-testid="button-edit-total-budget">
                  <Pencil className="w-3 h-3" />
                </Button>
              )}
            </div>
            {editingBudget ? (
              <div className="flex items-center gap-2 mt-1">
                <Input
                  type="number"
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(e.target.value)}
                  className="h-8 text-sm"
                  placeholder="0"
                  data-testid="input-total-budget"
                />
                <Button
                  size="sm"
                  className="h-8 bg-blue-600 hover:bg-blue-700"
                  disabled={saveBudget.isPending}
                  onClick={() => {
                    const v = budgetInput === "" ? null : Number(budgetInput);
                    if (v !== null && (!Number.isFinite(v) || v < 0)) {
                      toast({ title: "Enter a valid amount", variant: "destructive" });
                      return;
                    }
                    saveBudget.mutate(v);
                  }}
                  data-testid="button-save-total-budget"
                >
                  {saveBudget.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
                </Button>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => { setEditingBudget(false); setBudgetInput(project?.totalBudget != null ? String(project.totalBudget) : ""); }}>Cancel</Button>
              </div>
            ) : (
              <div className="text-2xl font-bold text-slate-900 mt-1" data-testid="text-total-budget">
                {fmtMoney(currency, totalBudget)}
              </div>
            )}
            {equivalents && totalBudget > 0 && (
              <div className="text-xs text-slate-500 mt-2 space-x-2">
                {currency !== "NGN" && <span>≈ ₦{equivalents.NGN.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}
                {currency !== "USD" && <span>≈ ${equivalents.USD.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}
                {currency !== "GBP" && <span>≈ £{equivalents.GBP.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}
              </div>
            )}
            {totalBudget === 0 && !editingBudget && (
              <div className="text-xs text-slate-500 mt-1">Set a total to enable progress tracking.</div>
            )}
          </div>
          {/* Total spent */}
          <div className="border rounded-lg p-4 bg-white" data-testid="kpi-total-spent">
            <div className="text-xs uppercase text-slate-500">Total spent</div>
            <div className={`text-2xl font-bold mt-1 ${overspent ? "text-red-600" : "text-slate-900"}`} data-testid="text-total-spent">
              {fmtMoney(currency, totalSpent)}
            </div>
            {totalBudget > 0 && (
              <Progress
                value={Math.min(100, Math.round((totalSpent / totalBudget) * 100))}
                className={`h-2 mt-2 ${overspent ? "[&>div]:bg-red-500" : ""}`}
              />
            )}
            {spentEq && totalSpent > 0 && (
              <div className="text-xs text-slate-500 mt-2 space-x-2">
                {currency !== "NGN" && <span>≈ ₦{spentEq.NGN.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}
                {currency !== "USD" && <span>≈ ${spentEq.USD.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}
                {currency !== "GBP" && <span>≈ £{spentEq.GBP.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}
              </div>
            )}
          </div>
          {/* Remaining */}
          <div className="border rounded-lg p-4 bg-white" data-testid="kpi-remaining">
            <div className="text-xs uppercase text-slate-500">Remaining</div>
            <div className={`text-2xl font-bold mt-1 ${overspent ? "text-red-600" : "text-emerald-700"}`} data-testid="text-remaining">
              {overspent ? `−${fmtMoney(currency, totalSpent - totalBudget)}` : fmtMoney(currency, remaining)}
            </div>
            {overspent && <div className="text-xs text-red-600 mt-1">Over budget</div>}
            {remainingEq && remaining > 0 && (
              <div className="text-xs text-slate-500 mt-2 space-x-2">
                {currency !== "NGN" && <span>≈ ₦{remainingEq.NGN.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}
                {currency !== "USD" && <span>≈ ${remainingEq.USD.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}
                {currency !== "GBP" && <span>≈ £{remainingEq.GBP.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>}
              </div>
            )}
          </div>
        </div>

        {/* Charts: 2x2 grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="shadow-none border-slate-200">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Budget vs Actual Spend (per stage)</CardTitle></CardHeader>
            <CardContent>
              {budgetVsActualData.length === 0 || budgetVsActualData.every(d => d.Budget === 0 && d.Spent === 0) ? (
                <EmptyChart message="Add vendor contracts and record payments to see budget vs actual." />
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={budgetVsActualData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: any) => fmtMoney(currency, Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Budget" fill="#93c5fd" />
                    <Bar dataKey="Spent" fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-none border-slate-200">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Cost Breakdown by Stage</CardTitle></CardHeader>
            <CardContent>
              {costBreakdownData.length === 0 ? (
                <EmptyChart message="No spend recorded yet across construction stages." />
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={costBreakdownData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={2}>
                      {costBreakdownData.map((_, i) => <Cell key={i} fill={STAGE_COLORS[i % STAGE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => fmtMoney(currency, Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-none border-slate-200">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Vendor / Subcontractor Spend</CardTitle></CardHeader>
            <CardContent>
              {vendorSpendData.length === 0 ? (
                <EmptyChart message="Add vendors and contract amounts to see spend by vendor." />
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(240, vendorSpendData.length * 32 + 40)}>
                  <BarChart layout="vertical" data={vendorSpendData} margin={{ left: 8, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                    <Tooltip formatter={(v: any) => fmtMoney(currency, Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Contract" fill="#93c5fd" />
                    <Bar dataKey="Spent" fill="#3b82f6" />
                    <Bar dataKey="Outstanding" fill="#fbbf24" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-none border-slate-200">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Burn Rate (last 12 months)</CardTitle></CardHeader>
            <CardContent>
              {burnData.length === 0 || burnData.every(d => d.Cumulative === 0) ? (
                <EmptyChart message="No payments recorded yet. Record vendor payments to see your burn rate." />
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={burnData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: any) => fmtMoney(currency, Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="Cumulative" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="Actual cumulative" />
                    {showTargetLine && (
                      <Line type="monotone" dataKey="Target" stroke="#10b981" strokeWidth={2} strokeDasharray="4 4" dot={false} name="On-track cumulative" />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              )}
              {budget?.requiredMonthlyBurn != null && (
                <div className="text-xs text-slate-500 mt-2">
                  To finish by {budget.plannedCompletionDate ? new Date(budget.plannedCompletionDate).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "the planned completion date"}, average monthly burn needed: <span className="font-medium text-slate-900">{fmtMoney(currency, budget.requiredMonthlyBurn)}</span>.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Per-stage vendor cards */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-slate-900">Vendors by stage</h3>
            <Button size="sm" variant="outline" onClick={() => setAddVendorStageId("open")} data-testid="button-add-vendor-top">
              <Plus className="w-4 h-4 mr-1" /> Add vendor
            </Button>
          </div>
          {budgetLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[1, 2, 3, 4].map(i => <div key={i} className="h-32 bg-slate-100 rounded animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {stages.map((s) => {
                const stageVendors = vendorsByStageId.get(s.id) || [];
                const stageContract = stageVendors.reduce((a, v) => a + v.contractAmount, 0);
                const stagePaid = stageVendors.reduce((a, v) => a + v.paid, 0);
                const pct = stageContract > 0 ? Math.round((stagePaid / stageContract) * 100) : 0;
                return (
                  <div key={s.id} className="border rounded-lg p-3 bg-white" data-testid={`stage-budget-card-${s.stageKey}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <div className="font-medium text-slate-900">{s.name}</div>
                        <div className="text-xs text-slate-500">{stageVendors.length} vendor{stageVendors.length === 1 ? "" : "s"}</div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => setAddVendorStageId(s.id)} data-testid={`button-add-vendor-${s.stageKey}`}>
                        <Plus className="w-3.5 h-3.5 mr-1" /> Add
                      </Button>
                    </div>
                    {stageContract > 0 && (
                      <div className="mb-2">
                        <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
                          <span>{fmtMoney(currency, stagePaid)} / {fmtMoney(currency, stageContract)}</span>
                          <span className="font-medium">{pct}%</span>
                        </div>
                        <Progress value={pct} className="h-1.5" />
                      </div>
                    )}
                    {stageVendors.length === 0 ? (
                      <div className="text-xs text-slate-400 italic py-2">No vendors yet.</div>
                    ) : (
                      <div className="space-y-1.5">
                        {stageVendors.map(v => {
                          const vp = v.contractAmount > 0 ? Math.round((v.paid / v.contractAmount) * 100) : 0;
                          const status = v.outstanding === 0 && v.contractAmount > 0 ? "Paid" : v.paid > 0 ? "Partial" : "Unpaid";
                          const statusCls = status === "Paid" ? "bg-emerald-100 text-emerald-700" : status === "Partial" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600";
                          return (
                            <div
                              key={v.id}
                              className="flex items-center justify-between gap-2 p-2 rounded hover:bg-slate-50 border border-transparent hover:border-slate-200 transition"
                              data-testid={`vendor-row-${v.id}`}
                            >
                              <button
                                type="button"
                                onClick={() => setVendorDetail(v)}
                                className="min-w-0 flex-1 text-left"
                                data-testid={`vendor-row-open-${v.id}`}
                              >
                                <div className="text-sm font-medium text-slate-900 truncate">{v.name}</div>
                                <div className="text-xs text-slate-500 truncate">{v.workCategory || "—"}</div>
                              </button>
                              <div className="text-right shrink-0">
                                <div className="text-xs text-slate-700">{fmtMoney(currency, v.paid)} / {fmtMoney(currency, v.contractAmount)}</div>
                                <div className="text-xs text-amber-700" data-testid={`vendor-outstanding-${v.id}`}>
                                  Outstanding: {fmtMoney(currency, v.outstanding)}
                                </div>
                                <Badge className={`${statusCls} text-xs mt-0.5`}>{status} • {vp}%</Badge>
                              </div>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 shrink-0"
                                title="View payment history"
                                onClick={(e) => { e.stopPropagation(); setVendorDetail({ ...v, __openTab: "payments" } as any); }}
                                data-testid={`button-vendor-history-${v.id}`}
                              >
                                <Receipt className="w-4 h-4 mr-1" />
                                <span className="hidden sm:inline text-xs">History</span>
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>

      {/* Dialogs */}
      <AddVendorDialog
        open={addVendorStageId !== null}
        defaultStageId={typeof addVendorStageId === "number" ? addVendorStageId : null}
        stages={stages}
        currency={currency}
        projectId={projectId}
        onClose={() => setAddVendorStageId(null)}
      />
      <VendorDetailDialog
        vendor={vendorDetail}
        stages={stages}
        currency={currency}
        projectId={projectId}
        onClose={() => setVendorDetail(null)}
      />
    </Card>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="h-[240px] flex items-center justify-center text-center text-xs text-slate-500 px-6">
      {message}
    </div>
  );
}

function AddVendorDialog({
  open, defaultStageId, stages, currency, projectId, onClose,
}: {
  open: boolean;
  defaultStageId: number | null;
  stages: any[];
  currency: string;
  projectId: string | number;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "",
    workCategory: "",
    stageId: defaultStageId ? String(defaultStageId) : "",
    contractAmount: "",
    currency,
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    notes: "",
  });

  useEffect(() => {
    if (open) {
      setForm(f => ({ ...f, stageId: defaultStageId ? String(defaultStageId) : "", currency }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultStageId]);

  const create = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/developer/projects/${projectId}/vendors`, {
      name: form.name,
      workCategory: form.workCategory || null,
      stageId: form.stageId ? Number(form.stageId) : null,
      contractAmount: form.contractAmount ? Number(form.contractAmount) : 0,
      currency: form.currency,
      contactName: form.contactName || null,
      contactPhone: form.contactPhone || null,
      contactEmail: form.contactEmail || null,
      notes: form.notes || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "vendors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "budget"] });
      toast({ title: "Vendor added" });
      setForm({
        name: "", workCategory: "", stageId: "", contractAmount: "", currency,
        contactName: "", contactPhone: "", contactEmail: "", notes: "",
      });
      onClose();
    },
    onError: (e: any) => toast(toastFromError(e, "Failed to add vendor")),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" data-testid="dialog-add-vendor">
        <DialogHeader>
          <DialogTitle>Add vendor</DialogTitle>
          <DialogDescription>Capture the contractor, their work scope, and contract value.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Vendor name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Acme Plumbing Ltd" data-testid="input-vendor-name" />
            </div>
            <div>
              <Label>Work category</Label>
              <Input value={form.workCategory} onChange={(e) => setForm({ ...form, workCategory: e.target.value })} placeholder="e.g. Plumbing, Architect" data-testid="input-vendor-category" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Construction stage</Label>
              <Select value={form.stageId || "none"} onValueChange={(v) => setForm({ ...form, stageId: v === "none" ? "" : v })}>
                <SelectTrigger data-testid="select-vendor-stage"><SelectValue placeholder="Select stage" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {stages.map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Contract amount ({form.currency})</Label>
              <Input type="number" value={form.contractAmount} onChange={(e) => setForm({ ...form, contractAmount: e.target.value })} placeholder="0" data-testid="input-vendor-contract" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Contact name</Label>
              <Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} data-testid="input-vendor-contact-name" />
            </div>
            <div>
              <Label>Contact phone</Label>
              <Input value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} data-testid="input-vendor-contact-phone" />
            </div>
          </div>
          <div>
            <Label>Contact email</Label>
            <Input type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} data-testid="input-vendor-contact-email" />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="textarea-vendor-notes" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="bg-blue-600 hover:bg-blue-700"
            disabled={!form.name.trim() || create.isPending}
            onClick={() => create.mutate()}
            data-testid="button-save-vendor"
          >
            {create.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
            Add vendor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VendorDetailDialog({
  vendor, stages, currency, projectId, onClose,
}: {
  vendor: BudgetVendorRow | null;
  stages: any[];
  currency: string;
  projectId: string | number;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState("details");
  const [details, setDetails] = useState({
    name: "", workCategory: "", stageId: "", contractAmount: "",
    contactName: "", contactPhone: "", contactEmail: "", notes: "", status: "active",
  });

  useEffect(() => {
    if (vendor) {
      setDetails({
        name: vendor.name,
        workCategory: vendor.workCategory || "",
        stageId: vendor.stageId ? String(vendor.stageId) : "",
        contractAmount: String(vendor.contractAmount || 0),
        contactName: "",
        contactPhone: "",
        contactEmail: "",
        notes: "",
        status: vendor.status || "active",
      });
      const requested = (vendor as any).__openTab;
      setTab(requested === "payments" ? "payments" : "details");
    }
  }, [vendor?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: payments } = useQuery<any[]>({
    queryKey: ["/api/developer/projects", projectId, "vendors", vendor?.id, "payments"],
    enabled: !!vendor?.id,
    queryFn: async () => {
      const res = await fetch(`/api/developer/projects/${projectId}/vendors/${vendor!.id}/payments`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const saveDetails = useMutation({
    mutationFn: async () => apiRequest("PATCH", `/api/developer/projects/${projectId}/vendors/${vendor!.id}`, {
      name: details.name,
      workCategory: details.workCategory || null,
      stageId: details.stageId ? Number(details.stageId) : null,
      contractAmount: details.contractAmount ? Number(details.contractAmount) : 0,
      status: details.status,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "vendors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "budget"] });
      toast({ title: "Vendor updated" });
      onClose();
    },
    onError: (e: any) => toast(toastFromError(e, "Failed to update vendor")),
  });

  const deleteVendor = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/developer/projects/${projectId}/vendors/${vendor!.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "vendors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "budget"] });
      toast({ title: "Vendor deleted" });
      onClose();
    },
    onError: (e: any) => toast(toastFromError(e, "Failed to delete vendor")),
  });

  // Add-payment form (lives inside the Payments tab)
  const [payForm, setPayForm] = useState({
    amount: "",
    paidAt: new Date().toISOString().slice(0, 10),
    method: "bank_transfer",
    reference: "",
    notes: "",
    proofUrl: "",
    proofType: "",
  });
  const resetPayForm = () => setPayForm({
    amount: "", paidAt: new Date().toISOString().slice(0, 10), method: "bank_transfer",
    reference: "", notes: "", proofUrl: "", proofType: "",
  });

  const addPayment = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/developer/projects/${projectId}/vendors/${vendor!.id}/payments`, {
      amount: Number(payForm.amount),
      paidAt: payForm.paidAt,
      method: payForm.method,
      reference: payForm.reference || null,
      notes: payForm.notes || null,
      proofUrl: payForm.proofUrl || null,
      proofType: payForm.proofType || null,
      currency,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "vendors", vendor?.id, "payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "vendors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "budget"] });
      toast({ title: "Payment recorded" });
      resetPayForm();
    },
    onError: (e: any) => toast(toastFromError(e, "Failed to record payment")),
  });

  const deletePayment = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/developer/projects/${projectId}/payments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "vendors", vendor?.id, "payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "vendors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "budget"] });
      toast({ title: "Payment deleted" });
    },
    onError: (e: any) => toast(toastFromError(e, "Failed to delete payment")),
  });

  if (!vendor) return null;
  const totalPaid = (payments || []).reduce((a, p) => a + Number(p.amount || 0), 0);
  const contractValue = Number(details.contractAmount || 0);
  const outstanding = Math.max(contractValue - totalPaid, 0);

  return (
    <Dialog open={!!vendor} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dialog-vendor-detail">
        <DialogHeader>
          <DialogTitle>{vendor.name}</DialogTitle>
          <DialogDescription>
            {fmtMoney(currency, totalPaid)} paid of {fmtMoney(currency, contractValue)}
            {outstanding > 0 && ` · ${fmtMoney(currency, outstanding)} outstanding`}
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid grid-cols-2">
            <TabsTrigger value="details" data-testid="tab-vendor-details">Details</TabsTrigger>
            <TabsTrigger value="payments" data-testid="tab-vendor-payments">Payments ({(payments || []).length})</TabsTrigger>
          </TabsList>
          <TabsContent value="details" className="space-y-3 mt-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Vendor name</Label>
                <Input value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} data-testid="input-detail-name" />
              </div>
              <div>
                <Label>Work category</Label>
                <Input value={details.workCategory} onChange={(e) => setDetails({ ...details, workCategory: e.target.value })} data-testid="input-detail-category" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Stage</Label>
                <Select value={details.stageId || "none"} onValueChange={(v) => setDetails({ ...details, stageId: v === "none" ? "" : v })}>
                  <SelectTrigger data-testid="select-detail-stage"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {stages.map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Contract amount ({currency})</Label>
                <Input type="number" value={details.contractAmount} onChange={(e) => setDetails({ ...details, contractAmount: e.target.value })} data-testid="input-detail-contract" />
              </div>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={details.status} onValueChange={(v) => setDetails({ ...details, status: v })}>
                <SelectTrigger data-testid="select-detail-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-between pt-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" className="text-red-600 hover:text-red-700" data-testid="button-delete-vendor">
                    <Trash2 className="w-4 h-4 mr-2" /> Delete vendor
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete vendor?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This removes {vendor.name} and all {(payments || []).length} recorded payment(s). This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteVendor.mutate()}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button className="bg-blue-600 hover:bg-blue-700" disabled={saveDetails.isPending} onClick={() => saveDetails.mutate()} data-testid="button-save-detail">
                {saveDetails.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                Save changes
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="payments" className="space-y-4 mt-4">
            {/* Add-payment form */}
            <div className="border rounded-lg p-3 bg-slate-50 space-y-3">
              <div className="font-medium text-sm text-slate-900 flex items-center gap-1.5">
                <Receipt className="w-4 h-4 text-blue-600" /> Record a new payment
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Amount ({currency}) *</Label>
                  <Input type="number" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} placeholder="0" data-testid="input-payment-amount" />
                </div>
                <div>
                  <Label className="text-xs">Paid date *</Label>
                  <Input type="date" value={payForm.paidAt} onChange={(e) => setPayForm({ ...payForm, paidAt: e.target.value })} data-testid="input-payment-date" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Method</Label>
                  <Select value={payForm.method} onValueChange={(v) => setPayForm({ ...payForm, method: v })}>
                    <SelectTrigger data-testid="select-payment-method"><SelectValue /></SelectTrigger>
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
                  <Label className="text-xs">Reference</Label>
                  <Input value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} placeholder="Transfer ID, cheque #, etc." data-testid="input-payment-reference" />
                </div>
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Textarea rows={2} value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} data-testid="textarea-payment-notes" />
              </div>
              <div>
                <FileUpload
                  label="Proof of payment (receipt, transfer slip — image or PDF)"
                  uploadType="document"
                  accept="image/*,application/pdf"
                  currentFile={payForm.proofUrl || undefined}
                  onUploadSuccess={(url, name) => {
                    const isPdf = (name || url).toLowerCase().endsWith(".pdf");
                    setPayForm(f => ({ ...f, proofUrl: url, proofType: url ? (isPdf ? "pdf" : "image") : "" }));
                  }}
                />
              </div>
              <div className="flex justify-end">
                <Button
                  className="bg-blue-600 hover:bg-blue-700"
                  disabled={!payForm.amount || Number(payForm.amount) <= 0 || !payForm.paidAt || addPayment.isPending}
                  onClick={() => addPayment.mutate()}
                  data-testid="button-record-payment"
                >
                  {addPayment.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                  Record payment
                </Button>
              </div>
            </div>

            {/* Payment history list */}
            <div>
              <div className="text-sm font-medium text-slate-900 mb-2">Payment history</div>
              {(!payments || payments.length === 0) ? (
                <div className="text-xs text-slate-500 italic py-4 text-center border rounded-lg bg-slate-50">
                  No payments recorded yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {payments.map((p) => (
                    <div key={p.id} className="border rounded-lg p-3 flex items-start gap-3" data-testid={`payment-row-${p.id}`}>
                      {p.proofUrl ? (
                        p.proofType === "image" ? (
                          <a href={p.proofUrl} target="_blank" rel="noreferrer" className="shrink-0">
                            <img src={p.proofUrl} alt="proof" className="w-14 h-14 object-cover rounded border" />
                          </a>
                        ) : (
                          <a href={p.proofUrl} target="_blank" rel="noreferrer" className="shrink-0 w-14 h-14 flex items-center justify-center bg-slate-50 border rounded text-slate-500">
                            <FileTextIcon className="w-6 h-6" />
                          </a>
                        )
                      ) : (
                        <div className="shrink-0 w-14 h-14 flex items-center justify-center bg-slate-50 border rounded text-slate-300">
                          <Receipt className="w-6 h-6" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-slate-900">{fmtMoney(p.currency || currency, Number(p.amount))}</div>
                          <Button size="sm" variant="ghost" className="h-7 text-red-600 hover:text-red-700" onClick={() => deletePayment.mutate(p.id)} data-testid={`button-delete-payment-${p.id}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                        <div className="text-xs text-slate-500 space-x-2">
                          <span>{new Date(p.paidAt).toLocaleDateString()}</span>
                          {p.method && <span>· {String(p.method).replace(/_/g, " ")}</span>}
                          {p.reference && <span>· Ref: <span className="font-mono">{p.reference}</span></span>}
                        </div>
                        {p.notes && <div className="text-xs text-slate-600 mt-1">{p.notes}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
