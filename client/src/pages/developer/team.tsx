import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import DeveloperLayout from "@/components/developer/DeveloperLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toastFromError } from "@/lib/planErrors";
import { Loader2, UserPlus, Trash2, Mail, Crown, Shield } from "lucide-react";
import { Link } from "wouter";

interface TeamMember {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  createdAt: string;
  lastLogin: string | null;
  isActive: boolean;
}

interface TeamInvite {
  id: number;
  email: string;
  inviteName: string | null;
  inviteRole: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
}

interface TeamData {
  owner: { id: number; email: string; firstName: string; lastName: string; companyName: string | null } | null;
  members: TeamMember[];
  invites: TeamInvite[];
  seats: { used: number; max: number | null; plan: string; planName: string };
}

function initialsOf(first?: string | null, last?: string | null, fallback?: string) {
  const a = (first || "")[0] || "";
  const b = (last || "")[0] || "";
  return ((a + b).toUpperCase() || (fallback || "?")[0].toUpperCase()).slice(0, 2);
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString(); } catch { return "—"; }
}

export default function DeveloperTeamPage() {
  const { toast } = useToast();
  const { data: me } = useQuery<any>({ queryKey: ["/api/developer/me"] });
  const { data, isLoading } = useQuery<TeamData>({ queryKey: ["/api/developer/team"] });
  const [inviteOpen, setInviteOpen] = useState(false);

  const isOwner = !!me?.isOwner;
  const seatsUsed = data?.seats?.used ?? 1;
  const seatsMax = data?.seats?.max;
  const atSeatLimit = seatsMax !== null && seatsMax !== undefined && seatsUsed >= seatsMax;

  const revoke = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/developer/team/invites/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/developer/me"] });
      toast({ title: "Invite revoked" });
    },
    onError: (err: any) => toast(toastFromError(err, "Failed to revoke")),
  });

  const removeMember = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/developer/team/members/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/developer/me"] });
      toast({ title: "Team member removed" });
    },
    onError: (err: any) => toast(toastFromError(err, "Failed to remove member")),
  });

  return (
    <DeveloperLayout
      title="Team"
      subtitle="Invite teammates to help manage projects, investors, and communications."
      actions={
        isOwner && (
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-invite-teammate" disabled={atSeatLimit}>
                <UserPlus className="w-4 h-4 mr-2" /> Invite teammate
              </Button>
            </DialogTrigger>
            <InviteDialog onClose={() => setInviteOpen(false)} />
          </Dialog>
        )
      }
    >
      {/* Plan / seats summary */}
      <Card className="mb-6">
        <CardContent className="py-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-sm text-slate-500">Current plan</div>
              <div className="text-lg font-semibold text-slate-900" data-testid="text-team-plan">
                {data?.seats?.planName || "Starter"}
              </div>
            </div>
            <div>
              <div className="text-sm text-slate-500">Seats used</div>
              <div className="text-lg font-semibold text-slate-900" data-testid="text-team-seats">
                {seatsUsed}{seatsMax !== null && seatsMax !== undefined ? ` / ${seatsMax}` : " · unlimited"}
              </div>
            </div>
            <div className="flex-1" />
            {atSeatLimit && (
              <Link href="/developer/pricing">
                <Button variant="outline" size="sm" data-testid="button-team-upgrade">
                  Upgrade for more seats
                </Button>
              </Link>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Members */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>Everyone with access to this developer workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading team…
            </div>
          ) : (
            <div className="divide-y">
              {data?.owner && (
                <MemberRow
                  initials={initialsOf(data.owner.firstName, data.owner.lastName, data.owner.email)}
                  name={`${data.owner.firstName || ""} ${data.owner.lastName || ""}`.trim() || data.owner.email}
                  email={data.owner.email}
                  badge={<Badge variant="secondary" className="bg-amber-50 text-amber-700"><Crown className="w-3 h-3 mr-1" /> Owner</Badge>}
                  rightMeta="Founding member"
                />
              )}
              {(data?.members || []).map((m) => (
                <MemberRow
                  key={m.id}
                  initials={initialsOf(m.firstName, m.lastName, m.email)}
                  name={`${m.firstName || ""} ${m.lastName || ""}`.trim() || m.email}
                  email={m.email}
                  badge={<Badge variant="secondary" className="bg-blue-50 text-blue-700"><Shield className="w-3 h-3 mr-1" /> Member</Badge>}
                  rightMeta={m.lastLogin ? `Last active ${fmtDate(m.lastLogin)}` : `Joined ${fmtDate(m.createdAt)}`}
                  action={isOwner && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                      onClick={() => {
                        if (confirm(`Remove ${m.firstName || m.email} from the team?`)) {
                          removeMember.mutate(m.id);
                        }
                      }}
                      disabled={removeMember.isPending}
                      data-testid={`button-remove-member-${m.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                />
              ))}
              {(data?.members || []).length === 0 && (
                <div className="py-8 text-center text-sm text-slate-500">
                  No teammates yet. {isOwner ? "Invite your first one above." : "Ask the account owner to invite more teammates."}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending invites */}
      <Card>
        <CardHeader>
          <CardTitle>Invitations</CardTitle>
          <CardDescription>Pending invites expire automatically after 14 days.</CardDescription>
        </CardHeader>
        <CardContent>
          {(data?.invites || []).length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-500">No invitations sent yet.</div>
          ) : (
            <div className="divide-y">
              {(data?.invites || []).map((inv) => (
                <div key={inv.id} className="py-3 flex items-center justify-between gap-3 flex-wrap" data-testid={`row-invite-${inv.id}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center">
                      <Mail className="w-4 h-4 text-slate-500" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">{inv.email}</div>
                      <div className="text-xs text-slate-500 truncate">
                        {inv.inviteName ? `${inv.inviteName} · ` : ""}
                        {inv.inviteRole.replace(/_/g, " ")} · expires {fmtDate(inv.expiresAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <InviteStatusBadge status={inv.status} />
                    {isOwner && inv.status === "pending" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                        onClick={() => revoke.mutate(inv.id)}
                        disabled={revoke.isPending}
                        data-testid={`button-revoke-${inv.id}`}
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </DeveloperLayout>
  );
}

function MemberRow({
  initials, name, email, badge, rightMeta, action,
}: {
  initials: string;
  name: string;
  email: string;
  badge: React.ReactNode;
  rightMeta?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="py-3 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        <Avatar className="w-9 h-9">
          <AvatarFallback className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white text-xs font-semibold">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-900 truncate">{name}</div>
          <div className="text-xs text-slate-500 truncate">{email}</div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {badge}
        {rightMeta && <div className="text-xs text-slate-500 hidden sm:block">{rightMeta}</div>}
        {action}
      </div>
    </div>
  );
}

function InviteStatusBadge({ status }: { status: TeamInvite["status"] }) {
  const map: Record<TeamInvite["status"], { label: string; cls: string }> = {
    pending:  { label: "Pending",  cls: "bg-amber-50 text-amber-700" },
    accepted: { label: "Accepted", cls: "bg-emerald-50 text-emerald-700" },
    revoked:  { label: "Revoked",  cls: "bg-slate-100 text-slate-600" },
    expired:  { label: "Expired",  cls: "bg-slate-100 text-slate-600" },
  };
  const m = map[status];
  return <Badge variant="secondary" className={m.cls}>{m.label}</Badge>;
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState("project_manager");

  const send = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/developer/team/invites", {
      email: email.trim().toLowerCase(),
      inviteName: inviteName.trim() || undefined,
      inviteRole,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/developer/team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/developer/me"] });
      toast({ title: "Invitation sent", description: `We emailed an invite link to ${email}.` });
      onClose();
      setEmail("");
      setInviteName("");
    },
    onError: (err: any) => toast(toastFromError(err, "Failed to send invite")),
  });

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Invite a teammate</DialogTitle>
        <DialogDescription>They'll receive an email with a link to join your developer workspace.</DialogDescription>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!email.trim()) {
            toast({ title: "Email required", variant: "destructive" });
            return;
          }
          send.mutate();
        }}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            required
            data-testid="input-invite-email"
          />
        </div>
        <div>
          <Label htmlFor="invite-name">Their name <span className="text-slate-400 text-xs">(optional)</span></Label>
          <Input
            id="invite-name"
            value={inviteName}
            onChange={(e) => setInviteName(e.target.value)}
            placeholder="Jane Doe"
            data-testid="input-invite-name"
          />
        </div>
        <div>
          <Label>Role label</Label>
          <Select value={inviteRole} onValueChange={setInviteRole}>
            <SelectTrigger data-testid="select-invite-role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="project_manager">Project manager</SelectItem>
              <SelectItem value="sales">Sales</SelectItem>
              <SelectItem value="finance">Finance</SelectItem>
              <SelectItem value="operations">Operations</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-slate-500 mt-1">Just a label — all teammates have the same access.</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={send.isPending} data-testid="button-send-invite">
            {send.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</> : "Send invitation"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
