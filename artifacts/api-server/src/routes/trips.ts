import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import {
  GetAgentsResponse,
  GetDestinationsResponse,
  GetDemoScenariosResponse,
  GetPlanningRunResponse,
  GetRunTraceParams,
  GetRunTraceResponse,
  PlanTripBody,
  PlanTripResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { getRunTrace, storeRunTrace } from "../lib/trace-store";
import { GroqNotConfiguredError, GroqRequestError } from "../trips/groq";
import { AGENTS, DEMO_SCENARIOS, DESTINATIONS } from "../trips/data";
import { adaptiveTripPlanner, PlannerInputError, PlannerOutputError } from "../trips/orchestrator";
import { createOfflineTripPlan } from "../trips/offline-planner";
import {
  completePlanningRun,
  createPlanningRun,
  failPlanningRun,
  getPlanningRun,
  markPlanningRunStarted,
  RunStoreCapacityError,
  type PlanningRunFailure,
} from "../trips/run-store";

const router: IRouter = Router();

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  setupInstruction: string | null = null,
) {
  res.status(status).json({ code, error: message, setupInstruction });
}

function serializeTripPlan(result: Awaited<ReturnType<typeof adaptiveTripPlanner.plan>>) {
  return {
    ...result,
    request: {
      ...result.request,
      startDate: dateOnly(result.request.startDate),
      endDate: dateOnly(result.request.endDate),
    },
    itinerary: result.itinerary.map((day) => ({ ...day, date: dateOnly(day.date) })),
    weatherAssessment: result.weatherAssessment.map((day) => ({ ...day, date: dateOnly(day.date) })),
  };
}

function categorizePlanningError(error: unknown): PlanningRunFailure {
  if (error instanceof PlannerInputError) {
    return {
      statusCode: 400,
      code: "INVALID_TRIP_REQUEST",
      error: error.message,
      setupInstruction: null,
    };
  }
  if (error instanceof GroqNotConfiguredError) {
    return {
      statusCode: 503,
      code: "GROQ_NOT_CONFIGURED",
      error: "Trip planning needs a Groq API key configured on the server.",
      setupInstruction: "Add GROQ_API_KEY in your .env or environment variables, then restart the API Server.",
    };
  }
  if (error instanceof GroqRequestError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      error: error.message,
      setupInstruction: null,
    };
  }
  if (error instanceof PlannerOutputError) {
    return {
      statusCode: 502,
      code: "PLANNING_VALIDATION_FAILED",
      error: error.message,
      setupInstruction: null,
    };
  }
  return {
    statusCode: 500,
    code: "INTERNAL_ERROR",
    error: "Trip planning could not complete. Retry the request.",
    setupInstruction: null,
  };
}

export function offlineFallbackCode(error: unknown) {
  if (error instanceof GroqNotConfiguredError) return "GROQ_NOT_CONFIGURED";
  if (error instanceof GroqRequestError) {
    return [
      "GROQ_QUOTA_EXHAUSTED",
      "GROQ_RATE_LIMITED",
      "GROQ_TEMPORARILY_UNAVAILABLE",
      "GROQ_TIMEOUT",
      "GROQ_NETWORK_ERROR",
      "GROQ_REQUEST_REJECTED",
      "GROQ_INVALID_RESPONSE",
      "GROQ_PROVIDER_REJECTED",
      "GROQ_MODEL_UNAVAILABLE",
      "GROQ_REQUEST_FAILED",
    ].includes(error.code)
      ? error.code
      : null;
  }
  return null;
}

async function executePlanningRun(runId: string, request: unknown) {
  markPlanningRunStarted(runId);
  try {
    const result = await adaptiveTripPlanner.plan(request, runId);
    storeRunTrace(result);
    completePlanningRun(runId, result);
  } catch (error) {
    const fallbackCode = offlineFallbackCode(error);
    if (fallbackCode) {
      try {
        const result = createOfflineTripPlan(request, runId, fallbackCode);
        storeRunTrace(result);
        completePlanningRun(runId, result);
        logger.warn({ runId, fallbackCode }, "Completed trip planning with bundled offline fallback");
        return;
      } catch (fallbackError) {
        logger.error(
          {
            runId,
            fallbackCode,
            fallbackErrorType: fallbackError instanceof Error ? fallbackError.name : "unknown",
          },
          "Bundled offline fallback could not complete",
        );
      }
    }
    const failure = categorizePlanningError(error);
    if (failure.statusCode >= 500) {
      logger.error(
        { runId, code: failure.code, errorType: error instanceof Error ? error.name : "unknown", errorMessage: error instanceof Error ? error.message : "unknown" },
        "Trip planning run failed",
      );
    } else {
      logger.warn({ runId, code: failure.code, errorMessage: error instanceof Error ? error.message : "unknown" }, "Trip planning run was rejected");
    }
    failPlanningRun(runId, failure);
  }
}

router.get("/agents", (_req, res) => {
  res.json(GetAgentsResponse.parse(AGENTS));
});

router.get("/destinations", (_req, res) => {
  res.json(GetDestinationsResponse.parse(DESTINATIONS));
});

router.get("/demo", (_req, res) => {
  const scenarios = GetDemoScenariosResponse.parse(DEMO_SCENARIOS);
  res.json(
    scenarios.map((scenario) => ({
      ...scenario,
      request: {
        ...scenario.request,
        startDate: dateOnly(scenario.request.startDate),
        endDate: dateOnly(scenario.request.endDate),
      },
    })),
  );
});

router.post("/plan-trip", async (req, res): Promise<void> => {
  const parsed = PlanTripBody.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, "INVALID_TRIP_REQUEST", "Check the destination, inclusive dates, group size, budget and preferences.");
    return;
  }
  const runId = randomUUID();
  try {
    createPlanningRun(runId);
  } catch (error) {
    if (error instanceof RunStoreCapacityError) {
      sendError(res, 503, "PLANNING_CAPACITY_REACHED", error.message);
      return;
    }
    req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Could not queue trip planning run");
    sendError(res, 500, "INTERNAL_ERROR", "Trip planning could not be queued. Retry the request.");
    return;
  }
  if (process.env.VERCEL) {
    await executePlanningRun(runId, parsed.data);
    res.status(202).json(PlanTripResponse.parse({ runId, status: "queued" }));
    return;
  }
  res.status(202).json(PlanTripResponse.parse({ runId, status: "queued" }));
  setImmediate(() => {
    void executePlanningRun(runId, parsed.data);
  });
});

router.get("/runs/:runId", (req, res) => {
  const parsed = GetRunTraceParams.safeParse(req.params);
  if (!parsed.success) {
    sendError(res, 400, "INVALID_RUN_ID", "A valid run ID is required.");
    return;
  }
  const run = getPlanningRun(parsed.data.runId);
  if (!run) {
    sendError(res, 404, "RUN_NOT_FOUND", "This planning run is unavailable or expired. Start a new run.");
    return;
  }
  const validated = GetPlanningRunResponse.parse(run);
  res.json({
    ...validated,
    result: validated.result ? serializeTripPlan(validated.result) : null,
  });
});

router.get("/runs/:runId/trace", (req, res) => {
  const parsed = GetRunTraceParams.safeParse(req.params);
  if (!parsed.success) {
    sendError(res, 400, "INVALID_RUN_ID", "A valid run ID is required.");
    return;
  }
  let result = getRunTrace(parsed.data.runId);
  if (!result) {
    const run = getPlanningRun(parsed.data.runId);
    if (run?.result) {
      result = {
        runId: run.result.runId,
        mode: run.result.mode,
        events: run.result.executionTrace,
        messages: run.result.messages,
      };
    }
  }
  if (!result) {
    sendError(res, 404, "TRACE_NOT_FOUND", "This trace is unavailable or expired. Traces are cleared when the API restarts.");
    return;
  }
  res.json(GetRunTraceResponse.parse(result));
});

export default router;
