import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LayoutGrid, Plus, BarChart3, LogOut, User, Menu, HardHat, ChevronLeft } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface ContractorLayoutProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  backTo?: string;
  actions?: ReactNode;
}

const NAV_ITEMS = [
  { href: "/contractor",     label: "My Projects", icon: LayoutGrid, match: (p: string) => p === "/contractor" || p.startsWith("/contractor/projects") },
  { href: "/contractor/new", label: "New Project", icon: Plus,       match: (p: string) => p === "/contractor/new" },
  { href: "/contractor/profile", label: "Profile", icon: User,       match: (p: string) => p === "/contractor/profile" },
];

function NavLinks({ location, onNavigate }: { location: string; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 px-3 py-3 space-y-1">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = item.match(location);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              active ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            }`}
          >
            <Icon className={`h-4 w-4 ${active ? "text-blue-600" : "text-gray-400"}`} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function ContractorLayout({ children, title, subtitle, backTo, actions }: ContractorLayoutProps) {
  const [location] = useLocation();
  const { data: me } = useQuery({ queryKey: ["/api/contractor/me"], retry: false });
  const user = me as any;

  const initials = user ? `${user.firstName?.[0] || ""}${user.lastName?.[0] || ""}`.toUpperCase() || "C" : "C";

  async function handleLogout() {
    await apiRequest("POST", "/api/contractor/logout");
    queryClient.clear();
    window.location.href = "/contractor/login";
  }

  const sidebar = (
    <div className="flex flex-col h-full">
      <div className="px-4 py-5 border-b border-gray-100">
        <Link href="/contractor" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <HardHat className="h-4 w-4 text-white" />
          </div>
          <span className="font-semibold text-gray-900 text-sm">Contractor Portal</span>
        </Link>
      </div>
      <NavLinks location={location} />
      <div className="px-3 py-4 border-t border-gray-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors text-left">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-blue-100 text-blue-700 text-xs font-semibold">{initials}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{user?.firstName} {user?.lastName}</p>
                <p className="text-xs text-gray-500 truncate">{user?.email}</p>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/contractor/profile">Profile</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-red-600">
              <LogOut className="h-4 w-4 mr-2" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-56 flex-col border-r border-gray-200 bg-white shrink-0">
        {sidebar}
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0">
          {/* Mobile menu */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-56 p-0">
              <SheetHeader className="sr-only"><SheetTitle>Navigation</SheetTitle></SheetHeader>
              {sidebar}
            </SheetContent>
          </Sheet>

          {backTo && (
            <Link href={backTo}>
              <Button variant="ghost" size="sm" className="gap-1 text-gray-500 -ml-1">
                <ChevronLeft className="h-4 w-4" /> Back
              </Button>
            </Link>
          )}

          <div className="flex-1 min-w-0">
            {title && <h1 className="font-semibold text-gray-900 truncate">{title}</h1>}
            {subtitle && <p className="text-xs text-gray-500 truncate">{subtitle}</p>}
          </div>

          {actions && <div className="flex items-center gap-2">{actions}</div>}

          {/* Mobile avatar */}
          <div className="lg:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button>
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-blue-100 text-blue-700 text-xs font-semibold">{initials}</AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild><Link href="/contractor/profile">Profile</Link></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                  <LogOut className="h-4 w-4 mr-2" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
