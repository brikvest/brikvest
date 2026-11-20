import { ReactNode, useEffect, useState } from "react";
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
import {
  Building2,
  LayoutGrid,
  Plus,
  LogOut,
  ChevronLeft,
  Megaphone,
  User,
  Menu,
  ChevronDown,
  Users,
  Clock,
  Sparkles,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface DeveloperLayoutProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  backTo?: string;
  actions?: ReactNode;
}

interface NavItem {
  href: string;
  label: string;
  icon: any;
  testId: string;
  match?: (path: string) => boolean;
  requires?: string; // permission key needed to see this nav item (members only)
}

const NAV_ITEMS: NavItem[] = [
  { href: "/developer",                label: "My Projects",    icon: LayoutGrid, testId: "link-projects",       match: (p) => p === "/developer" || p.startsWith("/developer/projects") },
  { href: "/developer/new",            label: "New Project",    icon: Plus,       testId: "link-new-project",    match: (p) => p === "/developer/new",            requires: "settings" },
  { href: "/developer/communications", label: "Communications", icon: Megaphone,  testId: "link-communications", match: (p) => p === "/developer/communications", requires: "comms" },
  { href: "/developer/team",           label: "Team",           icon: Users,      testId: "link-team",           match: (p) => p === "/developer/team" },
  { href: "/developer/profile",        label: "Profile",        icon: User,       testId: "link-profile",        match: (p) => p === "/developer/profile" },
];

function NavLinks({ location, onNavigate, permissions, isOwner }: {
  location: string;
  onNavigate?: () => void;
  permissions: string[];
  isOwner: boolean;
}) {
  const visible = NAV_ITEMS.filter((item) => {
    if (!item.requires) return true;
    if (isOwner) return true;
    return permissions.includes(item.requires);
  });
  return (
    <nav className="flex-1 px-3 py-3 space-y-1">
      {visible.map((item) => {
        const Icon = item.icon;
        const active = item.match ? item.match(location) : location === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            data-testid={item.testId}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              active
                ? "bg-blue-50 text-blue-700"
                : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            <Icon className={`w-4 h-4 ${active ? "text-blue-600" : "text-slate-500"}`} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function BrandMark() {
  return (
    <Link href="/developer" className="flex items-center gap-2.5 cursor-pointer" data-testid="link-developer-home">
      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-sm">
        <Building2 className="w-5 h-5 text-white" />
      </div>
      <div className="leading-tight">
        <div className="text-base font-bold text-slate-900">Brikvest</div>
        <div className="text-[10px] uppercase tracking-wider text-blue-600 font-semibold">Developer Portal</div>
      </div>
    </Link>
  );
}

export default function DeveloperLayout({ children, title, subtitle, backTo, actions }: DeveloperLayoutProps) {
  const [location, setLocation] = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { data: me, isLoading } = useQuery<any>({ queryKey: ["/api/developer/me"], retry: false });

  useEffect(() => {
    if (!isLoading && !me?.id) {
      setLocation("/developer/login");
    }
  }, [isLoading, me, setLocation]);

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
    return null;
  }

  const initials =
    `${(me.firstName || "")[0] || ""}${(me.lastName || "")[0] || ""}`.toUpperCase() || "D";
  const displayName = me.companyName || `${me.firstName || ""} ${me.lastName || ""}`.trim() || "Developer";
  const permissions: string[] = Array.isArray(me.permissions) ? me.permissions : [];
  const isOwner = !!me.isOwner;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col fixed inset-y-0 left-0 z-30 w-64 bg-white border-r border-slate-200">
        <div className="px-5 py-5 border-b border-slate-100">
          <BrandMark />
        </div>
        <NavLinks location={location} permissions={permissions} isOwner={isOwner} />
        <div className="p-3 border-t border-slate-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-slate-100 transition-colors text-left"
                data-testid="button-user-menu-desktop"
              >
                <Avatar className="w-9 h-9">
                  <AvatarFallback className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white text-xs font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-900 truncate" data-testid="text-developer-name">
                    {displayName}
                  </div>
                  <div className="text-xs text-slate-500 truncate">{me.email}</div>
                </div>
                <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="text-sm font-medium text-slate-900 truncate">{displayName}</div>
                <div className="text-xs text-slate-500 truncate">{me.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/developer/profile" className="cursor-pointer" data-testid="menu-item-profile">
                  <User className="w-4 h-4 mr-2" /> Profile & company
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-red-600 focus:text-red-600" data-testid="menu-item-logout">
                <LogOut className="w-4 h-4 mr-2" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main column */}
      <div className="lg:pl-64">
        {/* Sticky top bar */}
        <header className="sticky top-0 z-20 bg-white/85 backdrop-blur-md border-b border-slate-200">
          <div className="flex items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 h-14 lg:h-16">
            <div className="flex items-center gap-3 min-w-0">
              {/* Mobile hamburger */}
              <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="lg:hidden -ml-2"
                    data-testid="button-mobile-nav"
                    aria-label="Open navigation"
                  >
                    <Menu className="w-5 h-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="p-0 w-72 flex flex-col">
                  <SheetHeader className="px-5 py-4 border-b border-slate-100 text-left">
                    <SheetTitle asChild>
                      <div>
                        <BrandMark />
                      </div>
                    </SheetTitle>
                  </SheetHeader>
                  <NavLinks location={location} onNavigate={() => setMobileNavOpen(false)} permissions={permissions} isOwner={isOwner} />
                  <div className="p-3 border-t border-slate-100">
                    <div className="flex items-center gap-3 p-2 rounded-lg bg-slate-50 mb-2">
                      <Avatar className="w-9 h-9">
                        <AvatarFallback className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white text-xs font-semibold">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-900 truncate">{displayName}</div>
                        <div className="text-xs text-slate-500 truncate">{me.email}</div>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleLogout}
                      className="w-full justify-start"
                      data-testid="button-logout-mobile"
                    >
                      <LogOut className="w-4 h-4 mr-2" /> Sign out
                    </Button>
                  </div>
                </SheetContent>
              </Sheet>

              {/* Mobile brand */}
              <div className="lg:hidden">
                <BrandMark />
              </div>

              {/* Desktop title in topbar — keeps the bar useful even when no page header */}
              <div className="hidden lg:block min-w-0">
                {title && (
                  <h1 className="text-base font-semibold text-slate-900 truncate" data-testid="text-topbar-title">
                    {title}
                  </h1>
                )}
              </div>
            </div>

            {/* Mobile user menu */}
            <div className="lg:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center gap-2 -mr-2 p-1 rounded-lg hover:bg-slate-100"
                    data-testid="button-user-menu-mobile"
                    aria-label="Account menu"
                  >
                    <Avatar className="w-8 h-8">
                      <AvatarFallback className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white text-xs font-semibold">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="text-sm font-medium text-slate-900 truncate">{displayName}</div>
                    <div className="text-xs text-slate-500 truncate">{me.email}</div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/developer/profile" className="cursor-pointer">
                      <User className="w-4 h-4 mr-2" /> Profile & company
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-red-600 focus:text-red-600">
                    <LogOut className="w-4 h-4 mr-2" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        {/* Page header */}
        {(title || backTo || subtitle || actions) && (
          <div className="bg-white border-b border-slate-200">
            <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                <div className="min-w-0">
                  {backTo && (
                    <Link
                      href={backTo}
                      className="inline-flex items-center text-sm text-slate-500 hover:text-blue-600 mb-1.5"
                    >
                      <ChevronLeft className="w-4 h-4 mr-1" />
                      Back
                    </Link>
                  )}
                  {title && (
                    <h1
                      className="text-xl sm:text-2xl font-bold text-slate-900 truncate"
                      data-testid="text-page-title"
                    >
                      {title}
                    </h1>
                  )}
                  {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
                </div>
                {actions && (
                  <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">{actions}</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Trial / plan banner */}
        <TrialBanner me={me} />

        {/* Page content */}
        <main className="px-4 sm:px-6 lg:px-8 py-5 sm:py-6 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

function TrialBanner({ me }: { me: any }) {
  const status = me?.subscriptionStatus || "trialing";
  const days = typeof me?.trialDaysRemaining === "number" ? me.trialDaysRemaining : null;
  const planName = me?.planLimits?.name || (me?.plan === "growth" ? "Growth" : "Starter");

  if (status === "active") return null; // paid plan — no banner needed

  const expired = status === "expired" || status === "cancelled" || (status === "trialing" && days === 0);

  if (expired) {
    return (
      <div className="bg-rose-50 border-b border-rose-200">
        <div className="px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-rose-900">
            <Clock className="w-4 h-4 text-rose-600 flex-shrink-0" />
            <span>
              Your free trial has ended. Pick a plan to keep adding projects, investors, and updates.
            </span>
          </div>
          <Link href="/developer/pricing">
            <Button size="sm" className="bg-rose-600 hover:bg-rose-700 text-white" data-testid="button-trial-upgrade">
              <Sparkles className="w-4 h-4 mr-1.5" /> See plans
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // trialing
  const tone = days !== null && days <= 7
    ? { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-900", icon: "text-amber-600", btn: "bg-amber-600 hover:bg-amber-700" }
    : { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-900", icon: "text-blue-600", btn: "bg-blue-600 hover:bg-blue-700" };

  return (
    <div className={`${tone.bg} border-b ${tone.border}`}>
      <div className="px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <div className={`flex items-center gap-2 text-sm ${tone.text}`}>
          <Sparkles className={`w-4 h-4 ${tone.icon} flex-shrink-0`} />
          <span data-testid="text-trial-banner">
            <strong>{planName} trial</strong> · {days === null ? "active" : `${days} day${days === 1 ? "" : "s"} left`} —
            full access included.
          </span>
        </div>
        <Link href="/developer/pricing">
          <Button size="sm" variant="outline" className="text-xs h-7" data-testid="button-trial-pricing">
            View plans
          </Button>
        </Link>
      </div>
    </div>
  );
}
