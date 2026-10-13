import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AdaptiveTripPlanner } from "./orchestrator";
import type { AgentId, JsonModel, ModelCallEvent } from "./types";

class FixtureModel implements JsonModel {
  private readonly callCount = new Map<AgentId, number>();
  private activeCalls = 0;
  maxConcurrentCalls = 0;

  constructor(
    private readonly budgetExplanation = "This local estimate fits the group budget and preserves a modest contingency.",
    private readonly omitLastWeatherDay = false,
  ) {}

  async generateJson<T>(
    _runId: string,
    agentId: AgentId,
    _systemInstruction: string,
    _prompt: string,
    schema: z.ZodType<T>,
    responseJsonSchema: Record<string, unknown>,
    onCallEvent?: (event: ModelCallEvent) => void,
  ) {
    this.activeCalls += 1;
    this.maxConcurrentCalls = Math.max(this.maxConcurrentCalls, this.activeCalls);
    try {
      await Promise.resolve();
      expect(responseJsonSchema.type).toBe("object");
      expect(responseJsonSchema.additionalProperties).toBe(false);
      expect(responseJsonSchema.required).toBeDefined();
      const count = (this.callCount.get(agentId) ?? 0) + 1;
      this.callCount.set(agentId, count);
      if (agentId === "trip_manager" && count === 1) {
        expect(responseJsonSchema.required).toEqual(expect.arrayContaining(["summary", "assignments"]));
        const properties = responseJsonSchema.properties as Record<string, unknown>;
        const assignments = properties.assignments as {
          items?: { properties?: Record<string, unknown> };
        };
        expect(assignments.items?.properties?.task).toEqual({ type: "string" });
      }
      onCallEvent?.({ attempt: 1, status: "started" });
      const response = this.responseFor(agentId, count);
      const result = schema.parse(response);
      onCallEvent?.({ attempt: 1, status: "completed" });
      return result;
    } finally {
      this.activeCalls -= 1;
    }
  }

  private responseFor(agentId: AgentId, count: number): unknown {
    if (agentId === "trip_manager" && count === 1) {
      return {
        summary: "Assign the three travel specialists and review their combined result.",
        assignments: [
          {
            agentId: "destination_agent",
            task: "Build an interest-matched Jaipur itinerary from local catalogue entries.",
            tools: ["places_search", "place_details", "route_distance"],
          },
          {
            agentId: "budget_agent",
            task: "Calculate the full-group INR estimate and explain its trade-offs.",
            tools: ["budget_estimate"],
          },
          {
            agentId: "weather_agent",
            task: "Assess typical climate and keep an indoor alternative available.",
            tools: ["seasonal_weather_estimate", "indoor_alternatives"],
          },
        ],
      };
    }
    if (agentId === "trip_manager") {
      return {
        targetAgentId: "weather_agent",
        issueIds: ["wet-weather"],
        task: "Clarify the seasonal rain caveat and provide a practical indoor timing alternative.",
      };
    }
    if (agentId === "destination_agent") {
      return {
        days: [
          {
            date: "2026-11-02",
            theme: "Fort and palace history",
            activities: [
              { placeId: "jaipur-amber", startTime: "09:00", durationMinutes: 150, rationale: "Begin with the city's best-known hilltop fort." },
              { placeId: "jaipur-citypalace", startTime: "14:00", durationMinutes: 120, rationale: "Continue the history theme in the palace museum." },
            ],
          },
          {
            date: "2026-11-03",
            theme: "Pink City observatories",
            activities: [
              { placeId: "jaipur-hawa", startTime: "09:30", durationMinutes: 75, rationale: "See the old-city architecture in the cooler morning." },
              { placeId: "jaipur-jantar", startTime: "11:30", durationMinutes: 90, rationale: "Explore the historic observatory nearby." },
            ],
          },
        ],
      };
    }
    if (agentId === "budget_agent") {
      return { explanation: this.budgetExplanation };
    }
    if (agentId === "weather_agent") {
      const recommendation =
        count === 1
          ? "Carry water, and consider an indoor stop if seasonal showers begin."
          : "Carry water; if seasonal showers begin, move the museum visit earlier.";
      const days = [
        { date: "2026-11-02", recommendation, affectedPlaceIds: [] },
        { date: "2026-11-03", recommendation, affectedPlaceIds: [] },
      ];
      return { days: this.omitLastWeatherDay ? days.slice(0, 1) : days };
    }
    if (agentId === "critic_agent" && count === 1) {
      return {
        decision: "REJECTED",
        issues: [
          {
            id: "wet-weather",
            severity: "medium",
            responsibleAgent: "weather_agent",
            requestedAction: "Make the seasonal-weather backup specific to one of the planned stops.",
            evidence: "The first recommendation does not name an indoor alternative from the provided catalogue.",
          },
        ],
        approvalSummary: "The first draft needs a clearer contingency for a seasonal shower.",
      };
    }
    if (agentId === "critic_agent") {
      return {
        decision: "APPROVED",
        issues: [],
        approvalSummary: "The revised plan covers both dates and gives the group a clear weather alternative.",
      };
    }
    throw new Error(`Unexpected fixture call for ${agentId}`);
  }
}

describe("adaptive multi-agent planner", () => {
  it("records specialist tool work, routes a critic rejection, and captures the revision", async () => {
    const longBudgetExplanation = `This local estimate fits the group budget and preserves a modest contingency.${" Extra budget commentary.".repeat(60)}`;
    const model = new FixtureModel(longBudgetExplanation);
    const planner = new AdaptiveTripPlanner(model);
    const result = await planner.plan({
      destinationId: "jaipur",
      origin: "Delhi",
      startDate: "2026-11-02",
      endDate: "2026-11-03",
      travelers: 2,
      budgetInr: 50000,
      interests: ["history"],
      activityPreferences: ["museums"],
      pace: "balanced",
    }, "queued-run-id");

    expect(result.runId).toBe("queued-run-id");
    expect(result.mode).toBe("groq_api");
    expect(result.status).toBe("approved");
    expect(result.revisionCount).toBe(1);
    expect(result.itinerary).toHaveLength(2);
    expect(result.budgetAssessment.totalEstimatedInr).toBeLessThan(50000);
    expect(Array.from(result.budgetAssessment.explanation).length).toBeLessThanOrEqual(240);
    expect(result.budgetAssessment.explanation.length).toBeLessThan(longBudgetExplanation.length);
    expect(result.criticReports.map((report) => report.decision)).toEqual(["REJECTED", "APPROVED"]);
    expect(result.messages.some((message) => message.type === "targeted_revision")).toBe(true);
    expect(result.executionTrace.some((event) => event.toolName === "route_distance")).toBe(true);
    expect(result.executionTrace.some((event) => event.eventType === "model_call")).toBe(true);
    expect(result.executionTrace.at(-1)?.eventType).toBe("run_completed");
    expect(model.maxConcurrentCalls).toBeGreaterThanOrEqual(2);
  });

  it("rejects unsupported destinations before any model call", async () => {
    const planner = new AdaptiveTripPlanner(new FixtureModel());
    await expect(
      planner.plan({
        destinationId: "unknown",
        startDate: "2026-11-02",
        endDate: "2026-11-03",
        travelers: 1,
        budgetInr: 25000,
        interests: [],
        activityPreferences: [],
        pace: "relaxed",
      }),
    ).rejects.toThrow(/supported destinations/i);
  });

  it("fills a missing model weather note from the bundled climate data", async () => {
    const planner = new AdaptiveTripPlanner(new FixtureModel(undefined, true));
    const result = await planner.plan({
      destinationId: "jaipur",
      origin: "Delhi",
      startDate: "2026-11-02",
      endDate: "2026-11-03",
      travelers: 2,
      budgetInr: 50000,
      interests: ["history"],
      activityPreferences: ["museums"],
      pace: "balanced",
    }, "weather-gap-run");

    expect(result.weatherAssessment.map((day) => day.date.toISOString().slice(0, 10))).toEqual([
      "2026-11-02",
      "2026-11-03",
    ]);
    expect(result.weatherAssessment[1]?.recommendation).toContain("Check a current forecast");
    expect(result.weatherAssessment[1]?.recommendation).toContain("Bundled typical-climate estimate");
  });

  it("initializes all five distinct specialist agents conforming to BaseAgent", () => {
    const planner = new AdaptiveTripPlanner(new FixtureModel());
    expect(planner.tripManager.id).toBe("trip_manager");
    expect(planner.destinationAgent.id).toBe("destination_agent");
    expect(planner.budgetAgent.id).toBe("budget_agent");
    expect(planner.weatherAgent.id).toBe("weather_agent");
    expect(planner.criticAgent.id).toBe("critic_agent");

    expect(planner.destinationAgent.allowedTools).toContain("places_search");
    expect(planner.budgetAgent.allowedTools).toContain("budget_estimate");
    expect(planner.weatherAgent.allowedTools).toContain("seasonal_weather_estimate");

    // Tool security enforcement: destination agent cannot run budget_estimate
    expect(() => planner.destinationAgent.executeTool("budget_estimate", {})).toThrow(/Security Violation/);

    // Authorized tool execution succeeds
    const places = planner.destinationAgent.executeTool("places_search", {
      destinationId: "jaipur",
      limit: 2,
    }) as unknown[];
    expect(places.length).toBeGreaterThanOrEqual(1);
  });
});

