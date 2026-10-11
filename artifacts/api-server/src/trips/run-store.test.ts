import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createPlanningRun,
  failPlanningRun,
  getPlanningRun,
  markPlanningRunStarted,
} from "./run-store";

describe("planning run store", () => {
  it("keeps a run pollable and exposes categorized failures", () => {
    const runId = randomUUID();
    createPlanningRun(runId);
    expect(getPlanningRun(runId)).toMatchObject({ runId, status: "queued", result: null, error: null });

    markPlanningRunStarted(runId);
    expect(getPlanningRun(runId)?.status).toBe("running");

    failPlanningRun(runId, {
      statusCode: 502,
      code: "GROQ_REQUEST_FAILED",
      error: "Groq could not return a valid structured response. Please retry.",
      setupInstruction: null,
    });
    expect(getPlanningRun(runId)).toMatchObject({
      runId,
      status: "failed",
      error: { statusCode: 502, code: "GROQ_REQUEST_FAILED" },
    });
  });
});
