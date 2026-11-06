"use client";

/**
 * News on Roles (Jonno 2026-11-04): when the Gmail sync has moved roles forward that he hasn't watched yet, a platinum
 * cube sits at the end of the In progress heading (the list of his applications) and hops now and then, like a present
 * in a game lobby waiting to be opened. No label beside it (Jonno 2026-11-05): the count is engraved on its side and
 * the hover title says what moved. Same cube as the Climb's. Click it and it flies up into the Applications tab, then
 * the page follows and the Climb plays each move (components/ClimbReveal.tsx).
 *
 * Rejections never get a cube: nothing about them should invite a click. Reduced motion: it sits still and the click
 * just navigates.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { cube, faces, r1 } from "@/lib/ui/cubes";
import { reducedMotion } from "./motion";
import type { NewsMove } from "@/lib/queries";

const C = cube(22);
const F = faces(24, 1, C);
const STAGE_WORD: Record<string, string> = {
  applied: "Sent", tests: "Tests", hirevue: "HireVue", interview: "Interview", offer: "Offer",
};

export function MovedCube({ moves }: { moves: NewsMove[] }) {
  const forward = moves.filter((m) => m.to !== "rejected");
  const router = useRouter();
  const box = useRef<HTMLAnchorElement>(null);
  const flying = useRef(false);
  if (!forward.length) return null;

  const one = forward.length === 1 ? forward[0] : null;
  const k = (1.375 * C.a) / 44;

  function open(e: React.MouseEvent) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    const go = () => router.push("/applications", { transitionTypes: ["tab"] });
    const el = box.current?.querySelector<HTMLElement>(".mc-cube");
    const tab = document.querySelector<HTMLElement>('.nav a[href="/applications"] .nb') ?? document.querySelector<HTMLElement>('.nav a[href="/applications"]');
    if (!el || !tab || reducedMotion()) return go();
    if (flying.current) return;
    flying.current = true;
    // fly: a short crouch, then up and across into the tab's badge, shrinking to its size
    const a = el.getBoundingClientRect(), b = tab.getBoundingClientRect();
    const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const s = Math.max(0.2, b.height / a.height);
    el.getAnimations().forEach((x) => x.cancel());
    box.current?.classList.add("mc--off");
    const fly = el.animate([
      { transform: "none" },
      { transform: "translateY(4px) scale(1.08, .88)", offset: 0.16 },
      { transform: `translate(${r1(dx * 0.45)}px, ${r1(dy * 0.55 - 70)}px) rotate(-14deg) scale(.8)`, offset: 0.55 },
      { transform: `translate(${r1(dx)}px, ${r1(dy)}px) rotate(0) scale(${s})`, opacity: 0.9 },
    ], { duration: 700, easing: "cubic-bezier(.55, 0, .25, 1)", fill: "forwards" });
    fly.finished.then(go, go);
  }

  const label = one ? `${one.company} moved to ${STAGE_WORD[one.to] ?? one.to}` : `${forward.length} roles moved stage`;
  return (
    <Link ref={box} href="/applications" className="mc" onClick={open} title={label}
          aria-label={`${label}. Open Applications to see ${one ? "it" : "them"}.`}>
      <span className="mc-art" aria-hidden="true">
        <span className="mc-shadow" />
        <svg viewBox="0 0 48 54" width="34" height="38" className="mc-cube">
          <polygon points={F.left} className="mc-l" />
          <polygon points={F.right} className="mc-r" />
          <polygon points={F.top} className="mc-t" />
          <g transform={F.leftT}>
            <text x={C.a / 2} y={C.H * 0.72} textAnchor="middle" className="mc-n" style={{ fontSize: `${r1(C.a * 0.66)}px` }}>{forward.length}</text>
          </g>
          <g transform={F.rightT}>
            {/* the stairs going up: the Climb's direction */}
            <path transform={`translate(${r1(C.a / 2 - 8 * k)} ${r1(C.H / 2 - 8 * k)}) scale(${r1(k * 100) / 100})`}
                  d="M2.5 13.5h4v-4h3.5v-4h3.5V2.5" className="mc-ico" />
          </g>
        </svg>
      </span>
    </Link>
  );
}
