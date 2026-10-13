import { groqModel, DEFAULT_GROQ_MODEL } from "./groq";
import type { JsonModel } from "./types";

export type LlmProvider = "groq";

export function getActiveProvider(): LlmProvider {
  return "groq";
}

export function getActiveModel(): JsonModel {
  return groqModel;
}

export function getActiveModelInfo() {
  return {
    provider: "groq" as const,
    model: process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL,
    configured: Boolean(process.env.GROQ_API_KEY?.trim()),
  };
}
