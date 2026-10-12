import { describe, expect, it } from "vitest";
import { offlineFallbackCode } from "../routes/trips";
import { DEMO_SCENARIOS } from "./data";
import { GeminiNotConfiguredError, GeminiRequestError } from "./gemini";
import { createOfflineTripPlan } from "./offline-planner";

describe("offline planning fallback", () => {
  it("creates a validated local itinerary without claiming AI review or live data", () => {
    const request = DEMO_SCENARIOS[0]!.request;
    const result = createOfflineTripPlan(request, "offline-test-run", "GEMINI_QUOTA_EXHAUSTED");
    const expectedDays =
      (Date.UTC(
        request.endDate.getUTCFullYear(),
        request.endDate.getUTCMonth(),
        request.endDate.getUTCDate(),
      ) -
        Date.UTC(
          request.startDate.getUTCFullYear(),
          request.startDate.getUTCMonth(),
          request.startDate.getUTCDate(),
        )) /
        (24 * 60 * 60 * 1000)
      + 1;

    expect(result.mode).toBe("offline_fallback");
    expect(result.status).toBe("needs_attention");
    expect(result.itinerary).toHaveLength(expectedDays);
    expect(result.itinerary.every((day) => day.activities.length > 0)).toBe(true);
    expect(result.criticReports).toEqual([]);
    expect(result.agentsUsed).toEqual([]);
    expect(result.fallbackNotice).toContain("GEMINI_QUOTA_EXHAUSTED");
    expect(result.weatherAssessment.every((day) => day.summary.includes("not a live forecast"))).toBe(true);
    expect(result.budgetAssessment.totalEstimatedInr).toBe(
      result.budgetAssessment.accommodationInr
        + result.budgetAssessment.foodInr
        + result.budgetAssessment.activitiesInr
        + result.budgetAssessment.transportInr
        + result.budgetAssessment.contingencyInr,
    );
    expect(result.executionTrace[0]?.eventType).toBe("offline_fallback");
  });

  it("uses offline planning for quota and availability failures, not provider setup errors", () => {
    expect(offlineFallbackCode(new GeminiNotConfiguredError())).toBe("GEMINI_NOT_CONFIGURED");
    expect(offlineFallbackCode(new GeminiRequestError("quota", 503, "GEMINI_QUOTA_EXHAUSTED")))
      .toBe("GEMINI_QUOTA_EXHAUSTED");
    expect(offlineFallbackCode(new GeminiRequestError("limited", 503, "GEMINI_RATE_LIMITED")))
      .toBe("GEMINI_RATE_LIMITED");
    expect(offlineFallbackCode(new GeminiRequestError("bad key", 502, "GEMINI_AUTH_FAILED"))).toBeNull();
  });
});
