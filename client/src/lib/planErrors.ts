import { ApiError, getApiErrorMessage } from "./queryClient";

export interface PlanError {
  status: number;
  code?: string;
  limit?: number;
  plan?: string;
  message: string;
}

export function parsePlanError(err: unknown): PlanError {
  if (err instanceof ApiError) {
    const data = err.data;
    return {
      status: err.status,
      code: err.code,
      limit: typeof data?.limit === "number" ? data.limit : undefined,
      plan: typeof data?.plan === "string" ? data.plan : undefined,
      message: getApiErrorMessage(err, "Please try again."),
    };
  }

  return { status: 0, message: "Please try again." };
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
