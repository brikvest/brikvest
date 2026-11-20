import { useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toastFromError } from "@/lib/planErrors";
import { Building2, Loader2, ShieldAlert, CheckCircle2 } from "lucide-react";
import { PERMISSIONS } from "@shared/permissions";

interface InviteInfo {
  email: string;
  inviteName: string | null;
  inviteRole: string;
  permissions?: string[];
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  companyName: string | null;
  inviterName: string | null;
}

const PERM_LABEL: Record<string, string> = Object.fromEntries(PERMISSIONS.map((p) => [p.key, p.label]));

export default function AcceptInvitePage() {
  const [, params] = useRoute("/developer/accept-invite/:token");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const token = params?.token || "";

  const { data, isLoading, error } = useQuery<InviteInfo>({
    queryKey: ["/api/developer/team/invites/by-token", token],
    queryFn: async () => {
      const res = await fetch(`/api/developer/team/invites/by-token/${token}`);
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
    enabled: !!token,
  });

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const accept = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/developer/team/invites/by-token/${token}/accept`, {
      firstName, lastName, phone, password,
    }),
    onSuccess: (res: any) => {
      toast({ title: "Welcome aboard!", description: "Your developer account is ready." });
      queryClient.clear();
      if (res?.autoLogin) {
        setLocation("/developer");
      } else {
        setLocation("/developer/login");
      }
    },
    onError: (err: any) => toast(toastFromError(err, "Failed to accept invite")),
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2.5 mb-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-sm">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div className="text-left leading-tight">
              <div className="text-base font-bold text-slate-900">Brikvest</div>
              <div className="text-[10px] uppercase tracking-wider text-blue-600 font-semibold">Developer Portal</div>
            </div>
          </div>
        </div>

        <Card>
          {isLoading ? (
            <CardContent className="py-12 flex items-center justify-center text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading invitation…
            </CardContent>
          ) : error || !data ? (
            <>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-rose-500" />
                  <CardTitle>Invitation not found</CardTitle>
                </div>
                <CardDescription>This invitation link is invalid. Ask the person who invited you to send a new one.</CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/developer/login">
                  <Button variant="outline" className="w-full">Go to sign in</Button>
                </Link>
              </CardContent>
            </>
          ) : data.status !== "pending" ? (
            <>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-amber-500" />
                  <CardTitle>This invitation can't be used</CardTitle>
                </div>
                <CardDescription>
                  {data.status === "accepted" && "This invitation has already been accepted. Sign in instead."}
                  {data.status === "revoked"  && "The account owner revoked this invitation."}
                  {data.status === "expired"  && "This invitation expired. Ask the account owner to send a new one."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Link href="/developer/login">
                  <Button className="w-full">Go to sign in</Button>
                </Link>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader>
                <CardTitle>Join {data.companyName || "the developer team"}</CardTitle>
                <CardDescription>
                  {data.inviterName ? `${data.inviterName} invited ` : "You've been invited "}
                  <strong>{data.email}</strong> to join as <strong>{data.inviteRole.replace(/_/g, " ")}</strong>.
                  Set a password to get started.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {(data.permissions && data.permissions.length > 0) ? (
                  <div className="mb-4 p-3 rounded-lg bg-indigo-50 border border-indigo-100">
                    <div className="text-xs font-semibold text-indigo-900 mb-1.5">You'll have access to:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {data.permissions.map((p) => (
                        <span
                          key={p}
                          className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full bg-white text-indigo-700 font-medium border border-indigo-200"
                        >
                          {PERM_LABEL[p] || p}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
                    Your access starts limited — the account owner can grant you areas (fundraising, sales, etc.) after you join.
                  </div>
                )}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (password.length < 6) {
                      toast({ title: "Password too short", description: "Use at least 6 characters.", variant: "destructive" });
                      return;
                    }
                    if (password !== confirm) {
                      toast({ title: "Passwords don't match", variant: "destructive" });
                      return;
                    }
                    accept.mutate();
                  }}
                  className="space-y-4"
                >
                  <div>
                    <Label>Email</Label>
                    <Input value={data.email} disabled />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="first">First name</Label>
                      <Input id="first" value={firstName} onChange={(e) => setFirstName(e.target.value)} required data-testid="input-accept-firstname" />
                    </div>
                    <div>
                      <Label htmlFor="last">Last name</Label>
                      <Input id="last" value={lastName} onChange={(e) => setLastName(e.target.value)} required data-testid="input-accept-lastname" />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="phone">Phone <span className="text-slate-400 text-xs">(optional)</span></Label>
                    <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="input-accept-phone" />
                  </div>
                  <div>
                    <Label htmlFor="pw">Password</Label>
                    <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required data-testid="input-accept-password" />
                  </div>
                  <div>
                    <Label htmlFor="confirm">Confirm password</Label>
                    <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required data-testid="input-accept-confirm" />
                  </div>
                  <Button type="submit" className="w-full" disabled={accept.isPending} data-testid="button-accept-invite">
                    {accept.isPending
                      ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating account…</>
                      : <><CheckCircle2 className="w-4 h-4 mr-2" /> Accept &amp; sign in</>}
                  </Button>
                </form>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
