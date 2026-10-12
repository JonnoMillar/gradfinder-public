/**
 * OpenAI-compatible /chat/completions — shared by OpenRouter and Groq.
 * Uses globalThis.fetch at call time so tests can stub it.
 */
import { ChatMessage, ChatOptions, LlmError, Provider } from "../types";

export function openAiCompat(name: string, baseUrl: string, apiKey: string, models: string[], extraHeaders: Record<string, string> = {}): Provider {
  return {
    name, models,
    async chat(model, messages: ChatMessage[], opts: ChatOptions) {
      const body: Record<string, unknown> = { model, messages, temperature: opts.temperature ?? 0, max_tokens: opts.maxTokens ?? 4096 };
      if (opts.json) body.response_format = { type: "json_object" };
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, ...extraHeaders },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120_000),
        });
      } catch (e) {
        throw new LlmError(name, model, null, (e as Error).message);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        // Groq puts the wait in the body ("Please try again in 24.5s") rather than a retry-after header
        const header = Number(res.headers.get("retry-after"));
        const hint = Number(text.match(/try again in ([\d.]+)\s*s/i)?.[1]);
        const retryAfterMs = header > 0 ? header * 1000 : hint > 0 ? Math.ceil(hint) * 1000 : undefined;
        throw new LlmError(name, model, res.status, text.slice(0, 300), retryAfterMs);
      }
      const json = await res.json().catch(() => null) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } } | null;
      const content = json?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new LlmError(name, model, null, `no content in response: ${JSON.stringify(json)?.slice(0, 200)}`);
      return content;
    },
  };
}
