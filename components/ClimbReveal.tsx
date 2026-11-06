"use client";

/**
 * The payoff for the platinum badge and the Roles cube (Jonno 2026-11-04): once the stairs have risen, each Gmail stage
 * move he hasn't seen plays out on the Climb, one at a time. The stage it lands on lights up platinum, the role's mini
 * appears on the stage it left (platinum too), crouches, hops up the stairs and lands with a squash, and the stamp card
 * drops in (components/Celebrate.tsx; Interview and Offer also get confetti). The first three play in full; any more
 * just appear in place. Then all of them, rejections included, are marked seen, so the badge and cube go away.
 *
 * Climb.tsx tags each moved mini with `data-hop` (its offset back to the stage it left); this only animates. The minis
 * keep a platinum tint until the page is left. Reduced motion: no travel, the stamps still come in turn.
 *
 * It also writes the one quiet line for rejections in the Climb's head ("Since you last looked: X said no."), and holds
 * on to the moves it opened with: the revalidate after markMovesSeen sends an empty list, which must not wipe the line.
 */
import { useEffect, useState } from "react";
import { markMovesSeen } from "@/app/actions";
import type { NewsMove } from "@/lib/queries";
import { emitMoved, reducedMotion } from "./motion";

const AFTER_ENTRANCE = 1500;
const BETWEEN = 3300;
const FULL = 3;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const idsOf = (ms: NewsMove[]) => ms.map((m) => m.emailId).join(",");

export function ClimbReveal({ moves: fresh }: { moves: NewsMove[] }) {
  // what was news when the page opened; new news (a refresh after the tab regains focus) replaces it, an empty list doesn't
  const [moves, setMoves] = useState(fresh);
  if (fresh.length && idsOf(fresh) !== idsOf(moves)) setMoves(fresh);
  // keyed on the email ids, not the array: a revalidate hands a new array with the same moves, and must not restart it
  const key = idsOf(moves);

  useEffect(() => {
    if (!moves.length) return;
    let live = true;
    const calm = reducedMotion();
    const forward = moves.filter((m) => m.to !== "rejected");
    const mini = (m: NewsMove) => document.querySelector<SVGAElement>(`.cl-mini[data-app="${m.applicationId}"]`);

    // every moved mini wears platinum from the start (data-news, which also switches off its CSS entrance). The ones
    // waiting to hop are hidden by CSS (data-hop) until now; from here by data-wait instead. Both are attributes React
    // doesn't manage, so the revalidate after markMovesSeen (which drops data-hop and rewrites inline styles) can't
    // show a mini early or restart its entrance.
    forward.forEach((m) => {
      const el = mini(m);
      if (!el) return;
      if (el.dataset.hop) el.setAttribute("data-wait", "1");
      el.setAttribute("data-news", "1");
    });

    async function hop(el: SVGAElement) {
      const [dx, dy] = (el.dataset.hop ?? "0,0").split(",").map(Number);
      const stage = el.closest(".cl-step, .cl-peak");
      stage?.setAttribute("data-news", "1");
      setTimeout(() => stage?.removeAttribute("data-news"), 2600);
      if (calm || (!dx && !dy)) { el.removeAttribute("data-wait"); return; }
      const at = (x: number, y: number, extra = "") => `translate(${x}px, ${y}px) ${extra}`;
      const anim = el.animate([
        { opacity: 0, transform: at(dx, dy - 10, "scale(.6)") },
        { opacity: 1, transform: at(dx, dy), offset: 0.16 },
        { transform: at(dx, dy + 1.5, "scale(1.12, .84)"), offset: 0.32 },                      // crouch
        { transform: at(dx * 0.5, Math.min(dy, 0) * 0.5 - 46, "rotate(-10deg)"), offset: 0.62 },   // the arc's top
        { transform: at(0, 1.5, "scale(1.16, .8)"), offset: 0.84 },                                // land, squash
        { opacity: 1, transform: "none" },
      ], { duration: 1250, easing: "cubic-bezier(.45, 0, .25, 1)", fill: "forwards" });
      await anim.finished.catch(() => {});
      el.removeAttribute("data-wait");
    }

    (async () => {
      await wait(AFTER_ENTRANCE);
      for (const [n, m] of forward.entries()) {
        if (!live) return;
        const el = mini(m);
        if (n >= FULL) { el?.removeAttribute("data-wait"); continue; }
        if (el) await hop(el);
        if (!live) return;
        emitMoved({ jobId: m.jobId, company: m.company, from: m.from ?? "discovered", to: m.to });
        if (n < Math.min(forward.length, FULL) - 1) await wait(BETWEEN);
      }
      if (live) await markMovesSeen({ ids: moves.map((m) => m.emailId) });
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const saidNo = [...new Set(moves.filter((m) => m.to === "rejected").map((m) => m.company))];
  return saidNo.length ? <p className="cl-said">Since you last looked: {saidNo.join(", ")} said no.</p> : null;
}
