"use client";
/**
 * Role page "What they look for": the employer's values as big coloured cards (lib/apply/research.ts saveValues),
 * with the section heading in the left column, centred against them. Only the values show at first; "Show my
 * stories" grows Claude's story pick out of each card, one after another (grid-rows 0fr → 1fr, so no height is
 * measured). Sources and the employer's exact words are in the page's "Sources & quotes" drawer.
 */
import { useState } from "react";
import { IconChevron, IconHeart } from "@/lib/ui/icons";

export interface ValueCard { key: string; text: string; story: string | null }

export function ValueCards({ values }: { values: ValueCard[] }) {
  const [open, setOpen] = useState(false);
  const anyStory = values.some((v) => v.story);
  return (
    <div className="vals" data-open={open || undefined}>
      <div className="vals-l">
        <h2 className="rs-h vals-h"><span className="rs-ic" aria-hidden><IconHeart /></span>What they look for</h2>
        {anyStory ? (
          <button type="button" className="btn vals-btn" aria-expanded={open} aria-controls="vals-list" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide my stories" : "Show my stories"}<IconChevron width={13} height={13} />
          </button>
        ) : null}
      </div>
      <ol className="vals-r" id="vals-list">
        {values.map((v, i) => (
          <li key={v.key} className="val" data-tone={i % 5} style={{ "--i": i } as React.CSSProperties}>
            <span className="val-t">{v.text}</span>
            <span className="val-sw" aria-hidden={!open}>
              <span className="val-swi"><span className="val-s" data-none={v.story ? undefined : true}>{v.story ?? "No story yet"}</span></span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
