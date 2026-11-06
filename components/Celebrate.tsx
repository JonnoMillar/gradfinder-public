"use client";

/**
 * The reward for moving a role forward: a card rises from the bottom and a rubber stamp lands on it (SENT, STARTED,
 * TESTS DONE, INTERVIEW, OFFER). The stamp comes down big and blurred, bites into the card with a small shake, and
 * leaves an ink ring behind. For a sent application the caption ticks up to the week's new count once the save has
 * landed ("2 of 6 this week"), and says so when that closes the week.
 *
 * Mounted once in the layout; listens for `emitMoved` (components/motion.ts). Backward moves and endings (rejected,
 * dismissed, closed) are never celebrated. Reduced motion: the card fades in and out, nothing flies.
 *
 * The Climb's replay of Gmail moves (components/ClimbReveal.tsx) uses it too: an invite to tests or a HireVue is
 * stamped in platinum, the colour of news from outside. Interview and Offer, the real milestones, add a short burst of
 * confetti from the stamp; nothing else does, so it still means something when it comes.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { EASE_OUT, onMoved, reducedMotion, weekStore, type Moved } from "./motion";
import { Rolling } from "./Rings";

const STAMP: Record<string, { word: string; tone: string }> = {
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
const HOLD_MS = 2600;
const CONFETTI = new Set(["interview", "offer"]);

/**
 * Confetti from the stamp: a few dozen bits thrown up and out, falling back with a tumble, gone in under two seconds.
 * Three shapes and three lightnesses (the stage's tone, platinum, near-white), so it reads without hue. Pieces live on
 * <body> for the length of their flight only.
 */
function burst(from: HTMLElement, tone: string) {
  const r = from.getBoundingClientRect();
  const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
  const colours = [tone, "var(--plat)", "oklch(0.98 0.01 240)"];
  const sizes = [[8, 8], [6, 13], [4, 15]];
  for (let n = 0; n < 40; n++) {
    const el = document.createElement("i");
    const [w, h] = sizes[n % 3];
    el.className = "cel-bit";
    el.style.cssText = `left:${x0}px;top:${y0}px;width:${w}px;height:${h}px;background:${colours[n % 3]};border-radius:${n % 3 === 0 ? "50%" : "1px"}`;
    document.body.appendChild(el);
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;   // mostly upwards, fanned out
    const v = 140 + Math.random() * 190;
    const dx = Math.cos(a) * v, dy = Math.sin(a) * v;
    const spin = (Math.random() - 0.5) * 900;
    el.animate([
      { transform: "translate(-50%, -50%) rotate(0) scale(.4)", opacity: 1 },
      { transform: `translate(calc(-50% + ${dx * 0.8}px), calc(-50% + ${dy * 0.8}px)) rotate(${spin * 0.5}deg) scale(1)`, opacity: 1, offset: 0.35 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 260}px)) rotate(${spin}deg) scale(.9)`, opacity: 0 },
    ], { duration: 1300 + Math.random() * 600, easing: "cubic-bezier(.2, .7, .4, 1)", fill: "forwards" })
      .finished.then(() => el.remove(), () => el.remove());
  }
}

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
    let confetti: ReturnType<typeof setTimeout> | undefined;
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
      if (CONFETTI.has(m.to)) confetti = setTimeout(() => burst(s, getComputedStyle(c).getPropertyValue("--tone").trim() || "var(--plat)"), 540);
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
    return () => { clearTimeout(out); clearTimeout(confetti); anims.forEach((a) => a.cancel()); };
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
            : m.to === "tests" ? "Invited to the online tests" : m.to === "hirevue" ? "Invited to a HireVue"
            : m.to === "applying" ? "Lined up. Go get it" : ["tests_done", "hirevue_done", "interview_done"].includes(m.to) ? "Now it's their move" : m.to === "interview" ? "You're through to interview" : "An offer"}
        </span>
      </span>
      <span className="sr">{`${st.word}: ${m.company}`}</span>
    </div>
  );
}
