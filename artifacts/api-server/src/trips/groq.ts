import { z } from "zod";
import { logger } from "../lib/logger";
import type { AgentId, JsonModel, ModelCallEvent } from "./types";

export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";
const STRICT_JSON_SCHEMA_MODELS = new Set([
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
]);
const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_RATE_LIMIT_RETRY_WAIT_MS = 12_000;
const MAX_PROVIDER_COOLDOWN_MS = 60_000;
const DEFAULT_RATE_LIMIT_RETRY_WAIT_MS = 1_200;
const MAX_COMPLETION_TOKENS = 4_096;

export class GroqNotConfiguredError extends Error {
  constructor() {
    super("Groq is not configured. Add GROQ_API_KEY to Replit Secrets.");
    this.name = "GroqNotConfiguredError";
  }
}

export class GroqRequestError extends Error {
  constructor(
    message = "Groq could not return a valid structured response. Please retry.",
    readonly statusCode = 502,
    readonly code = "GROQ_REQUEST_FAILED",
  ) {
    super(message);
    this.name = "GroqRequestError";
  }
}

class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs?: number,
    readonly quotaExhausted = false,
  ) {
    super(`Groq returned HTTP ${status}.`);
    this.name = "ProviderHttpError";
  }
}

class ConcurrencyGate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

// Serialize provider calls so parallel planner agents don't burst through
// per-minute request or token limits at the same time.
const requestGate = new ConcurrencyGate(1);
const callsByRun = new Map<string, Map<AgentId, number>>();

function readJson(text: string) {
  const trimmed = text.trim();
  const withoutFence = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
  return JSON.parse(withoutFence) as unknown;
}

function nextCall(runId: string, agentId: AgentId) {
  let callsByAgent = callsByRun.get(runId);
  if (!callsByAgent) {
    callsByAgent = new Map();
    callsByRun.set(runId, callsByAgent);
  }
  const count = (callsByAgent.get(agentId) ?? 0) + 1;
  if (count > 8) {
    throw new GroqRequestError(`The ${agentId} call limit for this run was reached.`);
  }
  callsByAgent.set(agentId, count);
  if (callsByRun.size > 500) {
    const oldestRunId = callsByRun.keys().next().value;
    if (oldestRunId && oldestRunId !== runId) callsByRun.delete(oldestRunId);
  }
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseDurationMs(value: string | null | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  const numericSeconds = Number(trimmed);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) {
    return numericSeconds * 1_000;
  }
  const absoluteDate = Date.parse(trimmed);
  if (Number.isFinite(absoluteDate)) {
    return Math.max(0, absoluteDate - Date.now());
  }
  const parts = [...trimmed.matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|m|h)/gi)];
  if (parts.length === 0) return undefined;
  return parts.reduce((total, part) => {
    const amount = Number(part[1]);
    const unit = part[2]?.toLowerCase();
    const multiplier = unit === "ms" ? 1 : unit === "s" ? 1_000 : unit === "m" ? 60_000 : 3_600_000;
    return total + amount * multiplier;
  }, 0);
}

function providerErrorInfo(body: string) {
  try {
    const payload: unknown = JSON.parse(body);
    if (!payload || typeof payload !== "object" || !("error" in payload)) return {};
    const error = payload.error;
    if (!error || typeof error !== "object") return {};
    const code = "code" in error && typeof error.code === "string" ? error.code : "";
    const message = "message" in error && typeof error.message === "string" ? error.message : "";
    return {
      quotaExhausted: /insufficient[_ -]quota|billing|credit|quota exhausted/i.test(`${code} ${message}`),
      bodyRetryAfterMs: parseDurationMs(message.match(/try again in\s+([\d.]+\s*(?:ms|s|m|h))/i)?.[1]),
    };
  } catch {
    return {};
  }
}

function responseRetryAfterMs(headers: Headers, bodyRetryAfterMs?: number) {
  const explicit = parseDurationMs(headers.get("retry-after"));
  if (explicit !== undefined) return explicit;
  const resetValues = [
    parseDurationMs(headers.get("x-ratelimit-reset-requests")),
    parseDurationMs(headers.get("x-ratelimit-reset-tokens")),
  ].filter((value): value is number => value !== undefined);
  if (resetValues.length > 0) return Math.max(...resetValues);
  return bodyRetryAfterMs;
}

function providerStatus(error: unknown) {
  return error && typeof error === "object" && "status" in error && typeof error.status === "number"
    ? error.status
    : undefined;
}

function providerRetryAfterMs(error: unknown) {
  return error instanceof ProviderHttpError ? error.retryAfterMs : undefined;
}

function providerQuotaExhausted(error: unknown) {
  return error instanceof ProviderHttpError && error.quotaExhausted;
}

function isRetryableFailure(error: unknown) {
  if (providerQuotaExhausted(error)) return false;
  const status = providerStatus(error);
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

function retryLimit(error: unknown) {
  const status = providerStatus(error);
  if (status === 429) return 2;
  return status === 408 || (status !== undefined && status >= 500) ? 3 : 2;
}

function retryDelayMs(attempt: number, error: unknown) {
  const status = providerStatus(error);
  if (status === 429) {
    return providerRetryAfterMs(error) ?? DEFAULT_RATE_LIMIT_RETRY_WAIT_MS;
  }
  if (status === 408 || (status !== undefined && status >= 500)) {
    return Math.min(750 * 2 ** attempt, 3_000);
  }
  return 350;
}

function failureDetails(error: unknown) {
  if (error instanceof z.ZodError) {
    return {
      failureKind: "schema_validation",
      validationIssues: error.issues.slice(0, 8).map((issue) => ({
        path: issue.path.join("."),
        code: issue.code,
      })),
    };
  }
  if (error instanceof SyntaxError) {
    return { failureKind: "invalid_json" };
  }
  if (error instanceof Error && error.message === "empty response") {
    return { failureKind: "empty_response" };
  }
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return { failureKind: "timeout" };
  }
  const status = providerStatus(error);
  return {
    failureKind: status === undefined ? "network_or_provider_error" : "provider_error",
    errorType: error instanceof Error ? error.name : "unknown",
    ...(status === undefined ? {} : { providerStatus: status }),
    ...(providerRetryAfterMs(error) === undefined
      ? {}
      : { retryAfterMs: providerRetryAfterMs(error) }),
    ...(providerQuotaExhausted(error) ? { quotaExhausted: true } : {}),
  };
}

function isTimeout(error: unknown) {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export class GroqJsonModel implements JsonModel {
  private readonly model = process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL;
  private providerCooldownUntil = 0;

  async generateJson<T>(
    runId: string,
    agentId: AgentId,
    systemInstruction: string,
    prompt: string,
    schema: z.ZodType<T>,
    responseJsonSchema: Record<string, unknown>,
    onCallEvent?: (event: ModelCallEvent) => void,
  ): Promise<T> {
    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) throw new GroqNotConfiguredError();

    nextCall(runId, agentId);
    let lastFailure: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const parsed = await requestGate.run(async () => {
          const remainingCooldownMs = this.providerCooldownUntil - Date.now();
          if (remainingCooldownMs > 0) await wait(remainingCooldownMs);
          onCallEvent?.({ attempt: attempt + 1, status: "started" });
          const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: this.model,
              messages: [
                { role: "system", content: systemInstruction },
                { role: "user", content: prompt },
              ],
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: agentId,
                  strict: STRICT_JSON_SCHEMA_MODELS.has(this.model),
                  schema: responseJsonSchema,
                },
              },
              temperature: 0.2,
              max_completion_tokens: MAX_COMPLETION_TOKENS,
            }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
          if (!response.ok) {
            const responseBody = await response.text();
            const errorInfo = providerErrorInfo(responseBody);
            const retryAfterMs = responseRetryAfterMs(response.headers, errorInfo.bodyRetryAfterMs);
            if (response.status === 429 && !errorInfo.quotaExhausted && retryAfterMs && retryAfterMs > 0) {
              this.providerCooldownUntil = Math.max(
                this.providerCooldownUntil,
                Date.now() + Math.min(retryAfterMs, MAX_PROVIDER_COOLDOWN_MS),
              );
            }
            throw new ProviderHttpError(response.status, retryAfterMs, errorInfo.quotaExhausted);
          }

          const payload: unknown = await response.json();
          const envelope = z.object({
            choices: z.array(z.object({
              message: z.object({
                content: z.string().nullable().optional(),
              }),
            })).min(1),
          }).parse(payload);
          const text = envelope.choices[0]?.message.content;
          if (!text) throw new Error("empty response");
          const validated = schema.parse(readJson(text));
          onCallEvent?.({ attempt: attempt + 1, status: "completed" });
          return validated;
        });
        logger.info({ runId, agentId, model: this.model, attempt: attempt + 1 }, "Groq agent response validated");
        return parsed;
      } catch (error) {
        onCallEvent?.({ attempt: attempt + 1, status: "failed" });
        lastFailure = error;
        const delayMs = retryDelayMs(attempt, error);
        const rateLimitWaitIsShortEnough =
          providerStatus(error) !== 429 ||
          delayMs <= MAX_RATE_LIMIT_RETRY_WAIT_MS;
        if (
          attempt + 1 < retryLimit(error) &&
          isRetryableFailure(error) &&
          rateLimitWaitIsShortEnough
        ) {
          logger.warn(
            {
              runId,
              agentId,
              model: this.model,
              attempt: attempt + 1,
              nextAttempt: attempt + 2,
              retryDelayMs: delayMs,
              ...failureDetails(error),
            },
            "Groq response failed; retrying",
          );
          await wait(delayMs);
          continue;
        }
        break;
      }
    }

    logger.error({ runId, agentId, model: this.model, ...failureDetails(lastFailure) }, "Groq request failed");
    if (lastFailure instanceof GroqNotConfiguredError) throw lastFailure;
    const status = providerStatus(lastFailure);
    if (status === 401 || status === 403) {
      throw new GroqRequestError(
        "Groq rejected the API key or its access. Replace GROQ_API_KEY with a valid key in Replit Secrets.",
        502,
        "GROQ_AUTH_FAILED",
      );
    }
    if (status === 404) {
      throw new GroqRequestError(
        `Groq model "${this.model}" is unavailable to this API key. Set GROQ_MODEL to an active model enabled for this account.`,
        502,
        "GROQ_MODEL_UNAVAILABLE",
      );
    }
    if (status === 429) {
      if (providerQuotaExhausted(lastFailure)) {
        throw new GroqRequestError(
          "Groq reports that this account has exhausted its available quota or credits. Check the account billing and model limits before retrying.",
          503,
          "GROQ_QUOTA_EXHAUSTED",
        );
      }
      const retryAfterMs = providerRetryAfterMs(lastFailure);
      const waitInstruction = retryAfterMs && retryAfterMs > MAX_RATE_LIMIT_RETRY_WAIT_MS
        ? ` Wait about ${Math.ceil(retryAfterMs / 1_000)} seconds before trying again.`
        : " Wait briefly before trying again.";
      throw new GroqRequestError(
        `Groq is rate-limiting requests.${waitInstruction} If the limit persists, review the model's request and token limits.`,
        503,
        "GROQ_RATE_LIMITED",
      );
    }
    if (status === 408 || (status !== undefined && status >= 500)) {
      throw new GroqRequestError(
        "Groq is temporarily unavailable. The trip was not completed; please try again shortly.",
        503,
        "GROQ_TEMPORARILY_UNAVAILABLE",
      );
    }
    if (lastFailure instanceof z.ZodError || lastFailure instanceof SyntaxError ||
        (lastFailure instanceof Error && lastFailure.message === "empty response")) {
      throw new GroqRequestError(
        "Groq returned a response that did not match the required trip format. Please try again.",
        502,
        "GROQ_INVALID_RESPONSE",
      );
    }
    if (status === 400) {
      throw new GroqRequestError(
        "Groq rejected the structured-output request. Check that GROQ_MODEL supports JSON-schema outputs.",
        502,
        "GROQ_REQUEST_REJECTED",
      );
    }
    if (status !== undefined && status >= 400 && status < 500) {
      throw new GroqRequestError(
        "Groq rejected the request. Check the selected model and API key permissions.",
        502,
        "GROQ_PROVIDER_REJECTED",
      );
    }
    if (isTimeout(lastFailure)) {
      throw new GroqRequestError(
        "The request to Groq timed out. Please retry the trip plan.",
        504,
        "GROQ_TIMEOUT",
      );
    }
    if (lastFailure instanceof TypeError) {
      throw new GroqRequestError(
        "The API server could not reach Groq. Check network access and retry.",
        503,
        "GROQ_NETWORK_ERROR",
      );
    }
    throw new GroqRequestError();
  }

  getModel() {
    return this.model;
  }
}

export const groqModel = new GroqJsonModel();
