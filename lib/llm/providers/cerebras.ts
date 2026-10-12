/** Cerebras free tier (OpenAI-compatible). Models verified live 2026-09-21 via /v1/models. Override with CEREBRAS_MODELS. */
import { modelList, Provider } from "../types";
import { openAiCompat } from "./openai-compat";

export const CEREBRAS_DEFAULT_MODELS = ["gpt-oss-120b", "qwen-3.8-27b"];

export function cerebras(apiKey: string, models = modelList(process.env.CEREBRAS_MODELS, CEREBRAS_DEFAULT_MODELS)): Provider {
  return openAiCompat("cerebras", "https://api.cerebras.ai/v1", apiKey, models);
}
