import { useState, type MouseEvent } from "react";
import { Link, useLocation } from "wouter";
import { Award, Building2, CircleHelp, LayoutDashboard, LogOut, Menu, TrendingUp, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { queryClient } from "@/lib/queryClient";
import brikvestLogo from "@/assets/brikvest-logo.png";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { CurrencySelector } from "@/components/CurrencySelector";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const navLinkClass =
  "text-slate-700 hover:text-blue-600 hover:bg-slate-50 px-3 py-2 rounded-md text-sm font-medium transition-colors";
const mobileNavLinkClass =
  "flex items-center text-slate-700 hover:text-blue-600 hover:bg-slate-50 px-3 py-3 rounded-lg text-base font-medium transition-colors";

export function InvestorHeader() {
  const { user, isAuthenticated } = useAuth();
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const account = user as any;

  const signOut = async () => {
    try {
      await fetch("/api/logout", { method: "POST", credentials: "include" });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      window.location.reload();
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const closeMenu = () => setMobileMenuOpen(false);
  const handlePropertiesClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (location !== "/") return;
    event.preventDefault();
    document.getElementById("properties")?.scrollIntoView({ block: "start" });
    closeMenu();
  };

  return (
    <>
      <header
        className="bg-white/85 backdrop-blur-md border-b border-slate-200 sticky top-0 z-40"
        data-testid="investor-header"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link href="/" className="flex items-center" data-testid="link-home">
              <img src={brikvestLogo} alt="Brikvest" className="h-8 w-auto cursor-pointer" />
            </Link>

            <nav className="hidden md:flex items-center gap-1" aria-label="Investor navigation">
              <Link
                href="/?section=properties"
                className={navLinkClass}
                onClick={handlePropertiesClick}
                data-testid="link-properties"
              >
                Properties
              </Link>
              <Link href="/insights" className={navLinkClass}>Insights</Link>
              <Link href="/about" className={navLinkClass}>About</Link>
              <Link href="/faqs" className={navLinkClass} data-testid="link-faqs">FAQs</Link>
            </nav>

            <div className="hidden md:flex items-center gap-2">
              <CurrencySelector compact />
              {isAuthenticated ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="flex items-center gap-2 rounded-full hover:bg-slate-100 transition-colors p-1 pr-3"
                      data-testid="button-user-menu"
                      aria-label="Account menu"
                    >
                      <Avatar className="w-8 h-8">
                        <AvatarFallback className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white text-xs font-semibold">
                          {((account?.firstName || account?.email || "U")[0] || "U").toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium text-slate-700 max-w-[120px] truncate">
                        {account?.firstName || account?.email?.split("@")[0] || "Account"}
                      </span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuLabel className="font-normal">
                      <div className="text-sm font-medium text-slate-900 truncate">
                        {account?.firstName} {account?.lastName}
                      </div>
                      <div className="text-xs text-slate-500 truncate">{account?.email}</div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/dashboard" className="cursor-pointer" data-testid="menu-item-portfolio">
                        <LayoutDashboard className="w-4 h-4 mr-2" /> My Portfolio
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={signOut}
                      className="cursor-pointer text-red-600 focus:text-red-600"
                      data-testid="menu-item-signout"
                    >
                      <LogOut className="w-4 h-4 mr-2" /> Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button
                  onClick={() => (window.location.href = "/login")}
                  className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                  size="sm"
                  data-testid="button-sign-in"
                >
                  Sign in
                </Button>
              )}
            </div>

            <div className="md:hidden flex items-center gap-1">
              <CurrencySelector compact />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileMenuOpen((open) => !open)}
                className="text-slate-700"
                data-testid="button-mobile-menu"
                aria-label="Open menu"
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </div>
          </div>
        </div>
      </header>

      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-[60] md:hidden transition-opacity duration-300"
          onClick={closeMenu}
          data-testid="overlay-mobile-menu"
        />
      )}

      <aside
        className={`fixed inset-y-0 right-0 z-[70] w-[85vw] max-w-sm bg-white shadow-2xl transform transition-transform duration-300 ease-in-out md:hidden ${mobileMenuOpen ? "translate-x-0" : "translate-x-full pointer-events-none"}`}
        aria-hidden={!mobileMenuOpen}
        data-testid="drawer-mobile-menu"
      >
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between p-4 border-b border-slate-200">
            <Link href="/" onClick={closeMenu}>
              <img src={brikvestLogo} alt="Brikvest" className="h-8 cursor-pointer" />
            </Link>
            <Button variant="ghost" size="sm" onClick={closeMenu} data-testid="button-close-mobile-menu">
              <X className="h-6 w-6" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto py-4">
            {Boolean(isAuthenticated && user) && (
              <div className="px-4 mb-2">
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                  <Avatar className="w-10 h-10">
                    <AvatarFallback className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white text-sm font-semibold">
                      {((account?.firstName || account?.email || "U")[0] || "U").toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {account?.firstName} {account?.lastName}
                    </p>
                    <p className="text-xs text-slate-500 truncate">{account?.email}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-1 px-3 mt-2">
              {isAuthenticated && (
                <Link href="/dashboard" className={mobileNavLinkClass} onClick={closeMenu} data-testid="link-mobile-dashboard">
                  <LayoutDashboard className="h-4 w-4 mr-3 text-slate-500" /> My Portfolio
                </Link>
              )}
              <Link
                href="/?section=properties"
                className={mobileNavLinkClass}
                onClick={handlePropertiesClick}
                data-testid="link-mobile-properties"
              >
                <Building2 className="h-4 w-4 mr-3 text-slate-500" /> Properties
              </Link>
              <Link href="/insights" className={mobileNavLinkClass} onClick={closeMenu} data-testid="link-mobile-insights">
                <TrendingUp className="h-4 w-4 mr-3 text-slate-500" /> Insights
              </Link>
              <Link href="/about" className={mobileNavLinkClass} onClick={closeMenu} data-testid="link-mobile-about">
                <Award className="h-4 w-4 mr-3 text-slate-500" /> About
              </Link>
              <Link href="/faqs" className={mobileNavLinkClass} onClick={closeMenu} data-testid="link-mobile-faqs">
                <CircleHelp className="h-4 w-4 mr-3 text-slate-500" /> FAQs
              </Link>
            </div>
          </div>

          <div className="border-t border-slate-200 p-4 space-y-3">
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Currency</p>
              <CurrencySelector />
            </div>
            {isAuthenticated ? (
              <Button variant="outline" className="w-full" onClick={signOut} data-testid="button-mobile-logout">
                <LogOut className="h-4 w-4 mr-2" /> Sign out
              </Button>
            ) : (
              <Button
                onClick={() => {
                  closeMenu();
                  window.location.href = "/login";
                }}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                data-testid="button-mobile-signin"
              >
                Sign in
              </Button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}