/**
 * Groq free tier. Verified live 2026-09-20: llama-3.3-70b-versatile is gone; gpt-oss-120b and qwen3.8-27b
 * are the general-purpose chat models on offer. qwen/qwen3.8-27b is NOT listed here despite being
 * available: its free-tier output-tokens-per-minute cap is 1000, which the shared default maxTokens
 * (4096, set once for the whole provider chain in lib/llm/index.ts) always exceeds — every call to it
 * 429s outright, so it's dead weight rather than a real fallback. Override with GROQ_MODELS if you want
 * it anyway with a smaller maxTokens.
 */
import { modelList, Provider } from "../types";
import { openAiCompat } from "./openai-compat";

export const GROQ_DEFAULT_MODELS = ["openai/gpt-oss-120b"];

export function groq(apiKey: string, models = modelList(process.env.GROQ_MODELS, GROQ_DEFAULT_MODELS)): Provider {
  return openAiCompat("groq", "https://api.groq.com/openai/v1", apiKey, models);
}
