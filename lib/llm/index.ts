/**
 * LLM layer — `extract(schema, system, user)`.
 * Provider chain Groq → Gemini → OpenRouter (:free) → Cerebras → Mistral, built from env (LLM_PROVIDER_ORDER
 * overrides). For each call: walk providers in order (skipping any on 429 cooldown or disabled by a 401/402/403),
 * each model in turn; ask for JSON; zod-validate; on validation failure do ONE repair round on the same model with
 * the error appended; on 429 put the provider on cooldown and move on; on any other failure try the next model.
 * Chain exhausted → null, and the caller records "unknown".
 *
 * Ollama is deliberately NOT in the default order: this pipeline treats "unknown" (null) as a legitimate,
 * honest outcome when every free-tier cloud provider is exhausted. A small local model would still validate
 * against the schema, but as a much weaker guess masquerading as a real answer — worse than an explicit
 * "unknown" for a data-extraction pipeline. It stays available for offline/manual use via
 * LLM_PROVIDER_ORDER=ollama (or with any other provider name in the list).
 *
 * Never the Anthropic API.
 */
import type { ZodType } from "zod";
import { ChatMessage, LlmError, Provider } from "./types";
import { openrouter } from "./providers/openrouter";
import { groq } from "./providers/groq";
import { gemini } from "./providers/gemini";
import { ollama } from "./providers/ollama";
import { cerebras } from "./providers/cerebras";
import { mistral } from "./providers/mistral";

export interface ExtractMeta { provider: string; model: string; attempts: number; repaired: boolean }
export interface ExtractResult<T> { data: T; meta: ExtractMeta }
export interface Chain { providers: Provider[]; cooldownUntil: Map<string, number> }
export interface ExtractOptions {
  chain?: Chain;
  maxTokens?: number;
  log?: (msg: string) => void;
  /** how long one call may sit waiting for rate-limit cooldowns to lapse before giving up (default 30 min) */
  maxWaitMs?: number;
}

const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_MAX_WAIT_MS = 30 * 60_000;

export const DEFAULT_PROVIDER_ORDER = ["groq", "gemini", "openrouter", "cerebras", "mistral"] as const;

export function buildChain(env: Record<string, string | undefined> = process.env): Chain {
  const available: Record<string, Provider | undefined> = {
    openrouter: env.OPENROUTER_API_KEY ? openrouter(env.OPENROUTER_API_KEY, splitList(env.OPENROUTER_MODELS) ?? undefined) : undefined,
    groq: env.GROQ_API_KEY ? groq(env.GROQ_API_KEY, splitList(env.GROQ_MODELS) ?? undefined) : undefined,
    gemini: env.GEMINI_API_KEY ? gemini(env.GEMINI_API_KEY, splitList(env.GEMINI_MODELS) ?? undefined) : undefined,
    cerebras: env.CEREBRAS_API_KEY ? cerebras(env.CEREBRAS_API_KEY, splitList(env.CEREBRAS_MODELS) ?? undefined) : undefined,
    mistral: env.MISTRAL_API_KEY ? mistral(env.MISTRAL_API_KEY, splitList(env.MISTRAL_MODELS) ?? undefined) : undefined,
    ollama: env.OLLAMA_URL ? ollama(env.OLLAMA_URL, splitList(env.OLLAMA_MODELS) ?? undefined) : undefined,
  };
  const order = splitList(env.LLM_PROVIDER_ORDER) ?? [...DEFAULT_PROVIDER_ORDER];
  const providers = order.map((n) => available[n.toLowerCase()]).filter((p): p is Provider => !!p);
  return { providers, cooldownUntil: new Map() };
}

let _default: Chain | null = null;
export function defaultChain(): Chain { return (_default ??= buildChain()); }

/**
 * Cooldown keys: `<provider>` = disabled for the run (Infinity, from a 401/402/403); `<provider>/<model>` = a
 * 429 on that model (quotas are per model on Gemini/Groq, so a sibling model is still worth trying).
 * If a walk fails only because everything is cooling, wait for the earliest cooldown and walk again — a chain
 * that is merely rate-limited right now must not be recorded as "unknown".
 */
export async function extract<T>(schema: ZodType<T>, system: string, user: string, opts: ExtractOptions = {}): Promise<ExtractResult<T> | null> {
  const chain = opts.chain ?? defaultChain();
  const log = opts.log ?? (() => {});
  const deadline = Date.now() + (opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS);
  const state = { attempts: 0 };
  for (;;) {
    const r = await walk(schema, system, user, chain, opts, log, state);
    if (r) return r;
    const next = earliestCooldown(chain);
    if (next === null || next > deadline) return null;
    const ms = Math.max(0, next - Date.now());
    log(`all providers cooling down — waiting ${Math.ceil(ms / 1000)}s`);
    await new Promise((res) => setTimeout(res, ms));
  }
}

async function walk<T>(schema: ZodType<T>, system: string, user: string, chain: Chain, opts: ExtractOptions, log: (m: string) => void, state: { attempts: number }): Promise<ExtractResult<T> | null> {
  const base: ChatMessage[] = [{ role: "system", content: system }, { role: "user", content: user }];
  const now = Date.now();

  for (const provider of chain.providers) {
    if ((chain.cooldownUntil.get(provider.name) ?? 0) > now) { log(`${provider.name}: disabled, skipping`); continue; }

    for (const model of provider.models) {
      const key = `${provider.name}/${model}`;
      const until = chain.cooldownUntil.get(key) ?? 0;
      if (until > now) { log(`${key}: on cooldown for ${Math.ceil((until - now) / 1000)}s, skipping`); continue; }

      const call = async (messages: ChatMessage[]): Promise<string | "next-model" | "next-provider"> => {
        try {
          state.attempts++;
          return await provider.chat(model, messages, { json: true, maxTokens: opts.maxTokens });
        } catch (e) {
          const err = e as LlmError;
          log(err.message);
          if (err instanceof LlmError && err.rateLimited) { chain.cooldownUntil.set(key, Date.now() + (err.retryAfterMs ?? DEFAULT_COOLDOWN_MS)); return "next-model"; }
          if (err instanceof LlmError && err.notAuthorised) { disable(chain, provider, log, err); return "next-provider"; }
          return "next-model";
        }
      };

      const raw = await call(base);
      if (raw === "next-provider") break;
      if (raw === "next-model") continue;
      const first = validate(schema, raw);
      if (first.ok) return { data: first.data, meta: { provider: provider.name, model, attempts: state.attempts, repaired: false } };

      // one repair round: show the model its own output and what was wrong with it
      log(`${key}: invalid output (${first.error.slice(0, 120)}), repairing`);
      const repaired = await call([
        ...base,
        { role: "assistant", content: raw },
        { role: "user", content: `That response was not valid. Problems:\n${first.error}\n\nReturn ONLY the corrected JSON object, nothing else.` },
      ]);
      if (repaired === "next-provider") break;
      if (repaired === "next-model") continue;
      const second = validate(schema, repaired);
      if (second.ok) return { data: second.data, meta: { provider: provider.name, model, attempts: state.attempts, repaired: true } };
      log(`${key}: still invalid after repair (${second.error.slice(0, 120)}), next model`);
    }
  }
  return null;
}

/** Earliest finite model cooldown among providers that are not disabled; null if nothing is merely cooling. */
function earliestCooldown(chain: Chain): number | null {
  let min: number | null = null;
  for (const p of chain.providers) {
    if ((chain.cooldownUntil.get(p.name) ?? 0) === Number.POSITIVE_INFINITY) continue;
    for (const m of p.models) {
      const t = chain.cooldownUntil.get(`${p.name}/${m}`);
      if (t !== undefined && Number.isFinite(t) && t > Date.now() && (min === null || t < min)) min = t;
    }
  }
  return min;
}

// ---- helpers ----

/** A key that is invalid or has no quota won't fix itself mid-run: skip the provider from now on. */
function disable(chain: Chain, provider: Provider, log: (m: string) => void, err: LlmError) {
  chain.cooldownUntil.set(provider.name, Number.POSITIVE_INFINITY);
  log(`${provider.name}: disabled for this run (HTTP ${err.status}: ${err.message.slice(0, 160)})`);
}

function validate<T>(schema: ZodType<T>, raw: string): { ok: true; data: T } | { ok: false; error: string } {
  const text = extractJsonText(raw);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch (e) { return { ok: false, error: `not valid JSON: ${(e as Error).message}` }; }
  const r = schema.safeParse(parsed);
  if (r.success) return { ok: true, data: r.data };
  const issues = r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  return { ok: false, error: issues };
}

/** Tolerate <think>…</think> preambles, ``` fences and prose around the object. */
export function extractJsonText(raw: string): string {
  let s = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // first balanced {...} (string-aware), so reasoning prose with stray braces after the object is ignored
  const start = s.indexOf("{");
  if (start < 0) return s;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  return s.slice(start); // unbalanced: let JSON.parse report it
}

function splitList(v?: string): string[] | null {
  const l = (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return l.length ? l : null;
}
