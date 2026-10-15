import { groqModel, DEFAULT_GROQ_MODEL, getAvailableApiKeys } from "./groq";
import type { JsonModel } from "./types";

export type LlmProvider = "groq";

export function getActiveProvider(): LlmProvider {
  return "groq";
}

export function getActiveModel(): JsonModel {
  return groqModel;
}

export function getActiveModelInfo() {
  const keys = getAvailableApiKeys();
  const configuredModel =
    process.env.GROQ_MODEL?.trim() ||
    process.env.GroqModel?.trim() ||
    process.env.groq_model?.trim() ||
    DEFAULT_GROQ_MODEL;
  return {
    provider: "groq" as const,
    model: configuredModel,
    configured: keys.length > 0,
  };
}
