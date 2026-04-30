import { useState } from "react";
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
import {
  Building2, TrendingUp, Hammer, Users, BarChart3, Mail, Plus, Pencil, Trash2,
  CheckCircle2, Clock, AlertTriangle, Send, Download, Calendar, Loader2, Save, Megaphone,
  ArrowUp, ArrowDown, ImagePlus, X,
} from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

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

function fmt(currency: string | null | undefined, amount: number | string) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `${currency || "NGN"} ${(isNaN(n) ? 0 : n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function DeveloperProjectDetail() {
  const [, params] = useRoute("/developer/projects/:id");
  const projectId = params?.id ? parseInt(params.id) : 0;
  const [tab, setTab] = useState("overview");

  const { data: project, isLoading } = useQuery<any>({
    queryKey: ["/api/developer/projects", projectId],
    enabled: !!projectId,
  });
  const { data: rollup } = useQuery<any>({
    queryKey: ["/api/developer/projects", projectId, "rollup"],
    enabled: !!projectId,
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
        <TabsList className="bg-white border border-slate-200 p-1">
          <TabsTrigger value="overview" data-testid="tab-overview"><BarChart3 className="w-4 h-4 mr-2" />Overview</TabsTrigger>
          <TabsTrigger value="fundraising" data-testid="tab-fundraising"><TrendingUp className="w-4 h-4 mr-2" />Fundraising</TabsTrigger>
          <TabsTrigger value="construction" data-testid="tab-construction"><Hammer className="w-4 h-4 mr-2" />Construction</TabsTrigger>
          <TabsTrigger value="sales" data-testid="tab-sales"><Building2 className="w-4 h-4 mr-2" />Sales</TabsTrigger>
          <TabsTrigger value="captable" data-testid="tab-captable"><Users className="w-4 h-4 mr-2" />Cap Table</TabsTrigger>
          <TabsTrigger value="comms" data-testid="tab-comms"><Mail className="w-4 h-4 mr-2" />Communications</TabsTrigger>
        </TabsList>

        <TabsContent value="overview"><OverviewTab project={project} rollup={rollup} /></TabsContent>
        <TabsContent value="fundraising"><FundraisingTab project={project} rollup={rollup} /></TabsContent>
        <TabsContent value="construction"><ConstructionTab projectId={projectId} /></TabsContent>
        <TabsContent value="sales"><SalesTab project={project} /></TabsContent>
        <TabsContent value="captable"><CapTableTab project={project} rollup={rollup} /></TabsContent>
        <TabsContent value="comms"><CommunicationsTab projectId={projectId} project={project} /></TabsContent>
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

  const funnelData = [
    { stage: "Reserved",          count: funnel.reserved || 0 },
    { stage: "KYC Complete",      count: funnel.kycComplete || 0 },
    { stage: "Payment Submitted", count: funnel.paymentSubmitted || 0 },
    { stage: "Confirmed",         count: funnel.confirmed || 0 },
  ];

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
    </div>
  );
}

// ======================= CONSTRUCTION =======================
function ConstructionTab({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const { data: milestones, isLoading } = useQuery<any[]>({
    queryKey: ["/api/developer/projects", projectId, "milestones"],
    enabled: !!projectId,
  });
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);

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

  const reorderMutation = useMutation({
    mutationFn: async (items: { id: number; sortOrder: number }[]) => {
      // Sequentially patch each item's sortOrder
      for (const item of items) {
        await apiRequest("PATCH", `/api/developer/milestones/${item.id}`, { sortOrder: item.sortOrder });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "milestones"] });
    },
  });

  const move = (idx: number, dir: -1 | 1) => {
    if (!milestones) return;
    const sorted = [...milestones].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    const target = idx + dir;
    if (target < 0 || target >= sorted.length) return;
    [sorted[idx], sorted[target]] = [sorted[target], sorted[idx]];
    const items = sorted.map((m, i) => ({ id: m.id, sortOrder: i }));
    reorderMutation.mutate(items);
  };

  const sortedMilestones = milestones ? [...milestones].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)) : [];
  const overall = sortedMilestones.length === 0 ? 0 : Math.round(sortedMilestones.reduce((s, m) => s + (m.percentComplete || 0), 0) / sortedMilestones.length);

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
            <div className="space-y-3">
              {sortedMilestones.map((m, idx) => {
                const meta = MILESTONE_STATUS[m.status] || MILESTONE_STATUS.not_started;
                const Icon = meta.icon;
                const media: string[] = Array.isArray(m.mediaUrls) ? m.mediaUrls : [];
                return (
                  <div key={m.id} className="border border-slate-200 rounded-lg p-4 bg-white" data-testid={`milestone-${m.id}`}>
                    <div className="flex items-start gap-3">
                      {/* Reorder column */}
                      <div className="flex flex-col gap-1 pt-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          disabled={idx === 0 || reorderMutation.isPending}
                          onClick={() => move(idx, -1)}
                          data-testid={`button-move-up-${m.id}`}
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          disabled={idx === sortedMilestones.length - 1 || reorderMutation.isPending}
                          onClick={() => move(idx, 1)}
                          data-testid={`button-move-down-${m.id}`}
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </Button>
                      </div>

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
                              <Button size="sm" variant="ghost" onClick={() => { setEditing(m); setOpen(true); }} data-testid={`button-edit-${m.id}`}>
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => deleteMutation.mutate(m.id)} data-testid={`button-delete-${m.id}`}>
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
              })}
            </div>
          )}
        </CardContent>
      </Card>
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

  const handleUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Only images allowed", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Image too large (max 5 MB)", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/upload/image", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setForm((prev) => ({ ...prev, mediaUrls: [...prev.mediaUrls, data.url] }));
      toast({ title: "Image uploaded" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message || "Try again", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const removeMedia = (idx: number) => {
    setForm((prev) => ({ ...prev, mediaUrls: prev.mediaUrls.filter((_, i) => i !== idx) }));
  };

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{editing ? "Edit milestone" : "Add milestone"}</DialogTitle>
        <DialogDescription>Construction milestones appear on the investor dashboard.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <Label>Name *</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Foundation poured" data-testid="input-milestone-name" />
        </div>
        <div>
          <Label>Description</Label>
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} data-testid="input-milestone-description" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Target date</Label>
            <Input type="date" value={form.targetDate} onChange={(e) => setForm({ ...form, targetDate: e.target.value })} data-testid="input-milestone-target" />
          </div>
          <div>
            <Label>Completed date</Label>
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
            <Label>% Complete</Label>
            <Input type="number" min={0} max={100} value={form.percentComplete} onChange={(e) => setForm({ ...form, percentComplete: parseInt(e.target.value) || 0 })} data-testid="input-milestone-percent" />
          </div>
        </div>

        {/* Media uploader */}
        <div>
          <Label>Site photos / progress media</Label>
          <p className="text-xs text-slate-500 mb-2">Upload photos to share with investors (max 5 MB each).</p>
          <div className="flex flex-wrap gap-2 mb-2">
            {form.mediaUrls.map((url, i) => (
              <div key={i} className="relative w-20 h-20 rounded border border-slate-200 overflow-hidden bg-slate-50" data-testid={`milestone-media-thumb-${i}`}>
                <img src={url} alt={`Media ${i + 1}`} className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeMedia(i)}
                  className="absolute top-0.5 right-0.5 bg-white/90 rounded-full p-0.5 shadow hover:bg-red-50"
                  data-testid={`button-remove-media-${i}`}
                >
                  <X className="w-3 h-3 text-red-600" />
                </button>
              </div>
            ))}
            <label className="w-20 h-20 rounded border-2 border-dashed border-slate-300 flex items-center justify-center cursor-pointer hover:bg-slate-50 hover:border-blue-400 transition" data-testid="button-upload-media">
              {uploading ? (
                <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
              ) : (
                <ImagePlus className="w-5 h-5 text-slate-400" />
              )}
              <input
                type="file"
                accept="image/*"
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

// ======================= SALES (analytics + investor list with notes) =======================
type SalesStage = "all" | "reserved" | "converted_to_investment" | "expired" | "cancelled";

function SalesTab({ project }: { project: any }) {
  const { toast } = useToast();
  const { data: investors, isLoading } = useQuery<any[]>({
    queryKey: ["/api/developer/projects", project.id, "investors"],
    enabled: !!project.id,
  });
  const [stage, setStage] = useState<SalesStage>("all");
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteInvestor, setNoteInvestor] = useState<any | null>(null);
  const [noteText, setNoteText] = useState("");

  const saveNote = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/developer/projects/${project.id}/notes`, {
      investorUserId: noteInvestor?.investorUserId,
      notes: noteText,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", project.id, "investors"] });
      setNoteOpen(false);
      toast({ title: "Note saved" });
    },
  });

  const list = investors || [];

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
  const confirmed = list.filter((i) => i.status === "converted_to_investment" && i.confirmedAt);
  const totalUnits = project.totalUnits || 0;
  const soldUnits = confirmed.reduce((s, i) => s + (i.units || 0), 0);
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
      .reduce((s, i) => s + (i.units || 0), 0);
    const label = `W-${w}`;
    weekBuckets.push({ label, units, cumulative: 0 });
  }
  // Cumulative across the 4-week window (running total of units up to bucket end)
  const cutoff = new Date(now.getTime() - 4 * weekMs);
  const baseSold = confirmed
    .filter((i) => new Date(i.confirmedAt) < cutoff)
    .reduce((s, i) => s + (i.units || 0), 0);
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
      {/* Velocity / Forecast cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="py-5">
            <div className="text-xs uppercase tracking-wide text-slate-500">Sold units</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{soldUnits} <span className="text-sm font-normal text-slate-500">/ {totalUnits}</span></div>
            <Progress value={totalUnits > 0 ? (soldUnits / totalUnits) * 100 : 0} className="h-1.5 mt-2" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <div className="text-xs uppercase tracking-wide text-slate-500">Remaining</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{remainingUnits}</div>
            <div className="text-xs text-slate-500 mt-2">units available</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <div className="text-xs uppercase tracking-wide text-slate-500">Velocity (4-wk avg)</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{avgVelocity.toFixed(1)} <span className="text-sm font-normal text-slate-500">units/wk</span></div>
            <div className="text-xs text-slate-500 mt-2">{totalLast4} sold in last 4 weeks</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <div className="text-xs uppercase tracking-wide text-slate-500">Sell-out forecast</div>
            {forecastDate && remainingUnits > 0 ? (
              <>
                <div className="text-2xl font-bold text-slate-900 mt-1">{forecastDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div>
                <div className="text-xs text-slate-500 mt-2">~{forecastDays} days at current pace</div>
              </>
            ) : remainingUnits === 0 ? (
              <>
                <div className="text-2xl font-bold text-emerald-600 mt-1">Sold out</div>
                <div className="text-xs text-slate-500 mt-2">All units allocated</div>
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
          <CardDescription>Units confirmed per week and cumulative trend.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weekBuckets} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <XAxis dataKey="label" stroke="#64748b" fontSize={12} />
                <YAxis stroke="#64748b" fontSize={12} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="units" stroke="#2563eb" strokeWidth={2} name="Units / week" dot={{ r: 4 }} />
                <Line type="monotone" dataKey="cumulative" stroke="#15803d" strokeWidth={2} name="Cumulative" dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Investors & reservations</CardTitle>
            <CardDescription>{filtered.length} of {list.length} entries shown</CardDescription>
          </div>
          <a
            href={`/api/developer/projects/${project.id}/investors.csv`}
            className="inline-flex items-center px-3 py-1.5 text-sm font-medium border border-slate-300 rounded-md hover:bg-slate-50"
            data-testid="link-export-csv"
          >
            <Download className="w-4 h-4 mr-2" /> Export CSV
          </a>
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
            <div className="text-center py-12 text-slate-500">No investors in this stage.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Units</TableHead>
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
                      <TableCell>{inv.units}</TableCell>
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
                        <TableCell className="text-right font-medium">{c.units}</TableCell>
                        <TableCell className="text-right font-medium">{equityPct}%</TableCell>
                        <TableCell className="text-right">{fmt(c.currency, c.amount)}</TableCell>
                      </TableRow>
                    );
                  })}
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
function CommunicationsTab({ projectId, project }: { projectId: number; project: any }) {
  const { toast } = useToast();
  const { data: updates, isLoading } = useQuery<any[]>({
    queryKey: ["/api/developer/projects", projectId, "updates"],
    enabled: !!projectId,
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ type: "general", subject: "", body: "" });

  const sendMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/developer/projects/${projectId}/updates`, form),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects", projectId, "updates"] });
      setOpen(false);
      setForm({ type: "general", subject: "", body: "" });
      toast({ title: "Update sent", description: `Broadcast to investors of ${project.name}.` });
    },
    onError: () => toast({ title: "Failed to send update", variant: "destructive" }),
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
                  <Textarea
                    value={form.body}
                    onChange={(e) => setForm({ ...form, body: e.target.value })}
                    rows={8}
                    placeholder="Share details, photos, or next steps. HTML is supported."
                    data-testid="input-update-body"
                  />
                  <p className="text-xs text-slate-500 mt-1">Tip: Wrap paragraphs in &lt;p&gt;…&lt;/p&gt; for nicer email formatting.</p>
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
