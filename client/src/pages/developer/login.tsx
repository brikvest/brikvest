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

export default function DeveloperLogin() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const { toast } = useToast();

  const loginMutation = useMutation({
    mutationFn: async (data: { email: string; password: string }) => {
      return await apiRequest("POST", "/api/developer/login", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/me"] });
      toast({ title: "Welcome back!", description: "Redirecting to your land listings…" });
      setLocation("/developer");
    },
    onError: (err: any) => {
      const msg = err?.message?.includes("403")
        ? "This account isn't a developer account. Use the regular sign-in."
        : "Invalid email or password";
      setError(msg);
    },
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Link href="/" className="flex items-center justify-center gap-2 mb-8" data-testid="link-home">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <div className="text-left">
            <div className="text-xl font-bold text-slate-900">Brikvest</div>
            <div className="text-[10px] uppercase tracking-wider text-blue-600 font-semibold">Developer Portal</div>
          </div>
        </Link>

        <Card className="shadow-lg border-slate-200">
          <CardHeader>
            <CardTitle className="text-xl">Sign in to your developer account</CardTitle>
            <CardDescription>Manage your land listings and investor communications.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError("");
                loginMutation.mutate({ email, password });
              }}
              className="space-y-4"
            >
              {error && (
                <Alert variant="destructive">
                  <AlertDescription data-testid="text-error">{error}</AlertDescription>
                </Alert>
              )}
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1"
                  data-testid="input-email"
                />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1"
                  data-testid="input-password"
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700"
                disabled={loginMutation.isPending}
                data-testid="button-submit"
              >
                {loginMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Signing in…
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>

            <div className="mt-6 pt-6 border-t border-slate-200 text-center text-sm">
              <span className="text-slate-600">New developer? </span>
              <Link href="/developer/signup" className="text-blue-600 hover:underline font-medium" data-testid="link-signup">
                Create an account
              </Link>
            </div>
            <div className="mt-2 text-center text-sm">
              <Link href="/login" className="text-slate-500 hover:text-blue-600">Investor sign-in →</Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
