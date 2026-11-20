import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useState } from "react";
import ContractorLayout from "@/components/contractor/ContractorLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, FolderOpen, MapPin, Calendar, TrendingUp, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function ConfirmDialog({ open, title, description, onConfirm, onCancel, loading }: {
  open: boolean; title: string; description: string;
  onConfirm: () => void; onCancel: () => void; loading?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <p className="text-sm text-gray-500">{description}</p>
        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading}>
            {loading ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  completed: "bg-blue-100 text-blue-700",
  on_hold: "bg-blue-100 text-blue-700",
  cancelled: "bg-red-100 text-red-700",
};

function formatCurrency(amount: number | string | null, currency = "NGN") {
  if (!amount) return "—";
  return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(amount));
}

export default function ContractorDashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const deleteProject = useMutation({
    mutationFn: (slug: string) => apiRequest("DELETE", `/api/contractor/projects/${slug}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/contractor/projects"] });
      setConfirmDelete(null);
      toast({ title: "Project deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete project", description: err.message, variant: "destructive" });
    },
  });

  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ["/api/contractor/me"],
    retry: false,
  });

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["/api/contractor/projects"],
    enabled: !!me,
  });

  if (meLoading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" /></div>;
  if (!me) { window.location.href = "/contractor/login"; return null; }

  const projectList = projects as any[];

  return (
    <ContractorLayout
      title="My Projects"
      actions={
        <Button onClick={() => navigate("/contractor/new")} size="sm" className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5">
          <Plus className="h-4 w-4" /> New Project
        </Button>
      }
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
        </div>
      ) : projectList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mb-4">
            <FolderOpen className="h-8 w-8 text-blue-400" />
          </div>
          <h3 className="font-semibold text-gray-900 text-lg mb-1">No projects yet</h3>
          <p className="text-gray-500 text-sm mb-6 max-w-xs">Create your first project to start tracking expenses and budgets.</p>
          <Button onClick={() => navigate("/contractor/new")} className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5">
            <Plus className="h-4 w-4" /> Create project
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projectList.map((p: any) => (
            <div key={p.id} className="relative group">
              <button
                className="absolute top-3 right-3 z-10 p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity bg-white shadow-sm border border-gray-200 hover:bg-red-50 hover:border-red-200 hover:text-red-600 text-gray-400"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmDelete(p.slug); }}
                title="Delete project"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <Link href={`/contractor/projects/${p.slug}`}>
              <Card className="cursor-pointer hover:shadow-md transition-shadow group">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-semibold text-gray-900 group-hover:text-blue-700 transition-colors line-clamp-1 pr-6">{p.name}</h3>
                    <Badge className={`text-xs shrink-0 ml-2 ${STATUS_COLORS[p.status] || "bg-gray-100 text-gray-600"}`}>
                      {p.status.replace("_", " ")}
                    </Badge>
                  </div>

                  {p.location && (
                    <p className="flex items-center gap-1.5 text-xs text-gray-500 mb-2">
                      <MapPin className="h-3 w-3" /> {p.location}
                    </p>
                  )}
                  {p.description && <p className="text-sm text-gray-600 line-clamp-2 mb-3">{p.description}</p>}

                  <div className="border-t border-gray-100 pt-3 mt-3 space-y-1.5">
                    {p.totalBudget && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-500 flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Total Budget</span>
                        <span className="font-medium text-gray-900">{formatCurrency(p.totalBudget, p.currency)}</span>
                      </div>
                    )}
                    {(p.startDate || p.endDate) && (
                      <div className="flex items-center gap-1.5 text-xs text-gray-500">
                        <Calendar className="h-3 w-3" />
                        {p.startDate ? new Date(p.startDate).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "—"}
                        {" → "}
                        {p.endDate ? new Date(p.endDate).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "Ongoing"}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
              </Link>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete project?"
        description="This will permanently delete the project, all its budget categories, and all expenses. This cannot be undone."
        loading={deleteProject.isPending}
        onConfirm={() => confirmDelete !== null && deleteProject.mutate(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </ContractorLayout>
  );
}
