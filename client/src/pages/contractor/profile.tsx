import { useQuery } from "@tanstack/react-query";
import ContractorLayout from "@/components/contractor/ContractorLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export default function ContractorProfile() {
  const { data: me } = useQuery({ queryKey: ["/api/contractor/me"], retry: false });
  if (!me) { window.location.href = "/contractor/login"; return null; }
  const u = me as any;
  const initials = `${u.firstName?.[0] || ""}${u.lastName?.[0] || ""}`.toUpperCase() || "C";

  return (
    <ContractorLayout title="Profile">
      <div className="max-w-md">
        <Card>
          <CardHeader><CardTitle className="text-base">My account</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar className="h-14 w-14">
                <AvatarFallback className="bg-blue-100 text-blue-700 text-xl font-bold">{initials}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold text-gray-900 text-lg">{u.firstName} {u.lastName}</p>
                <p className="text-sm text-gray-500">{u.email}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-100 text-sm">
              <div><span className="text-gray-500">Phone</span><p className="font-medium mt-0.5">{u.phone || "—"}</p></div>
              <div><span className="text-gray-500">Role</span><p className="font-medium mt-0.5 capitalize">{u.role}</p></div>
            </div>
          </CardContent>
        </Card>
      </div>
    </ContractorLayout>
  );
}
