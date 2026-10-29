/**
 * Loading skeletons: the grey outline of a page, shown the moment a link is clicked while the server renders the real
 * one (each route's `loading.tsx`). Every page is force-dynamic, so without these Next has nothing to show or prefetch
 * and the old page sits frozen until the new one arrives whole.
 *
 * Shapes follow each page's real sections so content lands where the outline was. The outline fades in after a short
 * delay (`.skp` in globals.css): a quick navigation never flashes it.
 */
import type { CSSProperties, ReactNode } from "react";
import { PageSlide } from "@/components/PageSlide";

/** One grey block. `h`/`w` in px (numbers) or any CSS length. */
export function Sk({ h, w, r, style }: { h: number | string; w?: number | string; r?: number; style?: CSSProperties }) {
  return <div className="sk" style={{ height: h, width: w, borderRadius: r, ...style }} />;
}

/** A row of `n` blocks sharing the width. */
export function SkRow({ n, h, gap = 14 }: { n: number; h: number; gap?: number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap }}>
      {Array.from({ length: n }, (_, i) => <Sk key={i} h={h} />)}
    </div>
  );
}

/** A page's frame: the same slide-in as the real page, labelled for screen readers. */
export function SkPage({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <PageSlide>
      <main className={`wrap skp ${className}`} role="status" aria-busy="true" aria-label={`Loading ${label}`}>
        {children}
      </main>
    </PageSlide>
  );
}
