import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Building2, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function DeveloperSignup() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    companyName: "",
    companyRegistration: "",
    websiteUrl: "",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });

  const update = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const signupMutation = useMutation({
    mutationFn: async () => {
      if (form.password !== form.confirmPassword) throw new Error("Passwords do not match");
      const { confirmPassword, ...payload } = form;
      const res = await apiRequest("POST", "/api/developer/register", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/me"] });
      toast({ title: "Account created!", description: "Welcome to the Brikvest Developer Portal." });
      setLocation("/developer");
    },
    onError: (err: any) => {
      const msg = err?.message?.includes("already exists")
        ? "An account with this email already exists."
        : err?.message || "Signup failed. Please try again.";
      setError(msg);
    },
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <Link href="/">
          <a className="flex items-center justify-center gap-2 mb-6" data-testid="link-home">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center">
              <Building2 className="w-6 h-6 text-white" />
            </div>
            <div className="text-left">
              <div className="text-xl font-bold text-slate-900">Brikvest</div>
              <div className="text-[10px] uppercase tracking-wider text-blue-600 font-semibold">Developer Portal</div>
            </div>
          </a>
        </Link>

        <Card className="shadow-lg border-slate-200">
          <CardHeader>
            <CardTitle className="text-xl">List your project on Brikvest</CardTitle>
            <CardDescription>
              Connect with hundreds of vetted Nigerian and diaspora investors. Create your developer account to get started.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError("");
                signupMutation.mutate();
              }}
              className="space-y-5"
            >
              {error && (
                <Alert variant="destructive">
                  <AlertDescription data-testid="text-error">{error}</AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">Company</h3>
                </div>
                <div>
                  <Label htmlFor="companyName">Company name *</Label>
                  <Input id="companyName" required value={form.companyName} onChange={update("companyName")} className="mt-1" data-testid="input-company-name" />
                </div>
                <div>
                  <Label htmlFor="companyRegistration">CAC / Registration #</Label>
                  <Input id="companyRegistration" value={form.companyRegistration} onChange={update("companyRegistration")} className="mt-1" placeholder="RC1234567" data-testid="input-company-registration" />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="websiteUrl">Website</Label>
                  <Input id="websiteUrl" type="url" value={form.websiteUrl} onChange={update("websiteUrl")} className="mt-1" placeholder="https://example.com" data-testid="input-website" />
                </div>

                <div className="md:col-span-2 mt-3">
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">Primary contact</h3>
                </div>
                <div>
                  <Label htmlFor="firstName">First name *</Label>
                  <Input id="firstName" required value={form.firstName} onChange={update("firstName")} className="mt-1" data-testid="input-first-name" />
                </div>
                <div>
                  <Label htmlFor="lastName">Last name *</Label>
                  <Input id="lastName" required value={form.lastName} onChange={update("lastName")} className="mt-1" data-testid="input-last-name" />
                </div>
                <div>
                  <Label htmlFor="email">Email *</Label>
                  <Input id="email" type="email" required value={form.email} onChange={update("email")} className="mt-1" data-testid="input-email" />
                </div>
                <div>
                  <Label htmlFor="phone">Phone *</Label>
                  <Input id="phone" required value={form.phone} onChange={update("phone")} className="mt-1" placeholder="+234…" data-testid="input-phone" />
                </div>

                <div className="md:col-span-2 mt-3">
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">Password</h3>
                </div>
                <div>
                  <Label htmlFor="password">Password *</Label>
                  <Input id="password" type="password" required minLength={8} value={form.password} onChange={update("password")} className="mt-1" data-testid="input-password" />
                </div>
                <div>
                  <Label htmlFor="confirmPassword">Confirm password *</Label>
                  <Input id="confirmPassword" type="password" required value={form.confirmPassword} onChange={update("confirmPassword")} className="mt-1" data-testid="input-confirm-password" />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 mt-2"
                disabled={signupMutation.isPending}
                data-testid="button-submit"
              >
                {signupMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating account…
                  </>
                ) : (
                  "Create developer account"
                )}
              </Button>
            </form>

            <div className="mt-6 pt-6 border-t border-slate-200 text-center text-sm">
              <span className="text-slate-600">Already have a developer account? </span>
              <Link href="/developer/login">
                <a className="text-blue-600 hover:underline font-medium" data-testid="link-login">
                  Sign in
                </a>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
