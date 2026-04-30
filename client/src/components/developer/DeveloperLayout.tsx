import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Building2, LayoutGrid, Plus, LogOut, ChevronLeft, Megaphone, User } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface DeveloperLayoutProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  backTo?: string;
  actions?: ReactNode;
}

export default function DeveloperLayout({ children, title, subtitle, backTo, actions }: DeveloperLayoutProps) {
  const [location, setLocation] = useLocation();
  const { data: me, isLoading } = useQuery<any>({ queryKey: ["/api/developer/me"], retry: false });

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/logout");
      queryClient.clear();
      setLocation("/developer/login");
    } catch (e) {
      console.error(e);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-pulse text-slate-500">Loading…</div>
      </div>
    );
  }

  if (!me?.id) {
    setLocation("/developer/login");
    return null;
  }

  const initials = `${(me.firstName || "")[0] || ""}${(me.lastName || "")[0] || ""}`.toUpperCase() || "D";

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col fixed inset-y-0 left-0 z-30">
        <div className="px-6 py-5 border-b border-slate-200">
          <Link href="/developer">
            <div className="flex items-center gap-2 cursor-pointer" data-testid="link-developer-home">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="text-base font-bold text-slate-900">Brikvest</div>
                <div className="text-[10px] uppercase tracking-wider text-blue-600 font-semibold">Developer Portal</div>
              </div>
            </div>
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          <Link href="/developer">
            <a
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                location === "/developer" ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100"
              }`}
              data-testid="link-projects"
            >
              <LayoutGrid className="w-4 h-4" />
              My Projects
            </a>
          </Link>
          <Link href="/developer/new">
            <a
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                location === "/developer/new" ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100"
              }`}
              data-testid="link-new-project"
            >
              <Plus className="w-4 h-4" />
              New Project
            </a>
          </Link>
          <Link href="/developer/communications">
            <a
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                location === "/developer/communications" ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100"
              }`}
              data-testid="link-communications"
            >
              <Megaphone className="w-4 h-4" />
              Communications
            </a>
          </Link>
          <Link href="/developer/profile">
            <a
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                location === "/developer/profile" ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-100"
              }`}
              data-testid="link-profile"
            >
              <User className="w-4 h-4" />
              Profile
            </a>
          </Link>
        </nav>

        <div className="p-4 border-t border-slate-200">
          <div className="flex items-center gap-3 mb-3">
            <Avatar className="w-9 h-9">
              <AvatarFallback className="bg-blue-600 text-white text-xs font-semibold">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate" data-testid="text-developer-name">
                {me.companyName || `${me.firstName} ${me.lastName}`}
              </div>
              <div className="text-xs text-slate-500 truncate">{me.email}</div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            className="w-full justify-start"
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 ml-64">
        {(title || backTo) && (
          <div className="bg-white border-b border-slate-200 px-8 py-5">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                {backTo && (
                  <Link href={backTo}>
                    <a className="inline-flex items-center text-sm text-slate-500 hover:text-blue-600 mb-2">
                      <ChevronLeft className="w-4 h-4 mr-1" />
                      Back
                    </a>
                  </Link>
                )}
                {title && <h1 className="text-2xl font-bold text-slate-900" data-testid="text-page-title">{title}</h1>}
                {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
              </div>
              {actions && <div className="flex items-center gap-2">{actions}</div>}
            </div>
          </div>
        )}
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
