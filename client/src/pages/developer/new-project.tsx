import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import DeveloperLayout from "@/components/developer/DeveloperLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toastFromError } from "@/lib/planErrors";
import {
  Loader2, ChevronLeft, ChevronRight, CheckCircle2, Check,
  PieChart, TrendingUp, Banknote, Coins, Wallet, Plus, Trash2,
} from "lucide-react";
import HelpTip from "@/components/developer/HelpTip";

const STEPS = [
  { id: 1, label: "Basics" },
  { id: 2, label: "Funding model" },
  { id: 3, label: "Pricing & Units" },
  { id: 4, label: "Description & Media" },
  { id: 5, label: "Review" },
];

type FundingType = "equity" | "fixed_return" | "profit_share" | "loan" | "self_funded";

const FUNDING_OPTIONS: {
  value: FundingType;
  label: string;
  short: string;
  icon: any;
  example: string;
}[] = [
  {
    value: "equity",
    label: "Equity / Co-ownership",
    short: "Investors own a share of the project. They earn when the property is sold, rented out, or appreciates.",
    icon: PieChart,
    example: "Example: 100 investors each own 1% of a Lekki land plot and split the proceeds when it's sold.",
  },
  {
    value: "fixed_return",
    label: "Fixed return (ROI)",
    short: "You commit to paying a specific percentage return. Investors get their capital plus that return at the end of the agreed term.",
    icon: TrendingUp,
    example: "Example: ₦1m today returns ₦1.25m in 12 months — 25% ROI.",
  },
  {
    value: "profit_share",
    label: "Profit share",
    short: "Investors get a share of the project's net profit at exit. Returns go up if the project does well, down if it doesn't.",
    icon: Coins,
    example: "Example: Investors collectively take 40% of net profit when the development is sold.",
  },
  {
    value: "loan",
    label: "Loan / Debt",
    short: "Individuals or financial institutions lend money for a set period and earn interest. They don't own any part of the project.",
    icon: Banknote,
    example: "Example: ₦50m loan at 18% interest, repaid in full after 18 months.",
  },
];

const SELF_FUNDED: { value: FundingType; label: string; short: string; icon: any } = {
  value: "self_funded",
  label: "Self-funded",
  short: "No external investors. You're funding the project yourself; we'll just track the build.",
  icon: Wallet,
};

function devTypeNouns(propertyType: string) {
  // Affects how "units" are described downstream (Pricing & Units, Review).
  if (propertyType === "residential") {
    return {
      singular: "unit",
      plural: "units",
      Plural: "Units",
      retainedLabel: "Developer-retained units",
      retainedHelp:
        "Units (apartments) you keep for yourself or your team — your sweat equity. These are removed from what's available to investors.",
      resaleHelp:
        "When ON, investors who buy units can later list those units for resale to other approved Brikvest members.",
      // Per-type rows
      sectionTitle: "Unit types & pricing",
      sectionHelp:
        "List each type of unit you're selling — for example 2-bedroom apartment, 3-bedroom apartment, penthouse. Add a row for every type with how many you have and the price each.",
      typeLabel: "Unit type",
      typePlaceholder: "e.g. 2-bedroom apartment",
      qtyLabel: "How many",
      pricePlaceholder: "20000000",
      addRowLabel: "Add another unit type",
    };
  }
  // default: land / estate
  return {
    singular: "plot",
    plural: "plots",
    Plural: "Plots",
    retainedLabel: "Developer-retained plots",
    retainedHelp:
      "Plots you keep for yourself or your team — your sweat equity. These are removed from what's available to investors.",
    resaleHelp:
      "When ON, investors who buy plots can later list those plots for resale to other approved Brikvest members.",
    // Per-type rows
    sectionTitle: "Plot sizes & pricing",
    sectionHelp:
      "List each plot size you're selling — for example 500 sqm, 1000 sqm. Add a row for every size with how many plots you have and the price each.",
    typeLabel: "Plot size",
    typePlaceholder: "e.g. 500 sqm",
    qtyLabel: "How many plots",
    pricePlaceholder: "5000000",
    addRowLabel: "Add another plot size",
  };
}

type UnitTypeRow = { label: string; quantity: string; price: string };

export default function NewProjectWizard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    // Basics
    name: "",
    location: "",
    city: "",
    district: "",
    propertyType: "land",
    currency: "NGN",
    spvName: "",
    // Funding model
    fundingTypes: ["equity"] as FundingType[],
    acceptsExternalInvestors: true,
    expectedReturnPercent: "",
    returnPeriod: "annual",
    investmentTermMonths: "",
    payoutFrequency: "on_exit",
    exitStrategy: "sale",
    fundingNotes: "",
    // Pricing & units — per-type breakdown (estate: by plot size; vertical: by apartment type)
    unitTypes: [{ label: "", quantity: "", price: "" }] as UnitTypeRow[],
    developerEquityUnits: "0",
    isTransferable: false,
    // Description & media
    description: "",
    investmentDetails: "",
    imageUrl: "",
    videoUrl: "",
    developerNotes: "",
  });

  const u = (k: string) => (e: any) => setForm({ ...form, [k]: e?.target ? e.target.value : e });

  const updateUnitType = (idx: number, field: keyof UnitTypeRow, value: string) => {
    const next = form.unitTypes.map((r, i) => (i === idx ? { ...r, [field]: value } : r));
    setForm({ ...form, unitTypes: next });
  };
  const addUnitType = () => setForm({ ...form, unitTypes: [...form.unitTypes, { label: "", quantity: "", price: "" }] });
  const removeUnitType = (idx: number) => {
    const next = form.unitTypes.filter((_, i) => i !== idx);
    setForm({ ...form, unitTypes: next.length ? next : [{ label: "", quantity: "", price: "" }] });
  };

  const validUnitTypes = form.unitTypes
    .map(r => ({ label: r.label.trim(), quantity: parseInt(r.quantity) || 0, price: parseFloat(r.price) || 0 }))
    .filter(r => r.label && r.quantity > 0 && r.price > 0);
  const totalUnitsCalc = validUnitTypes.reduce((s, r) => s + r.quantity, 0);
  const totalValueCalc = validUnitTypes.reduce((s, r) => s + r.quantity * r.price, 0);
  const minPriceCalc = validUnitTypes.length ? Math.min(...validUnitTypes.map(r => r.price)) : 0;

  const toggleFundingType = (t: FundingType) => {
    const has = form.fundingTypes.includes(t);
    const next = has
      ? form.fundingTypes.filter(x => x !== t)
      : [...form.fundingTypes, t];
    setForm({ ...form, fundingTypes: next.length === 0 ? ["equity"] : next });
  };

  const isSelfFunded = !form.acceptsExternalInvestors;
  const types = isSelfFunded ? ["self_funded"] : form.fundingTypes;
  const showReturnFields = !isSelfFunded && (types.includes("fixed_return") || types.includes("loan"));
  const showExitField   = !isSelfFunded && (types.includes("equity") || types.includes("profit_share"));
  const isCombo = !isSelfFunded && form.fundingTypes.length > 1;

  const create = useMutation({
    mutationFn: async () => {
      const payload: any = {
        ...form,
        unitTypes: validUnitTypes,
        totalValue: totalValueCalc,
        totalUnits: totalUnitsCalc,
        unitPrice: minPriceCalc,
        minInvestment: minPriceCalc,
        developerEquityUnits: parseInt(form.developerEquityUnits) || 0,
        // Funding fields — only send when meaningful
        fundingTypes: isSelfFunded ? ["self_funded"] : form.fundingTypes,
        acceptsExternalInvestors: !isSelfFunded,
        expectedReturnPercent: showReturnFields && form.expectedReturnPercent ? parseFloat(form.expectedReturnPercent) : null,
        returnPeriod: showReturnFields ? form.returnPeriod || null : null,
        investmentTermMonths: showReturnFields && form.investmentTermMonths ? parseInt(form.investmentTermMonths) : null,
        payoutFrequency: showReturnFields ? form.payoutFrequency || null : null,
        exitStrategy: showExitField ? form.exitStrategy || null : null,
        fundingNotes: form.fundingNotes || null,
      };
      delete payload.fundingType;
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
    if (step === 2) {
      if (isSelfFunded) return true;
      if (form.fundingTypes.length === 0) return false;
      if (showReturnFields) {
        return !!form.expectedReturnPercent && !!form.investmentTermMonths;
      }
      return true;
    }
    if (step === 3) return validUnitTypes.length > 0;
    if (step === 4) return form.description && form.imageUrl;
    return true;
  };

  const nouns = devTypeNouns(form.propertyType);

  const fundingLabels = isSelfFunded
    ? [SELF_FUNDED.label]
    : form.fundingTypes.map(t => FUNDING_OPTIONS.find(o => o.value === t)?.label || t);

  return (
    <DeveloperLayout backTo="/developer" title="Create new project" subtitle="Tell us about your development. You can edit anything later.">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between overflow-x-auto">
            {STEPS.map((s, idx) => (
              <div key={s.id} className="flex items-center flex-1 min-w-fit">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold flex-shrink-0 ${
                    step > s.id ? "bg-emerald-600 text-white"
                    : step === s.id ? "bg-blue-600 text-white"
                    : "bg-slate-200 text-slate-600"
                  }`}>
                    {step > s.id ? <CheckCircle2 className="w-4 h-4" /> : s.id}
                  </div>
                  <span className={`text-sm font-medium whitespace-nowrap ${step >= s.id ? "text-slate-900" : "text-slate-500"}`}>{s.label}</span>
                </div>
                {idx < STEPS.length - 1 && <div className="flex-1 h-0.5 bg-slate-200 mx-3 min-w-[12px]" />}
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
                  <Label>Development type *</Label>
                  <Select value={form.propertyType} onValueChange={u("propertyType")}>
                    <SelectTrigger data-testid="select-property-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="land">Estate / Land development</SelectItem>
                      <SelectItem value="residential">Residential / Vertical development</SelectItem>
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
                  <span className="text-xs text-slate-400 font-normal">(optional)</span>
                  <HelpTip>
                    The Special Purpose Vehicle (SPV) is the legal entity that holds title to the property on
                    behalf of investors. Investors own units in this SPV, not the underlying land directly.
                    Leave blank if you haven't incorporated one yet — you can add it later.
                  </HelpTip>
                </div>
                <Input value={form.spvName} onChange={u("spvName")} placeholder="Lily Crest SPV Ltd (optional)" data-testid="input-spv" />
                <p className="text-xs text-slate-500 mt-1">Optional — you can add this later once your SPV is incorporated.</p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div className="rounded-lg border border-slate-200 p-4 bg-slate-50">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Label className="text-sm">Will this project have external investors?</Label>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Turn off if you're funding it yourself and just want it tracked here.
                    </p>
                  </div>
                  <Switch
                    checked={form.acceptsExternalInvestors}
                    onCheckedChange={(v) => setForm({ ...form, acceptsExternalInvestors: v })}
                    data-testid="switch-external-investors"
                  />
                </div>
              </div>

              {form.acceptsExternalInvestors && (
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <Label className="text-sm">How are investors funding this project? *</Label>
                    <span className="text-xs text-slate-500">Select one or more</span>
                  </div>
                  <p className="text-xs text-slate-500 mb-3">
                    Pick every model that applies. You can combine them — for example a fixed return plus equity upside.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {FUNDING_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      const active = form.fundingTypes.includes(opt.value);
                      return (
                        <button
                          type="button"
                          key={opt.value}
                          onClick={() => toggleFundingType(opt.value)}
                          aria-pressed={active}
                          className={`relative text-left rounded-lg border p-3 transition-all ${
                            active
                              ? "border-blue-500 bg-blue-50 ring-2 ring-blue-100"
                              : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                          }`}
                          data-testid={`card-funding-${opt.value}`}
                        >
                          {active && (
                            <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center">
                              <Check className="w-3 h-3 text-white" strokeWidth={3} />
                            </div>
                          )}
                          <div className="flex items-start gap-2.5 pr-6">
                            <div className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                              <Icon className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-slate-900">{opt.label}</div>
                              <div className="text-xs text-slate-600 mt-0.5">{opt.short}</div>
                              <div className="text-[11px] text-slate-500 mt-1 italic">{opt.example}</div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {isCombo && (
                    <div className="mt-3 rounded-md bg-indigo-50 border border-indigo-100 p-2.5 text-xs text-indigo-900">
                      <strong>Combined model selected.</strong> Use the funding notes below to spell out exactly how
                      the structures fit together for investors.
                    </div>
                  )}
                </div>
              )}

              {showReturnFields && (
                <div className="space-y-4 rounded-lg border border-blue-100 bg-blue-50/30 p-4">
                  <div className="text-sm font-semibold text-slate-900">Return terms</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label>Expected return % *</Label>
                      <Input
                        type="number"
                        step="0.5"
                        value={form.expectedReturnPercent}
                        onChange={u("expectedReturnPercent")}
                        placeholder="25"
                        data-testid="input-expected-return"
                      />
                      <p className="text-xs text-slate-500 mt-1">e.g. 25 for 25%.</p>
                    </div>
                    <div>
                      <Label>Return period</Label>
                      <Select value={form.returnPeriod} onValueChange={u("returnPeriod")}>
                        <SelectTrigger data-testid="select-return-period"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="annual">Per annum (annualized)</SelectItem>
                          <SelectItem value="project_lifetime">Over the full term (total)</SelectItem>
                          <SelectItem value="quarterly">Per quarter</SelectItem>
                          <SelectItem value="monthly">Per month</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label>Investment term (months) *</Label>
                      <Input
                        type="number"
                        value={form.investmentTermMonths}
                        onChange={u("investmentTermMonths")}
                        placeholder="12"
                        data-testid="input-term-months"
                      />
                      <p className="text-xs text-slate-500 mt-1">How long is investor capital locked up?</p>
                    </div>
                    <div>
                      <Label>Payout frequency</Label>
                      <Select value={form.payoutFrequency} onValueChange={u("payoutFrequency")}>
                        <SelectTrigger data-testid="select-payout-frequency"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="on_exit">On exit / end of term</SelectItem>
                          <SelectItem value="lump_sum">Single lump sum (capital + returns)</SelectItem>
                          <SelectItem value="monthly">Monthly</SelectItem>
                          <SelectItem value="quarterly">Quarterly</SelectItem>
                          <SelectItem value="annually">Annually</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}

              {showExitField && (
                <div>
                  <Label>How do investors exit / earn? *</Label>
                  <Select value={form.exitStrategy} onValueChange={u("exitStrategy")}>
                    <SelectTrigger data-testid="select-exit-strategy"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sale">Sale of property at completion</SelectItem>
                      <SelectItem value="land_appreciation">Land appreciation (sell anytime after)</SelectItem>
                      <SelectItem value="rental_income">Ongoing rental income</SelectItem>
                      <SelectItem value="buyback">Developer buyback at agreed price</SelectItem>
                      <SelectItem value="refinance">Refinance and return capital</SelectItem>
                      <SelectItem value="other">Other (explain in notes)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {!isSelfFunded && (
                <div>
                  <Label>Funding notes <span className="text-xs text-slate-400 font-normal">(optional)</span></Label>
                  <Textarea
                    value={form.fundingNotes}
                    onChange={u("fundingNotes")}
                    rows={3}
                    placeholder="e.g. 30% deposit, balance over 12 months. Returns paid quarterly. Early-bird investors before March get an extra 2%."
                    data-testid="input-funding-notes"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    {isCombo
                      ? "Spell out how the combined models fit together — e.g. base ROI plus profit share at exit."
                      : "Spell out payment plans, milestones, or special terms investors should know."}
                  </p>
                </div>
              )}

              {isSelfFunded && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  <div className="font-medium text-slate-900 mb-1">No external investors</div>
                  We'll skip the investor-facing return fields. You can still track the build, milestones, and notes.
                  Toggle external investors back on at any time if your plans change.
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <Label className="text-sm">{nouns.sectionTitle} *</Label>
                  <span className="text-xs text-slate-500">Add a row per {nouns.singular === "plot" ? "size" : "type"}</span>
                </div>
                <p className="text-xs text-slate-500 mb-3">{nouns.sectionHelp}</p>

                <div className="space-y-2">
                  {form.unitTypes.map((row, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-start">
                      <div className="col-span-12 sm:col-span-5">
                        {idx === 0 && <Label className="text-xs text-slate-500">{nouns.typeLabel}</Label>}
                        <Input
                          value={row.label}
                          onChange={(e) => updateUnitType(idx, "label", e.target.value)}
                          placeholder={nouns.typePlaceholder}
                          data-testid={`input-unittype-label-${idx}`}
                        />
                      </div>
                      <div className="col-span-5 sm:col-span-2">
                        {idx === 0 && <Label className="text-xs text-slate-500">{nouns.qtyLabel}</Label>}
                        <Input
                          type="number"
                          value={row.quantity}
                          onChange={(e) => updateUnitType(idx, "quantity", e.target.value)}
                          placeholder="10"
                          data-testid={`input-unittype-qty-${idx}`}
                        />
                      </div>
                      <div className="col-span-6 sm:col-span-4">
                        {idx === 0 && <Label className="text-xs text-slate-500">Price each ({form.currency})</Label>}
                        <Input
                          type="number"
                          value={row.price}
                          onChange={(e) => updateUnitType(idx, "price", e.target.value)}
                          placeholder={nouns.pricePlaceholder}
                          data-testid={`input-unittype-price-${idx}`}
                        />
                      </div>
                      <div className="col-span-1 flex items-end h-full">
                        {idx === 0 && <Label className="text-xs text-slate-500 invisible">x</Label>}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-slate-500 hover:text-rose-600"
                          onClick={() => removeUnitType(idx)}
                          disabled={form.unitTypes.length === 1}
                          data-testid={`button-remove-unittype-${idx}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={addUnitType}
                  data-testid="button-add-unittype"
                >
                  <Plus className="w-4 h-4 mr-1.5" /> {nouns.addRowLabel}
                </Button>
              </div>

              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-slate-500">Total {nouns.plural}</div>
                  <div className="font-semibold text-slate-900" data-testid="text-total-units-calc">{totalUnitsCalc.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Total project value</div>
                  <div className="font-semibold text-slate-900" data-testid="text-total-value-calc">
                    {form.currency} {totalValueCalc.toLocaleString()}
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-1.5">
                  <Label>{nouns.retainedLabel}</Label>
                  <HelpTip>{nouns.retainedHelp} Leave at 0 if you're selling the full development.</HelpTip>
                </div>
                <Input type="number" value={form.developerEquityUnits} onChange={u("developerEquityUnits")} data-testid="input-developer-units" />
                <p className="text-xs text-slate-500 mt-1">{nouns.Plural} you keep as the developer (sweat equity).</p>
              </div>

            </div>
          )}

          {step === 4 && (
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

          {step === 5 && (
            <div className="space-y-3 text-sm">
              <RowKV label="Project name" value={form.name} />
              <RowKV label="Location" value={form.location} />
              <RowKV label="Property type" value={form.propertyType} />
              <RowKV label="Currency" value={form.currency} />
              <RowKV label="Funding model" value={fundingLabels.join(", ")} />
              {showReturnFields && (
                <>
                  <RowKV label="Expected return" value={form.expectedReturnPercent ? `${form.expectedReturnPercent}% ${form.returnPeriod === "project_lifetime" ? "total" : (form.returnPeriod || "")}` : "—"} />
                  <RowKV label="Investment term" value={form.investmentTermMonths ? `${form.investmentTermMonths} months` : "—"} />
                  <RowKV label="Payout" value={prettyPayout(form.payoutFrequency)} />
                </>
              )}
              {showExitField && <RowKV label="Exit / earnings via" value={prettyExit(form.exitStrategy)} />}
              <RowKV label="Total value" value={`${form.currency} ${totalValueCalc.toLocaleString()}`} />
              <RowKV label={`Total ${nouns.plural}`} value={totalUnitsCalc.toLocaleString()} />
              <div>
                <div className="text-xs text-slate-500 mb-1">Breakdown</div>
                <div className="rounded-lg border border-slate-200 divide-y">
                  {validUnitTypes.map((r, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="text-slate-700">{r.label} × {r.quantity}</span>
                      <span className="font-medium text-slate-900">{form.currency} {r.price.toLocaleString()} each</span>
                    </div>
                  ))}
                </div>
              </div>
              <RowKV label={nouns.retainedLabel} value={form.developerEquityUnits} />
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
        {step < STEPS.length ? (
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

function prettyPayout(p: string): string {
  switch (p) {
    case "on_exit":   return "On exit / end of term";
    case "lump_sum":  return "Single lump sum";
    case "monthly":   return "Monthly";
    case "quarterly": return "Quarterly";
    case "annually":  return "Annually";
    default:          return "—";
  }
}

function prettyExit(s: string): string {
  switch (s) {
    case "sale":               return "Sale at completion";
    case "land_appreciation":  return "Land appreciation";
    case "rental_income":      return "Rental income";
    case "buyback":            return "Developer buyback";
    case "refinance":          return "Refinance";
    case "other":              return "Other";
    default:                   return "—";
  }
}
