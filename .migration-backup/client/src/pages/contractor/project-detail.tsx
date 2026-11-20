import { useState, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ContractorLayout from "@/components/contractor/ContractorLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";
import {
  Plus, Upload, Trash2, Edit2, FileText, Image, Loader2,
  TrendingUp, TrendingDown, DollarSign, AlertCircle, CheckCircle2, Sparkles,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function ConfirmDialog({ open, title, description, onConfirm, onCancel, loading }: {
  open: boolean; title: string; description: string;
  onConfirm: () => void; onCancel: () => void; loading?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
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

const CATEGORY_COLORS = ["#f59e0b", "#3b82f6", "#10b981", "#8b5cf6", "#ef4444", "#f97316", "#06b6d4", "#84cc16", "#ec4899", "#6366f1"];

function formatCurrency(amount: number | string | null | undefined, currency = "NGN") {
  if (amount === null || amount === undefined || amount === "") return "—";
  return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(amount));
}

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ─── Overview Tab ────────────────────────────────────────────────────────────
function OverviewTab({ project, analysis }: { project: any; analysis: any }) {
  const pct = analysis ? (analysis.totalBudget > 0 ? Math.min(100, (analysis.totalSpent / analysis.totalBudget) * 100) : 0) : 0;
  const overBudget = analysis && analysis.remaining < 0;

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total budget", value: formatCurrency(project.totalBudget, project.currency), icon: DollarSign, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Total spent", value: analysis ? formatCurrency(analysis.totalSpent, project.currency) : "—", icon: TrendingUp, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Remaining", value: analysis ? formatCurrency(Math.abs(analysis.remaining), project.currency) : "—", icon: overBudget ? TrendingDown : CheckCircle2, color: overBudget ? "text-red-600" : "text-green-600", bg: overBudget ? "bg-red-50" : "bg-green-50" },
          { label: "Expenses logged", value: analysis?.expenseCount ?? "—", icon: FileText, color: "text-purple-600", bg: "bg-purple-50" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center mb-3`}>
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
              <p className="text-xs text-gray-500">{label}</p>
              <p className={`text-xl font-bold mt-0.5 ${label === "Remaining" && overBudget ? "text-red-600" : "text-gray-900"}`}>{String(value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Spend progress */}
      {analysis && analysis.totalBudget > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Budget utilisation</span>
              <span className={`text-sm font-bold ${overBudget ? "text-red-600" : "text-gray-900"}`}>{pct.toFixed(1)}%</span>
            </div>
            <Progress value={pct} className={`h-2.5 ${overBudget ? "[&>div]:bg-red-500" : "[&>div]:bg-blue-600"}`} />
            {overBudget && (
              <p className="flex items-center gap-1.5 text-xs text-red-600 mt-2">
                <AlertCircle className="h-3 w-3" /> Over budget by {formatCurrency(Math.abs(analysis.remaining), project.currency)}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Project info */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold text-gray-700">Project information</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {[
            ["Type", project.projectType?.replace("_", " ")],
            ["Status", project.status?.replace("_", " ")],
            ["Location", project.location],
            ["Currency", project.currency],
            ["Start date", formatDate(project.startDate)],
            ["End date", formatDate(project.endDate)],
            ["Client", project.clientName],
            ["Client phone", project.clientPhone],
          ].map(([k, v]) => v ? (
            <div key={k}>
              <span className="text-gray-500">{k}</span>
              <p className="font-medium text-gray-900 capitalize">{v}</p>
            </div>
          ) : null)}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Budget Tab ───────────────────────────────────────────────────────────────
function BudgetTab({ project, budget, refetch }: { project: any; budget: any; refetch: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editCat, setEditCat] = useState<any>(null);
  const [form, setForm] = useState({ name: "", allocatedAmount: "" });
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const addCat = useMutation({
    mutationFn: (d: any) => apiRequest("POST", `/api/contractor/projects/${project.slug}/budget`, d),
    onSuccess: () => { refetch(); setShowAdd(false); setForm({ name: "", allocatedAmount: "" }); toast({ title: "Category added" }); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const updateCat = useMutation({
    mutationFn: ({ id, ...d }: any) => apiRequest("PATCH", `/api/contractor/projects/${project.slug}/budget/${id}`, d),
    onSuccess: () => { refetch(); setEditCat(null); toast({ title: "Category updated" }); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const deleteCat = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/contractor/projects/${project.slug}/budget/${id}`),
    onSuccess: () => { refetch(); toast({ title: "Category deleted" }); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const cats = budget?.categories || [];
  const totalAllocated = budget?.totalAllocated || 0;
  const totalBudget = parseFloat(project.totalBudget || "0");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">
            Allocated: <span className="font-semibold text-gray-900">{formatCurrency(totalAllocated, project.currency)}</span>
            {totalBudget > 0 && <span className="text-gray-400"> / {formatCurrency(totalBudget, project.currency)}</span>}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)} className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5">
          <Plus className="h-4 w-4" /> Add category
        </Button>
      </div>

      {cats.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center mb-3">
              <DollarSign className="h-6 w-6 text-blue-400" />
            </div>
            <p className="font-medium text-gray-700">No budget categories yet</p>
            <p className="text-sm text-gray-500 mt-1">Add categories like Labour, Materials, Equipment...</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {cats.map((cat: any, i: number) => {
            const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
            const pct = cat.allocatedAmount > 0 ? Math.min(100, (cat.spent / cat.allocatedAmount) * 100) : 0;
            const over = cat.spent > cat.allocatedAmount && cat.allocatedAmount > 0;
            return (
              <Card key={cat.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                      <span className="font-medium text-gray-900">{cat.name}</span>
                      {over && <Badge className="bg-red-100 text-red-600 text-xs">Over budget</Badge>}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditCat(cat); setForm({ name: cat.name, allocatedAmount: cat.allocatedAmount }); }}>
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={() => setConfirmDelete(cat.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-gray-500">Spent: <span className="font-medium text-gray-900">{formatCurrency(cat.spent, project.currency)}</span></span>
                    <span className="text-gray-500">Budget: <span className="font-medium text-gray-900">{formatCurrency(cat.allocatedAmount, project.currency)}</span></span>
                  </div>
                  {cat.allocatedAmount > 0 && (
                    <Progress value={pct} className={`h-1.5 ${over ? "[&>div]:bg-red-500" : "[&>div]:bg-blue-600"}`} />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete category"
        description="This will remove the category and unlink all expenses from it. This cannot be undone."
        loading={deleteCat.isPending}
        onConfirm={() => { if (confirmDelete !== null) deleteCat.mutate(confirmDelete); setConfirmDelete(null); }}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* Add/Edit dialog */}
      <Dialog open={showAdd || !!editCat} onOpenChange={(o) => { if (!o) { setShowAdd(false); setEditCat(null); setForm({ name: "", allocatedAmount: "" }); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{editCat ? "Edit category" : "Add budget category"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Category name</Label>
              <Input placeholder="e.g. Labour, Materials" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Allocated amount ({project.currency})</Label>
              <Input type="number" placeholder="e.g. 5000000" value={form.allocatedAmount} onChange={(e) => setForm(f => ({ ...f, allocatedAmount: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAdd(false); setEditCat(null); }}>Cancel</Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700 text-white"
              disabled={!form.name || addCat.isPending || updateCat.isPending}
              onClick={() => {
                if (editCat) updateCat.mutate({ id: editCat.id, name: form.name, allocatedAmount: form.allocatedAmount || "0" });
                else addCat.mutate({ name: form.name, allocatedAmount: form.allocatedAmount || "0", projectId: project.id });
              }}
            >
              {(addCat.isPending || updateCat.isPending) ? "Saving..." : editCat ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Expense Entry Dialog ────────────────────────────────────────────────────
function ExpenseDialog({
  open, onClose, project, categories, initialData, onSaved
}: {
  open: boolean; onClose: () => void; project: any; categories: any[]; initialData?: any; onSaved: () => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    vendor: "", description: "", amount: "", currency: project.currency,
    expenseDate: new Date().toISOString().slice(0, 10),
    categoryId: "", paymentMethod: "", reference: "", notes: "",
  });
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [receiptType, setReceiptType] = useState<string>("image");
  const [extracting, setExtracting] = useState(false);
  const [aiData, setAiData] = useState<any>(null);

  const isEdit = !!initialData;

  // Pre-fill form when editing
  useState(() => {
    if (initialData) {
      setForm({
        vendor: initialData.vendor || "",
        description: initialData.description || "",
        amount: initialData.amount || "",
        currency: initialData.currency || project.currency,
        expenseDate: initialData.expenseDate ? new Date(initialData.expenseDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
        categoryId: initialData.categoryId ? String(initialData.categoryId) : "",
        paymentMethod: initialData.paymentMethod || "",
        reference: initialData.reference || "",
        notes: initialData.notes || "",
      });
      setReceiptUrl(initialData.receiptUrl || null);
      setReceiptType(initialData.receiptType || "image");
    }
  });

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtracting(true);
    setAiData(null);
    try {
      const fd = new FormData();
      fd.append("receipt", file);
      const res = await fetch("/api/contractor/extract-receipt", { method: "POST", body: fd, credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setReceiptUrl(data.receiptUrl);
      setReceiptType(data.receiptType);
      setAiData(data.extracted);
      // Pre-fill form with AI data
      setForm(f => ({
        ...f,
        vendor: data.extracted.vendor || f.vendor,
        amount: data.extracted.amount ? String(data.extracted.amount) : f.amount,
        expenseDate: data.extracted.date || f.expenseDate,
        description: data.extracted.description || f.description,
        paymentMethod: data.extracted.paymentMethod || f.paymentMethod,
        reference: data.extracted.reference || f.reference,
        currency: data.extracted.currency || f.currency,
      }));
      toast({ title: "Receipt scanned!", description: "Review and confirm the extracted details." });
    } catch (err: any) {
      toast({ title: "Extraction failed", description: err.message || "Could not read receipt. Fill in manually.", variant: "destructive" });
    } finally {
      setExtracting(false);
    }
  }

  const save = useMutation({
    mutationFn: (d: any) => isEdit
      ? apiRequest("PATCH", `/api/contractor/projects/${project.slug}/expenses/${initialData.id}`, d)
      : apiRequest("POST", `/api/contractor/projects/${project.slug}/expenses`, d),
    onSuccess: () => { onSaved(); onClose(); toast({ title: isEdit ? "Expense updated" : "Expense logged" }); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  function handleSubmit() {
    if (!form.amount || !form.expenseDate) return;
    save.mutate({
      ...form,
      amount: form.amount,
      categoryId: form.categoryId && form.categoryId !== "none" ? parseInt(form.categoryId) : null,
      expenseDate: new Date(form.expenseDate).toISOString(),
      receiptUrl,
      receiptType,
      aiExtracted: aiData,
      projectId: project.id,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit expense" : "Log expense"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Receipt upload */}
          <div className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center">
            {extracting ? (
              <div className="flex flex-col items-center gap-2 py-2">
                <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                <p className="text-sm text-gray-500">Reading receipt with AI...</p>
              </div>
            ) : receiptUrl ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  {receiptType === "pdf" ? <FileText className="h-4 w-4 text-red-500" /> : <Image className="h-4 w-4 text-blue-500" />}
                  <span>Receipt uploaded</span>
                  {aiData && <Badge className="bg-blue-100 text-blue-700 gap-1"><Sparkles className="h-3 w-3" /> AI extracted</Badge>}
                </div>
                <Button size="sm" variant="ghost" className="text-xs" onClick={() => fileRef.current?.click()}>Change</Button>
              </div>
            ) : (
              <div>
                <Upload className="h-6 w-6 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-600 font-medium">Upload receipt</p>
                <p className="text-xs text-gray-400 mt-0.5">Image or PDF — AI will extract details automatically</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => fileRef.current?.click()}>
                  Choose file
                </Button>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleFileChange} />
          </div>

          {aiData && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-amber-800">
              <p className="font-medium flex items-center gap-1 mb-1"><Sparkles className="h-3 w-3" /> AI extracted — please verify</p>
              <p>Confidence: {aiData.confidence ? `${(aiData.confidence * 100).toFixed(0)}%` : "—"}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Amount *</Label>
              <Input type="number" placeholder="0.00" value={form.amount} onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Select value={form.currency} onValueChange={(v) => setForm(f => ({ ...f, currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NGN">NGN</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Vendor / Supplier</Label>
            <Input placeholder="e.g. Dangote Cement" value={form.vendor} onChange={(e) => setForm(f => ({ ...f, vendor: e.target.value }))} />
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input placeholder="What was this for?" value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date *</Label>
              <Input type="date" value={form.expenseDate} onChange={(e) => setForm(f => ({ ...f, expenseDate: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={form.categoryId} onValueChange={(v) => setForm(f => ({ ...f, categoryId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Uncategorised</SelectItem>
                  {categories.map((c: any) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Payment method</Label>
              <Select value={form.paymentMethod} onValueChange={(v) => setForm(f => ({ ...f, paymentMethod: v }))}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Reference</Label>
              <Input placeholder="Transaction ref" value={form.reference} onChange={(e) => setForm(f => ({ ...f, reference: e.target.value }))} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea placeholder="Any additional notes..." rows={2} value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="bg-blue-600 hover:bg-blue-700 text-white"
            disabled={!form.amount || !form.expenseDate || save.isPending}
            onClick={handleSubmit}
          >
            {save.isPending ? "Saving..." : isEdit ? "Update" : "Log expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Expenses Tab ─────────────────────────────────────────────────────────────
function ExpensesTab({ project, expenses, categories, refetch }: { project: any; expenses: any[]; categories: any[]; refetch: () => void }) {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [editExpense, setEditExpense] = useState<any>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const deleteExpense = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/contractor/projects/${project.slug}/expenses/${id}`),
    onSuccess: () => { refetch(); toast({ title: "Expense deleted" }); setConfirmDelete(null); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const METHOD_LABELS: Record<string, string | undefined> = {
    cash: "Cash", bank_transfer: "Bank transfer", card: "Card", cheque: "Cheque", other: "Other",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{expenses.length} expense{expenses.length !== 1 ? "s" : ""} logged</p>
        <Button size="sm" onClick={() => setShowAdd(true)} className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5">
          <Plus className="h-4 w-4" /> Log expense
        </Button>
      </div>

      {expenses.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center mb-3">
              <FileText className="h-6 w-6 text-blue-400" />
            </div>
            <p className="font-medium text-gray-700">No expenses yet</p>
            <p className="text-sm text-gray-500 mt-1">Upload a receipt and AI will extract the details for you.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {expenses.map((e: any) => (
            <Card key={e.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-gray-900">{formatCurrency(e.amount, e.currency)}</span>
                      {e.categoryName && (
                        <Badge style={{ backgroundColor: e.categoryColor + "20", color: e.categoryColor || "#6b7280" }} className="text-xs">
                          {e.categoryName}
                        </Badge>
                      )}
                      {e.aiExtracted && <Badge className="bg-blue-50 text-blue-600 text-xs gap-0.5"><Sparkles className="h-2.5 w-2.5" /> AI</Badge>}
                    </div>
                    {e.vendor && <p className="text-sm text-gray-700 font-medium">{e.vendor}</p>}
                    {e.description && <p className="text-xs text-gray-500 mt-0.5">{e.description}</p>}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
                      <span>{formatDate(e.expenseDate)}</span>
                      {e.paymentMethod && <span>{METHOD_LABELS[e.paymentMethod] || e.paymentMethod}</span>}
                      {e.reference && <span>Ref: {e.reference}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-3">
                    {e.receiptUrl && (
                      <a href={e.receiptUrl} target="_blank" rel="noreferrer">
                        <Button size="icon" variant="ghost" className="h-7 w-7">
                          {e.receiptType === "pdf" ? <FileText className="h-3.5 w-3.5 text-red-500" /> : <Image className="h-3.5 w-3.5 text-blue-500" />}
                        </Button>
                      </a>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditExpense(e)}>
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={() => setConfirmDelete(e.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete expense"
        description="This will permanently remove this expense record. This cannot be undone."
        loading={deleteExpense.isPending}
        onConfirm={() => { if (confirmDelete !== null) deleteExpense.mutate(confirmDelete); }}
        onCancel={() => setConfirmDelete(null)}
      />

      <ExpenseDialog
        open={showAdd}
        onClose={() => setShowAdd(false)}
        project={project}
        categories={categories}
        onSaved={refetch}
      />
      {editExpense && (
        <ExpenseDialog
          open={!!editExpense}
          onClose={() => setEditExpense(null)}
          project={project}
          categories={categories}
          initialData={editExpense}
          onSaved={refetch}
        />
      )}
    </div>
  );
}

// ─── Analysis Tab ─────────────────────────────────────────────────────────────
function AnalysisTab({ project, analysis }: { project: any; analysis: any }) {
  if (!analysis) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-blue-600" /></div>;

  const { categoryBreakdown, burnRate, paymentMethods } = analysis;

  const budgetVsActual = categoryBreakdown.map((c: any, i: number) => ({
    name: c.name.length > 12 ? c.name.slice(0, 12) + "…" : c.name,
    Budget: c.allocated,
    Spent: c.spent,
    color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
  }));

  const donutData = categoryBreakdown.filter((c: any) => c.spent > 0).map((c: any, i: number) => ({
    name: c.name,
    value: c.spent,
    color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
  }));

  const burnData = burnRate.map((r: any) => ({
    month: r.month,
    amount: r.amount,
  }));

  const methodData = paymentMethods.map((m: any) => ({
    name: { cash: "Cash", bank_transfer: "Bank transfer", card: "Card", cheque: "Cheque", other: "Other" }[m.method] || m.method,
    value: m.amount,
  }));

  return (
    <div className="space-y-6">
      {/* Budget vs Actual */}
      {budgetVsActual.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold text-gray-700">Budget vs Actual Spend</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={budgetVsActual} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₦${(v / 1000000).toFixed(1)}M`} />
                <Tooltip formatter={(v: any) => formatCurrency(v, project.currency)} />
                <Legend />
                <Bar dataKey="Budget" fill="#e5e7eb" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Spent" fill="#f59e0b" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-5">
        {/* Spend by category donut */}
        {donutData.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-sm font-semibold text-gray-700">Spend by Category</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={donutData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value" paddingAngle={2}>
                    {donutData.map((entry: any, i: number) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => formatCurrency(v, project.currency)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1 mt-2">
                {donutData.map((d: any) => (
                  <div key={d.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                      <span className="text-gray-600">{d.name}</span>
                    </div>
                    <span className="font-medium text-gray-900">{formatCurrency(d.value, project.currency)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Payment methods */}
        {methodData.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-sm font-semibold text-gray-700">Payment Methods</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3 pt-2">
                {methodData.map((m: any) => {
                  const total = methodData.reduce((s: number, x: any) => s + x.value, 0);
                  const pct = total > 0 ? (m.value / total) * 100 : 0;
                  return (
                    <div key={m.name}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-gray-600">{m.name}</span>
                        <span className="font-medium">{formatCurrency(m.value, project.currency)}</span>
                      </div>
                      <Progress value={pct} className="h-1.5 [&>div]:bg-blue-600" />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Burn rate */}
      {burnData.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold text-gray-700">Monthly Spend (last 12 months)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={burnData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₦${(v / 1000000).toFixed(1)}M`} />
                <Tooltip formatter={(v: any) => formatCurrency(v, project.currency)} />
                <Line type="monotone" dataKey="amount" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: "#f59e0b" }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {burnData.length === 0 && donutData.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <BarChart3 className="h-8 w-8 text-gray-300 mb-3" />
            <p className="font-medium text-gray-700">No data yet</p>
            <p className="text-sm text-gray-500 mt-1">Log expenses to see analysis charts here.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── BarChart3 import fix ────────────────────────────────────────────────────
import { BarChart3 } from "lucide-react";

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ContractorProjectDetail() {
  const [, params] = useRoute("/contractor/projects/:slug");
  const [, navigate] = useLocation();
  const projectSlug = params?.slug;

  const { data: me } = useQuery({ queryKey: ["/api/contractor/me"], retry: false });
  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ["/api/contractor/projects", projectSlug],
    queryFn: () => apiRequest("GET", `/api/contractor/projects/${projectSlug}`),
    enabled: !!me && !!projectSlug,
  });

  const { data: budget, refetch: refetchBudget } = useQuery({
    queryKey: ["/api/contractor/projects", projectSlug, "budget"],
    queryFn: () => apiRequest("GET", `/api/contractor/projects/${projectSlug}/budget`),
    enabled: !!project,
  });

  const { data: expenses = [], refetch: refetchExpenses } = useQuery({
    queryKey: ["/api/contractor/projects", projectSlug, "expenses"],
    queryFn: () => apiRequest("GET", `/api/contractor/projects/${projectSlug}/expenses`),
    enabled: !!project,
  });

  const { data: analysis, refetch: refetchAnalysis } = useQuery({
    queryKey: ["/api/contractor/projects", projectSlug, "analysis"],
    queryFn: () => apiRequest("GET", `/api/contractor/projects/${projectSlug}/analysis`),
    enabled: !!project,
  });

  if (!me) { window.location.href = "/contractor/login"; return null; }
  if (projectLoading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" /></div>;
  if (!project) return <div className="min-h-screen flex items-center justify-center text-gray-500">Project not found</div>;

  const p = project as any;
  const b = budget as any;
  const a = analysis as any;
  const exps = expenses as any[];
  const cats = b?.categories || [];

  function refetchAll() { refetchBudget(); refetchExpenses(); refetchAnalysis(); }

  return (
    <ContractorLayout title={p.name} subtitle={p.location || p.projectType} backTo="/contractor">
      <Tabs defaultValue="overview" className="space-y-5">
        <TabsList className="grid grid-cols-4 w-full max-w-lg">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="budget">Budget</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="analysis">Analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab project={p} analysis={a} />
        </TabsContent>
        <TabsContent value="budget">
          <BudgetTab project={p} budget={b} refetch={refetchBudget} />
        </TabsContent>
        <TabsContent value="expenses">
          <ExpensesTab project={p} expenses={exps} categories={cats} refetch={refetchAll} />
        </TabsContent>
        <TabsContent value="analysis">
          <AnalysisTab project={p} analysis={a} />
        </TabsContent>
      </Tabs>
    </ContractorLayout>
  );
}
