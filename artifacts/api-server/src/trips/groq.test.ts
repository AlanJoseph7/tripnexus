import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { GroqJsonModel } from "./groq";

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("Groq request recovery", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.GROQ_API_KEY = "unit-test-key";
    process.env.GROQ_DISABLE_MODEL_FALLBACK = "true";
    delete process.env.GROQ_MODEL;
    vi.useFakeTimers();
    // Each unit test should start with an expired provider-wide cooldown.
    vi.setSystemTime(Date.now() + 10 * 60_000);
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_MODEL;
    delete process.env.GROQ_DISABLE_MODEL_FALLBACK;
  });

  it("sends a server-side chat-completion request with the configured structured schema", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, {
      choices: [{ message: { content: '{"ready":true}' } }],
    }));
    globalThis.fetch = fetchMock as typeof fetch;

    const pending = new GroqJsonModel().generateJson(
      "request-shape-test",
      "trip_manager",
      "Return JSON.",
      '{"request":"test"}',
      z.object({ ready: z.boolean() }),
      { type: "object", properties: { ready: { type: "boolean" } }, required: ["ready"], additionalProperties: false },
    );
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({ ready: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer unit-test-key");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("openai/gpt-oss-120b");
    expect(body.response_format.json_schema.name).toBe("trip_manager");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.required).toEqual(["ready"]);
    expect(body.messages).toHaveLength(2);
    expect(body.max_completion_tokens).toBe(4096);
  });

  it("recovers from temporary provider errors", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(503, {}))
      .mockResolvedValueOnce(response(503, {}))
      .mockResolvedValueOnce(response(200, { choices: [{ message: { content: '{"ready":true}' } }] }));
    globalThis.fetch = fetchMock as typeof fetch;

    const events: Array<{ attempt: number; status: string }> = [];
    const pending = new GroqJsonModel().generateJson(
      "retry-success-test",
      "trip_manager",
      "Return JSON.",
      "{}",
      z.object({ ready: z.boolean() }),
      { type: "object" },
      (event) => events.push(event),
    );
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({ ready: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(events.filter((event) => event.status === "started").map((event) => event.attempt)).toEqual([1, 2, 3]);
    expect(events.at(-1)).toEqual({ attempt: 3, status: "completed" });
  });

  it("recovers from transient json_validate_failed (HTTP 400) errors with retry", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(400, {
        error: { code: "json_validate_failed", message: "Failed to validate JSON." },
      }))
      .mockResolvedValueOnce(response(200, { choices: [{ message: { content: '{"ready":true}' } }] }));
    globalThis.fetch = fetchMock as typeof fetch;

    const pending = new GroqJsonModel().generateJson(
      "json-validate-retry-test",
      "trip_manager",
      "Return JSON.",
      "{}",
      z.object({ ready: z.boolean() }),
      { type: "object" },
    );
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({ ready: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("waits for Groq's transient rate-limit reset and retries only once", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(429, {
        error: {
          code: "rate_limit_exceeded",
          message: "Rate limit reached; this quota window resets soon. Try again in 16s.",
        },
      }, { "Retry-After": "16" }))
      .mockResolvedValueOnce(response(200, { choices: [{ message: { content: '{"ready":true}' } }] }));
    globalThis.fetch = fetchMock as typeof fetch;

    const pending = new GroqJsonModel().generateJson(
      "rate-limit-retry-test",
      "trip_manager",
      "Return JSON.",
      "{}",
      z.object({ ready: z.boolean() }),
      { type: "object" },
    );
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({ ready: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry an exhausted provider quota", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(429, {
      error: { code: "insufficient_quota", message: "Quota exceeded" },
    }));
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(new GroqJsonModel().generateJson(
      "quota-exhausted-test",
      "trip_manager",
      "Return JSON.",
      "{}",
      z.object({ ready: z.boolean() }),
      { type: "object" },
    )).rejects.toMatchObject({
      code: "GROQ_QUOTA_EXHAUSTED",
      message: expect.stringContaining("billing"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a rate limit if the provider reset window is too long", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response(429, { error: { message: "Rate limit reached" } }, { "Retry-After": "60" }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(new GroqJsonModel().generateJson(
      "long-rate-limit-test",
      "trip_manager",
      "Return JSON.",
      "{}",
      z.object({ ready: z.boolean() }),
      { type: "object" },
    )).rejects.toMatchObject({
      code: "GROQ_RATE_LIMITED",
      message: expect.stringContaining("60 seconds"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a clear authentication failure without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(401, { error: "private provider body" }));
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(new GroqJsonModel().generateJson(
      "auth-failure-test",
      "trip_manager",
      "Return JSON.",
      "{}",
      z.object({ ready: z.boolean() }),
      { type: "object" },
    )).rejects.toMatchObject({
      name: "GroqRequestError",
      statusCode: 502,
      code: "GROQ_AUTH_FAILED",
      message: expect.stringContaining("GROQ_API_KEY"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("identifies an unavailable model and does not retry", async () => {
    process.env.GROQ_MODEL = "not-a-model";
    const fetchMock = vi.fn().mockResolvedValue(response(404, {}));
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(new GroqJsonModel().generateJson(
      "model-failure-test",
      "trip_manager",
      "Return JSON.",
      "{}",
      z.object({ ready: z.boolean() }),
      { type: "object" },
    )).rejects.toMatchObject({
      name: "GroqRequestError",
      code: "GROQ_MODEL_UNAVAILABLE",
      message: expect.stringContaining("not-a-model"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not make a request when the API key is missing", async () => {
    delete process.env.GROQ_API_KEY;
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(new GroqJsonModel().generateJson(
      "missing-key-test",
      "trip_manager",
      "Return JSON.",
      "{}",
      z.object({ ready: z.boolean() }),
      { type: "object" },
    )).rejects.toMatchObject({ name: "GroqNotConfiguredError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("automatically fails over to alternative model when primary model is rate limited (HTTP 429)", async () => {
    delete process.env.GROQ_DISABLE_MODEL_FALLBACK;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(429, {
        error: { code: "rate_limit_exceeded", message: "Rate limit reached for openai/gpt-oss-120b" },
      }))
      .mockResolvedValueOnce(response(200, { choices: [{ message: { content: '{"ready":true}' } }] }));
    globalThis.fetch = fetchMock as typeof fetch;

    const pending = new GroqJsonModel().generateJson(
      "model-failover-test",
      "trip_manager",
      "Return JSON.",
      "{}",
      z.object({ ready: z.boolean() }),
      { type: "object" },
    );
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({ ready: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(firstInit.body)).model).toBe("openai/gpt-oss-120b");
    expect(JSON.parse(String(secondInit.body)).model).toBe("qwen/qwen3.8-27b");
  });

  it("rotates to backup API key when multiple keys are supplied and primary key hits limit", async () => {
    process.env.GROQ_API_KEYS = "key-primary,key-backup";
    delete process.env.GROQ_DISABLE_MODEL_FALLBACK;

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(429, {
        error: { code: "rate_limit_exceeded", message: "Rate limit reached for model" },
      }))
      .mockResolvedValueOnce(response(200, { choices: [{ message: { content: '{"ready":true}' } }] }));
    globalThis.fetch = fetchMock as typeof fetch;

    const pending = new GroqJsonModel().generateJson(
      "key-rotation-test",
      "trip_manager",
      "Return JSON.",
      "{}",
      z.object({ ready: z.boolean() }),
      { type: "object" },
    );
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({ ready: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect((firstInit.headers as Record<string, string>).Authorization).toBe("Bearer key-primary");
    expect((secondInit.headers as Record<string, string>).Authorization).toBe("Bearer key-backup");
    delete process.env.GROQ_API_KEYS;
  });

  it("fails over to backup model when primary model hits daily quota exhaustion", async () => {
    delete process.env.GROQ_DISABLE_MODEL_FALLBACK;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(429, {
        error: { code: "insufficient_quota", message: "You have exceeded your daily quota balance" },
      }))
      .mockResolvedValueOnce(response(200, { choices: [{ message: { content: '{"ready":true}' } }] }));
    globalThis.fetch = fetchMock as typeof fetch;

    const pending = new GroqJsonModel().generateJson(
      "quota-failover-test",
      "trip_manager",
      "Return JSON.",
      "{}",
      z.object({ ready: z.boolean() }),
      { type: "object" },
    );
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({ ready: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(firstInit.body)).model).toBe("openai/gpt-oss-120b");
    expect(JSON.parse(String(secondInit.body)).model).toBe("qwen/qwen3.8-27b");
  });
});
