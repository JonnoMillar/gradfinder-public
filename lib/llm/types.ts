export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface ChatOptions { json: boolean; maxTokens?: number; temperature?: number }

export interface Provider {
  name: string;
  models: string[];
  /** Returns the assistant text. Throws LlmError on HTTP/network failure. */
  chat(model: string, messages: ChatMessage[], opts: ChatOptions): Promise<string>;
}

export class LlmError extends Error {
  constructor(
    public provider: string,
    public model: string,
    public status: number | null,   // null = network / parse error
    message: string,
    public retryAfterMs?: number,
  ) { super(`[${provider}/${model}] ${status ?? "net"}: ${message}`); this.name = "LlmError"; }
  get rateLimited() { return this.status === 429; }
  /** invalid key, no quota, or forbidden — not worth retrying this run */
  get notAuthorised() { return this.status === 401 || this.status === 402 || this.status === 403; }
}

/** Comma-separated env override, else the default list. */
export function modelList(envValue: string | undefined, fallback: string[]): string[] {
  const list = (envValue ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : fallback;
}
