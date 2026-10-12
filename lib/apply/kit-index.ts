/**
 * profile/INDEX.md: a map of Jonno's knowledge store, so a run reads one short file and then opens only the sections
 * a question needs (Read with offset/limit), instead of loading every story, answer and letter into context.
 *
 * One line per `## ` section of every Markdown file (with its line range and any `Tags:` line under it), one line per
 * other file. Rebuilt by prepareRun() before every run, so it can't go stale. `inbox/` (raw imports, not yet checked
 * with Jonno) and `cv/` (files to upload, not to read) are left out on purpose.
 */
import fs from "node:fs";
import path from "node:path";

const SKIP = new Set(["inbox", "cv", "INDEX.md"]);

function sections(rel: string, text: string): string[] {
  const lines = text.split(/\r?\n/);
  const heads = lines.flatMap((l, i) => (/^## /.test(l) ? [i] : []));
  if (!heads.length) return [`- ${rel} (whole file, ${lines.length} lines)`];
  // Text above the first section (a letter's body, a file's preamble) gets its own line, or it would be invisible.
  const top = lines.slice(0, heads[0]).filter((l) => l.trim() && !/^# /.test(l)).length > 3
    ? [`- ${rel}:1-${heads[0]} (top: ${(lines.find((l) => /^# /.test(l)) ?? "").replace(/^# /, "").slice(0, 90) || "untitled"})`] : [];
  return [...top, ...heads.map((start, k) => {
    const end = (heads[k + 1] ?? lines.length) - 1;
    const tags = lines.slice(start + 1, Math.min(end + 1, start + 4)).find((l) => /^tags:/i.test(l.trim()));
    const title = lines[start].replace(/^## /, "").slice(0, 110);
    return `- ${rel}:${start + 1}-${end + 1} ${title}${tags ? ` [${tags.trim().replace(/^tags:\s*/i, "")}]` : ""}`;
  })];
}

export function buildIndex(dir: string): string {
  const out: string[] = [];
  const walk = (sub: string) => {
    for (const name of fs.readdirSync(path.join(dir, sub)).sort()) {
      if (SKIP.has(name) || name.startsWith("~$")) continue;
      const rel = sub ? `${sub}/${name}` : name;
      const full = path.join(dir, rel);
      if (fs.statSync(full).isDirectory()) walk(rel);
      else if (/\.md$/i.test(name)) out.push(...sections(rel, fs.readFileSync(full, "utf8")));
      else out.push(`- ${rel}`);
    }
  };
  walk("");
  return [
    "# Knowledge store index (generated before every run; do not edit)",
    "",
    "Read `facts.yaml` whole. Open anything else only when a question needs it, at the lines shown (Read with offset",
    "and limit). `answers/` and `cover-letters/` hold earlier answers: reuse and adapt them for a similar question.",
    "",
    ...out,
    "",
  ].join("\n");
}

export function writeIndex(dir: string): string {
  const file = path.join(dir, "INDEX.md");
  if (fs.existsSync(dir)) fs.writeFileSync(file, buildIndex(dir));
  return file;
}
