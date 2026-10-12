/** Mistral "Experiment" free plan (OpenAI-compatible). Override with MISTRAL_MODELS. */
import { modelList, Provider } from "../types";
import { openAiCompat } from "./openai-compat";

export const MISTRAL_DEFAULT_MODELS = ["mistral-small-latest", "mistral-medium-latest"];

export function mistral(apiKey: string, models = modelList(process.env.MISTRAL_MODELS, MISTRAL_DEFAULT_MODELS)): Provider {
  return openAiCompat("mistral", "https://api.mistral.ai/v1", apiKey, models);
}
