import { z } from "zod";
import { logger } from "../lib/logger";
import type { AgentId, JsonModel, ModelCallEvent } from "./types";

export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
export const GROQ_FALLBACK_MODELS = [
  "openai/gpt-oss-120b",
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-20b",
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
];
const STRICT_JSON_SCHEMA_MODELS = new Set([
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "qwen/qwen3.8-27b",
]);
const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_RATE_LIMIT_RETRY_WAIT_MS = 45_000;
const MAX_PROVIDER_COOLDOWN_MS = 60_000;
const DEFAULT_RATE_LIMIT_RETRY_WAIT_MS = 1_200;
const MAX_COMPLETION_TOKENS = 4_096;

export class GroqNotConfiguredError extends Error {
  constructor() {
    super("Groq is not configured. Add GROQ_API_KEY in your .env or environment variables.");
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
    readonly isJsonValidateFailed = false,
    readonly providerCode?: string,
    readonly providerMessage?: string,
  ) {
    super(`Groq returned HTTP ${status}${providerCode ? ` (${providerCode})` : ""}.`);
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

export function getAvailableApiKeys(): string[] {
  const keys: string[] = [];
  const raw = process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "";
  if (raw) {
    keys.push(...raw.split(",").map((k) => k.trim()).filter((k) => k.length > 0));
  }
  for (const [keyName, value] of Object.entries(process.env)) {
    if (!value || typeof value !== "string") continue;
    if (keyName === "GROQ_API_KEY" || keyName === "GROQ_API_KEYS") continue;
    const trimmed = value.trim();
    if (trimmed.startsWith("gsk_")) {
      for (const piece of trimmed.split(",")) {
        const cleanPiece = piece.trim();
        if (cleanPiece.startsWith("gsk_") && !keys.includes(cleanPiece)) {
          keys.push(cleanPiece);
        }
      }
    }
  }
  return keys;
}

function readJson(text: string) {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const firstBracket = cleaned.indexOf("[");
    let startIdx = -1;
    let endIdx = -1;
    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      startIdx = firstBrace;
      endIdx = cleaned.lastIndexOf("}");
    } else if (firstBracket !== -1) {
      startIdx = firstBracket;
      endIdx = cleaned.lastIndexOf("]");
    }
    if (startIdx !== -1 && endIdx > startIdx) {
      const extracted = cleaned.slice(startIdx, endIdx + 1);
      try {
        return JSON.parse(extracted) as unknown;
      } catch {
        const sanitized = extracted.replace(/,\s*([}\]])/g, "$1");
        return JSON.parse(sanitized) as unknown;
      }
    }
    throw new SyntaxError("Failed to parse JSON from model output");
  }
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
    const isProviderRateLimitCode = /rate[_ -]?limit[_ -]?exceeded|too[_ -]?many[_ -]?requests/i.test(code);
    return {
      code,
      message,
      isJsonValidateFailed: code === "json_validate_failed",
      quotaExhausted:
        !isProviderRateLimitCode &&
        /insufficient[_ -]quota|billing|credits? (?:balance )?(?:exhausted|depleted)|quota exhausted/i.test(
          `${code} ${message}`,
        ),
      bodyRetryAfterMs: parseDurationMs(message.match(/try again in\s+([\d.]+\s*(?:ms|s|m|h))/i)?.[1]),
    };
  } catch {
    return {};
  }
}

function responseRetryAfterMs(headers: Headers, bodyRetryAfterMs?: number) {
  if (bodyRetryAfterMs !== undefined && bodyRetryAfterMs > 0) return bodyRetryAfterMs;
  const explicit = parseDurationMs(headers.get("retry-after"));
  if (explicit !== undefined && explicit > 0) return explicit;
  const tokenReset = parseDurationMs(headers.get("x-ratelimit-reset-tokens"));
  if (tokenReset !== undefined && tokenReset > 0) return tokenReset;
  const requestReset = parseDurationMs(headers.get("x-ratelimit-reset-requests"));
  if (requestReset !== undefined && requestReset > 0) return requestReset;
  return undefined;
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
  if (error instanceof ProviderHttpError && error.isJsonValidateFailed) return true;
  const status = providerStatus(error);
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

function retryLimit(error: unknown) {
  if (error instanceof ProviderHttpError && error.isJsonValidateFailed) return 3;
  const status = providerStatus(error);
  if (status === 429) return 4;
  return status === 408 || (status !== undefined && status >= 500) ? 3 : 2;
}

function retryDelayMs(attempt: number, error: unknown) {
  if (error instanceof ProviderHttpError && error.isJsonValidateFailed) {
    return 600 * (attempt + 1);
  }
  const status = providerStatus(error);
  if (status === 429) {
    const delay = providerRetryAfterMs(error) ?? DEFAULT_RATE_LIMIT_RETRY_WAIT_MS;
    return delay + 500;
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
    ...(error instanceof ProviderHttpError && error.providerCode ? { providerCode: error.providerCode } : {}),
    ...(error instanceof ProviderHttpError && error.providerMessage ? { providerMessage: error.providerMessage } : {}),
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
  private activeModel: string =
    process.env.GROQ_MODEL?.trim() ||
    process.env.GroqModel?.trim() ||
    process.env.groq_model?.trim() ||
    DEFAULT_GROQ_MODEL;
  private modelCooldowns = new Map<string, number>();
  private unavailableModels = new Set<string>();
  private currentKeyIndex = 0;

  get model(): string {
    return this.activeModel;
  }

  private getCandidateModels(): string[] {
    const configured =
      process.env.GROQ_MODEL?.trim() ||
      process.env.GroqModel?.trim() ||
      process.env.groq_model?.trim();
    if (process.env.GROQ_DISABLE_MODEL_FALLBACK === "true") {
      return [configured || DEFAULT_GROQ_MODEL];
    }
    const all = [
      ...(configured ? [configured] : []),
      ...GROQ_FALLBACK_MODELS,
    ].filter((m) => !this.unavailableModels.has(m));
    const unique = Array.from(new Set(all));
    if (unique.length === 0) {
      return [configured || DEFAULT_GROQ_MODEL];
    }
    const now = Date.now();
    return unique.sort((a, b) => {
      const aCd = this.modelCooldowns.get(a) ?? 0;
      const bCd = this.modelCooldowns.get(b) ?? 0;
      const aOnCd = aCd > now ? 1 : 0;
      const bOnCd = bCd > now ? 1 : 0;
      return aOnCd - bOnCd;
    });
  }

  async generateJson<T>(
    runId: string,
    agentId: AgentId,
    systemInstruction: string,
    prompt: string,
    schema: z.ZodType<T>,
    responseJsonSchema: Record<string, unknown>,
    onCallEvent?: (event: ModelCallEvent) => void,
  ): Promise<T> {
    const apiKeys = getAvailableApiKeys();
    if (apiKeys.length === 0) throw new GroqNotConfiguredError();

    nextCall(runId, agentId);
    const candidateModels = this.getCandidateModels();
    let overallLastFailure: unknown;
    let rateLimitFailure: unknown;
    let lastAttemptedModel = this.activeModel;

    for (let modelIdx = 0; modelIdx < candidateModels.length; modelIdx += 1) {
      const currentModel = candidateModels[modelIdx];
      lastAttemptedModel = currentModel;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const currentApiKey = apiKeys[this.currentKeyIndex % apiKeys.length];
        try {
          const parsed = await requestGate.run(async () => {
            const now = Date.now();
            const cdUntil = this.modelCooldowns.get(currentModel) ?? 0;
            if (cdUntil > now) {
              const remainingCooldownMs = cdUntil - now;
              if (modelIdx + 1 < candidateModels.length) {
                const nextModel = candidateModels[modelIdx + 1];
                const nextCd = this.modelCooldowns.get(nextModel) ?? 0;
                if (nextCd <= now) {
                  throw new ProviderHttpError(
                    429,
                    remainingCooldownMs,
                    false,
                    false,
                    "rate_limit_exceeded",
                    `Model "${currentModel}" is on cooldown; switching to "${nextModel}"`,
                  );
                }
              }
              if (remainingCooldownMs > 0 && remainingCooldownMs <= 5_000) {
                await wait(remainingCooldownMs);
              }
            }

            onCallEvent?.({ attempt: attempt + 1, status: "started" });
            const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${currentApiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: currentModel,
                messages: [
                  { role: "system", content: systemInstruction },
                  { role: "user", content: prompt },
                ],
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: agentId,
                    strict: STRICT_JSON_SCHEMA_MODELS.has(currentModel),
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
              if (response.status === 429 && retryAfterMs && retryAfterMs > 0) {
                this.modelCooldowns.set(currentModel, Date.now() + Math.min(retryAfterMs, MAX_PROVIDER_COOLDOWN_MS));
              } else if (response.status === 429) {
                this.modelCooldowns.set(currentModel, Date.now() + 30_000);
              }
              throw new ProviderHttpError(
                response.status,
                retryAfterMs,
                errorInfo.quotaExhausted,
                errorInfo.isJsonValidateFailed,
                errorInfo.code,
                errorInfo.message,
              );
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
            this.activeModel = currentModel;
            await wait(250);
            return validated;
          });

          logger.info({ runId, agentId, model: currentModel, attempt: attempt + 1 }, "Groq agent response validated");
          return parsed;
        } catch (error) {
          onCallEvent?.({ attempt: attempt + 1, status: "failed" });
          overallLastFailure = error;

          const status = providerStatus(error);

          if (error instanceof ProviderHttpError && error.quotaExhausted) {
            this.modelCooldowns.set(currentModel, Date.now() + 1_800_000);
            logger.warn(
              { runId, agentId, model: currentModel, nextModel: candidateModels[modelIdx + 1] },
              "Model token quota exhausted; failing over to next candidate model",
            );
            if (apiKeys.length > 1) {
              this.currentKeyIndex = (this.currentKeyIndex + 1) % apiKeys.length;
              logger.info({ newKeyIndex: this.currentKeyIndex }, "Rotating Groq API key after quota limit");
            }
            break;
          }

          if (status === 401 || status === 403) {
            if (apiKeys.length > 1) {
              this.currentKeyIndex = (this.currentKeyIndex + 1) % apiKeys.length;
              logger.warn({ failedKeyIndex: this.currentKeyIndex }, "API key rejected; switching to backup key");
              continue;
            }
            break;
          }

          if (status === 404) {
            this.unavailableModels.add(currentModel);
          }
          if (status === 429) {
            rateLimitFailure = error;
          }

          if ((status === 429 || status === 404) && modelIdx + 1 < candidateModels.length) {
            const nextModel = candidateModels[modelIdx + 1];
            logger.warn(
              {
                runId,
                agentId,
                failedModel: currentModel,
                nextModel,
                status,
                attempt: attempt + 1,
              },
              "Groq model hit rate limit or is unavailable; failing over to alternative model in pool",
            );
            if (apiKeys.length > 1) {
              this.currentKeyIndex = (this.currentKeyIndex + 1) % apiKeys.length;
            }
            break;
          }

          const delayMs = retryDelayMs(attempt, error);
          const rateLimitWaitIsShortEnough =
            status !== 429 || delayMs <= MAX_RATE_LIMIT_RETRY_WAIT_MS;
          if (
            attempt + 1 < retryLimit(error) &&
            isRetryableFailure(error) &&
            rateLimitWaitIsShortEnough
          ) {
            logger.warn(
              {
                runId,
                agentId,
                model: currentModel,
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

          if (modelIdx + 1 < candidateModels.length) {
            const nextModel = candidateModels[modelIdx + 1];
            logger.warn(
              {
                runId,
                agentId,
                failedModel: currentModel,
                nextModel,
                attempt: attempt + 1,
                ...failureDetails(error),
              },
              "Model response failed validation or retries; failing over to next model in pool",
            );
            break;
          }
          break;
        }
      }

      if ((providerStatus(overallLastFailure) === 401 || providerStatus(overallLastFailure) === 403) && apiKeys.length <= 1) {
        break;
      }
    }

    if (providerStatus(overallLastFailure) === 404 && rateLimitFailure) {
      overallLastFailure = rateLimitFailure;
    }

    logger.error({ runId, agentId, model: lastAttemptedModel, ...failureDetails(overallLastFailure) }, "Groq request failed");
    if (overallLastFailure instanceof GroqNotConfiguredError) throw overallLastFailure;
    const status = providerStatus(overallLastFailure);
    if (status === 401 || status === 403) {
      throw new GroqRequestError(
        "Groq rejected the API key or its access. Replace GROQ_API_KEY with a valid key in your .env or environment variables.",
        502,
        "GROQ_AUTH_FAILED",
      );
    }
    if (status === 404) {
      throw new GroqRequestError(
        `Groq model "${lastAttemptedModel || this.model}" is unavailable to this API key. Set GROQ_MODEL to an active model enabled for this account.`,
        502,
        "GROQ_MODEL_UNAVAILABLE",
      );
    }
    if (status === 429) {
      if (providerQuotaExhausted(overallLastFailure)) {
        throw new GroqRequestError(
          "Groq reports that this account has exhausted its available quota or credits. Check the account billing and model limits before retrying.",
          503,
          "GROQ_QUOTA_EXHAUSTED",
        );
      }
      const retryAfterMs = providerRetryAfterMs(overallLastFailure);
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
    if (overallLastFailure instanceof z.ZodError || overallLastFailure instanceof SyntaxError ||
        (overallLastFailure instanceof Error && overallLastFailure.message === "empty response")) {
      throw new GroqRequestError(
        "Groq returned a response that did not match the required trip format. Please try again.",
        502,
        "GROQ_INVALID_RESPONSE",
      );
    }
    if (status === 400) {
      const detail =
        overallLastFailure instanceof ProviderHttpError && overallLastFailure.providerMessage
          ? `: ${overallLastFailure.providerMessage}`
          : ". Check that GROQ_MODEL supports JSON-schema outputs.";
      throw new GroqRequestError(
        `Groq rejected the structured-output request${detail}`,
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
