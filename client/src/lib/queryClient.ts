import { QueryClient, QueryFunction } from "@tanstack/react-query";

const DEFAULT_API_ERROR_MESSAGE = "Something went wrong. Please try again.";

export interface ApiErrorDetails {
  status: number;
  code?: string;
  data?: Record<string, unknown>;
  safeMessage?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly data?: Record<string, unknown>;
  readonly safeMessage?: string;

  constructor(details: ApiErrorDetails) {
    super(details.safeMessage || DEFAULT_API_ERROR_MESSAGE);
    this.name = "ApiError";
    this.status = details.status;
    this.code = details.code;
    this.data = details.data;
    this.safeMessage = details.safeMessage;
  }
}

function isSafeApiMessage(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const message = value.trim();
  if (!message || message.length > 500) return false;

  return !(
    /<(!doctype|html|body|head|script|style)\b/i.test(message) ||
    /^[{\[]/.test(message) ||
    /^\d{3}\s*:/.test(message) ||
    /(?:\bat\s+\S+\s+\([^)]+:\d+:\d+\)|\b(?:error|exception):.*\n)/i.test(message)
  );
}

export async function normalizeApiErrorResponse(res: Response): Promise<ApiError> {
  const body = await res.text();
  const contentType = res.headers.get("content-type") || "";

  if (body && (contentType.includes("json") || /^[\s]*[{\[]/.test(body))) {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const data = parsed as Record<string, unknown>;
        const candidate = isSafeApiMessage(data.message)
          ? data.message
          : isSafeApiMessage(data.error)
            ? data.error
            : undefined;
        return new ApiError({
          status: res.status,
          code: typeof data.code === "string" ? data.code : undefined,
          data,
          safeMessage: candidate?.trim(),
        });
      }
    } catch {
      // Malformed structured responses must not reach the interface.
    }
  } else if (isSafeApiMessage(body)) {
    return new ApiError({ status: res.status, safeMessage: body.trim() });
  }

  return new ApiError({ status: res.status });
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.safeMessage || fallback;
  }
  return fallback;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    throw await normalizeApiErrorResponse(res);
  }
}

export async function apiRequest(
  methodOrUrl: string,
  urlOrOptions?: string | {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  },
  bodyData?: any
): Promise<any> {
  let method: string;
  let url: string;
  let body: string | undefined;
  let headers: Record<string, string> = {};

  if (typeof urlOrOptions === "string") {
    method = methodOrUrl;
    url = urlOrOptions;
    body = bodyData ? JSON.stringify(bodyData) : undefined;
  } else {
    url = methodOrUrl;
    const opts = urlOrOptions || {};
    method = opts.method || "GET";
    body = opts.body;
    headers = opts.headers || {};
  }

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return await res.json();
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey[0] as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
