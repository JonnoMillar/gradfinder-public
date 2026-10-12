/**
 * LLM provider chain, with fetch stubbed:
 *  - first provider that returns valid JSON wins; meta says which
 *  - 429 → next provider, and that provider is skipped (cooldown) for the next call too
 *  - invalid-against-schema → one repair retry carrying the validation error
 *  - garbage everywhere → null (caller records "unknown")
 *  - providers without a key are not in the chain; Ollama uses /api/chat
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { buildChain, extract } from "@/lib/llm";
import { openrouter } from "@/lib/llm/providers/openrouter";
import { groq } from "@/lib/llm/providers/groq";
import { gemini } from "@/lib/llm/providers/gemini";
import { ollama } from "@/lib/llm/providers/ollama";
import { LlmError } from "@/lib/llm/types";

const Schema = z.object({ kind: z.enum(["graduate_scheme", "internship"]), stages: z.array(z.string()) });

type Reply = { status?: number; body?: unknown; headers?: Record<string, string>; throws?: string };
/** Stub fetch: `script` keyed by URL substring, each an array of replies consumed in order. */
function stubFetch(script: Record<string, Reply[]>) {
  const calls: { url: string; body: any }[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const key = Object.keys(script).find((k) => url.includes(k));
    const reply = key ? script[key].shift() : undefined;
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (!reply) throw new Error(`unexpected fetch ${url}`);
    if (reply.throws) throw new Error(reply.throws);
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: reply.headers });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}
const openai = (content: string) => ({ choices: [{ message: { content } }] });
const chain = () => buildChain({ OPENROUTER_API_KEY: "or", GROQ_API_KEY: "gq", OLLAMA_URL: "http://ollama.test", LLM_PROVIDER_ORDER: "openrouter,groq,ollama" });

afterEach(() => vi.unstubAllGlobals());
/** cooldowns are keyed per model; this reads the longest one for a provider */
const cool = (c: { cooldownUntil: Map<string, number> }, provider: string) =>
  Math.max(...[...c.cooldownUntil].filter(([k]) => k.startsWith(provider + "/")).map(([, v]) => v));

describe("extract", () => {
  it("returns validated data and names the provider/model that produced it", async () => {
    const calls = stubFetch({ "openrouter.ai": [{ body: openai('{"kind":"graduate_scheme","stages":["tests","AC"]}') }] });
    const r = await extract(Schema, "sys", "usr", { chain: chain() });
    expect(r?.data).toEqual({ kind: "graduate_scheme", stages: ["tests", "AC"] });
    expect(r?.meta.provider).toBe("openrouter");
    expect(r?.meta.model).toBe(chain().providers[0].models[0]);
    expect(calls[0].body.messages).toEqual([{ role: "system", content: "sys" }, { role: "user", content: "usr" }]);
    expect(calls[0].body.response_format).toEqual({ type: "json_object" });
  });

  it("falls through to the next provider on 429 and keeps that provider on cooldown for the next call", async () => {
    const calls = stubFetch({
      "openrouter.ai": Array(3).fill({ status: 429, body: { error: { message: "rate limited" } } }),
      "api.groq.com": [{ body: openai('{"kind":"internship","stages":[]}') }, { body: openai('{"kind":"internship","stages":[]}') }],
    });
    const c = chain();
    const r1 = await extract(Schema, "s", "u", { chain: c });
    expect(r1?.meta.provider).toBe("groq");
    const r2 = await extract(Schema, "s", "u", { chain: c });
    expect(r2?.meta.provider).toBe("groq");
    expect(calls.filter((x) => x.url.includes("openrouter.ai")).length).toBe(3); // one per model, none on the second call
  });

  it("tries the next model of the same provider on a 5xx or network error", async () => {
    const calls = stubFetch({ "openrouter.ai": [{ status: 503 }, { throws: "ECONNRESET" }, { body: openai('{"kind":"internship","stages":[]}') }] });
    const r = await extract(Schema, "s", "u", { chain: chain() });
    expect(r?.meta.provider).toBe("openrouter");
    expect(r?.meta.model).toBe(chain().providers[0].models[2]);
    expect(calls.length).toBe(3);
  });

  it("repairs once with the validation error appended, then accepts the fixed output", async () => {
    const calls = stubFetch({ "openrouter.ai": [
      { body: openai('```json\n{"kind":"grad scheme","stages":"tests"}\n```') },
      { body: openai('{"kind":"graduate_scheme","stages":["tests"]}') },
    ] });
    const r = await extract(Schema, "s", "u", { chain: chain() });
    expect(r?.data).toEqual({ kind: "graduate_scheme", stages: ["tests"] });
    expect(r?.meta.repaired).toBe(true);
    const repair = calls[1].body.messages;
    expect(repair).toHaveLength(4);
    expect(repair[2].role).toBe("assistant");
    expect(repair[3].content).toMatch(/kind/);
    expect(repair[3].content).toMatch(/stages/);
  });

  it("returns null when every provider only produces garbage", async () => {
    stubFetch({
      "openrouter.ai": Array(6).fill({ body: openai("I am a teapot") }),
      "api.groq.com": Array(4).fill({ body: openai("<html>nope</html>") }),
      "ollama.test": Array(2).fill({ body: { message: { content: "{" } } }),
    });
    expect(await extract(Schema, "s", "u", { chain: chain() })).toBeNull();
  });

  it("uses Ollama's /api/chat with format=json and strips <think> blocks", async () => {
    const calls = stubFetch({ "ollama.test": [{ body: { message: { content: '<think>hmm</think>{"kind":"internship","stages":["x"]}' } } }] });
    const c = buildChain({ OLLAMA_URL: "http://ollama.test", LLM_PROVIDER_ORDER: "ollama" }); // not in the default order — opt in explicitly
    const r = await extract(Schema, "s", "u", { chain: c });
    expect(r?.meta.provider).toBe("ollama");
    expect(r?.data.stages).toEqual(["x"]);
    expect(calls[0].url).toBe("http://ollama.test/api/chat");
    expect(calls[0].body.format).toBe("json");
    expect(calls[0].body.stream).toBe(false);
    expect(calls[0].body.options.num_ctx).toBeGreaterThanOrEqual(8192); // Ollama's default 4096 silently drops the system prompt
  });
});

describe("buildChain", () => {
  it("includes only providers with a key/url, in default order", () => {
    expect(buildChain({ OPENROUTER_API_KEY: "a", GROQ_API_KEY: "b", GEMINI_API_KEY: "c" }).providers.map((p) => p.name)).toEqual(["groq", "gemini", "openrouter"]);
    expect(buildChain({ GROQ_API_KEY: "b" }).providers.map((p) => p.name)).toEqual(["groq"]);
    expect(buildChain({}).providers).toEqual([]);
  });
  it("excludes Ollama from the default order even when OLLAMA_URL is set — it's opt-in only via LLM_PROVIDER_ORDER", () => {
    expect(buildChain({ GROQ_API_KEY: "b", OLLAMA_URL: "http://x" }).providers.map((p) => p.name)).toEqual(["groq"]);
    expect(buildChain({ OLLAMA_URL: "http://x", LLM_PROVIDER_ORDER: "ollama" }).providers.map((p) => p.name)).toEqual(["ollama"]);
  });
  it("lets env override the model lists", () => {
    const c = buildChain({
      OPENROUTER_API_KEY: "a", OPENROUTER_MODELS: "x/one:free, y/two:free",
      GROQ_API_KEY: "b", GROQ_MODELS: "g1",
      OLLAMA_URL: "http://x", OLLAMA_MODELS: "llama3.1,mistral",
      LLM_PROVIDER_ORDER: "groq, openrouter, ollama",
    });
    expect(c.providers.map((p) => p.models)).toEqual([["g1"], ["x/one:free", "y/two:free"], ["llama3.1", "mistral"]]);
  });
  it("never lists a paid OpenRouter model", () => {
    for (const m of openrouter("k").models) expect(m).toMatch(/:free$/);
    expect(groq("k").models.length).toBeGreaterThan(0);
    expect(ollama("http://x").models).toEqual(["llama3.1"]);
  });
  it("never lists a Gemini Pro model (0 quota on the free tier)", () => {
    for (const m of gemini("k").models) expect(m).not.toMatch(/-pro/);
  });
});

describe("extractJsonText", () => {
  it("takes the first balanced object even when prose with braces follows", async () => {
    const { extractJsonText } = await import("@/lib/llm");
    const raw = 'We need to answer.\n{"a":{"b":"}"},"c":[1]}\nThen {more} thoughts }';
    expect(JSON.parse(extractJsonText(raw))).toEqual({ a: { b: "}" }, c: [1] });
  });
  it("still handles fenced and bare objects", async () => {
    const { extractJsonText } = await import("@/lib/llm");
    expect(JSON.parse(extractJsonText('```json\n{"x":1}\n```'))).toEqual({ x: 1 });
    expect(JSON.parse(extractJsonText('{"x":"a\\"}b"}'))).toEqual({ x: 'a"}b' });
  });
});

describe("429 cooldown length", () => {
  it("uses retry-after when present, else a 'try again in Ns' hint in the body, else 60s", async () => {
    stubFetch({
      "openrouter.ai": [{ status: 429, body: {} }],
      "api.groq.com": [{ status: 429, body: { error: { message: "Rate limit reached. Please try again in 24.5s. Need more?" } } }],
      "ollama.test": [{ body: { message: { content: '{"kind":"internship","stages":[]}' } } }],
    });
    const c = chain();
    const t0 = Date.now();
    await extract(Schema, "s", "u", { chain: c });
    expect(cool(c, "openrouter") - t0).toBeGreaterThanOrEqual(59_000);
    expect(cool(c, "groq") - t0).toBeGreaterThanOrEqual(24_000);
    expect(cool(c, "groq") - t0).toBeLessThan(30_000);
    vi.unstubAllGlobals();
    stubFetch({ "openrouter.ai": [{ status: 429, body: {}, headers: { "retry-after": "5" } }], "ollama.test": [{ body: { message: { content: '{"kind":"internship","stages":[]}' } } }] });
    const c2 = buildChain({ OPENROUTER_API_KEY: "a", OLLAMA_URL: "http://ollama.test", LLM_PROVIDER_ORDER: "openrouter,ollama" });
    await extract(Schema, "s", "u", { chain: c2 });
    expect(cool(c2, "openrouter") - Date.now()).toBeLessThanOrEqual(5_000);
  });
});

describe("Cerebras and Mistral providers", () => {
  it("joins the chain in the default order groq → gemini → openrouter → cerebras → mistral", () => {
    const c = buildChain({ OPENROUTER_API_KEY: "a", GROQ_API_KEY: "b", CEREBRAS_API_KEY: "c", MISTRAL_API_KEY: "d", GEMINI_API_KEY: "e", OLLAMA_URL: "http://x" });
    expect(c.providers.map((p) => p.name)).toEqual(["groq", "gemini", "openrouter", "cerebras", "mistral"]);
  });
  it("honours LLM_PROVIDER_ORDER and drops names that have no key", () => {
    const c = buildChain({ GROQ_API_KEY: "b", CEREBRAS_API_KEY: "c", OLLAMA_URL: "http://x", LLM_PROVIDER_ORDER: "ollama, mistral, cerebras, groq" });
    expect(c.providers.map((p) => p.name)).toEqual(["ollama", "cerebras", "groq"]);
  });
  it("calls the right endpoints and disables a provider for the run on 402", async () => {
    const calls = stubFetch({
      "api.cerebras.ai": [{ status: 402, body: { message: "Payment required", code: "payment_required" } }],
      "api.mistral.ai": [{ body: openai('{"kind":"internship","stages":[]}') }, { body: openai('{"kind":"internship","stages":[]}') }],
    });
    const c = buildChain({ CEREBRAS_API_KEY: "c", MISTRAL_API_KEY: "d" });
    expect((await extract(Schema, "s", "u", { chain: c }))?.meta.provider).toBe("mistral");
    expect((await extract(Schema, "s", "u", { chain: c }))?.meta.provider).toBe("mistral");
    expect(calls.map((x) => x.url)).toEqual(["https://api.cerebras.ai/v1/chat/completions", "https://api.mistral.ai/v1/chat/completions", "https://api.mistral.ai/v1/chat/completions"]);
  });
});

const gemini_response = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] });

describe("Gemini provider", () => {
  it("sends systemInstruction separately, maps assistant->model, sets json mime type, and parses candidate text", async () => {
    const calls = stubFetch({ "generativelanguage.googleapis.com": [{ body: gemini_response('{"kind":"internship","stages":["a"]}') }] });
    const c = buildChain({ GEMINI_API_KEY: "g" });
    const r = await extract(Schema, "sys", "usr", { chain: c });
    expect(r?.data).toEqual({ kind: "internship", stages: ["a"] });
    expect(r?.meta.provider).toBe("gemini");
    expect(calls[0].url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${gemini("k").models[0]}:generateContent`);
    expect(calls[0].body.systemInstruction).toEqual({ parts: [{ text: "sys" }] });
    expect(calls[0].body.contents).toEqual([{ role: "user", parts: [{ text: "usr" }] }]);
    expect(calls[0].body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("maps a prior assistant turn to role 'model' (repair round)", async () => {
    const calls = stubFetch({ "generativelanguage.googleapis.com": [
      { body: gemini_response('not json') },
      { body: gemini_response('{"kind":"internship","stages":[]}') },
    ] });
    await extract(Schema, "s", "u", { chain: buildChain({ GEMINI_API_KEY: "g" }) });
    expect(calls[1].body.contents[1]).toEqual({ role: "model", parts: [{ text: "not json" }] });
  });

  it("disables the provider for the run on 403 (bad key / API not enabled)", async () => {
    const calls = stubFetch({ "generativelanguage.googleapis.com": [{ status: 403, body: { error: { message: "forbidden" } } }] });
    const c = buildChain({ GEMINI_API_KEY: "g" });
    expect(await extract(Schema, "s", "u", { chain: c })).toBeNull();
    expect(c.cooldownUntil.get("gemini")).toBe(Number.POSITIVE_INFINITY);
    expect(calls.length).toBe(1); // didn't burn every model in the list on a dead key
  });

  it("parses the free-tier RetryInfo retryDelay into a cooldown", async () => {
    const quotaBody = { error: { code: 429, status: "RESOURCE_EXHAUSTED", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "33s" }] } };
    stubFetch({ "generativelanguage.googleapis.com": Array(2).fill({ status: 429, body: quotaBody }) });
    const c = buildChain({ GEMINI_API_KEY: "g" });
    const t0 = Date.now();
    expect(await extract(Schema, "s", "u", { chain: c, maxWaitMs: 0 })).toBeNull();
    const cooldown = cool(c, "gemini") - t0;
    expect(cooldown).toBeGreaterThanOrEqual(32_000);
    expect(cooldown).toBeLessThan(40_000);
  });
});

describe("cooldown is per model, and an all-cooling chain waits instead of giving up", () => {
  type Provider = import("@/lib/llm/types").Provider;
  const ok = '{"kind":"internship","stages":[]}';
  const mk = (name: string, models: Record<string, () => Promise<string>>): Provider => ({ name, models: Object.keys(models), chat: (m) => models[m]() });

  it("tries the provider's next model after a 429 and skips only the cooling model on the next call", async () => {
    const hits: string[] = [];
    const p = mk("g", {
      lite: async () => { hits.push("lite"); throw new LlmError("g", "lite", 429, "quota", 60_000); },
      flash: async () => { hits.push("flash"); return ok; },
    });
    const c = { providers: [p], cooldownUntil: new Map<string, number>() };
    expect((await extract(Schema, "s", "u", { chain: c }))?.meta.model).toBe("flash");
    expect((await extract(Schema, "s", "u", { chain: c }))?.meta.model).toBe("flash");
    expect(hits).toEqual(["lite", "flash", "flash"]);
  });

  it("waits for the earliest finite cooldown when every provider is cooling, then succeeds", async () => {
    let calls = 0;
    const p = mk("g", { m: async () => { calls++; if (calls === 1) throw new LlmError("g", "m", 429, "slow down", 40); return ok; } });
    const c = { providers: [p], cooldownUntil: new Map<string, number>() };
    const t0 = Date.now();
    const r = await extract(Schema, "s", "u", { chain: c });
    expect(r?.data.kind).toBe("internship");
    expect(calls).toBe(2);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(35);
  });

  it("returns null immediately when the only providers left are disabled (401/402/403)", async () => {
    let calls = 0;
    const p = mk("c", { m: async () => { calls++; throw new LlmError("c", "m", 402, "pay up"); } });
    const c = { providers: [p], cooldownUntil: new Map<string, number>() };
    expect(await extract(Schema, "s", "u", { chain: c })).toBeNull();
    expect(await extract(Schema, "s", "u", { chain: c })).toBeNull();
    expect(calls).toBe(1);
  });

  it("gives up after maxWaitMs of cumulative waiting", async () => {
    const p = mk("g", { m: async () => { throw new LlmError("g", "m", 429, "never", 20); } });
    const c = { providers: [p], cooldownUntil: new Map<string, number>() };
    const t0 = Date.now();
    expect(await extract(Schema, "s", "u", { chain: c, maxWaitMs: 70 })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(400);
  });
});
