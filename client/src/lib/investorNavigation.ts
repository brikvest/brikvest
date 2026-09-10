export type InvestorScrollDestination = "top" | "properties" | null;

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