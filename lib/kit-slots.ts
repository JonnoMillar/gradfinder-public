/** Pure helper shared by the Kit page's server and client code (lib/kit.ts reads files, so the client can't import it). */

/** A letter paragraph split into fixed text and `[…]` slots a run fills per role. Brackets nest: `[name, else "[Firm] team"]`. */
export function letterSlots(p: string): { text: string; slot: boolean }[] {
  const out: { text: string; slot: boolean }[] = [];
  let depth = 0, buf = "";
  const flush = (slot: boolean) => { if (buf.trim()) out.push({ text: buf, slot }); buf = ""; };
  for (const ch of p) {
    if (ch === "[" && depth++ === 0) { flush(false); continue; }
    if (ch === "]" && depth > 0 && --depth === 0) { flush(true); continue; }
    buf += ch;
  }
  flush(depth > 0);
  return out;
}
