import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GeminiJsonModel, GeminiNotConfiguredError } from "./gemini";

const responseSchema = z.object({ answer: z.string() });
const responseJsonSchema = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Gemini JSON model", () => {
  it("uses the API key header and validates structured JSON without calling a live API", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-only-key");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"answer":"ready"}' }] } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new GeminiJsonModel().generateJson(
      "run-test",
      "trip_manager",
      "Return JSON.",
      "Make a test response.",
      responseSchema,
      responseJsonSchema,
    );

    expect(result).toEqual({ answer: "ready" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/models/gemini-3.8-flash:generateContent");
    expect(init?.headers).toMatchObject({ "x-goog-api-key": "test-only-key" });
    const body = JSON.parse(String(init?.body));
    expect(body.generationConfig.responseJsonSchema).toEqual(responseJsonSchema);
    expect(body.generationConfig.maxOutputTokens).toBe(8_192);
  });

  it("fails locally without a key and maps quota exhaustion without retrying", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const noKeyFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", noKeyFetch);
    await expect(new GeminiJsonModel().generateJson(
      "run-no-key",
      "trip_manager",
      "Return JSON.",
      "Make a test response.",
      responseSchema,
      responseJsonSchema,
    )).rejects.toBeInstanceOf(GeminiNotConfiguredError);
    expect(noKeyFetch).not.toHaveBeenCalled();

    vi.stubEnv("GEMINI_API_KEY", "test-only-key");
    const quotaFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "Quota exceeded for requests_per_day." } }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", quotaFetch);
    await expect(new GeminiJsonModel().generateJson(
      "run-quota",
      "trip_manager",
      "Return JSON.",
      "Make a test response.",
      responseSchema,
      responseJsonSchema,
    )).rejects.toMatchObject({ code: "GEMINI_QUOTA_EXHAUSTED" });
    expect(quotaFetch).toHaveBeenCalledTimes(1);
  });
});
