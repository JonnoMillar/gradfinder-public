/**
 * OpenRouter, free models only (":free" suffix = $0). Verified live 2026-09-20 via /api/v1/models;
 * the spec's llama-3.3-70b:free / qwen3-235b:free no longer exist. Override with OPENROUTER_MODELS.
 */
import { modelList, Provider } from "../types";
import { openAiCompat } from "./openai-compat";

// Non-reasoning models first: nemotron wraps its JSON in "We need to..." prose and takes 30-75s a call.
export const OPENROUTER_DEFAULT_MODELS = [
  "google/gemma-4-31b-it:free",
  "qwen/qwen3.8-27b:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
];

export function openrouter(apiKey: string, models = modelList(process.env.OPENROUTER_MODELS, OPENROUTER_DEFAULT_MODELS)): Provider {
  const paid = models.filter((m) => !m.endsWith(":free"));
  if (paid.length) throw new Error(`OPENROUTER_MODELS must be :free models only, got: ${paid.join(", ")}`);
  return openAiCompat("openrouter", "https://openrouter.ai/api/v1", apiKey, models, {
    "http-referer": "https://github.com/jonno/gradfinder", "x-title": "gradfinder",
  });
}
