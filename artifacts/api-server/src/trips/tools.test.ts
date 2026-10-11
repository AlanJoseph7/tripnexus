import { describe, expect, it } from "vitest";
import { estimateRouteDistance, estimateSeasonalWeather, estimateTripBudget, searchPlaces } from "./tools";

describe("bundled travel tools", () => {
  it("searches verified places in the requested destination", () => {
    const matches = searchPlaces({ destinationId: "jaipur", query: "Amber fort", limit: 4 });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe("jaipur-amber");
    expect(matches[0]?.destinationId).toBe("jaipur");
  });

  it("calculates a non-negative coordinate route estimate", () => {
    const result = estimateRouteDistance({
      routes: [["jaipur-amber", "jaipur-citypalace"], ["jaipur-hawa"]],
    });
    expect(result.routes).toHaveLength(2);
    expect(result.routes[0]?.distanceKm).toBeGreaterThan(0);
    expect(result.routes[1]?.distanceKm).toBe(0);
    expect(result.note).toMatch(/not road distance/i);
  });

  it("keeps group budget arithmetic consistent", () => {
    const result = estimateTripBudget({
      destinationId: "jaipur",
      travelers: 2,
      days: 3,
      budgetInr: 50000,
      activityCostsPerPersonInr: [550, 200, 300],
    });
    expect(result.totalEstimatedInr).toBe(
      result.accommodationInr +
        result.foodInr +
        result.activitiesInr +
        result.transportInr +
        result.contingencyInr,
    );
    expect(result.remainingInr).toBe(50000 - result.totalEstimatedInr);
    expect(result.withinBudget).toBe(true);
  });

  it("returns seasonal climate estimates with a truthful data source", () => {
    const result = estimateSeasonalWeather({
      destinationId: "goa",
      dates: ["2026-07-15", "2026-12-15"],
    });
    expect(result[0]?.rainChancePercent).toBeGreaterThan(result[1]?.rainChancePercent ?? 0);
    expect(result[0]?.dataSource).toBe("bundled_typical_climate");
  });
});
