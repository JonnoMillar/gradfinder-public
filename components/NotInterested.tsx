"use client";

/**
 * "Not interested" (Jonno 2026-10-02): bins a role for good. It writes status `dismissed` (layer 3), which hides the role
 * from Roles and files it in the Applications archive; Undo in the toast brings it back.
 *
 * Two forms:
 *  - `tile`: a small bin on a role tile. The tile drops away (shrink, fade, a little blur), then the tiles after it glide
 *    into the gap (FLIP), so the grid never jumps. Inside a company deck only that card fades; the deck re-renders
 *    without it when the server answers.
 *  - `hero`: a quiet bin button beside the fit ring on the role page; the Undo toast offers the way back.
 *  - `card`: the Up next card's text button. It moves on to the next pick straight away (the card flicks, the same
 *    `skip` view transition as before) while the write runs.
 * Reduced motion: the tile just fades.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismiss } from "@/app/actions";
import { offerUndo, UNDONE_EVENT } from "./StageTrack";
import { EASE_OUT, reducedMotion } from "./motion";

const EXPO = "cubic-bezier(0.16, 1, 0.3, 1)";

function BinIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 4.5h11M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4 4.5l.7 8.6a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9l.7-8.6" />
      <path d="M6.8 7.2v4M9.2 7.2v4" />
    </svg>
  );
}

/** Slide the tiles after `gone` into its place: measure, hide, measure again, animate the difference. */
function closeGap(gone: HTMLElement) {
  const grid = gone.parentElement;
  const sibs = grid ? [...grid.children].filter((c): c is HTMLElement => c !== gone && c instanceof HTMLElement) : [];
  const before = new Map(sibs.map((s) => [s, s.getBoundingClientRect()]));
  gone.style.display = "none";
  if (reducedMotion()) return;
  sibs.forEach((s, k) => {
    const a = before.get(s)!, b = s.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top;
    if (!dx && !dy) return;
    // `zoom` on <html> scales rects and transforms alike, so the raw difference is the right offset
    s.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      { duration: 460, easing: EXPO, delay: Math.min(k, 8) * 14 });
  });
}

export function NotInterested({ jobId, company, status, variant = "tile", nextHref }: {
  jobId: number; company: string; status: string | null;
  variant?: "tile" | "card" | "hero";
  /** card only: where the Up next card goes next (the current URL with this role skipped) */
  nextHref?: string;
}) {
  const [, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const from = status ?? "discovered";

  // Undo: put a hidden tile back at once (the server re-render follows)
  useEffect(() => {
    if (variant !== "tile") return;
    const back = (e: Event) => {
      if ((e as CustomEvent<number>).detail !== jobId) return;
      const w = btn.current?.closest<HTMLElement>(".tile-w");
      if (!w) return;
      w.style.display = "";
      w.getAnimations().forEach((a) => a.cancel());
      w.animate([{ opacity: 0, transform: "scale(.96)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: EXPO });
    };
    window.addEventListener(UNDONE_EVENT, back);
    return () => window.removeEventListener(UNDONE_EVENT, back);
  }, [jobId, variant]);

  const bin = () => {
    setErr(null);
    const w = btn.current?.closest<HTMLElement>(".tile-w") ?? null;
    const inDeck = !!w?.closest(".cdeck");

    if (variant === "card" && nextHref) router.push(nextHref, { transitionTypes: ["skip"], scroll: false });

    let out: Animation | null = null;
    if (variant === "tile" && w) {
      out = w.animate(
        reducedMotion()
          ? [{ opacity: 1 }, { opacity: 0 }]
          : [{ opacity: 1, transform: "none", filter: "blur(0)" },
             { opacity: 0, transform: "translateY(10px) scale(.92)", filter: "blur(3px)" }],
        { duration: reducedMotion() ? 160 : 280, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" },
      );
      if (!inDeck) out.finished.then(() => closeGap(w), () => {});
    }

    start(async () => {
      const r = await dismiss({ jobId, reason: "Not interested" });
      if (!r.ok) {
        setErr(r.error);
        if (w) { w.style.display = ""; out?.cancel(); w.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: EASE_OUT }); }
        return;
      }
      offerUndo({ jobId, company, from, to: "dismissed" });
    });
  };

  if (variant === "card") {
    return (
      <>
        <button ref={btn} type="button" className="sg-bin" onClick={bin} title="Bin it: hides it from Roles, keeps it in the archive">
          <BinIcon /> Not interested
        </button>
        {err ? <span className="tmsg" data-err="1" role="status">{err}</span> : null}
      </>
    );
  }
  if (variant === "hero") {
    return (
      <>
        <button ref={btn} type="button" className="rp-bin" onClick={bin} data-err={err ? "1" : undefined}
                title={err ?? "Bin it: hides it from Roles, keeps it in the archive"}>
          <BinIcon /> Not interested
        </button>
      </>
    );
  }
  return (
    <button ref={btn} type="button" className="tile-bin" onClick={bin} data-err={err ? "1" : undefined}
            title={err ?? `Not interested in ${company}: bin it`} aria-label={`Not interested in ${company}: bin it`}>
      <BinIcon />
    </button>
  );
}
