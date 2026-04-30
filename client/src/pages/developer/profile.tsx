import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import DeveloperLayout from "@/components/developer/DeveloperLayout";

export default function DeveloperProfile() {
  const { toast } = useToast();
  const { data: me, isLoading } = useQuery<any>({ queryKey: ["/api/developer/me"] });
  const [form, setForm] = useState({
    firstName: "", lastName: "", phone: "",
    companyName: "", companyRegistration: "", websiteUrl: "",
  });

  useEffect(() => {
    if (me) setForm({
      firstName: me.firstName || "",
      lastName: me.lastName || "",
      phone: me.phone || "",
      companyName: me.companyName || "",
      companyRegistration: me.companyRegistration || "",
      websiteUrl: me.websiteUrl || "",
    });
  }, [me]);

  const saveMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await apiRequest("PATCH", "/api/developer/me", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/me"] });
      toast({ title: "Profile updated" });
    },
    onError: () => toast({ title: "Failed to update profile", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <DeveloperLayout title="Profile"><div className="h-40 bg-slate-100 rounded animate-pulse" /></DeveloperLayout>
    );
  }

  return (
    <DeveloperLayout title="Profile" subtitle="Manage your developer account and company details.">
      <div className="max-w-2xl space-y-6">
        <Card>
          <CardHeader><CardTitle>Personal information</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">First name</Label>
                <Input id="firstName" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} data-testid="input-first-name" />
              </div>
              <div>
                <Label htmlFor="lastName">Last name</Label>
                <Input id="lastName" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} data-testid="input-last-name" />
              </div>
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={me?.email || ""} disabled className="bg-slate-50" />
              <p className="text-xs text-slate-500 mt-1">Contact support to change your email.</p>
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-phone" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Company details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="companyName">Company name</Label>
              <Input id="companyName" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} data-testid="input-company-name" />
            </div>
            <div>
              <Label htmlFor="companyRegistration">Company registration #</Label>
              <Input id="companyRegistration" value={form.companyRegistration} onChange={(e) => setForm({ ...form, companyRegistration: e.target.value })} data-testid="input-company-registration" />
            </div>
            <div>
              <Label htmlFor="websiteUrl">Website</Label>
              <Input id="websiteUrl" type="url" placeholder="https://" value={form.websiteUrl} onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })} data-testid="input-website" />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button
            onClick={() => saveMutation.mutate(form)}
            disabled={saveMutation.isPending}
            className="bg-blue-600 hover:bg-blue-700"
            data-testid="button-save-profile"
          >
            {saveMutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </DeveloperLayout>
  );
}
