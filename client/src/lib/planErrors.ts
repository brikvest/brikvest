// Helpers for surfacing developer plan-limit / trial errors returned by the
// API. The server uses HTTP 402 with a JSON body of the form:
//   { code: "plan_limit_projects" | "plan_limit_investors" | ... | "trial_expired",
//     limit: number, plan: string, message: string }
// Our shared `apiRequest` throws `Error("402: <bodyText>")`, so we parse the
// message string back into structured info.

export interface PlanError {
  status: number;
  code?: string;
  limit?: number;
  plan?: string;
  message: string;
}

export function parsePlanError(err: unknown): PlanError {
  const raw = err instanceof Error ? err.message : String(err);
  const match = /^(\d{3}):\s*([\s\S]*)$/.exec(raw);
  if (!match) return { status: 0, message: raw };
  const status = parseInt(match[1], 10);
  const body = match[2];
  try {
    const parsed = JSON.parse(body);
    return {
      status,
      code: parsed.code,
      limit: parsed.limit,
      plan: parsed.plan,
      message: parsed.message || body,
    };
  } catch {
    return { status, message: body };
  }
}

export function isPlanLimitError(err: unknown): boolean {
  const p = parsePlanError(err);
  return p.status === 402;
}

// Returns a user-friendly toast { title, description } based on the error.
export function toastFromError(err: unknown, fallbackTitle: string): {
  title: string;
  description?: string;
  variant?: "destructive";
} {
  const p = parsePlanError(err);
  if (p.status === 402) {
    return {
      title: p.code === "trial_expired" ? "Free trial ended" : "Plan limit reached",
      description: p.message,
      variant: "destructive",
    };
  }
  return { title: fallbackTitle, description: p.message, variant: "destructive" };
}
