import { GetPlanningRunResponse, PlanTripBody } from "@workspace/api-zod";
import { z } from "zod";

export const AGENT_IDS = [
  "trip_manager",
  "destination_agent",
  "budget_agent",
  "weather_agent",
  "critic_agent",
] as const;

export type AgentId = (typeof AGENT_IDS)[number];
export type TripRequest = z.infer<typeof PlanTripBody>;
export type TripPlanResult = NonNullable<z.infer<typeof GetPlanningRunResponse>["result"]>;
export type TraceEvent = TripPlanResult["executionTrace"][number];
export type AgentMessage = TripPlanResult["messages"][number];
export type PlannerMode = "groq_api" | "offline_fallback";

export interface ModelCallEvent {
  attempt: number;
  status: "started" | "completed" | "failed";
}

export interface JsonModel {
  generateJson<T>(
    runId: string,
    agentId: AgentId,
    systemInstruction: string,
    prompt: string,
    schema: z.ZodType<T>,
    responseJsonSchema: Record<string, unknown>,
    onCallEvent?: (event: ModelCallEvent) => void,
  ): Promise<T>;
}
