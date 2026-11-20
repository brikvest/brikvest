import { describe, expect, it } from "vitest";
import {
  ApiError,
  getApiErrorMessage,
  normalizeApiErrorResponse,
} from "../client/src/lib/queryClient";
import { isPlanLimitError, parsePlanError, toastFromError } from "../client/src/lib/planErrors";

describe("API error normalization", () => {
  it("keeps structured fields while exposing only the useful JSON message", async () => {
    const error = await normalizeApiErrorResponse(new Response(JSON.stringify({
      code: "plan_limit_projects",
      limit: 3,
      plan: "starter",
      message: "Upgrade your plan to add another project.",
    }), {
      status: 402,
      headers: { "content-type": "application/json" },
    }));

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(402);
    expect(error.code).toBe("plan_limit_projects");
    expect(error.message).toBe("Upgrade your plan to add another project.");
    expect(error.message).not.toContain("402:");
  });

  it("accepts useful plain text without adding an HTTP status", async () => {
    const error = await normalizeApiErrorResponse(new Response(
      "Only 2 units available. Please select a smaller quantity.",
      { status: 400, headers: { "content-type": "text/plain" } },
    ));

    expect(error.safeMessage).toBe("Only 2 units available. Please select a smaller quantity.");
    expect(error.message).not.toContain("400:");
  });

  it.each([
    ["malformed JSON", '{"message":'],
    ["HTML", "<!doctype html><html><body>Gateway failure</body></html>"],
    ["empty content", ""],
    ["stack details", "Error: failed\n    at handler (/app/server.js:1:2)"],
  ])("replaces %s with an action-specific fallback", async (_label, body) => {
    const error = await normalizeApiErrorResponse(new Response(body, {
      status: 500,
      headers: { "content-type": body.startsWith("{") ? "application/json" : "text/plain" },
    }));

    expect(getApiErrorMessage(error, "Could not save your changes. Please try again."))
      .toBe("Could not save your changes. Please try again.");
    if (body) {
      expect(error.message).not.toContain(body);
    }
  });
});

describe("plan-limit compatibility", () => {
  it("reads status, code, and plan details from normalized errors", () => {
    const error = new ApiError({
      status: 402,
      code: "trial_expired",
      safeMessage: "Your free trial has ended.",
      data: { code: "trial_expired", limit: 1, plan: "trial" },
    });

    expect(isPlanLimitError(error)).toBe(true);
    expect(parsePlanError(error)).toEqual({
      status: 402,
      code: "trial_expired",
      limit: 1,
      plan: "trial",
      message: "Your free trial has ended.",
    });
    expect(toastFromError(error, "Could not continue")).toMatchObject({
      title: "Free trial ended",
      description: "Your free trial has ended.",
    });
  });
});