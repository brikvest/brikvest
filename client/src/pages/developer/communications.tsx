import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Megaphone, Building, Calendar, Users } from "lucide-react";
import DeveloperLayout from "@/components/developer/DeveloperLayout";

const TYPE_META: Record<string, { label: string; color: string }> = {
  construction: { label: "Construction", color: "bg-blue-100 text-blue-700" },
  sales:        { label: "Sales",        color: "bg-emerald-100 text-emerald-700" },
  financial:    { label: "Financial",    color: "bg-purple-100 text-purple-700" },
  delay:        { label: "Delay",        color: "bg-red-100 text-red-700" },
  general:      { label: "General",      color: "bg-slate-100 text-slate-700" },
};

export default function DeveloperCommunications() {
  const { data: updates = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/developer/updates"],
  });

  return (
    <DeveloperLayout
      title="Communications History"
      subtitle="Every update you've broadcast to your investors, across all land listings."
    >
      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-32 bg-slate-100 rounded animate-pulse" />)}</div>
      ) : updates.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-slate-500">
            <Megaphone className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            <div className="text-base font-medium mb-1">No updates yet</div>
            <div className="text-sm">When you broadcast a listing update, it will appear here.</div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {updates.map((u: any) => {
            const meta = TYPE_META[u.type] || TYPE_META.general;
            return (
              <Card key={u.id} data-testid={`update-${u.id}`}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={meta.color}>{meta.label}</Badge>
                      <span className="text-xs text-slate-500 flex items-center gap-1">
                        <Building className="w-3 h-3" />
                        {u.propertyName}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {u.recipientCount || 0} recipient{(u.recipientCount || 0) === 1 ? "" : "s"}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {u.sentAt ? new Date(u.sentAt).toLocaleString() : ""}
                      </span>
                    </div>
                  </div>
                  <h3 className="font-semibold text-slate-900 mb-1">{u.subject}</h3>
                  <div
                    className="text-sm text-slate-700 prose prose-sm max-w-none line-clamp-4"
                    dangerouslySetInnerHTML={{ __html: u.body }}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </DeveloperLayout>
  );
}
