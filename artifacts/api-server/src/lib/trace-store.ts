import type { PlannerMode, TripPlanResult } from "../trips/types";

interface StoredTrace {
  savedAt: number;
  value: {
    runId: string;
    mode: PlannerMode;
    events: TripPlanResult["executionTrace"];
    messages: TripPlanResult["messages"];
  };
}

const MAX_TRACES = 250;
const TRACE_TTL_MS = 24 * 60 * 60 * 1000;
const traces = new Map<string, StoredTrace>();

export function storeRunTrace(result: TripPlanResult) {
  const now = Date.now();
  for (const [runId, item] of traces) {
    if (now - item.savedAt > TRACE_TTL_MS) traces.delete(runId);
  }
  traces.delete(result.runId);
  traces.set(result.runId, {
    savedAt: now,
    value: {
      runId: result.runId,
      mode: result.mode,
      events: result.executionTrace,
      messages: result.messages,
    },
  });
  while (traces.size > MAX_TRACES) {
    const oldest = traces.keys().next().value;
    if (oldest) traces.delete(oldest);
    else break;
  }
}

export function getRunTrace(runId: string) {
  const entry = traces.get(runId);
  if (!entry) return undefined;
  if (Date.now() - entry.savedAt > TRACE_TTL_MS) {
    traces.delete(runId);
    return undefined;
  }
  traces.delete(runId);
  traces.set(runId, entry);
  return entry.value;
}
