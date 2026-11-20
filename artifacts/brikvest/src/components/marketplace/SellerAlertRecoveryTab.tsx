import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Mail, RefreshCw, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

type AdminTabProps = {
  authenticatedRequest: (url: string, options?: any) => Promise<any>;
};

function displayStatus(status: string) {
  if (status === "processing") return "Retry timed out";
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function SellerAlertRecoveryTab({ authenticatedRequest }: AdminTabProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const queryKey = ["/api/admin/marketplace-alert-retries"];

  const { data: alerts = [], isLoading, error } = useQuery<any[]>({
    queryKey,
    queryFn: () => authenticatedRequest("/api/admin/marketplace-alert-retries"),
    refetchInterval: 60_000,
  });

  const retryMutation = useMutation({
    mutationFn: (id: number) => authenticatedRequest(`/api/admin/marketplace-alert-retries/${id}/retry`, {
      method: "POST",
    }),
    onSuccess: async (result: any) => {
      await queryClient.invalidateQueries({ queryKey });
      toast({
        title: result.delivered ? "Seller alert delivered" : "Seller alert still unsent",
        description: result.delivered ? result.message : `${result.message} ${result.lastFailure || ""}`.trim(),
        variant: result.delivered ? "default" : "destructive",
      });
    },
    onError: (mutationError: Error) => toast({
      title: "Could not retry seller alert",
      description: mutationError.message,
      variant: "destructive",
    }),
  });

  if (isLoading) return <p className="py-12 text-center text-slate-500">Loading seller alerts…</p>;
  if (error) return <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">Could not load seller alerts. Refresh to retry.</p>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Seller Alert Recovery</h2>
        <p className="mt-1 text-sm text-slate-600">Review seller alerts that were not delivered and retry them. Failure details are visible to admins only.</p>
      </div>
      {alerts.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-slate-600">No pending or exhausted seller alerts.</CardContent></Card>
      ) : alerts.map((alert: any) => (
        <Card key={alert.id}>
          <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-slate-900">{alert.propertyName}</h3>
                <Badge variant="outline">{alert.reference}</Badge>
                <Badge variant={alert.status === "exhausted" ? "destructive" : "secondary"}>
                  {displayStatus(alert.status)}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  {alert.channel === "email" ? <Mail className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
                  {alert.channel === "email" ? "Email" : "In-app"}
                </span>
                <span>{alert.attempts} {alert.attempts === 1 ? "attempt" : "attempts"}</span>
                <span>Last updated {new Date(alert.updatedAt).toLocaleString()}</span>
              </div>
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                <p className="mb-1 flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="h-4 w-4" />Last failure
                </p>
                <p className="break-words">{alert.lastFailure}</p>
              </div>
            </div>
            <Button
              className="shrink-0"
              disabled={retryMutation.isPending}
              onClick={() => retryMutation.mutate(alert.id)}
            >
              {retryMutation.isPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              {retryMutation.isPending ? "Retrying…" : alert.status === "processing" ? "Recover alert" : "Retry alert"}
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}