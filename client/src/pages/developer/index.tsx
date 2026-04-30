import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import DeveloperLayout from "@/components/developer/DeveloperLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Building2, Plus, Users, TrendingUp, Hammer, Calendar, DollarSign, CheckCircle2, BarChart3 } from "lucide-react";

function formatNaira(amount: number): string {
  if (amount >= 1_000_000_000) return `₦${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000)     return `₦${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000)         return `₦${(amount / 1_000).toFixed(1)}K`;
  return `₦${amount.toLocaleString()}`;
}

function KpiCard({ icon: Icon, label, value, sub, color }: { icon: any; label: string; value: string; sub?: string; color: string }) {
  return (
    <Card className="border-slate-200">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs uppercase tracking-wide text-slate-500 font-medium">{label}</span>
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
            <Icon className="w-4 h-4 text-white" />
          </div>
        </div>
        <div className="text-2xl font-semibold text-slate-900" data-testid={`kpi-value-${label.toLowerCase().replace(/\s+/g,'-')}`}>{value}</div>
        {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  draft:            { label: "Draft",            className: "bg-slate-100 text-slate-700" },
  pending_approval: { label: "Pending Approval", className: "bg-amber-100 text-amber-700" },
  live:             { label: "Live",             className: "bg-emerald-100 text-emerald-700" },
  sold_out:         { label: "Sold Out",         className: "bg-blue-100 text-blue-700" },
  archived:         { label: "Archived",         className: "bg-slate-200 text-slate-600" },
};

export default function DeveloperProjectsPage() {
  const { data: projects, isLoading } = useQuery<any[]>({ queryKey: ["/api/developer/projects"] });

  return (
    <DeveloperLayout
      title="My Projects"
      subtitle="Manage your fundraising, construction, and investor communications."
      actions={
        <Link href="/developer/new">
          <Button className="bg-blue-600 hover:bg-blue-700" data-testid="button-new-project">
            <Plus className="w-4 h-4 mr-2" /> New project
          </Button>
        </Link>
      }
    >
      {!isLoading && projects && projects.length > 0 && (() => {
        const totalRaised = projects.reduce((sum, p) => sum + (Number(p.totalRaised) || 0), 0);
        const totalInvestors = projects.reduce((sum, p) => sum + (Number(p.investorCount) || 0), 0);
        const liveCount = projects.filter((p) => p.projectStatus === "live").length;
        const fundedProjects = projects.filter((p) => Number(p.fundingPercent) > 0);
        const avgFundingPercent = fundedProjects.length > 0
          ? Math.round(fundedProjects.reduce((s, p) => s + Number(p.fundingPercent || 0), 0) / fundedProjects.length)
          : 0;
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6" data-testid="kpi-strip">
            <KpiCard icon={DollarSign}    label="Total raised"    value={formatNaira(totalRaised)}      sub={`Across ${projects.length} project${projects.length === 1 ? "" : "s"}`} color="bg-blue-600" />
            <KpiCard icon={Users}         label="Total investors" value={String(totalInvestors)}        sub="Confirmed across all projects"                                       color="bg-emerald-600" />
            <KpiCard icon={CheckCircle2}  label="Projects live"   value={String(liveCount)}             sub={`${projects.length - liveCount} draft / pending`}                    color="bg-purple-600" />
            <KpiCard icon={BarChart3}     label="Avg funding"     value={`${avgFundingPercent}%`}       sub="Across active projects"                                              color="bg-amber-600" />
          </div>
        );
      })()}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-56 bg-white rounded-xl border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : !projects || projects.length === 0 ? (
        <Card className="border-dashed border-2 border-slate-300 bg-white/50">
          <CardContent className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mb-4">
              <Building2 className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">No projects yet</h3>
            <p className="text-slate-500 max-w-md mb-6">
              Create your first project to start raising funds, sharing construction progress, and managing your investor base.
            </p>
            <Link href="/developer/new">
              <Button className="bg-blue-600 hover:bg-blue-700" data-testid="button-empty-new">
                <Plus className="w-4 h-4 mr-2" /> Create your first project
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map((p) => {
            const status = STATUS_BADGE[p.projectStatus] || STATUS_BADGE.draft;
            return (
              <Link key={p.id} href={`/developer/projects/${p.id}`}>
                <Card className="cursor-pointer hover:shadow-md transition-shadow border-slate-200" data-testid={`card-project-${p.id}`}>
                  <div className="aspect-[16/7] bg-slate-100 rounded-t-xl overflow-hidden relative">
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
                        <Building2 className="w-10 h-10 text-slate-400" />
                      </div>
                    )}
                    <Badge className={`absolute top-3 right-3 ${status.className}`}>{status.label}</Badge>
                  </div>
                  <CardContent className="p-5">
                    <h3 className="text-lg font-semibold text-slate-900 mb-1 truncate" data-testid={`text-project-name-${p.id}`}>{p.name}</h3>
                    <p className="text-sm text-slate-500 mb-4 truncate">{p.location}</p>

                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-600 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Funding</span>
                          <span className="font-semibold text-slate-900">{p.fundingPercent}%</span>
                        </div>
                        <Progress value={p.fundingPercent} className="h-1.5" />
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-600 flex items-center gap-1"><Hammer className="w-3 h-3" /> Construction</span>
                          <span className="font-semibold text-slate-900">{p.constructionPercent}%</span>
                        </div>
                        <Progress value={p.constructionPercent} className="h-1.5" />
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-4 mt-4 border-t border-slate-100 text-xs text-slate-600">
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {p.investorCount} investor{p.investorCount === 1 ? "" : "s"}</span>
                      {p.nextMilestoneDate && (
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(p.nextMilestoneDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </DeveloperLayout>
  );
}
