"use client";

/**
 * Concentric progress rings, after Apple's Activity rings (Jonno 2026-09-29: "applications, online tests, hirevues, and
 * interviews as different rings"). One ring per kind of task, outside in: applications sent this week (against the
 * weekly target), online tests sat (against the tests he has to do), and later HireVues and interviews. A ring with
 * nothing to do this week shows just its track. A change sweeps the arc from the old value to the new one (expo-out);
 * completing a ring throws a small burst of sparks off its end and gives it one glow. Reduced motion: values jump.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EASE_OUT, reducedMotion } from "./motion";
import { HIREVUES_PER_WEEK, TESTS_PER_WEEK } from "@/lib/tracker/goals";

export type RingKey = "send" | "tests" | "video" | "interview";
export interface RingSpec { key: RingKey; value: number; target: number; label: string }

/** radii outside in, in a 100-unit box; stroke 11 leaves a 2-unit gap between rings */
const RADII = [41, 28, 15];
const COLOR: Record<RingKey, string> = { send: "var(--mint)", tests: "var(--ring-2)", video: "var(--ring-3)", interview: "var(--ring-4)" };

const frac = (v: number, t: number) => (t <= 0 ? 0 : Math.min(1, v / t));

export function Rings({ rings, size = 120, from, className, burst = true }: {
  rings: RingSpec[]; size?: number;
  /** replay from these values on mount (the numbers last seen in this browser) */
  from?: Partial<Record<RingKey, number>> | null;
  className?: string; burst?: boolean;
}) {
  const arcs = useRef<Record<string, SVGCircleElement | null>>({});
  const box = useRef<HTMLSpanElement>(null);
  const prev = useRef<Partial<Record<RingKey, number>> | null>(null);
  const sig = rings.map((r) => `${r.key}:${r.value}/${r.target}`).join(",");

  useLayoutEffect(() => {
    // a replay on mount (panel opened, or numbers since the last visit) sweeps but never bursts: the burst is for the
    // moment a ring is actually completed, not for every look at it
    const replay = prev.current === null;
    const start = prev.current ?? from ?? {};
    prev.current = Object.fromEntries(rings.map((r) => [r.key, r.value]));
    rings.forEach((r, i) => {
      const el = arcs.current[r.key];
      if (!el) return;
      const a = frac(start[r.key] ?? r.value, r.target);
      const b = frac(r.value, r.target);
      el.style.strokeDashoffset = String(1 - b);
      el.style.opacity = b > 0 ? "1" : "0";
      if (a === b || reducedMotion()) return;
      el.animate(
        [{ strokeDashoffset: 1 - a, opacity: a > 0 ? 1 : 0.001 }, { strokeDashoffset: 1 - b, opacity: 1 }],
        { duration: 1100 + Math.abs(b - a) * 500, easing: EASE_OUT, delay: i * 90 },
      );
      if (burst && !replay && a < 1 && b >= 1 && box.current) sparks(box.current, COLOR[r.key]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, from, burst]);

  const label = rings.map((r) => (r.target ? `${r.label} ${r.value} of ${r.target}` : `${r.label}: none this week`)).join(", ");
  return (
    <span ref={box} className={`rings${className ? ` ${className}` : ""}`} style={{ width: size, height: size }}
          role="img" aria-label={`This week: ${label}`}>
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        {rings.map((r, i) => (
          <g key={r.key} data-ring={r.key} data-empty={r.target ? undefined : "1"}>
            <circle className="ring-track" cx="50" cy="50" r={RADII[i]} pathLength={1} />
            <circle
              className="ring-arc" cx="50" cy="50" r={RADII[i]} pathLength={1}
              ref={(el) => { arcs.current[r.key] = el; }}
              style={{ strokeDashoffset: 1 - frac(r.value, r.target) }}
            />
          </g>
        ))}
      </svg>
    </span>
  );
}

/** The rings for a week, outside in: applications sent, online assessments sat, HireVues recorded. Each against its own target. */
export function weekRings(g: { sent: number; target: number; testsDone: number; hirevuesDone: number }): RingSpec[] {
  return [
    { key: "send", value: g.sent, target: g.target, label: "Applications sent" },
    { key: "tests", value: g.testsDone, target: TESTS_PER_WEEK, label: "Online assessments done" },
    { key: "video", value: g.hirevuesDone, target: HIREVUES_PER_WEEK, label: "HireVues done" },
  ];
}

/** A dozen sparks off the top of the ring (where every arc ends when full), plus one glow on the whole thing. */
function sparks(host: HTMLElement, color: string) {
  host.animate(
    [{ filter: "drop-shadow(0 0 0 transparent)" }, { filter: `drop-shadow(0 0 10px ${color})` }, { filter: "drop-shadow(0 0 0 transparent)" }],
    { duration: 900, easing: EASE_OUT, delay: 700 },
  );
  // radial streaks: each one is rotated to its angle, then pushed out from just outside the ring
  const n = 14;
  const w = host.clientWidth;
  for (let i = 0; i < n; i++) {
    const s = document.createElement("i");
    s.className = "spark";
    s.style.background = color;
    s.style.color = color;
    host.appendChild(s);
    const deg = (i / n) * 360 + (Math.random() * 14 - 7);
    const r0 = w * 0.5, r1 = w * (0.62 + Math.random() * 0.08), r2 = w * (0.74 + Math.random() * 0.12);
    const at = (r: number, sy: number) => `translate(-50%, -50%) rotate(${deg}deg) translateY(${-r}px) scaleY(${sy})`;
    s.animate(
      [
        { transform: at(r0, 0.3), opacity: 0 },
        { transform: at(r1, 1), opacity: 1, offset: 0.3 },
        { transform: at(r2, 0.2), opacity: 0 },
      ],
      { duration: 850 + Math.random() * 250, easing: EASE_OUT, delay: 620 + Math.random() * 60 },
    ).finished.then(() => s.remove(), () => s.remove());
  }
}

/**
 * Odometer-style number: each digit is a column of 0–9 that slides to its value. Replays from `from` on mount.
 * Reduced motion: the transition is off in CSS, so it just shows the number.
 */
export function Rolling({ value, from, className }: { value: number; from?: number | null; className?: string }) {
  const [shown, setShown] = useState(from ?? value);
  useEffect(() => {
    if (shown === value) return;
    const t = requestAnimationFrame(() => requestAnimationFrame(() => setShown(value)));
    return () => cancelAnimationFrame(t);
  }, [value, shown]);
  const width = String(Math.max(value, from ?? 0, shown)).length;
  const digits = String(shown).padStart(width, " ").split("");
  return (
    <span className={`roll${className ? ` ${className}` : ""}`} aria-label={String(value)}>
      {digits.map((d, i) => (
        <span key={width - i} className="roll-col" data-blank={d === " " ? "1" : undefined} aria-hidden="true">
          <span className="roll-strip" style={{ transform: `translateY(${-(d === " " ? 0 : Number(d)) * 10}%)` }}>
            {"0123456789".split("").map((n) => <span key={n}>{n}</span>)}
          </span>
        </span>
      ))}
    </span>
  );
}
