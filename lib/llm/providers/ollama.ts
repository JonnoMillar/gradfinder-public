/** Local Ollama via its native /api/chat (format:"json" forces valid JSON output). Last resort, unlimited, slow. */
import { ChatMessage, ChatOptions, LlmError, modelList, Provider } from "../types";

export const OLLAMA_DEFAULT_MODELS = ["llama3.1"];

export function ollama(url: string, models = modelList(process.env.OLLAMA_MODELS, OLLAMA_DEFAULT_MODELS)): Provider {
  const base = url.replace(/\/+$/, "");
  return {
    name: "ollama", models,
    async chat(model, messages: ChatMessage[], opts: ChatOptions) {
      const body: Record<string, unknown> = {
        model, messages, stream: false,
        // num_ctx: Ollama defaults to 4096 and truncates from the FRONT, dropping the system prompt on a long posting.
        // 8192 covers the 12k-char description cap + prompt + output. Override with OLLAMA_NUM_CTX.
        options: { temperature: opts.temperature ?? 0, num_predict: opts.maxTokens ?? 4096, num_ctx: Number(process.env.OLLAMA_NUM_CTX) || 8192 },
      };
      if (opts.json) body.format = "json";
      let res: Response;
      try {
        res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(600_000) });
      } catch (e) {
        throw new LlmError("ollama", model, null, (e as Error).message);
      }
      if (!res.ok) throw new LlmError("ollama", model, res.status, (await res.text().catch(() => "")).slice(0, 300));
      const json = await res.json().catch(() => null) as { message?: { content?: string } } | null;
      const content = json?.message?.content;
      if (typeof content !== "string") throw new LlmError("ollama", model, null, "no content in response");
      return content;
    },
  };
}
