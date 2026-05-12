// Per-feature permissions for developer team members.
// Owners implicitly have all permissions. Members get the explicit set
// granted at invite time (or later edited from the Team page).

export type PermissionKey =
  | "fundraising"
  | "construction"
  | "cap_table"
  | "sales"
  | "comms"
  | "settings";

export interface PermissionDef {
  key: PermissionKey;
  label: string;
  description: string;
}

export const PERMISSIONS: PermissionDef[] = [
  {
    key: "fundraising",
    label: "Fundraising",
    description: "View capital-raise progress, money in, and rollups.",
  },
  {
    key: "construction",
    label: "Construction",
    description: "Manage build milestones, progress photos, and timelines.",
  },
  {
    key: "cap_table",
    label: "Cap table",
    description: "View ownership records and investor allocations.",
  },
  {
    key: "sales",
    label: "Sales & clients",
    description: "Manage clients, leads, and record off-platform sales.",
  },
  {
    key: "comms",
    label: "Communications",
    description: "Post updates and broadcast emails to investors.",
  },
  {
    key: "settings",
    label: "Project settings",
    description: "Create and edit project details, pricing, and media.",
  },
];

export const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map((p) => p.key);

export function isValidPermission(k: any): k is PermissionKey {
  return typeof k === "string" && (ALL_PERMISSION_KEYS as string[]).includes(k);
}

export function sanitizePermissions(input: any): PermissionKey[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<PermissionKey>();
  for (const v of input) {
    if (isValidPermission(v)) out.add(v);
  }
  return Array.from(out);
}

// Resolve effective permissions for a user record:
// - Owners (teamRole !== 'member' OR no parentDeveloperId) get all permissions.
// - Members get whatever is stored on their `permissions` array.
export function effectivePermissions(user: {
  teamRole?: string | null;
  parentDeveloperId?: number | null;
  permissions?: string[] | null;
}): PermissionKey[] {
  const isMember = user?.teamRole === "member" && !!user?.parentDeveloperId;
  if (!isMember) return [...ALL_PERMISSION_KEYS];
  return sanitizePermissions(user?.permissions);
}

export function hasPermission(
  user: { teamRole?: string | null; parentDeveloperId?: number | null; permissions?: string[] | null },
  key: PermissionKey,
): boolean {
  return effectivePermissions(user).includes(key);
}
