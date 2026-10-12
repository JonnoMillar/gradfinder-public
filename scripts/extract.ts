/**
 * npm run extract [-- --limit N] [--ids 1,2,3] [--force] [--sample N] [--concurrency N] [--garbage] [--no-rank]
 *   Runs LLM extraction over kept, active, not-yet-extracted jobs, then re-ranks every active job.
 *   --sample N   print N extracted jobs with each field's evidence quote and whether it's really in the posting
 *   --garbage    replace the provider chain with one that answers nonsense (proves the "unknown" path on real rows)
 *   --no-rank    skip the re-rank at the end
 * Exit code 1 if the chain was exhausted for every job it tried (keys / Ollama probably down).
 */
import { parseArgs } from "node:util";
import type { Chain } from "../lib/llm";
import { defaultChain } from "../lib/llm";
import { Extraction, eligibilityText, quoteInText, requirementsText, runExtract } from "../lib/pipeline/extract";
import { rankAll } from "../lib/pipeline/rank";
import { getDb, schema } from "../lib/db/client";
import { eq } from "drizzle-orm";

try { process.loadEnvFile(); } catch { /* no .env: chain will be empty and every job → unknown, loudly */ }

async function main() {
  const { values } = parseArgs({ options: {
    limit: { type: "string" }, ids: { type: "string" }, force: { type: "boolean", default: false },
    sample: { type: "string", default: "10" }, concurrency: { type: "string", default: "2" }, garbage: { type: "boolean", default: false }, "no-rank": { type: "boolean", default: false },
  } });
  const chain: Chain = values.garbage
    ? { cooldownUntil: new Map(), providers: [{ name: "garbage", models: ["teapot"], chat: async () => "I'm a teapot, not a JSON object. <html>lol</html>" }] }
    : defaultChain();
  if (!chain.providers.length) console.warn("WARNING: no LLM providers configured (.env has no OPENROUTER_API_KEY / GROQ_API_KEY / OLLAMA_URL) — everything will be recorded as unknown");
  console.log(`providers: ${chain.providers.map((p) => `${p.name}[${p.models.join(", ")}]`).join(" → ") || "none"}`);

  const samples: { job: schema.Job; data: Extraction }[] = [];
  const sampleN = Number(values.sample);
  const res = await runExtract({
    chain,
    limit: values.limit ? Number(values.limit) : undefined,
    jobIds: values.ids?.split(",").map(Number).filter(Boolean),
    force: values.force || values.garbage,   // garbage is a demo: always re-run the chosen rows
    concurrency: Number(values.concurrency),
    onJob: (job, data) => { if (data && samples.length < sampleN) samples.push({ job, data }); },
  });
  console.table([res]);

  for (const s of samples) printSample(s.job, s.data);

  if (!values["no-rank"]) console.log(`ranked ${rankAll()} active jobs`);
  if (res.processed > 0 && res.extracted === 0) { console.error("every job came back unknown — is any provider reachable?"); process.exitCode = 1; }
}

function printSample(job: schema.Job, d: Extraction) {
  const db = getDb();
  const company = db.select({ name: schema.companies.name }).from(schema.companies).where(eq(schema.companies.id, job.companyId)).get()?.name;
  const text = `${job.title}\n${job.descriptionText ?? ""}`;
  const ev = (field: string) => {
    const q = d.evidence[field];
    if (!q) return "(no quote)";
    return quoteInText(q, text) ? `“${q}” ✓ in posting` : `“${q}” ✗ NOT FOUND in posting`;
  };
  console.log(`\n#${job.id} ${job.title} — ${d.employer_name ?? company}\n  ${job.canonicalUrl}`);
  console.log(`  kind: ${d.kind}   function: ${d.function}   is_entry_level: ${d.is_entry_level}`);
  console.log(`  eligibility: ${eligibilityText(d.eligibility)}\n    ${ev("eligibility")}`);
  console.log(`  application_requirements: ${requirementsText(d.application_requirements)}\n    ${ev("application_requirements")}`);
  console.log(`  process_stages: ${d.process_stages.join(" → ") || "not stated"}\n    ${ev("process_stages")}`);
  for (const f of ["is_entry_level", "kind", "function", "salary_text", "start_text", "deadline_text"] as const) {
    if (d.evidence[f]) console.log(`  ${f}: ${String(d[f] ?? "")}\n    ${ev(f)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
