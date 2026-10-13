import type { TripPlanResult } from "./types";

export type PlanningRunFailure = {
  statusCode: number;
  code: string;
  error: string;
  setupInstruction: string | null;
};

export type PlanningRunState = "queued" | "running" | "completed" | "failed";

export type PlanningRunSnapshot = {
  runId: string;
  status: PlanningRunState;
  result: TripPlanResult | null;
  error: PlanningRunFailure | null;
};

type PlanningRunRecord = PlanningRunSnapshot & {
  updatedAt: number;
};

const MAX_RUNS = 250;
const RUN_TTL_MS = 24 * 60 * 60 * 1000;
const runs = new Map<string, PlanningRunRecord>();

function isTerminal(run: PlanningRunRecord) {
  return run.status === "completed" || run.status === "failed";
}

function pruneRuns(now: number) {
  for (const [runId, run] of runs) {
    if (now - run.updatedAt > RUN_TTL_MS) runs.delete(runId);
  }
}

export class RunStoreCapacityError extends Error {
  constructor() {
    super("The planning service is at capacity. Please retry shortly.");
    this.name = "RunStoreCapacityError";
  }
}

export function createPlanningRun(runId: string) {
  pruneRuns(Date.now());
  if (runs.size >= MAX_RUNS) {
    const oldestFinished = [...runs.entries()]
      .filter(([, run]) => isTerminal(run))
      .sort(([, a], [, b]) => a.updatedAt - b.updatedAt)[0];
    if (oldestFinished) runs.delete(oldestFinished[0]);
  }
  if (runs.size >= MAX_RUNS) throw new RunStoreCapacityError();

  runs.set(runId, {
    runId,
    status: "queued",
    result: null,
    error: null,
    updatedAt: Date.now(),
  });
}

function updateRun(runId: string, update: (run: PlanningRunRecord) => void) {
  const run = runs.get(runId);
  if (!run) return;
  update(run);
  run.updatedAt = Date.now();
}

export function markPlanningRunStarted(runId: string) {
  updateRun(runId, (run) => {
    if (run.status === "queued") run.status = "running";
  });
}

export function completePlanningRun(runId: string, result: TripPlanResult) {
  updateRun(runId, (run) => {
    run.status = "completed";
    run.result = result;
    run.error = null;
  });
}

export function failPlanningRun(runId: string, error: PlanningRunFailure) {
  updateRun(runId, (run) => {
    run.status = "failed";
    run.result = null;
    run.error = error;
  });
}

export function getPlanningRun(runId: string): PlanningRunSnapshot | undefined {
  pruneRuns(Date.now());
  const run = runs.get(runId);
  if (!run) return undefined;
  return {
    runId: run.runId,
    status: run.status,
    result: run.result,
    error: run.error,
  };
}
