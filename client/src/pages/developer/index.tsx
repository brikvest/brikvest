import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { slugify } from "@/lib/utils";
import DeveloperLayout from "@/components/developer/DeveloperLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Building2,
  Plus,
  Users,
  TrendingUp,
  Hammer,
  Calendar,
  DollarSign,
  CheckCircle2,
  BarChart3,
  ArrowUpRight,
  ShieldCheck,
  XCircle,
} from "lucide-react";

const ONBOARDING_STAGES = [
  { key: "submitted",        label: "Submitted",         hint: "We've received your submission and confirmed receipt." },
  { key: "due_diligence",    label: "Due diligence",     hint: "We're verifying your company and property information. We'll contact you if anything else is needed." },
  { key: "agreement_signed", label: "Agreement signed",  hint: "You sign the Brikvest Developer Partnership Agreement." },
  { key: "live",             label: "Live",              hint: "Your store is set up and your listing can be published." },
  { key: "selling",          label: "Selling",           hint: "Share your listing with your buyers and agents to start selling." },
];

function OnboardingTimeline({ me }: { me: any }) {
  const stage = me?.onboardingStage || "submitted";
  if (me?.teamRole && me.teamRole !== "owner") return null;

  if (stage === "rejected") {
    return (
      <Card className="border-rose-200 bg-rose-50 mb-6" data-testid="card-onboarding-rejected">
        <CardContent className="p-4 sm:p-5 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-rose-900">Your application wasn't approved</div>
            {me?.onboardingRejectionReason && (
              <p className="text-sm text-rose-800 mt-1">Reason: {me.onboardingRejectionReason}</p>
            )}
            <p className="text-sm text-rose-800 mt-1">
              If you can address this, contact us at <a className="underline" href="mailto:info@brikvest.net">info@brikvest.net</a> and we'll take another look.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (stage === "live") return null; // fully onboarded — no banner needed

  const currentIdx = Math.max(0, ONBOARDING_STAGES.findIndex((s) => s.key === stage));
  return (
    <Card className="border-blue-200 mb-6" data-testid="card-onboarding-timeline">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck className="w-5 h-5 text-blue-600" />
          <div>
            <div className="font-semibold text-slate-900">Onboarding in progress</div>
            <div className="text-xs text-slate-500">
              Complete your profile (logo, description, payout details) and draft your first listing — it speeds up due diligence.
            </div>
          </div>
        </div>
        <div className="flex items-start overflow-x-auto pb-1">
          {ONBOARDING_STAGES.map((s, idx) => {
            const done = idx < currentIdx;
            const current = idx === currentIdx;
            return (
              <div key={s.key} className="flex items-start flex-1 min-w-[110px]">
                <div className="flex flex-col items-center text-center flex-1">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${
                    done ? "bg-emerald-600 text-white" : current ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-500"
                  }`}>
                    {done ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
                  </div>
                  <div className={`text-xs font-medium mt-1.5 ${current ? "text-blue-700" : done ? "text-slate-800" : "text-slate-500"}`}>
                    {s.label}
                  </div>
                  {current && <div className="text-[11px] text-slate-500 mt-1 px-1">{s.hint}</div>}
                </div>
                {idx < ONBOARDING_STAGES.length - 1 && <div className="h-0.5 bg-slate-200 flex-shrink-0 w-4 sm:w-6 mt-3.5" />}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function formatNaira(amount: number): string {
  if (amount >= 1_000_000_000) return `₦${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `₦${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `₦${(amount / 1_000).toFixed(1)}K`;
  return `₦${amount.toLocaleString()}`;
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  iconBg,
  iconColor,
}: {
  icon: any;
  label: string;
  value: string;
  sub?: string;
  iconBg: string;
  iconColor: string;
}) {
  return (
    <Card className="border-slate-200 hover:border-slate-300 transition-colors">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between mb-3">
          <span className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
            {label}
          </span>
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${iconBg}`}>
            <Icon className={`w-4 h-4 ${iconColor}`} />
          </div>
        </div>
        <div
          className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums"
          data-testid={`kpi-value-${label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          {value}
        </div>
        {sub && <div className="text-xs text-slate-500 mt-1 truncate">{sub}</div>}
      </CardContent>
    </Card>
  );
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-slate-100 text-slate-700 border-slate-200" },
  pending_approval: { label: "Pending", className: "bg-amber-100 text-amber-700 border-amber-200" },
  live: { label: "Live", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  sold_out: { label: "Sold out", className: "bg-blue-100 text-blue-700 border-blue-200" },
  archived: { label: "Archived", className: "bg-slate-200 text-slate-600 border-slate-300" },
};

export default function DeveloperProjectsPage() {
  const { data: projects, isLoading } = useQuery<any[]>({
    queryKey: ["/api/developer/projects"],
  });
  const { data: me } = useQuery<any>({ queryKey: ["/api/developer/me"] });

  return (
    <DeveloperLayout
      title="My Projects"
      subtitle="Manage your fundraising, construction, and investor communications."
      actions={
        <Link href="/developer/new">
          <Button
            className="bg-blue-600 hover:bg-blue-700 shadow-sm w-full sm:w-auto"
            data-testid="button-new-project"
          >
            <Plus className="w-4 h-4 mr-2" /> New project
          </Button>
        </Link>
      }
    >
      {me && <OnboardingTimeline me={me} />}

      {!isLoading && projects && projects.length > 0 && (() => {
        const totalRaised = projects.reduce((sum, p) => sum + (Number(p.totalRaised) || 0), 0);
        const totalInvestors = projects.reduce(
          (sum, p) => sum + (Number(p.investorCount) || 0),
          0,
        );
        const liveCount = projects.filter((p) => p.projectStatus === "live").length;
        const fundedProjects = projects.filter((p) => Number(p.fundingPercent) > 0);
        const avgFundingPercent =
          fundedProjects.length > 0
            ? Math.round(
                fundedProjects.reduce((s, p) => s + Number(p.fundingPercent || 0), 0) /
                  fundedProjects.length,
              )
            : 0;
        return (
          <div
            className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6"
            data-testid="kpi-strip"
          >
            <KpiCard
              icon={DollarSign}
              label="Total raised"
              value={formatNaira(totalRaised)}
              sub={`Across ${projects.length} project${projects.length === 1 ? "" : "s"}`}
              iconBg="bg-blue-50"
              iconColor="text-blue-600"
            />
            <KpiCard
              icon={Users}
              label="Investors"
              value={String(totalInvestors)}
              sub="Confirmed across all projects"
              iconBg="bg-emerald-50"
              iconColor="text-emerald-600"
            />
            <KpiCard
              icon={CheckCircle2}
              label="Projects live"
              value={String(liveCount)}
              sub={`${projects.length - liveCount} draft / pending`}
              iconBg="bg-purple-50"
              iconColor="text-purple-600"
            />
            <KpiCard
              icon={BarChart3}
              label="Avg funding"
              value={`${avgFundingPercent}%`}
              sub="Across active projects"
              iconBg="bg-amber-50"
              iconColor="text-amber-600"
            />
          </div>
        );
      })()}

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-72 bg-white rounded-xl border border-slate-200 animate-pulse"
            />
          ))}
        </div>
      ) : !projects || projects.length === 0 ? (
        <Card className="border-dashed border-2 border-slate-300 bg-white/50">
          <CardContent className="flex flex-col items-center justify-center py-14 sm:py-20 px-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center mb-4">
              <Building2 className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">No projects yet</h3>
            <p className="text-slate-500 max-w-md mb-6 text-sm">
              Create your first project to start raising funds, sharing construction progress,
              and managing your investor base.
            </p>
            <Link href="/developer/new">
              <Button
                className="bg-blue-600 hover:bg-blue-700 shadow-sm"
                data-testid="button-empty-new"
              >
                <Plus className="w-4 h-4 mr-2" /> Create your first project
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map((p) => {
            const status = STATUS_BADGE[p.projectStatus] || STATUS_BADGE.draft;
            return (
              <Link key={p.id} href={`/developer/projects/${slugify(p.name)}`}>
                <Card
                  className="cursor-pointer group hover:shadow-lg hover:border-slate-300 transition-all border-slate-200 overflow-hidden h-full flex flex-col"
                  data-testid={`card-project-${p.id}`}
                >
                  <div className="aspect-[16/9] bg-slate-100 relative overflow-hidden">
                    {p.imageUrl ? (
                      <img
                        src={p.imageUrl}
                        alt={p.name}
                        className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
                        <Building2 className="w-10 h-10 text-slate-400" />
                      </div>
                    )}
                    <div className="absolute inset-x-0 top-0 p-3 flex items-start justify-between gap-2">
                      <Badge
                        variant="outline"
                        className="bg-white/95 backdrop-blur text-slate-700 border-white/40 shadow-sm text-[11px] font-semibold"
                        data-testid={`badge-sales-stage-${p.id}`}
                      >
                        {p.salesStage === "completed" ? "Completed" : "Off-plan"}
                      </Badge>
                      <Badge
                        className={`${status.className} border shadow-sm text-[11px] font-semibold`}
                      >
                        {status.label}
                      </Badge>
                    </div>
                  </div>

                  <CardContent className="p-4 sm:p-5 flex-1 flex flex-col">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3
                        className="text-base sm:text-lg font-semibold text-slate-900 truncate flex-1"
                        data-testid={`text-project-name-${p.id}`}
                      >
                        {p.name}
                      </h3>
                      <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all flex-shrink-0 mt-1" />
                    </div>
                    <p className="text-sm text-slate-500 mb-4 truncate">{p.location}</p>

                    <div className="space-y-3 mt-auto">
                      <div>
                        <div className="flex justify-between text-xs mb-1.5">
                          <span className="text-slate-600 flex items-center gap-1.5">
                            <TrendingUp className="w-3.5 h-3.5" /> Funding
                          </span>
                          <span className="font-semibold text-slate-900 tabular-nums">
                            {p.fundingPercent}%
                          </span>
                        </div>
                        <Progress value={p.fundingPercent} className="h-1.5" />
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1.5">
                          <span className="text-slate-600 flex items-center gap-1.5">
                            <Hammer className="w-3.5 h-3.5" /> Construction
                          </span>
                          <span className="font-semibold text-slate-900 tabular-nums">
                            {p.constructionPercent}%
                          </span>
                        </div>
                        <Progress value={p.constructionPercent} className="h-1.5" />
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-4 mt-4 border-t border-slate-100 text-xs text-slate-600">
                      <span className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5" />
                        {p.investorCount} investor{p.investorCount === 1 ? "" : "s"}
                      </span>
                      {p.nextMilestoneDate && (
                        <span className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5" />
                          {new Date(p.nextMilestoneDate).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
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
