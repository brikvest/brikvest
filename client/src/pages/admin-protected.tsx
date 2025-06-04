import { useAdminAuth } from "@/hooks/useAdminAuth";
import AdminLogin from "./admin-login";
import AdminDashboard from "./admin";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, Lock } from "lucide-react";

export default function AdminProtected() {
  const { isAuthenticated, isLoading, user, login } = useAdminAuth();

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 p-4">
        <Card className="w-full max-w-md shadow-xl border-0 bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm">
          <CardContent className="p-8">
            <div className="flex flex-col items-center space-y-4">
              <div className="p-3 bg-blue-100 dark:bg-blue-900/50 rounded-full">
                <Shield className="h-8 w-8 text-blue-600 dark:text-blue-400 animate-pulse" />
              </div>
              <div className="text-center space-y-2">
                <Skeleton className="h-6 w-32 mx-auto" />
                <Skeleton className="h-4 w-48" />
              </div>
              <div className="w-full space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Not authenticated - show login
  if (!isAuthenticated || !user) {
    return <AdminLogin onLoginSuccess={login} />;
  }

  // Authenticated - show admin dashboard
  return <AdminDashboard />;
}