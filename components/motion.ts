"use client";

/**
 * Shared motion plumbing for the goal rings and the celebration stamp. No library: the Web Animations API does
 * everything here, and every effect checks `prefers-reduced-motion` first.
 */

export const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";          // expo-out
export const EASE_OUT_QUART = "cubic-bezier(0.25, 1, 0.5, 1)";

export const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ------------------------------------------------------------------ "a role moved forward"

export interface Moved { jobId: number; company: string; from: string; to: string }
const MOVED = "gf:moved";

/** Called after a stage move is saved. The celebration listens; nothing else depends on it. */
export function emitMoved(m: Moved) {
  window.dispatchEvent(new CustomEvent<Moved>(MOVED, { detail: m }));
}
export function onMoved(fn: (m: Moved) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<Moved>).detail);
  window.addEventListener(MOVED, h);
  return () => window.removeEventListener(MOVED, h);
}

// ------------------------------------------------------------------ the latest week numbers

/**
 * The week pill writes the server's latest numbers here whenever they change (a move revalidates the page, the pill
 * re-renders with new props), so the celebration can say "2 of 6 this week" once the save has landed.
 */
export interface WeekNumbers { sent: number; target: number; linedUp: number; sentTotal: number; streak: number }
let week: WeekNumbers | null = null;
const subs = new Set<() => void>();
export const weekStore = {
  get: () => week,
  set: (w: WeekNumbers) => { week = w; subs.forEach((f) => f()); },
  subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
};

// ------------------------------------------------------------------ last seen, per browser

const SEEN_KEY = "gf.week.seen.v1";
export interface Seen { weekStart: string; sent: number; linedUp: number; sentTotal: number }
export function readSeen(): Seen | null {
  try { const v = localStorage.getItem(SEEN_KEY); return v ? (JSON.parse(v) as Seen) : null; } catch { return null; }
}
export function writeSeen(s: Seen) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch { /* private window: the rings just don't replay */ }
}
