export type InvestorScrollDestination = "top" | "properties" | null;
export type DashboardSection = "portfolio" | "properties" | "insights";

const investorRoutes = new Set(["/", "/insights", "/about"]);

export function getInvestorScrollDestination(
  pathname: string,
  search: string,
): InvestorScrollDestination {
  if (!investorRoutes.has(pathname)) return null;

  const params = new URLSearchParams(search);
  if (pathname === "/" && params.get("section") === "properties") {
    return "properties";
  }

  return "top";
}

export function getDashboardSection(search: string): DashboardSection {
  const section = new URLSearchParams(search).get("section");
  return section === "properties" || section === "insights" ? section : "portfolio";
}

export function getDashboardSectionUrl(section: DashboardSection): string {
  return section === "portfolio" ? "/dashboard" : `/dashboard?section=${section}`;
}

export function getDashboardLoginUrl(search: string): string {
  const dashboardUrl = `/dashboard${search ? `?${search}` : ""}`;
  return `/login?redirect=${encodeURIComponent(dashboardUrl)}`;
}