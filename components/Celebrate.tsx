"use client";

/**
 * The reward for moving a role forward (Jonno 2026-11-06: the rubber stamp was "the most vibecoded giveaway ever", so it
 * is gone). A toast carries a tiny Climb: six stairs, and a rigid cube that bounces in from the left and up the stairs
 * to the stage the role reached, spinning once on the last arc; each stair lights as it lands on it (lib/ui/bounce.ts is
 * the physics: nothing squashes, no face).
 * Beside it, in plain type: the stage, the company, and for a sent application the week's new count once the save has
 * landed ("2 of 6 this week"), saying so when that closes the week.
 *
 * Mounted once in the layout; listens for `emitMoved` (components/motion.ts). Backward moves and endings (rejected,
 * dismissed, closed) are never celebrated. The Climb's replay of Gmail moves (components/ClimbReveal.tsx) has already
 * bounced the real cube up the real stairs, so there (`replay`) the toast cube only hops once on the spot. Reduced
 * motion: the toast fades in and out, nothing moves.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { EASE_OUT, onMoved, reducedMotion, weekStore, type Moved } from "./motion";
import { Rolling } from "./Rings";
import { hopTrack, toKeyframes, type Pt, type Way } from "@/lib/ui/bounce";
import { thump } from "@/lib/ui/sound";
import { cube, faces, stageOf } from "@/lib/ui/cubes";

const WORD: Record<string, { word: string; tone: string }> = {
  applying: { word: "Started", tone: "warm" },
  applied: { word: "Sent", tone: "mint" },
  tests: { word: "Tests", tone: "plat" },
  hirevue: { word: "HireVue", tone: "plat" },
  tests_done: { word: "Tests done", tone: "mint" },
  hirevue_done: { word: "HireVue done", tone: "mint" },
  interview: { word: "Interview", tone: "vio" },
  interview_done: { word: "Interviewed", tone: "vio" },
  offer: { word: "Offer", tone: "gold" },
};
const ORDER = ["discovered", "interested", "applying", "applied", "tests", "tests_done", "hirevue", "hirevue_done", "interview", "interview_done", "offer"];
const MIN_HOLD_MS = 2600;

// the little stairs: six cubes rising to the right, the last one the Offer
const STEP = cube(10), HOPPER = cube(6.5);
const SX = (k: number) => 12 + k * 21;
const SY = (k: number) => 52 - k * 6;
const surface = (k: number): Pt => ({ x: SX(k), y: SY(k) + STEP.h });   // top face centre: where a cube stands

export function Celebrate() {
  const [m, setM] = useState<(Moved & { n: number; sentBefore: number | null }) | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const art = useRef<SVGSVGElement>(null);
  const week = useSyncExternalStore(weekStore.subscribe, weekStore.get, () => null);

  useEffect(() => onMoved((mv) => {
    if (!WORD[mv.to] || ORDER.indexOf(mv.to) <= ORDER.indexOf(mv.from)) return;
    setM({ ...mv, n: Date.now(), sentBefore: weekStore.get()?.sent ?? null });
  }), []);

  // choreography: card rises, the cube bounces up the stairs lighting them, card leaves
  useEffect(() => {
    if (!m || !card.current || !art.current) return;
    const c = card.current, svg = art.current;
    const calm = reducedMotion();
    const anims: Animation[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => { timers.push(setTimeout(fn, ms)); };
    let holdMs = MIN_HOLD_MS;
    if (calm) {
      anims.push(c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, fill: "both" }));
    } else {
      anims.push(c.animate(
        [{ opacity: 0, transform: "translate(-50%, 24px) scale(.96)" }, { opacity: 1, transform: "translate(-50%, 0) scale(1)" }],
        { duration: 420, easing: EASE_OUT, fill: "both" },
      ));
      const to = stageOf(m.to), from = stageOf(m.from);
      const body = svg.querySelector<SVGGElement>(".cel-hop");
      const stairs = svg.querySelectorAll<SVGGElement>(".cel-step");
      if (body && to >= 0) {
        // the journey on the little stairs: in from the left, then up each stair it passes, a spin on the last arc.
        // A move within one stage (tests -> tests done), or the Climb's replay (which has already bounced the real cube
        // up the real stairs), is one hop on the spot.
        const rest = surface(to);
        const inPlace = m.replay || from === to;
        const ks: number[] = [];
        if (!inPlace) for (let k = Math.max(from, 0); k <= to; k++) ks.push(k);
        const spots: Way[] = inPlace
          ? [{ ...rest }, { ...rest, lift: 40, spin: m.replay ? 0 : 1 }]
          : [{ x: surface(ks[0]).x - 30, y: surface(ks[0]).y + 14 }, ...ks.map((k, i) => ({ ...surface(k), spin: k === to || i === 0 ? 1 : 0 }))];   // a spin on the way in, and one on the last arc
        const pts = spots.map((p) => ({ ...p, x: p.x - rest.x, y: p.y - rest.y }));
        const restTop = rest.y - HOPPER.h - HOPPER.H;
        const track = hopTrack(pts, { ceil: 3 - restTop, pace: pts.length > 4 ? 1.3 : 1 });
        const delay = 260;                            // after the card has begun to rise
        anims.push(body.animate(toKeyframes(track.frames, track.duration), { duration: track.duration * 1000, delay, easing: "linear", fill: "both" }));
        // a stair lights up as the cube lands on it
        if (inPlace) stairs.forEach((s, k) => { if (k <= to) s.setAttribute("data-lit", "1"); });
        else track.landings.forEach((l) => later(() => stairs[ks[l.at - 1]]?.setAttribute("data-lit", "1"), delay + l.t * 1000));
        track.landings.forEach((l, j) => later(() => thump(j === track.landings.length - 1 ? 110 : 160 + 14 * j, j === track.landings.length - 1 ? 0.12 : 0.05), delay + l.t * 1000));
        holdMs = Math.max(MIN_HOLD_MS, delay + track.duration * 1000 + 1500);
      }
    }
    const out = setTimeout(() => {
      const leave = c.animate(
        calm ? [{ opacity: 1 }, { opacity: 0 }]
          : [{ opacity: 1, transform: "translate(-50%, 0)" }, { opacity: 0, transform: "translate(-50%, 12px)" }],
        { duration: calm ? 160 : 320, easing: EASE_OUT, fill: "forwards" },
      );
      leave.finished.then(() => setM((cur) => (cur?.n === m.n ? null : cur)), () => {});
    }, holdMs);
    return () => { clearTimeout(out); timers.forEach(clearTimeout); anims.forEach((a) => a.cancel()); };
  }, [m]);

  if (!m) return null;
  const st = WORD[m.to];
  const to = stageOf(m.to);
  const sentNow = week?.sent ?? null;
  const landed = m.to === "applied" && sentNow !== null && m.sentBefore !== null && sentNow > m.sentBefore;
  const closedWeek = landed && week && sentNow! >= week.target && m.sentBefore! < week.target;
  const hf = faces(SX(to), SY(to) + STEP.h - HOPPER.h - HOPPER.H, HOPPER);   // standing on its step: bottom face centre at the step's top face centre

  return (
    <div ref={card} className="cel" data-tone={st.tone} role="status" aria-live="polite" onClick={() => setM(null)}>
      <svg ref={art} className="cel-art" viewBox="0 0 132 86" width="132" height="86" aria-hidden="true">
        {Array.from({ length: 6 }, (_, k) => {
          const f = faces(SX(k), SY(k), STEP);
          return (
            <g key={k} className="cel-step" data-top={k === 5 ? "1" : undefined}>
              <polygon points={f.left} className="cl-l" /><polygon points={f.right} className="cl-r" /><polygon points={f.top} className="cl-t" />
            </g>
          );
        })}
        <g className="cel-hop">
          <polygon points={hf.left} className="cl-l" /><polygon points={hf.right} className="cl-r" /><polygon points={hf.top} className="cl-t" />
        </g>
      </svg>
      <span className="cel-txt">
        <em>{st.word}</em>
        <b>{m.company || "Role"}</b>
        <span>
          {m.to === "applied"
            ? landed
              ? <>{closedWeek ? "Week done: " : ""}<Rolling value={sentNow!} from={m.sentBefore} /> of {week!.target} this week</>
              : "Application sent"
            : m.to === "tests" ? "Invited to the online tests" : m.to === "hirevue" ? "Invited to a HireVue"
            : m.to === "applying" ? "Lined up. Go get it" : ["tests_done", "hirevue_done", "interview_done"].includes(m.to) ? "Now it's their move" : m.to === "interview" ? "You're through to interview" : "An offer"}
        </span>
      </span>
      <span className="sr">{`${st.word}: ${m.company}`}</span>
    </div>
  );
}

