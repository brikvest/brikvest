export type PlanId = "starter" | "growth";

export interface PlanLimits {
  id: PlanId;
  name: string;
  maxActiveProjects: number;
  maxInvestors: number;
  updatesPerMonth: number;
  maxTeamSeats: number;
  monthlyPriceNgn: number;
  yearlyPriceNgn: number;
}

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  starter: {
    id: "starter",
    name: "Starter",
    maxActiveProjects: 1,
    maxInvestors: 10,
    updatesPerMonth: 1,
    maxTeamSeats: 2,
    monthlyPriceNgn: 50_000,
    yearlyPriceNgn: 480_000,
  },
  growth: {
    id: "growth",
    name: "Growth",
    maxActiveProjects: 5,
    maxInvestors: 50,
    updatesPerMonth: Number.MAX_SAFE_INTEGER,
    maxTeamSeats: Number.MAX_SAFE_INTEGER,
    monthlyPriceNgn: 150_000,
    yearlyPriceNgn: 1_440_000,
  },
};

export const TRIAL_DAYS = 90;

export const DEFAULT_PLAN: PlanId = "starter";

export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  if (plan === "growth") return PLAN_LIMITS.growth;
  return PLAN_LIMITS.starter;
}

export function isUnlimited(n: number): boolean {
  return n >= Number.MAX_SAFE_INTEGER;
}
