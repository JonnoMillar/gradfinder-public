/**
 * Google Gemini (AI Studio) free tier. Verified live 2026-09-21 against generativelanguage.googleapis.com:
 *  - gemini-2.5-* model names are dead for new API keys (404, redirected to a 3.x equivalent).
 *  - `-pro` models are hard-capped at 0 quota on the free tier (429 with limit:0) — never list one here.
 *  - gemini-3.1-flash-lite skips the "thinking" step (far fewer tokens burned per call than gemini-3.6-flash),
 *    so it's the default; gemini-3.6-flash is the quality fallback within the same key/quota.
 * Uses the native generateContent endpoint, not an OpenAI-compat shape: system prompt goes in
 * systemInstruction, assistant turns are role "model", and JSON mode is generationConfig.responseMimeType.
 */
import { ChatMessage, ChatOptions, LlmError, modelList, Provider } from "../types";

export const GEMINI_DEFAULT_MODELS = ["gemini-3.1-flash-lite", "gemini-3.6-flash"];

export function gemini(apiKey: string, models = modelList(process.env.GEMINI_MODELS, GEMINI_DEFAULT_MODELS)): Provider {
  return {
    name: "gemini", models,
    async chat(model, messages: ChatMessage[], opts: ChatOptions) {
      const system = messages.find((m) => m.role === "system")?.content;
      const contents = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
      const body: Record<string, unknown> = {
        contents,
        generationConfig: {
          temperature: opts.temperature ?? 0,
          maxOutputTokens: opts.maxTokens ?? 4096,
          ...(opts.json ? { responseMimeType: "application/json" } : {}),
        },
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      let res: Response;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120_000),
        });
      } catch (e) {
        throw new LlmError("gemini", model, null, (e as Error).message);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        // Free-tier quota errors carry a RetryInfo detail: {"@type":"...RetryInfo","retryDelay":"33s"}
        const hint = Number(text.match(/"retryDelay"\s*:\s*"([\d.]+)s"/)?.[1]);
        const retryAfterMs = hint > 0 ? Math.ceil(hint) * 1000 : undefined;
        throw new LlmError("gemini", model, res.status, text.slice(0, 300), retryAfterMs);
      }
      const json = await res.json().catch(() => null) as { candidates?: { content?: { parts?: { text?: string }[] } }[] } | null;
      const parts = json?.candidates?.[0]?.content?.parts;
      if (!parts) throw new LlmError("gemini", model, null, `no content in response: ${JSON.stringify(json)?.slice(0, 200)}`);
      return parts.map((p) => p.text ?? "").join("");
    },
  };
}
