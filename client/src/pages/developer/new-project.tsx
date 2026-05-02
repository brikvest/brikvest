import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import DeveloperLayout from "@/components/developer/DeveloperLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toastFromError } from "@/lib/planErrors";
import { Loader2, ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";
import HelpTip from "@/components/developer/HelpTip";

const STEPS = [
  { id: 1, label: "Basics" },
  { id: 2, label: "Pricing & Units" },
  { id: 3, label: "Description & Media" },
  { id: 4, label: "Review" },
];

export default function NewProjectWizard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name: "",
    location: "",
    city: "",
    district: "",
    propertyType: "land",
    currency: "NGN",
    spvName: "",
    totalValue: "",
    totalUnits: "",
    unitPrice: "",
    minInvestment: "",
    developerEquityUnits: "0",
    isTransferable: false,
    description: "",
    investmentDetails: "",
    imageUrl: "",
    videoUrl: "",
    developerNotes: "",
  });

  const u = (k: string) => (e: any) => setForm({ ...form, [k]: e?.target ? e.target.value : e });

  const create = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        totalValue: parseFloat(form.totalValue),
        totalUnits: parseInt(form.totalUnits),
        unitPrice: parseFloat(form.unitPrice),
        minInvestment: form.minInvestment ? parseFloat(form.minInvestment) : parseFloat(form.unitPrice),
        developerEquityUnits: parseInt(form.developerEquityUnits) || 0,
      };
      return await apiRequest("POST", "/api/developer/projects", payload);
    },
    onSuccess: (project: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/projects"] });
      toast({ title: "Project created", description: "It's saved as a draft. Submit it for approval when ready." });
      setLocation(`/developer/projects/${project.id}`);
    },
    onError: (err: any) => toast(toastFromError(err, "Failed to create project")),
  });

  const canNext = () => {
    if (step === 1) return form.name && form.location && form.propertyType && form.currency;
    if (step === 2) return form.totalValue && form.totalUnits && form.unitPrice;
    if (step === 3) return form.description && form.imageUrl;
    return true;
  };

  return (
    <DeveloperLayout backTo="/developer" title="Create new project" subtitle="Tell us about your development. You can edit anything later.">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            {STEPS.map((s, idx) => (
              <div key={s.id} className="flex items-center flex-1">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                    step > s.id ? "bg-emerald-600 text-white"
                    : step === s.id ? "bg-blue-600 text-white"
                    : "bg-slate-200 text-slate-600"
                  }`}>
                    {step > s.id ? <CheckCircle2 className="w-4 h-4" /> : s.id}
                  </div>
                  <span className={`text-sm font-medium ${step >= s.id ? "text-slate-900" : "text-slate-500"}`}>{s.label}</span>
                </div>
                {idx < STEPS.length - 1 && <div className="flex-1 h-0.5 bg-slate-200 mx-3" />}
              </div>
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <Label>Project name *</Label>
                <Input value={form.name} onChange={u("name")} placeholder="Lily Crest Gardens — Phase 2" data-testid="input-name" />
              </div>
              <div>
                <Label>Location *</Label>
                <Input value={form.location} onChange={u("location")} placeholder="Guzape, Abuja" data-testid="input-location" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>City</Label>
                  <Input value={form.city} onChange={u("city")} placeholder="Abuja" data-testid="input-city" />
                </div>
                <div>
                  <Label>District</Label>
                  <Input value={form.district} onChange={u("district")} placeholder="Guzape" data-testid="input-district" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Property type *</Label>
                  <Select value={form.propertyType} onValueChange={u("propertyType")}>
                    <SelectTrigger data-testid="select-property-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="land">Land</SelectItem>
                      <SelectItem value="residential">Residential</SelectItem>
                      <SelectItem value="commercial">Commercial</SelectItem>
                      <SelectItem value="mixed_use">Mixed-use</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Currency *</Label>
                  <Select value={form.currency} onValueChange={u("currency")}>
                    <SelectTrigger data-testid="select-currency"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NGN">NGN — Nigerian Naira</SelectItem>
                      <SelectItem value="USD">USD — US Dollar</SelectItem>
                      <SelectItem value="GBP">GBP — British Pound</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <Label>SPV / Holding entity</Label>
                  <HelpTip>
                    The Special Purpose Vehicle (SPV) is the legal entity that holds title to the property on
                    behalf of investors. Investors own units in this SPV, not the underlying land directly.
                    Leave blank if you haven't incorporated one yet.
                  </HelpTip>
                </div>
                <Input value={form.spvName} onChange={u("spvName")} placeholder="Lily Crest SPV Ltd" data-testid="input-spv" />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-1.5">
                  <Label>Total project value *</Label>
                  <HelpTip>
                    The full capital you're raising for this project, in {form.currency}. This is the
                    target raise — once investors collectively commit this amount the project is fully funded.
                  </HelpTip>
                </div>
                <Input type="number" value={form.totalValue} onChange={u("totalValue")} placeholder="500000000" data-testid="input-total-value" />
                <p className="text-xs text-slate-500 mt-1">Total raise size in {form.currency}.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Label>Total units *</Label>
                    <HelpTip>
                      Fractional ownership shares. The project is split into this many equal pieces — for
                      example, 100 units of a ₦500m project means each unit represents ₦5m of ownership.
                      More units = lower entry price = more investors can participate.
                    </HelpTip>
                  </div>
                  <Input type="number" value={form.totalUnits} onChange={u("totalUnits")} placeholder="100" data-testid="input-total-units" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <Label>Unit price *</Label>
                    <HelpTip>
                      The price of a single unit, in {form.currency}. Usually equals
                      Total project value ÷ Total units. Investors pay this amount per unit they buy.
                    </HelpTip>
                  </div>
                  <Input type="number" value={form.unitPrice} onChange={u("unitPrice")} placeholder="5000000" data-testid="input-unit-price" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Label>Minimum investment</Label>
                    <HelpTip>
                      The smallest amount an investor can commit. Defaults to one unit price. Set this
                      lower if you want to allow micro-investments below a single unit (Brikvest will
                      pool fractional commitments).
                    </HelpTip>
                  </div>
                  <Input type="number" value={form.minInvestment} onChange={u("minInvestment")} placeholder="Defaults to unit price" data-testid="input-min-investment" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <Label>Developer-retained units</Label>
                    <HelpTip>
                      Units you keep for yourself (or your team) as the developer — your "sweat equity".
                      These are removed from the units available to investors. Leave at 0 if you're
                      raising the full amount externally.
                    </HelpTip>
                  </div>
                  <Input type="number" value={form.developerEquityUnits} onChange={u("developerEquityUnits")} data-testid="input-developer-units" />
                  <p className="text-xs text-slate-500 mt-1">Units you keep as the developer (sweat equity).</p>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Label className="text-sm">Allow secondary-market resale</Label>
                    <HelpTip>
                      When ON, investors who buy units can later list them for resale to other approved
                      Brikvest members (P2P marketplace). Off-plan projects often disable this until
                      construction is further along.
                    </HelpTip>
                  </div>
                  <p className="text-xs text-slate-500">Investors can list their units to other members.</p>
                </div>
                <Switch checked={form.isTransferable} onCheckedChange={(v) => setForm({ ...form, isTransferable: v })} data-testid="switch-transferable" />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <Label>Description *</Label>
                <Textarea value={form.description} onChange={u("description")} rows={5} placeholder="What is this project? Where? Why is it a great opportunity?" data-testid="input-description" />
              </div>
              <div>
                <Label>Investment thesis</Label>
                <Textarea value={form.investmentDetails} onChange={u("investmentDetails")} rows={4} placeholder="Expected returns, exit strategy, comparables…" data-testid="input-investment-details" />
              </div>
              <div>
                <Label>Cover image URL *</Label>
                <Input value={form.imageUrl} onChange={u("imageUrl")} placeholder="https://res.cloudinary.com/…" data-testid="input-image-url" />
                <p className="text-xs text-slate-500 mt-1">Paste a publicly hosted image URL (Cloudinary or other).</p>
              </div>
              <div>
                <Label>Video URL</Label>
                <Input value={form.videoUrl} onChange={u("videoUrl")} placeholder="https://…" data-testid="input-video-url" />
              </div>
              <div>
                <Label>Developer notes (private)</Label>
                <Textarea value={form.developerNotes} onChange={u("developerNotes")} rows={3} placeholder="Internal notes. Not shown to investors." data-testid="input-developer-notes" />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3 text-sm">
              <RowKV label="Project name" value={form.name} />
              <RowKV label="Location" value={form.location} />
              <RowKV label="Property type" value={form.propertyType} />
              <RowKV label="Currency" value={form.currency} />
              <RowKV label="Total value" value={`${form.currency} ${parseFloat(form.totalValue || "0").toLocaleString()}`} />
              <RowKV label="Total units" value={form.totalUnits} />
              <RowKV label="Unit price" value={`${form.currency} ${parseFloat(form.unitPrice || "0").toLocaleString()}`} />
              <RowKV label="Developer-retained units" value={form.developerEquityUnits} />
              <RowKV label="Resale allowed" value={form.isTransferable ? "Yes" : "No"} />
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
                <p className="text-sm text-blue-900">
                  Once created, your project is saved as a <strong>Draft</strong> and is not visible to investors. You can edit details and submit it for Brikvest approval from the project page.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between mt-6">
        <Button variant="outline" disabled={step === 1} onClick={() => setStep(step - 1)} data-testid="button-back">
          <ChevronLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        {step < 4 ? (
          <Button className="bg-blue-600 hover:bg-blue-700" disabled={!canNext()} onClick={() => setStep(step + 1)} data-testid="button-next">
            Next <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        ) : (
          <Button className="bg-blue-600 hover:bg-blue-700" disabled={create.isPending} onClick={() => create.mutate()} data-testid="button-create">
            {create.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Create project
          </Button>
        )}
      </div>
    </DeveloperLayout>
  );
}

function RowKV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
      <span className="text-slate-600">{label}</span>
      <span className="font-medium text-slate-900">{value || <span className="text-slate-400">—</span>}</span>
    </div>
  );
}
