import { z } from "zod";
import { logger } from "../lib/logger";
import type { AgentId, JsonModel, ModelCallEvent } from "./types";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const REQUEST_TIMEOUT_MS = 45_000;
const MIN_REQUEST_GAP_MS = 300;
const MAX_ATTEMPTS = 2;

export class GeminiNotConfiguredError extends Error {
  constructor() {
    super("Gemini is not configured. Add GEMINI_API_KEY in Replit Secrets.");
    this.name = "GeminiNotConfiguredError";
  }
}

export class GeminiRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "GeminiRequestError";
  }
}

let requestQueue: Promise<unknown> = Promise.resolve();
let lastRequestStartedAt = 0;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runSerialized<T>(operation: () => Promise<T>) {
  const current = requestQueue.then(async () => {
    const waitMs = MIN_REQUEST_GAP_MS - (Date.now() - lastRequestStartedAt);
    if (waitMs > 0) await wait(waitMs);
    lastRequestStartedAt = Date.now();
    return operation();
  });
  requestQueue = current.then(
    () => undefined,
    () => undefined,
  );
  return current;
}

function providerMessage(body: string) {
  try {
    const payload: unknown = JSON.parse(body);
    if (payload && typeof payload === "object" && "error" in payload) {
      const error = payload.error;
      if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
        return error.message;
      }
    }
  } catch {
    // Keep the provider's short text response as the diagnostic when it is not JSON.
  }
  return body.slice(0, 500) || "Gemini returned an empty error response.";
}

function mapHttpError(status: number, message: string) {
  if (status === 401 || status === 403) {
    return new GeminiRequestError(
      "Gemini rejected the API key or its permissions. Check the key and Gemini API access in Google AI Studio.",
      502,
      "GEMINI_AUTH_FAILED",
    );
  }
  if (status === 404) {
    return new GeminiRequestError(
      `Gemini model "${process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL}" is unavailable to this API key.`,
      502,
      "GEMINI_MODEL_UNAVAILABLE",
    );
  }
  if (status === 429) {
    const normalizedMessage = message.toLowerCase();
    const quotaExhausted =
      /\bquota\b|billing|requests_per_day|tokens_per_day|insufficient.*credit/.test(normalizedMessage);
    return new GeminiRequestError(
      `Gemini ${quotaExhausted ? "quota is exhausted" : "is rate-limiting requests"}. The trip will use the offline fallback.`,
      503,
      quotaExhausted ? "GEMINI_QUOTA_EXHAUSTED" : "GEMINI_RATE_LIMITED",
    );
  }
  if (status === 408 || status >= 500) {
    return new GeminiRequestError(
      "Gemini is temporarily unavailable. The trip will use the offline fallback.",
      503,
      "GEMINI_TEMPORARILY_UNAVAILABLE",
    );
  }
  return new GeminiRequestError(
    `Gemini rejected the request (${status}). Check the model and structured-output request settings.`,
    502,
    "GEMINI_REQUEST_REJECTED",
  );
}

function normalizeError(error: unknown): GeminiRequestError {
  if (error instanceof GeminiRequestError) return error;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return new GeminiRequestError("The request to Gemini timed out.", 504, "GEMINI_TIMEOUT");
  }
  if (error instanceof TypeError) {
    return new GeminiRequestError("The API server could not reach Gemini.", 503, "GEMINI_NETWORK_ERROR");
  }
  return new GeminiRequestError(
    "Gemini returned a response that did not match the required trip format.",
    502,
    "GEMINI_INVALID_RESPONSE",
  );
}

function retryable(error: GeminiRequestError) {
  return [
    "GEMINI_TEMPORARILY_UNAVAILABLE",
    "GEMINI_TIMEOUT",
    "GEMINI_NETWORK_ERROR",
  ].includes(error.code);
}

export class GeminiJsonModel implements JsonModel {
  private readonly model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;

  async generateJson<T>(
    runId: string,
    agentId: AgentId,
    systemInstruction: string,
    prompt: string,
    schema: z.ZodType<T>,
    responseJsonSchema: Record<string, unknown>,
    onCallEvent?: (event: ModelCallEvent) => void,
  ): Promise<T> {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new GeminiNotConfiguredError();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const result = await runSerialized(async () => {
          onCallEvent?.({ attempt, status: "started" });
          const response = await fetch(
            `${GEMINI_API_BASE_URL}/${encodeURIComponent(this.model)}:generateContent`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
              },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemInstruction }] },
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: {
                  responseMimeType: "application/json",
                  responseJsonSchema,
                  temperature: 0.2,
                  maxOutputTokens: 8_192,
                },
              }),
              signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            },
          );

          if (!response.ok) {
            const message = providerMessage(await response.text());
            throw mapHttpError(response.status, message);
          }

          const payload: unknown = await response.json();
          const envelope = z.object({
            candidates: z.array(z.object({
              content: z.object({
                parts: z.array(z.object({ text: z.string().optional() })).optional(),
              }).optional(),
            })).optional(),
          }).parse(payload);
          const text = envelope.candidates?.[0]?.content?.parts
            ?.map((part) => part.text ?? "")
            .join("")
            .trim();
          if (!text) {
            throw new GeminiRequestError(
              "Gemini returned no structured content.",
              502,
              "GEMINI_INVALID_RESPONSE",
            );
          }

          let decoded: unknown;
          try {
            decoded = JSON.parse(text);
          } catch {
            throw new GeminiRequestError(
              "Gemini returned invalid JSON for the requested response schema.",
              502,
              "GEMINI_INVALID_RESPONSE",
            );
          }
          const validated = schema.parse(decoded);
          onCallEvent?.({ attempt, status: "completed" });
          return validated;
        });
        logger.info({ runId, agentId, model: this.model, attempt }, "Gemini agent response validated");
        return result;
      } catch (error) {
        onCallEvent?.({ attempt, status: "failed" });
        const failure = normalizeError(error);
        if (attempt < MAX_ATTEMPTS && retryable(failure)) {
          await wait(500 * attempt);
          continue;
        }
        throw failure;
      }
    }
    throw new GeminiRequestError("Gemini could not complete the structured response.", 502, "GEMINI_REQUEST_FAILED");
  }
}

export const geminiModel = new GeminiJsonModel();
