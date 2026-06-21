import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import ContractorLayout from "@/components/contractor/ContractorLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const schema = z.object({
  name: z.string().min(2, "Project name is required"),
  description: z.string().optional(),
  location: z.string().optional(),
  projectType: z.string().default("residential"),
  currency: z.string().default("NGN"),
  totalBudget: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  clientName: z.string().optional(),
  clientPhone: z.string().optional(),
  clientEmail: z.string().email("Enter a valid email").optional().or(z.literal("")),
});

type FormData = z.infer<typeof schema>;

export default function NewContractorProject() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { projectType: "residential", currency: "NGN" },
  });

  const create = useMutation({
    mutationFn: (data: FormData) => apiRequest("POST", "/api/contractor/projects", {
      ...data,
      totalBudget: data.totalBudget ? data.totalBudget : null,
      startDate: data.startDate ? new Date(data.startDate).toISOString() : null,
      endDate: data.endDate ? new Date(data.endDate).toISOString() : null,
      clientEmail: data.clientEmail || null,
    }),
    onSuccess: (project: any) => {
      qc.invalidateQueries({ queryKey: ["/api/contractor/projects"] });
      toast({ title: "Project created!", description: "Now set up your budget categories." });
      navigate(`/contractor/projects/${project.slug}`);
    },
    onError: (err: any) => {
      toast({ title: "Failed to create project", description: err.message, variant: "destructive" });
    },
  });

  return (
    <ContractorLayout title="New Project" backTo="/contractor">
      <div className="max-w-2xl mx-auto">
        <form onSubmit={form.handleSubmit((d) => create.mutate(d))} className="space-y-6">
          {/* Basic info */}
          <Card>
            <CardHeader><CardTitle className="text-base">Project details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Project name *</Label>
                <Input id="name" placeholder="e.g. Lekki Duplex Build" {...form.register("name")} />
                {form.formState.errors.name && <p className="text-xs text-red-500">{form.formState.errors.name.message}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Project type</Label>
                  <Select defaultValue="residential" onValueChange={(v) => form.setValue("projectType", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="residential">Residential</SelectItem>
                      <SelectItem value="commercial">Commercial</SelectItem>
                      <SelectItem value="infrastructure">Infrastructure</SelectItem>
                      <SelectItem value="renovation">Renovation</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Currency</Label>
                  <Select defaultValue="NGN" onValueChange={(v) => form.setValue("currency", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NGN">NGN — Naira</SelectItem>
                      <SelectItem value="USD">USD — Dollar</SelectItem>
                      <SelectItem value="GBP">GBP — Pound</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="location">Location</Label>
                <Input id="location" placeholder="e.g. Lekki Phase 1, Lagos" {...form.register("location")} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" placeholder="Brief description of the project..." rows={3} {...form.register("description")} />
              </div>
            </CardContent>
          </Card>

          {/* Budget & Dates */}
          <Card>
            <CardHeader><CardTitle className="text-base">Budget & timeline</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="totalBudget">Total project budget</Label>
                <Input id="totalBudget" type="number" placeholder="e.g. 50000000" {...form.register("totalBudget")} />
                <p className="text-xs text-gray-400">You'll break this down into categories next</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="startDate">Start date</Label>
                  <Input id="startDate" type="date" {...form.register("startDate")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="endDate">Expected end date</Label>
                  <Input id="endDate" type="date" {...form.register("endDate")} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Client info */}
          <Card>
            <CardHeader><CardTitle className="text-base">Client information <span className="text-gray-400 font-normal text-sm">(optional)</span></CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="clientName">Client name</Label>
                <Input id="clientName" placeholder="e.g. Mr. Adeyemi" {...form.register("clientName")} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="clientPhone">Client phone</Label>
                  <Input id="clientPhone" placeholder="+234 800 000 0000" {...form.register("clientPhone")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="clientEmail">Client email</Label>
                  <Input id="clientEmail" type="email" placeholder="client@example.com" {...form.register("clientEmail")} />
                  {form.formState.errors.clientEmail && <p className="text-xs text-red-500">{form.formState.errors.clientEmail.message}</p>}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3 pb-6">
            <Button type="button" variant="outline" className="flex-1" onClick={() => navigate("/contractor")}>Cancel</Button>
            <Button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white" disabled={create.isPending}>
              {create.isPending ? "Creating..." : "Create project"}
            </Button>
          </div>
        </form>
      </div>
    </ContractorLayout>
  );
}
