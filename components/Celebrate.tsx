"use client";

/**
 * The reward for moving a role forward: a card rises from the bottom and a rubber stamp lands on it (SENT, STARTED,
 * TESTS DONE, INTERVIEW, OFFER). The stamp comes down big and blurred, bites into the card with a small shake, and
 * leaves an ink ring behind. For a sent application the caption ticks up to the week's new count once the save has
 * landed ("2 of 6 this week"), and says so when that closes the week.
 *
 * Mounted once in the layout; listens for `emitMoved` (components/motion.ts). Backward moves and endings (rejected,
 * dismissed, closed) are never celebrated. Reduced motion: the card fades in and out, nothing flies.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { EASE_OUT, onMoved, reducedMotion, weekStore, type Moved } from "./motion";
import { Rolling } from "./Rings";

const STAMP: Record<string, { word: string; tone: string }> = {
  applying: { word: "Started", tone: "warm" },
  applied: { word: "Sent", tone: "mint" },
  tests_done: { word: "Tests done", tone: "mint" },
  hirevue_done: { word: "HireVue done", tone: "mint" },
  interview: { word: "Interview", tone: "vio" },
  interview_done: { word: "Interviewed", tone: "vio" },
  offer: { word: "Offer", tone: "gold" },
};
const ORDER = ["discovered", "interested", "applying", "applied", "tests", "tests_done", "hirevue", "hirevue_done", "interview", "interview_done", "offer"];
const HOLD_MS = 2600;

export function Celebrate() {
  const [m, setM] = useState<(Moved & { n: number; sentBefore: number | null }) | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const stamp = useRef<HTMLSpanElement>(null);
  const week = useSyncExternalStore(weekStore.subscribe, weekStore.get, () => null);

  useEffect(() => onMoved((mv) => {
    if (!STAMP[mv.to] || ORDER.indexOf(mv.to) <= ORDER.indexOf(mv.from)) return;
    setM({ ...mv, n: Date.now(), sentBefore: weekStore.get()?.sent ?? null });
  }), []);

  // choreography: card rises, stamp slams, ink ring spreads, card leaves
  useEffect(() => {
    if (!m || !card.current || !stamp.current) return;
    const c = card.current, s = stamp.current;
    const calm = reducedMotion();
    const anims: Animation[] = [];
    if (calm) {
      anims.push(c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, fill: "both" }));
    } else {
      anims.push(c.animate(
        [{ opacity: 0, transform: "translate(-50%, 24px) scale(.96)", filter: "blur(6px)" },
         { opacity: 1, transform: "translate(-50%, 0) scale(1)", filter: "blur(0)" }],
        { duration: 420, easing: EASE_OUT, fill: "both" },
      ));
      anims.push(s.animate(
        [{ opacity: 0, transform: "rotate(-22deg) scale(2.6)", filter: "blur(8px)" },
         { opacity: 1, transform: "rotate(-9deg) scale(.94)", filter: "blur(0)", offset: 0.72 },
         { opacity: 1, transform: "rotate(-9deg) scale(1)", filter: "blur(0)" }],
        { duration: 460, delay: 180, easing: "cubic-bezier(0.55, 0, 0.1, 1)", fill: "both" },
      ));
      // the bite: a short jolt through the card as the stamp hits
      anims.push(c.animate(
        [{ transform: "translate(-50%, 0) scale(1)" }, { transform: "translate(-50%, 2px) scale(.985)" }, { transform: "translate(-50%, 0) scale(1)" }],
        { duration: 220, delay: 510, easing: EASE_OUT, composite: "replace" },
      ));
      const ink = s.querySelector<HTMLElement>(".cel-ink");
      if (ink) anims.push(ink.animate(
        [{ opacity: 0.7, transform: "translate(-50%, -50%) scale(.6)" }, { opacity: 0, transform: "translate(-50%, -50%) scale(1.6)" }],
        { duration: 700, delay: 520, easing: EASE_OUT, fill: "forwards" },
      ));
    }
    const out = setTimeout(() => {
      const leave = c.animate(
        calm ? [{ opacity: 1 }, { opacity: 0 }]
          : [{ opacity: 1, transform: "translate(-50%, 0)", filter: "blur(0)" }, { opacity: 0, transform: "translate(-50%, 12px)", filter: "blur(4px)" }],
        { duration: calm ? 160 : 320, easing: EASE_OUT, fill: "forwards" },
      );
      leave.finished.then(() => setM((cur) => (cur?.n === m.n ? null : cur)), () => {});
    }, HOLD_MS);
    return () => { clearTimeout(out); anims.forEach((a) => a.cancel()); };
  }, [m]);

  if (!m) return null;
  const st = STAMP[m.to];
  const sentNow = week?.sent ?? null;
  const landed = m.to === "applied" && sentNow !== null && m.sentBefore !== null && sentNow > m.sentBefore;
  const closedWeek = landed && week && sentNow! >= week.target && m.sentBefore! < week.target;

  return (
    <div ref={card} className="cel" data-tone={st.tone} role="status" aria-live="polite"
         onClick={() => setM(null)}>
      <span ref={stamp} className="cel-stamp" aria-hidden="true">
        <span className="cel-ink" />
        {st.word}
      </span>
      <span className="cel-txt">
        <b>{m.company || "Role"}</b>
        <span>
          {m.to === "applied"
            ? landed
              ? <>{closedWeek ? "Week done: " : ""}<Rolling value={sentNow!} from={m.sentBefore} /> of {week!.target} this week</>
              : "Application sent"
            : m.to === "applying" ? "Lined up. Go get it" : ["tests_done", "hirevue_done", "interview_done"].includes(m.to) ? "Now it's their move" : m.to === "interview" ? "You're through to interview" : "An offer"}
        </span>
      </span>
      <span className="sr">{`${st.word}: ${m.company}`}</span>
    </div>
  );
}
