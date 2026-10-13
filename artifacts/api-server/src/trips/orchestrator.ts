import { randomUUID } from "node:crypto";
import { GetPlanningRunResponse, PlanTripBody } from "@workspace/api-zod";
import { z } from "zod";
import { AGENTS, findDestination, type Place } from "./data";
import { getActiveModel, getActiveModelInfo } from "./model-provider";
import { RunTrace } from "./trace";
import {
  TripManagerAgent,
  DestinationAgent,
  BudgetAgent,
  WeatherAgent,
  CriticAgent,
} from "./base-agent";
import {
  executeLocalTool,
  getToolCatalog,
  LOCAL_TOOL_NAMES,
  type BudgetToolResult,
  type LocalToolName,
  type SeasonalWeatherDay,
} from "./tools";
import type { AgentId, JsonModel, TripPlanResult, TripRequest } from "./types";

const MAX_TRIP_DAYS = 14;
const MAX_MANAGER_ACTIONS = 15;
const MAX_TOOLS_PER_TASK = 8;
const MAX_REVISIONS = 3;

const ManagerAssignmentSchema = z.object({
  agentId: z.enum(["destination_agent", "budget_agent", "weather_agent"]),
  task: z.string().min(12).max(240),
  tools: z.array(z.enum(LOCAL_TOOL_NAMES)).min(1).max(MAX_TOOLS_PER_TASK),
});

const ManagerPlanSchema = z
  .object({
    summary: z.string().min(12).max(500),
    assignments: z.array(ManagerAssignmentSchema).length(3),
  })
  .superRefine((plan, context) => {
    const ids = plan.assignments.map((assignment) => assignment.agentId);
    if (new Set(ids).size !== 3) {
      context.addIssue({ code: "custom", message: "Assign each required specialist exactly once." });
    }
    const requiredTools: Record<z.infer<typeof ManagerAssignmentSchema>["agentId"], LocalToolName[]> = {
      destination_agent: ["places_search", "place_details", "route_distance"],
      budget_agent: ["budget_estimate"],
      weather_agent: ["seasonal_weather_estimate", "indoor_alternatives"],
    };
    for (const assignment of plan.assignments) {
      const allowedTools: Record<z.infer<typeof ManagerAssignmentSchema>["agentId"], LocalToolName[]> = {
        destination_agent: ["places_search", "place_details", "route_distance"],
        budget_agent: ["budget_estimate"],
        weather_agent: ["seasonal_weather_estimate", "indoor_alternatives"],
      };
      if (assignment.tools.some((tool) => !allowedTools[assignment.agentId].includes(tool))) {
        context.addIssue({
          code: "custom",
          message: `${assignment.agentId} selected a tool outside its allowed set.`,
        });
      }
      for (const requiredTool of requiredTools[assignment.agentId]) {
        if (!assignment.tools.includes(requiredTool)) {
          context.addIssue({
            code: "custom",
            message: `${assignment.agentId} must use ${requiredTool}.`,
          });
        }
      }
    }
  });

function clampText(val: string, min: number, max: number, fallback: string): string {
  const clean = (val || "").replace(/\s+/g, " ").trim();
  if (clean.length < min) {
    return clean ? `${clean}. ${fallback}`.slice(0, max) : fallback;
  }
  return clean.slice(0, max);
}

function normalizeStartTime(val: string): string {
  const match = (val || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "09:00";
  const hours = Math.max(7, Math.min(20, parseInt(match[1], 10)));
  const mins = match[2];
  return `${hours.toString().padStart(2, "0")}:${mins}`;
}

const ActivityDraftSchema = z.object({
  placeId: z.string().min(2).max(80),
  startTime: z.string().transform(normalizeStartTime),
  durationMinutes: z.coerce.number().transform((n) => Math.max(30, Math.min(360, Math.round(n || 90)))),
  rationale: z.string().transform((s) => clampText(s, 10, 240, "Recommended local stop based on traveler preferences.")),
});

const ItineraryDraftSchema = z.object({
  days: z.array(
    z.object({
      date: z.string(),
      theme: z.string().transform((s) => clampText(s, 3, 100, "City exploration and sightseeing")),
      activities: z.array(ActivityDraftSchema).min(1).transform((arr) => arr.slice(0, 2)),
    }),
  ).min(1).max(MAX_TRIP_DAYS),
});

const MAX_BUDGET_EXPLANATION_CHARS = 240;

function normalizeBudgetExplanation(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const safeText = normalized || "Costs are local estimates, not live prices; keep a contingency for changes.";
  const characters = Array.from(safeText);
  if (characters.length <= MAX_BUDGET_EXPLANATION_CHARS) return safeText;

  const clipped = characters.slice(0, MAX_BUDGET_EXPLANATION_CHARS - 1).join("");
  const lastSpace = clipped.lastIndexOf(" ");
  const sentence = (lastSpace >= 180 ? clipped.slice(0, lastSpace) : clipped).replace(/[ ,;:—-]+$/u, "");
  return `${sentence}…`;
}

const BudgetNotesSchema = z.object({
  explanation: z.string().transform(normalizeBudgetExplanation),
});

const WeatherNotesSchema = z.object({
  days: z.array(
    z.object({
      date: z.string(),
      recommendation: z.string().transform((s) => clampText(s, 15, 350, "Check weather conditions and carry water for outdoor stops.")),
      affectedPlaceIds: z.array(z.string()).max(2).catch([]),
    }),
  ).max(MAX_TRIP_DAYS),
});

const ReviewIssueSchema = z.object({
  id: z.string().min(1).max(80),
  severity: z.enum(["low", "medium", "high"]),
  responsibleAgent: z.enum(["destination_agent", "budget_agent", "weather_agent"]),
  requestedAction: z.string().transform((s) => clampText(s, 12, 300, "Review and adjust schedule to align with preferences.")),
  evidence: z.string().transform((s) => clampText(s, 8, 350, "Alignment check between planned activities and constraints.")),
});

const CriticDecisionSchema = z
  .object({
    decision: z.enum(["APPROVED", "REJECTED"]).or(z.string().transform((s) => s.toUpperCase() === "REJECTED" ? "REJECTED" : "APPROVED")),
    issues: z.array(ReviewIssueSchema).max(5).catch([]),
    approvalSummary: z.string().transform((s) => clampText(s, 15, 500, "The proposed itinerary meets budget and schedule criteria.")),
  })
  .transform((report) => {
    if (report.decision === "REJECTED" && report.issues.length === 0) {
      return {
        ...report,
        decision: "APPROVED" as const,
        approvalSummary: report.approvalSummary || "Plan reviewed and approved.",
      };
    }
    return report;
  });

const ManagerRevisionSchema = z.object({
  targetAgentId: z.enum(["destination_agent", "budget_agent", "weather_agent"]),
  issueIds: z.array(z.string()).min(1).max(3),
  task: z.string().transform((s) => clampText(s, 12, 300, "Revise itinerary to address the identified review points.")),
});

type ResponseJsonSchema = Record<string, unknown>;

function objectJsonSchema(properties: Record<string, unknown>, required: string[]): ResponseJsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

function arrayJsonSchema(
  items: ResponseJsonSchema,
  minItems?: number,
  maxItems?: number,
): ResponseJsonSchema {
  return {
    type: "array",
    items,
    ...(minItems === undefined ? {} : { minItems }),
    ...(maxItems === undefined ? {} : { maxItems }),
  };
}

const stringJsonSchema: ResponseJsonSchema = { type: "string" };

const ManagerPlanJsonSchema = objectJsonSchema(
  {
    summary: stringJsonSchema,
    assignments: arrayJsonSchema(
      objectJsonSchema(
        {
          agentId: {
            type: "string",
            enum: ["destination_agent", "budget_agent", "weather_agent"],
          },
          task: stringJsonSchema,
          tools: arrayJsonSchema(
            {
              type: "string",
              enum: [
                "places_search",
                "place_details",
                "route_distance",
                "budget_estimate",
                "seasonal_weather_estimate",
                "indoor_alternatives",
              ],
            },
            1,
            MAX_TOOLS_PER_TASK,
          ),
        },
        ["agentId", "task", "tools"],
      ),
      3,
      3,
    ),
  },
  ["summary", "assignments"],
);

const ItineraryDraftJsonSchema = objectJsonSchema(
  {
    days: arrayJsonSchema(
      objectJsonSchema(
        {
          date: { type: "string", format: "date" },
          theme: stringJsonSchema,
          activities: arrayJsonSchema(
            objectJsonSchema(
              {
                placeId: stringJsonSchema,
                startTime: stringJsonSchema,
                durationMinutes: { type: "integer", minimum: 30, maximum: 360 },
                rationale: stringJsonSchema,
              },
              ["placeId", "startTime", "durationMinutes", "rationale"],
            ),
            1,
            2,
          ),
        },
        ["date", "theme", "activities"],
      ),
      0,
      MAX_TRIP_DAYS,
    ),
  },
  ["days"],
);

const BudgetNotesJsonSchema = objectJsonSchema({ explanation: stringJsonSchema }, ["explanation"]);

const WeatherNotesJsonSchema = objectJsonSchema(
  {
    days: arrayJsonSchema(
      objectJsonSchema(
        {
          date: { type: "string", format: "date" },
          recommendation: stringJsonSchema,
          affectedPlaceIds: arrayJsonSchema(stringJsonSchema, 0, 2),
        },
        ["date", "recommendation", "affectedPlaceIds"],
      ),
      0,
      MAX_TRIP_DAYS,
    ),
  },
  ["days"],
);

const CriticDecisionJsonSchema = objectJsonSchema(
  {
    decision: { type: "string", enum: ["APPROVED", "REJECTED"] },
    issues: arrayJsonSchema(
      objectJsonSchema(
        {
          id: stringJsonSchema,
          severity: { type: "string", enum: ["low", "medium", "high"] },
          responsibleAgent: {
            type: "string",
            enum: ["destination_agent", "budget_agent", "weather_agent"],
          },
          requestedAction: stringJsonSchema,
          evidence: stringJsonSchema,
        },
        ["id", "severity", "responsibleAgent", "requestedAction", "evidence"],
      ),
      0,
      5,
    ),
    approvalSummary: stringJsonSchema,
  },
  ["decision", "issues", "approvalSummary"],
);

const ManagerRevisionJsonSchema = objectJsonSchema(
  {
    targetAgentId: {
      type: "string",
      enum: ["destination_agent", "budget_agent", "weather_agent"],
    },
    issueIds: arrayJsonSchema(stringJsonSchema, 1, 3),
    task: stringJsonSchema,
  },
  ["targetAgentId", "issueIds", "task"],
);

type ManagerPlan = z.infer<typeof ManagerPlanSchema>;
type ActivityDraft = z.infer<typeof ActivityDraftSchema>;
type DayDraft = z.infer<typeof ItineraryDraftSchema>["days"][number];
type CriticDecision = z.infer<typeof CriticDecisionSchema>;
type ReviewIssue = z.infer<typeof ReviewIssueSchema>;
type BudgetNotes = z.infer<typeof BudgetNotesSchema>;
type WeatherNotes = z.infer<typeof WeatherNotesSchema>;
type DestinationDraft = z.infer<typeof ItineraryDraftSchema>;

export class PlannerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlannerInputError";
  }
}

export class PlannerOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlannerOutputError";
  }
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function tripDates(request: TripRequest) {
  const dates: string[] = [];
  const current = new Date(Date.UTC(request.startDate.getUTCFullYear(), request.startDate.getUTCMonth(), request.startDate.getUTCDate()));
  const last = Date.UTC(request.endDate.getUTCFullYear(), request.endDate.getUTCMonth(), request.endDate.getUTCDate());
  while (current.getTime() <= last) {
    dates.push(formatDate(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function inclusiveDays(request: TripRequest) {
  return tripDates(request).length;
}

function callTaskKey(agentId: AgentId, revision: number) {
  return `${agentId}:task-${revision}`;
}

function boundedSummary(value: unknown) {
  if (Array.isArray(value)) return `${value.length} catalog records`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.totalEstimatedInr === "number") {
      return `Group estimate ₹${record.totalEstimatedInr.toLocaleString("en-IN")}`;
    }
    if (typeof record.totalDistanceKm === "number") {
      return `${record.totalDistanceKm} km straight-line estimate`;
    }
    if (Array.isArray(record.routes)) return `${record.routes.length} daily routes measured`;
  }
  return "Local tool completed";
}

function validateRequest(raw: unknown): TripRequest {
  const request = PlanTripBody.parse(raw);
  const destination = findDestination(request.destinationId);
  if (!destination) {
    throw new PlannerInputError("Choose one of the supported destinations.");
  }
  const numberOfDays = inclusiveDays(request);
  if (numberOfDays < 1 || numberOfDays > MAX_TRIP_DAYS) {
    throw new PlannerInputError(`Choose a trip lasting 1 to ${MAX_TRIP_DAYS} inclusive days.`);
  }
  if (request.endDate.getTime() < request.startDate.getTime()) {
    throw new PlannerInputError("The last day must be on or after the first day.");
  }
  return request;
}

function managerSystemInstruction() {
  return [
    "You are the Trip Manager in a five-agent travel-planning team.",
    "Return only valid JSON matching the supplied schema without markdown fences or outside text.",
    "Create one useful, bounded assignment for each of destination_agent, budget_agent, and weather_agent.",
    "Keep each assignment task under 200 characters.",
    "Always assign the required local tools: destination_agent must use places_search, place_details, route_distance; budget_agent must use budget_estimate; weather_agent must use seasonal_weather_estimate and indoor_alternatives.",
    "Do not invent data or claim bookings, live prices, road distances, or live weather.",
    "Respect dates, traveler count, destination, interests, pace, and group budget.",
  ].join(" ");
}

function destinationSystemInstruction() {
  return [
    "You are the Destination Agent. Select only place IDs in the supplied local catalogue.",
    "Return only valid JSON matching the schema without markdown fences or outside text. Include exactly one itinerary entry per requested date, in date order.",
    "Give each day one or two non-overlapping activities, with realistic times and a concise reason tied to the user's interests.",
    "Each day must contain distinct, unique places. Never select the same place more than once in the same day.",
    "Prefer places with matching interests and activity preferences; avoid unnecessary backtracking.",
    "On revision, address the cited critic issue while preserving unaffected days when possible.",
    "Do not claim availability, reservations, or current opening hours.",
  ].join(" ");
}

function budgetSystemInstruction() {
  return [
    "You are the Budget Agent. The provided cost figures are calculated by a local tool and are authoritative for this response.",
    "Return only valid JSON matching the schema without markdown fences or outside text. Do not change any numeric values, invent live prices, or imply the estimate is a quote.",
    "Keep the explanation to one short sentence under 200 characters. Mention the largest trade-off and, if over budget, recommend a lower-cost option.",
  ].join(" ");
}

function weatherSystemInstruction() {
  return [
    "You are the Weather Agent. The provided climate values come from a bundled typical-month dataset, not a live forecast.",
    "Return only valid JSON matching the schema without markdown fences or outside text. Use only activity place IDs from the supplied matching day.",
    "Return exactly one note for every date in climateEstimate, in the same order; copy each date exactly.",
    "Recommend practical clothing, timing, or the supplied indoor alternative when appropriate; never promise forecast conditions.",
  ].join(" ");
}

function criticSystemInstruction() {
  return [
    "You are the independent Critic Agent. Return only valid JSON matching the schema without markdown fences or outside text.",
    "Review the itinerary against the exact request, date coverage, tool-derived budget arithmetic, route distances, weather caveat, and agent recommendations.",
    "If the proposed draft itinerary has valid dates, reasonable budget allocations, and logical activities matching the destination, APPROVE the plan.",
    "Reject only when a severe, material issue is strictly supported by evidence in the supplied plan. Each rejection must name the responsible specialist and a concrete correction.",
    "Do not invent live availability, prices, weather, or unsupported factual claims.",
  ].join(" ");
}

function revisionManagerSystemInstruction() {
  return [
    "You are the Trip Manager routing a critic's rejection to one responsible specialist.",
    "Return only valid JSON matching the schema without markdown fences or outside text. Choose one cited issue and target the specialist named as responsible for it.",
    "Keep the correction specific and bounded; do not restart unrelated work.",
  ].join(" ");
}

function uniqueValues(values: string[]) {
  return [...new Set(values)];
}

function runTool(
  trace: RunTrace,
  agentId: AgentId,
  revision: number,
  name: LocalToolName,
  input: unknown,
  callsByTask: Map<string, number>,
) {
  const taskKey = callTaskKey(agentId, revision);
  const count = (callsByTask.get(taskKey) ?? 0) + 1;
  if (count > MAX_TOOLS_PER_TASK) {
    throw new PlannerOutputError(`${agentId} exceeded the ${MAX_TOOLS_PER_TASK}-tool task limit.`);
  }
  callsByTask.set(taskKey, count);
  trace.event({
    agentId,
    eventType: "tool_call",
    action: name,
    toolName: name,
    summary: `${agentId} called ${name}.`,
    status: "started",
  });
  try {
    const result = executeLocalTool(name, input);
    trace.event({
      agentId,
      eventType: "tool_result",
      action: name,
      toolName: name,
      summary: `${name}: ${boundedSummary(result)}.`,
      status: "completed",
    });
    return result;
  } catch (error) {
    trace.event({
      agentId,
      eventType: "tool_result",
      action: name,
      toolName: name,
      summary: `${name} rejected its arguments or could not find local data.`,
      status: "failed",
    });
    throw error;
  }
}

async function callAgent<T>(
  model: JsonModel,
  trace: RunTrace,
  agentId: AgentId,
  systemInstruction: string,
  prompt: string,
  schema: z.ZodType<T>,
  responseJsonSchema: ResponseJsonSchema,
): Promise<T> {
  return model.generateJson(
    trace.runId,
    agentId,
    systemInstruction,
    prompt,
    schema,
    responseJsonSchema,
    (event) => {
    trace.event({
      agentId,
      eventType: "model_call",
      action: `attempt_${event.attempt}`,
      summary: `${agentId} Groq model call ${event.status} (attempt ${event.attempt}).`,
      status: event.status,
    });
    },
  );
}

function checkManagerAssignments(plan: ManagerPlan) {
  const expected = ["destination_agent", "budget_agent", "weather_agent"];
  const actual = plan.assignments.map((assignment) => assignment.agentId).sort();
  if (expected.slice().sort().join(",") !== actual.join(",")) {
    throw new PlannerOutputError("The Trip Manager did not assign all required specialists.");
  }
}

function buildDayItinerary(
  dayDraft: DayDraft,
  dayNumber: number,
  detailsById: Map<string, Place>,
  distanceKm: number,
  allowedPlaceIds: Set<string>,
) {
  const seenPlaceIds = new Set<string>();
  const activities: Array<{
    placeId: string;
    name: string;
    category: string;
    startTime: string;
    durationMinutes: number;
    estimatedCostInr: number;
    setting: "indoor" | "outdoor" | "mixed";
    area: string;
    rationale: string;
  }> = [];

  for (const draft of dayDraft.activities) {
    if (!allowedPlaceIds.has(draft.placeId)) {
      throw new PlannerOutputError(`Destination Agent selected a place outside the supplied local catalogue.`);
    }
    let targetPlaceId = draft.placeId;
    if (seenPlaceIds.has(targetPlaceId)) {
      // Self-healing: if the model picked the same place twice for this day, pick an unused candidate
      const unusedPlaceId = Array.from(allowedPlaceIds).find((id) => !seenPlaceIds.has(id) && detailsById.has(id));
      if (unusedPlaceId) {
        targetPlaceId = unusedPlaceId;
      } else {
        // If no alternative candidate place is available, skip duplicate activity
        continue;
      }
    }
    seenPlaceIds.add(targetPlaceId);
    const place = detailsById.get(targetPlaceId);
    if (!place) throw new PlannerOutputError("A selected place is missing from the local place-details tool result.");
    activities.push({
      placeId: place.id,
      name: place.name,
      category: place.category,
      startTime: draft.startTime,
      durationMinutes: draft.durationMinutes,
      estimatedCostInr: place.estimatedCostInr,
      setting: place.setting,
      area: place.area,
      rationale: draft.rationale,
    });
  }

  return {
    dayNumber,
    date: new Date(`${dayDraft.date}T00:00:00.000Z`),
    theme: dayDraft.theme,
    activities,
    routeDistanceKm: distanceKm,
  };
}

async function generateItinerary(
  model: JsonModel,
  trace: RunTrace,
  request: TripRequest,
  candidates: Place[],
  currentItinerary: TripPlanResult["itinerary"] | null,
  revision: number,
  task: string,
  callsByTask: Map<string, number>,
): Promise<TripPlanResult["itinerary"]> {
  const dates = tripDates(request);
  const allowedPlaceIds = new Set(candidates.map((place) => place.id));
  const prompt = JSON.stringify(
    {
      task,
      tripRequest: {
        ...request,
        startDate: formatDate(request.startDate),
        endDate: formatDate(request.endDate),
        days: dates,
      },
      allowedPlaces: candidates.map((place) => ({
        id: place.id,
        name: place.name,
        category: place.category,
        area: place.area,
        setting: place.setting,
        costInr: place.estimatedCostInr,
      })),
      currentItinerary: currentItinerary?.map((day) => ({
        ...day,
        date: formatDate(day.date),
      })),
      requirement: `Return exactly ${dates.length} days, for these dates in order: ${dates.join(", ")}.`,
    },
    null,
    2,
  );
  const draft = await callAgent(
    model,
    trace,
    "destination_agent",
    destinationSystemInstruction(),
    prompt,
    ItineraryDraftSchema,
    ItineraryDraftJsonSchema,
  );
  if (draft.days.length !== dates.length || draft.days.some((day, index) => day.date !== dates[index])) {
    throw new PlannerOutputError("Destination Agent must return one correctly dated entry for every trip day.");
  }
  const selectedIds = draft.days.flatMap((day) => day.activities.map((activity) => activity.placeId));
  if (selectedIds.some((placeId) => !allowedPlaceIds.has(placeId))) {
    throw new PlannerOutputError("Destination Agent selected a place that was not returned by places_search.");
  }

  const details: Place[] = [];
  for (let offset = 0; offset < selectedIds.length; offset += 8) {
    const batch = selectedIds.slice(offset, offset + 8);
    const result = runTool(
      trace,
      "destination_agent",
      revision,
      "place_details",
      { placeIds: batch },
      callsByTask,
    ) as Place[];
    if (result.length !== batch.length) {
      throw new PlannerOutputError("place_details could not resolve every selected local place.");
    }
    details.push(...result);
  }
  const detailsById = new Map(details.map((place) => [place.id, place]));
  const routeResult = runTool(
    trace,
    "destination_agent",
    revision,
    "route_distance",
    { routes: draft.days.map((day) => day.activities.map((activity) => activity.placeId)) },
    callsByTask,
  ) as { routes: Array<{ distanceKm: number }> };
  if (routeResult.routes.length !== draft.days.length) {
    throw new PlannerOutputError("route_distance did not return a distance for every itinerary day.");
  }
  return draft.days.map((day, index) =>
    buildDayItinerary(day, index + 1, detailsById, routeResult.routes[index]!.distanceKm, allowedPlaceIds),
  );
}

function makeBudgetInput(request: TripRequest, itinerary: TripPlanResult["itinerary"]) {
  return {
    destinationId: request.destinationId,
    travelers: request.travelers,
    days: inclusiveDays(request),
    budgetInr: request.budgetInr,
    activityCostsPerPersonInr: itinerary.flatMap((day) =>
      day.activities.map((activity) => activity.estimatedCostInr),
    ),
  };
}

async function generateBudgetAssessment(
  model: JsonModel,
  trace: RunTrace,
  request: TripRequest,
  itinerary: TripPlanResult["itinerary"],
  revision: number,
  task: string,
  callsByTask: Map<string, number>,
) {
  const toolResult = runTool(
    trace,
    "budget_agent",
    revision,
    "budget_estimate",
    makeBudgetInput(request, itinerary),
    callsByTask,
  ) as BudgetToolResult;
  const notes = await callAgent(
    model,
    trace,
    "budget_agent",
    budgetSystemInstruction(),
    JSON.stringify(
      {
        task,
        request: { travelers: request.travelers, budgetInr: request.budgetInr, destinationId: request.destinationId },
        exactToolResult: toolResult,
        currency: "INR",
      },
      null,
      2,
    ),
    BudgetNotesSchema,
    BudgetNotesJsonSchema,
  );
  const { arithmeticVerified: _arithmeticVerified, ...assessment } = toolResult;
  return { ...assessment, explanation: notes.explanation };
}

async function generateWeatherAssessment(
  model: JsonModel,
  trace: RunTrace,
  request: TripRequest,
  itinerary: TripPlanResult["itinerary"],
  revision: number,
  task: string,
  indoorOptions: Place[],
  callsByTask: Map<string, number>,
) {
  const climate = runTool(
    trace,
    "weather_agent",
    revision,
    "seasonal_weather_estimate",
    { destinationId: request.destinationId, dates: tripDates(request) },
    callsByTask,
  ) as SeasonalWeatherDay[];
  const prompt = JSON.stringify(
    {
      task,
      climateEstimate: climate,
      indoorOptions: indoorOptions.map((place) => ({
        id: place.id,
        name: place.name,
        category: place.category,
        area: place.area,
      })),
      requiredDates: climate.map((day) => day.date),
      itinerary: itinerary.map((day) => ({
        date: formatDate(day.date),
        activities: day.activities.map((activity) => ({
          placeId: activity.placeId,
          name: activity.name,
          setting: activity.setting,
        })),
      })),
    },
    null,
    2,
  );
  const notes = await callAgent(
    model,
    trace,
    "weather_agent",
    weatherSystemInstruction(),
    prompt,
    WeatherNotesSchema,
    WeatherNotesJsonSchema,
  );

  // Best-effort JSON-schema responses can still omit a date or return days out
  // of order. Reconcile by date and fill gaps from the bundled climate/tool
  // data instead of failing an otherwise usable itinerary.
  const notesByDate = new Map(notes.days.map((note) => [note.date, note]));
  return climate.map((climateDay, index) => {
    const day = itinerary[index]!;
    const placeIdsForDay = new Set(day.activities.map((activity) => activity.placeId));
    const note = notesByDate.get(climateDay.date);
    const affectedPlaceIds = note
      ? note.affectedPlaceIds.filter((placeId) => placeIdsForDay.has(placeId)).slice(0, 2)
      : [];
    const placeNames = new Map(day.activities.map((activity) => [activity.placeId, activity.name]));
    const estimateCaveat = "Bundled typical-climate estimate; not a live forecast.";
    const fallbackRecommendation =
      climateDay.rainChancePercent >= 50
        ? `Typical seasonal rain chance is ${climateDay.rainChancePercent}%; keep outdoor plans flexible and carry rain protection. Check a current forecast before departure.`
        : `Typical temperatures range from ${climateDay.minTempC}°C to ${climateDay.maxTempC}°C. Check a current forecast and dress in comfortable layers.`;
    return {
      date: new Date(`${climateDay.date}T00:00:00.000Z`),
      summary: `${climateDay.summary}. ${estimateCaveat}`,
      minTempC: climateDay.minTempC,
      maxTempC: climateDay.maxTempC,
      rainChancePercent: climateDay.rainChancePercent,
      affectedActivities: uniqueValues(affectedPlaceIds.map((placeId) => placeNames.get(placeId)!)),
      recommendation: `${note?.recommendation ?? fallbackRecommendation} ${estimateCaveat}`,
    };
  });
}

async function generateBudgetAndWeatherAssessments(
  model: JsonModel,
  trace: RunTrace,
  request: TripRequest,
  itinerary: TripPlanResult["itinerary"],
  revision: number,
  budgetTask: string,
  weatherTask: string,
  indoorOptions: Place[],
  callsByTask: Map<string, number>,
) {
  const [budgetResult, weatherResult] = await Promise.allSettled([
    generateBudgetAssessment(model, trace, request, itinerary, revision, budgetTask, callsByTask),
    generateWeatherAssessment(model, trace, request, itinerary, revision, weatherTask, indoorOptions, callsByTask),
  ]);

  if (budgetResult.status === "rejected") throw budgetResult.reason;
  if (weatherResult.status === "rejected") throw weatherResult.reason;

  return {
    budgetAssessment: budgetResult.value,
    weatherAssessment: weatherResult.value,
  };
}

function deterministicIssues(result: {
  request: TripRequest;
  itinerary: TripPlanResult["itinerary"];
  budgetAssessment: TripPlanResult["budgetAssessment"];
  weatherAssessment: TripPlanResult["weatherAssessment"];
}): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const budget = result.budgetAssessment;
  if (budget.totalEstimatedInr !==
    budget.accommodationInr + budget.foodInr + budget.activitiesInr + budget.transportInr + budget.contingencyInr) {
    issues.push({
      id: "budget-arithmetic",
      severity: "high",
      responsibleAgent: "budget_agent",
      requestedAction: "Review the budget tool inputs and recalculate the estimate.",
      evidence: "The displayed budget components do not add up to the displayed total.",
    });
  }
  if (budget.totalEstimatedInr > result.request.budgetInr) {
    issues.push({
      id: "budget-overrun",
      severity: "high",
      responsibleAgent: "destination_agent",
      requestedAction: "Replace or remove activities with lower-cost catalogue options and ask the Budget Agent to recalculate.",
      evidence: `The estimate is ₹${budget.totalEstimatedInr.toLocaleString("en-IN")} for a ₹${result.request.budgetInr.toLocaleString("en-IN")} group budget.`,
    });
  }
  for (const [index, day] of result.itinerary.entries()) {
    if (day.routeDistanceKm > 50) {
      issues.push({
        id: `route-distance-day-${day.dayNumber}`,
        severity: "medium",
        responsibleAgent: "destination_agent",
        requestedAction: "Reorder this day's places or split distant stops across different days.",
        evidence: `The bundled coordinate estimate for day ${day.dayNumber} is ${day.routeDistanceKm} km straight-line.`,
      });
    }
    const forecast = result.weatherAssessment[index];
    const outdoorNames = day.activities
      .filter((activity) => activity.setting === "outdoor")
      .map((activity) => activity.name);
    if (forecast && forecast.rainChancePercent >= 60 && outdoorNames.length > 0) {
      const addressesRisk = /rain|indoor|wet|monsoon/i.test(forecast.recommendation);
      if (!addressesRisk) {
        issues.push({
          id: `weather-risk-day-${day.dayNumber}`,
          severity: "medium",
          responsibleAgent: "weather_agent",
          requestedAction: "Add a clear rain-aware timing recommendation or select an indoor alternative.",
          evidence: `${forecast.rainChancePercent}% typical monthly rain chance overlaps outdoor stops: ${outdoorNames.join(", ")}.`,
        });
      }
    }
  }
  return issues;
}

function mergeIssues(first: ReviewIssue[], second: ReviewIssue[]) {
  const byId = new Map<string, ReviewIssue>();
  for (const issue of [...first, ...second]) byId.set(issue.id, issue);
  return [...byId.values()].slice(0, 5);
}

async function reviewPlan(
  model: JsonModel,
  trace: RunTrace,
  request: TripRequest,
  itinerary: TripPlanResult["itinerary"],
  budgetAssessment: TripPlanResult["budgetAssessment"],
  weatherAssessment: TripPlanResult["weatherAssessment"],
  revision: number,
): Promise<CriticDecision> {
  const evidenceIssues = deterministicIssues({ request, itinerary, budgetAssessment, weatherAssessment });
  const decision = await callAgent(
    model,
    trace,
    "critic_agent",
    criticSystemInstruction(),
    JSON.stringify(
      {
        request: {
          ...request,
          startDate: formatDate(request.startDate),
          endDate: formatDate(request.endDate),
        },
        itinerary: itinerary.map((day) => ({
          ...day,
          date: formatDate(day.date),
        })),
        budgetAssessment,
        weatherAssessment: weatherAssessment.map((day) => ({
          ...day,
          date: formatDate(day.date),
        })),
        deterministicChecks: evidenceIssues,
        revision,
      },
      null,
      2,
    ),
    CriticDecisionSchema,
    CriticDecisionJsonSchema,
  );
  const issues = mergeIssues(evidenceIssues, decision.issues);
  const hasHardIssue = issues.some((issue) => issue.severity === "high");
  const rejected = hasHardIssue || decision.decision === "REJECTED";
  if (rejected && issues.length === 0) {
    throw new PlannerOutputError("Critic rejected the plan without providing a supported issue.");
  }
  return {
    decision: rejected ? "REJECTED" : "APPROVED",
    issues,
    approvalSummary: decision.approvalSummary,
  };
}

function makeManagerPlanPrompt(request: TripRequest, toolCatalog: ReturnType<typeof getToolCatalog>) {
  return JSON.stringify(
    {
      tripRequest: {
        ...request,
        startDate: formatDate(request.startDate),
        endDate: formatDate(request.endDate),
        inclusiveDays: inclusiveDays(request),
      },
      specialists: AGENTS.filter((agent) => agent.id !== "trip_manager" && agent.id !== "critic_agent"),
      availableTools: toolCatalog,
      requiredResponse: {
        summary: "Briefly summarize the overall planning approach.",
        assignments: [
          {
            agentId: "destination_agent",
            task: "Select local places and build one complete daily itinerary.",
            tools: ["places_search", "place_details", "route_distance"],
          },
          {
            agentId: "budget_agent",
            task: "Estimate the full-group budget and explain trade-offs.",
            tools: ["budget_estimate"],
          },
          {
            agentId: "weather_agent",
            task: "Estimate typical seasonal climate and identify weather alternatives.",
            tools: ["seasonal_weather_estimate", "indoor_alternatives"],
          },
        ],
      },
    },
    null,
    2,
  );
}

export class AdaptiveTripPlanner {
  readonly tripManager: TripManagerAgent;
  readonly destinationAgent: DestinationAgent;
  readonly budgetAgent: BudgetAgent;
  readonly weatherAgent: WeatherAgent;
  readonly criticAgent: CriticAgent;
  private readonly model: JsonModel;

  constructor(model: JsonModel = getActiveModel()) {
    this.model = model;
    this.tripManager = new TripManagerAgent(this.model);
    this.destinationAgent = new DestinationAgent(this.model);
    this.budgetAgent = new BudgetAgent(this.model);
    this.weatherAgent = new WeatherAgent(this.model);
    this.criticAgent = new CriticAgent(this.model);
  }

  async plan(rawRequest: unknown, requestedRunId?: string): Promise<TripPlanResult> {
    const request = validateRequest(rawRequest);
    const destination = findDestination(request.destinationId)!;
    const runId = requestedRunId ?? randomUUID();
    const trace = new RunTrace(runId);
    const callsByTask = new Map<string, number>();
    let managerActions = 0;

    const managerAction = (summary: string) => {
      managerActions += 1;
      if (managerActions > MAX_MANAGER_ACTIONS) {
        throw new PlannerOutputError(`Trip Manager exceeded its ${MAX_MANAGER_ACTIONS}-action run limit.`);
      }
      trace.event({
        agentId: "trip_manager",
        eventType: "manager_action",
        action: "orchestrate",
        summary,
      });
    };

    trace.event({
      agentId: "trip_manager",
      eventType: "run_started",
      action: "validate_request",
      summary: `Planning ${inclusiveDays(request)} days in ${destination.name} for ${request.travelers} traveler(s).`,
    });
    managerAction("Validated the request and opened a bounded specialist plan.");
    const managerPlan = await callAgent(
      this.model,
      trace,
      "trip_manager",
      managerSystemInstruction(),
      makeManagerPlanPrompt(request, getToolCatalog()),
      ManagerPlanSchema,
      ManagerPlanJsonSchema,
    );
    checkManagerAssignments(managerPlan);

    const assignments = new Map(managerPlan.assignments.map((assignment) => [assignment.agentId, assignment]));
    for (const assignment of managerPlan.assignments) {
      managerAction(`Delegated ${assignment.agentId}: ${assignment.task}`);
      trace.message({
        sender: "trip_manager",
        recipient: assignment.agentId,
        type: "task_assignment",
        task: assignment.task,
        result: `Tools allowed: ${assignment.tools.join(", ")}.`,
        status: "sent",
      });
    }

    const destinationAssignment = assignments.get("destination_agent")!;
    const budgetAssignment = assignments.get("budget_agent")!;
    const weatherAssignment = assignments.get("weather_agent")!;
    const interests = uniqueValues([...request.interests, ...request.activityPreferences]);
    const candidates = runTool(
      trace,
      "destination_agent",
      0,
      "places_search",
      { destinationId: request.destinationId, tags: interests, limit: 8 },
      callsByTask,
    ) as Place[];
    if (candidates.length === 0) throw new PlannerOutputError("The local catalogue has no places for the selected destination.");
    trace.message({
      sender: "destination_agent",
      recipient: "trip_manager",
      type: "tool_result",
      task: "Search the bundled place catalogue using trip interests.",
      result: `${candidates.length} local places are available to plan with.`,
      status: "completed",
    });

    for (const tool of destinationAssignment.tools) {
      if (tool !== "places_search" && tool !== "place_details" && tool !== "route_distance") {
        throw new PlannerOutputError("Destination Agent selected a tool outside its delegated scope.");
      }
    }
    for (const tool of budgetAssignment.tools) {
      if (tool !== "budget_estimate") throw new PlannerOutputError("Budget Agent selected an unsupported tool.");
    }
    for (const tool of weatherAssignment.tools) {
      if (tool !== "seasonal_weather_estimate" && tool !== "indoor_alternatives") {
        throw new PlannerOutputError("Weather Agent selected an unsupported tool.");
      }
    }

    let itinerary = await generateItinerary(
      this.model,
      trace,
      request,
      candidates,
      null,
      0,
      destinationAssignment.task,
      callsByTask,
    );
    trace.message({
      sender: "destination_agent",
      recipient: "trip_manager",
      type: "specialist_result",
      task: destinationAssignment.task,
      result: `Drafted ${itinerary.length} dated itinerary days using verified catalogue place IDs.`,
      status: "completed",
    });

    const indoorOptions = runTool(
      trace,
      "weather_agent",
      0,
      "indoor_alternatives",
      { destinationId: request.destinationId, limit: 6, avoidPlaceIds: itinerary.flatMap((day) => day.activities.map((activity) => activity.placeId)) },
      callsByTask,
    ) as Place[];
    const initialAssessments = await generateBudgetAndWeatherAssessments(
      this.model,
      trace,
      request,
      itinerary,
      0,
      budgetAssignment.task,
      weatherAssignment.task,
      indoorOptions,
      callsByTask,
    );
    let budgetAssessment = initialAssessments.budgetAssessment;
    let weatherAssessment = initialAssessments.weatherAssessment;
    trace.message({
      sender: "budget_agent",
      recipient: "trip_manager",
      type: "specialist_result",
      task: budgetAssignment.task,
      result: `Estimate: ₹${budgetAssessment.totalEstimatedInr.toLocaleString("en-IN")} group total; ${budgetAssessment.withinBudget ? "within" : "over"} the provided budget.`,
      status: "completed",
    });
    trace.message({
      sender: "weather_agent",
      recipient: "trip_manager",
      type: "specialist_result",
      task: weatherAssignment.task,
      result: "Returned a date-aligned, bundled typical-climate assessment and practical recommendations.",
      status: "completed",
    });

    const criticReports: TripPlanResult["criticReports"] = [];
    let revisionCount = 0;
    let criticReport = await reviewPlan(this.model, trace, request, itinerary, budgetAssessment, weatherAssessment, 0);
    criticReports.push(criticReport);
    trace.message({
      sender: "critic_agent",
      recipient: criticReport.decision === "APPROVED" ? "trip_manager" : "trip_manager",
      type: "critic_review",
      task: "Review dates, activity fit, cost arithmetic, seasonal risks, and route estimates.",
      result: `${criticReport.decision}: ${criticReport.approvalSummary}`,
      issueId: criticReport.issues[0]?.id ?? null,
      status: criticReport.decision === "APPROVED" ? "approved" : "rejected",
    });

    while (criticReport.decision === "REJECTED" && revisionCount < MAX_REVISIONS) {
      revisionCount += 1;
      trace.setRevision(revisionCount);
      const targetIssue = criticReport.issues.find((issue) => issue.severity === "high") ?? criticReport.issues[0]!;
      const revisionPlan = await callAgent(
        this.model,
        trace,
        "trip_manager",
        revisionManagerSystemInstruction(),
        JSON.stringify(
          {
            rejectedIssues: criticReport.issues,
            currentItinerary: itinerary.map((day) => ({ ...day, date: formatDate(day.date) })),
            currentBudget: budgetAssessment,
            requestedRevision: revisionCount,
            maxRevisions: MAX_REVISIONS,
            onePossibleTarget: targetIssue.responsibleAgent,
          },
          null,
          2,
        ),
        ManagerRevisionSchema,
        ManagerRevisionJsonSchema,
      );
      const revisionIssues = criticReport.issues.filter((issue) => revisionPlan.issueIds.includes(issue.id));
      if (
        revisionIssues.length === 0 ||
        revisionIssues.some((issue) => issue.responsibleAgent !== revisionPlan.targetAgentId)
      ) {
        throw new PlannerOutputError("Trip Manager routed a critic correction to an unrelated specialist.");
      }
      managerAction(`Revision ${revisionCount}: sent ${revisionPlan.issueIds.join(", ")} to ${revisionPlan.targetAgentId}.`);
      trace.message({
        sender: "critic_agent",
        recipient: "trip_manager",
        type: "revision_request",
        task: "Resolve the cited issue before approval.",
        result: `${revisionPlan.issueIds.join(", ")}: ${revisionPlan.task}`,
        issueId: revisionPlan.issueIds[0],
        status: "rejected",
      });
      trace.message({
        sender: "trip_manager",
        recipient: revisionPlan.targetAgentId,
        type: "targeted_revision",
        task: revisionPlan.task,
        result: `Address critic issue(s): ${revisionPlan.issueIds.join(", ")}.`,
        issueId: revisionPlan.issueIds[0],
        status: "sent",
      });

      if (revisionPlan.targetAgentId === "destination_agent") {
        itinerary = await generateItinerary(
          this.model,
          trace,
          request,
          candidates,
          itinerary,
          revisionCount,
          revisionPlan.task,
          callsByTask,
        );
        const revisedAssessments = await generateBudgetAndWeatherAssessments(
          this.model,
          trace,
          request,
          itinerary,
          revisionCount,
          `Recalculate after destination changes requested by the Critic: ${revisionPlan.task}`,
          `Reassess the revised activities against the seasonal estimate: ${revisionPlan.task}`,
          indoorOptions,
          callsByTask,
        );
        budgetAssessment = revisedAssessments.budgetAssessment;
        weatherAssessment = revisedAssessments.weatherAssessment;
      } else if (revisionPlan.targetAgentId === "budget_agent") {
        budgetAssessment = await generateBudgetAssessment(
          this.model,
          trace,
          request,
          itinerary,
          revisionCount,
          revisionPlan.task,
          callsByTask,
        );
      } else {
        weatherAssessment = await generateWeatherAssessment(
          this.model,
          trace,
          request,
          itinerary,
          revisionCount,
          revisionPlan.task,
          indoorOptions,
          callsByTask,
        );
      }
      trace.message({
        sender: revisionPlan.targetAgentId,
        recipient: "trip_manager",
        type: "revision_result",
        task: revisionPlan.task,
        result: `Completed the targeted revision for ${revisionPlan.issueIds.join(", ")}.`,
        issueId: revisionPlan.issueIds[0],
        status: "completed",
      });
      criticReport = await reviewPlan(this.model, trace, request, itinerary, budgetAssessment, weatherAssessment, revisionCount);
      criticReports.push(criticReport);
      trace.message({
        sender: "critic_agent",
        recipient: "trip_manager",
        type: "critic_review",
        task: `Review revision ${revisionCount} against the original constraints.`,
        result: `${criticReport.decision}: ${criticReport.approvalSummary}`,
        issueId: criticReport.issues[0]?.id ?? null,
        status: criticReport.decision === "APPROVED" ? "approved" : "rejected",
      });
    }

    const modelInfo = getActiveModelInfo();
    const modelName = typeof (this.model as unknown as { getModel?: () => string }).getModel === "function"
      ? (this.model as unknown as { getModel: () => string }).getModel()
      : modelInfo.model;
    const mode = "groq_api" as const;

    const result = {
      runId,
      status: criticReport.decision === "APPROVED" ? "approved" : "needs_attention",
      mode,
      model: modelName,
      request,
      itinerary,
      budgetAssessment,
      weatherAssessment,
      criticReports,
      messages: trace.messages,
      executionTrace: trace.events,
      agentsUsed: AGENTS.map((agent) => agent.id),
      revisionCount,
    };
    trace.event({
      agentId: "trip_manager",
      eventType: "run_completed",
      action: criticReport.decision === "APPROVED" ? "approved" : "needs_attention",
      summary: `Planning finished with ${criticReport.decision.toLowerCase()} after ${revisionCount} revision(s).`,
      status: "completed",
    });
    const validated = GetPlanningRunResponse.parse({
      runId,
      status: "completed",
      result: {
        ...result,
        executionTrace: trace.events,
        messages: trace.messages,
      },
      error: null,
    }).result;
    if (!validated) throw new PlannerOutputError("The completed planning result could not be validated.");
    return validated;
  }
}

export const adaptiveTripPlanner = new AdaptiveTripPlanner();

