// Deliberately not the main API client: these routes exist only in this service.
export type Attempt = {
  id: number; reservationId: number; txRef: string; state: string;
  expectedAmount: string; expectedCurrency: string; verifiedAt?: string | null;
  verifiedAmount?: string | null; reason?: string | null; checkoutExpiresAt?: string;
};
export type SandboxState = {
  synthetic: true;
  setup: { available: boolean; blockers: string[]; providerEvidence: string; providerEmailPolicy: string; scopeNotice: string };
  property: { name: string; location: string; units: number; area: number; unitPrice: string };
  reservations: { id: number; amount: string; currency: string; status: string; createdAt: string; attempts: Attempt[] }[];
  safety: { database: string; mail: string; ownership: string };
};
const base = import.meta.env.BASE_URL.replace(/\/$/, "");
const storageKey = "brikvest-isolated-checkout-session";
let sessionPromise: Promise<string> | undefined;
async function session() {
  const saved = localStorage.getItem(storageKey);
  if (saved) return saved;
  if (!sessionPromise) sessionPromise = fetch(`${base}/api/session`, {
    method: "POST", credentials: "omit", headers: { "Content-Type": "application/json" }, body: "{}",
  }).then(async response => {
    if (!response.ok) throw new Error("Could not start a synthetic session. Retry.");
    const { token } = await response.json();
    localStorage.setItem(storageKey, token);
    return token as string;
  }).finally(() => { sessionPromise = undefined; });
  return sessionPromise;
}
async function call<T>(path: string, body?: unknown): Promise<T> {
  const token = await session();
  const response = await fetch(`${base}/api${path}`, {
    method: body === undefined ? "GET" : "POST", credentials: "omit",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) localStorage.removeItem(storageKey);
    throw new Error(result.error || "Sandbox request failed. Retry; do not pay again.");
  }
  return result;
}
export const getSandboxState = () => call<SandboxState>("/state");
export const newReservation = () => call<{ id: number }>("/reservations", {});
export const startCheckout = (id: number) => call<{ checkoutUrl: string }>(`/reservations/${id}/checkout`, {});
export const recheckAttempt = (id: number) => call<{ message: string }>(`/attempts/${id}/recheck`, {});
export const handleProviderReturn = (txRef: string, transactionId?: string) =>
  call<{ message: string }>("/return", { txRef, ...(transactionId ? { transactionId } : {}) });
export const resetRecords = () => call<{ message: string }>("/reset", { confirmation: "RESET SYNTHETIC RECORDS" });
