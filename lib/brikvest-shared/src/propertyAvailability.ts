export type PropertyLifecycleStatus = {
  status?: string | null;
  projectStatus?: string | null;
};

export function isPropertySoldOut(property: PropertyLifecycleStatus): boolean {
  return property.status === "sold_out" || property.projectStatus === "sold_out";
}

export function getCustomerPropertyStatusLabel(property: PropertyLifecycleStatus): string {
  if (isPropertySoldOut(property)) return "Sold Out";

  const status = property.status || property.projectStatus || "";
  return status
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}