"use client";

/**
 * The Climb's replay (Jonno 2026-11-10: "a run through of applications ... matching the timing of when applications
 * went out, when things moved stages and when rejected ... the cubes should bounce along to their stage ... falling into
 * graves below with rejection"; second pass the same day: slower, a tally you watch tick up, stages that light up and
 * jump as their number rolls over, falls you can follow, a bounce and spin when a stage is done, piles stacked right,
 * and no back-and-forth from a corrected misclick).
 *
 * "Replay" (ClimbStage) grows the card to show the whole world, stairs and graveyard at once. The real piles, counts and
 * graves are hidden (CSS on `data-view="all"`; every grave gets `data-pending`), and this layer replays the activity
 * log on its own cubes, one per application:
 *
 *  - a role entering the tracker hops in from the left onto its stage, via each stair before it (each lights as it lands);
 *  - a move forward bounces up stair by stair to its new pile; a move back is one hop; a stage done (tests sat, HireVue
 *    done) is a high bounce with a spin on the spot;
 *  - a rejection: the cube hops to its stage's front corner, turns blue-violet and tumbles off, slowly enough to follow,
 *    into its grave; the lid slides open, it sinks in, the lid shuts and the headstone comes up;
 *  - closed or dismissed: the cube fades out where it stands.
 *
 * Counts change when a cube arrives or leaves, not before, and roll over (the old number slides out, the new one in);
 * the stage it lands on flashes and jumps. A stage nobody is on is dim and dashed, lit once someone is. Top left: the
 * applications-sent tally, big, rolling up; the date; live and buried; a timeline with a tick per application sent and a
 * cross per rejection.
 *
 * Time: each event's moment is part real time, part its turn in the queue (`script`), so a burst of moves made minutes
 * apart is spread out enough to watch while long quiet spells still read as quiet. The date follows the same mapping.
 * A move undone within the hour (a misclick, a wrong Gmail match) is dropped with its undo (`settle`).
 *
 * Paint order: SVG draws later elements on top, so a cube that lands is put back in its pile's back-to-front order (layer,
 * then depth, as Climb.tsx's Pile sorts), and a cube in flight is drawn over everything.
 */
import { useEffect, useMemo, useRef, useState, type SVGProps } from "react";
import { hopTrack, toKeyframes, type Way } from "@/lib/ui/bounce";
import { faces, pileSpot, r1, MINI, STAIRS, stageOf, stageTop } from "@/lib/ui/cubes";
import { thump } from "@/lib/ui/sound";
import { reducedMotion } from "./motion";
import { useReplay } from "./ClimbStage";
import { GRAVE_DEPTH } from "./Graveyard";

export type ReplayMove = { appId: number; to: string; at: string };

const GROW_MS = 1200;     // the card's growth (.cl-stage transition in globals.css) before the first move
const HOLD_MS = 3000;     // the finished picture, before handing back
const LIN_MS = 16000;     // the real-time share of the replay: the whole history squeezed into this
const PER_MS = 420;       // the queue share: each event adds this much, so bursts spread out
const UNDO_MS = 3_600_000;   // a move reversed within this is a correction, not history
const PACE = 0.82;        // hop speed (gravity scale): below 1 is slower than the live Climb
const BAR = { x: 30, y: 182, w: 330 };
const KEYS = [...STAIRS.map((s) => s.key), "offer"];
const mini = faces(0, 0, MINI);   // a cube drawn with its top vertex at the origin; moved by its transform
const fmt = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** where a cube stands: its top vertex in the drawing's units */
type At = { x: number; y: number };
/** what happens to one cube at one moment, worked out up front from the log */
type Step =
  | { kind: "move"; from: number | null; to: number; slot: number }
  | { kind: "nudge" }
  | { kind: "fall"; from: number }
  | { kind: "reveal" }
  | { kind: "leave" };
export type Beat = {
  t: number; real: number; appId: number; step: Step;
  /** the picture once it has happened (tests use these) */
  counts: number[]; sent: number; buried: number;
  /** this beat is the role's first time sent; this beat brings a rejected role back */
  sends: boolean; unbury: boolean;
};

/** drop each move undone within `within` ms, with its undo: X → Y then back to X straight after was never history */
export function settle(moves: ReplayMove[], within = UNDO_MS): ReplayMove[] {
  const keep = moves.map(() => true);
  const status = new Map<number, string>();
  const last = new Map<number, { i: number; prev: string }>();   // per app: its latest kept move and the status before it
  moves.forEach((m, i) => {
    const before = status.get(m.appId) ?? "discovered";
    const l = last.get(m.appId);
    status.set(m.appId, m.to);
    if (l && m.to === l.prev && Date.parse(m.at) - Date.parse(moves[l.i].at) < within) {
      keep[l.i] = keep[i] = false;
      last.delete(m.appId);
      return;
    }
    last.set(m.appId, { i, prev: before });
  });
  return moves.filter((_, i) => keep[i]);
}

/** the whole replay as a script: each log row becomes one cube's step, timed; T = its length in ms */
export function script(input: ReplayMove[], o = { lin: LIN_MS, per: PER_MS }): { beats: Beat[]; T: number } {
  const moves = settle(input);
  const where = new Map<number, number | null>();   // app → stage index it stands on (null = off the climb)
  const slots: (number | null)[][] = KEYS.map(() => []);
  const sentSet = new Set<number>();
  const dead = new Set<number>();   // rejected and not reopened since

  const free = (app: number, s: number) => { const k = slots[s].indexOf(app); if (k >= 0) slots[s][k] = null; };
  const take = (app: number, s: number) => {
    const k = slots[s].indexOf(null);
    if (k >= 0) { slots[s][k] = app; return k; }
    return slots[s].push(app) - 1;
  };
  const beats: Beat[] = [];
  for (const m of moves) {
    const at = where.get(m.appId) ?? null;
    const s = stageOf(m.to);
    let step: Step | null = null;
    const before = sentSet.size;
    const wasDead = dead.has(m.appId);
    if (m.to !== "rejected") dead.delete(m.appId);   // reopened (a rejection undone)
    if (m.to === "rejected") {
      dead.add(m.appId);
      if (at !== null) { free(m.appId, at); step = { kind: "fall", from: at }; }
      else step = { kind: "reveal" };
      where.set(m.appId, null);
    } else if (s >= 0) {
      if (s >= 1) sentSet.add(m.appId);
      if (at === s) step = { kind: "nudge" };
      else {
        if (at !== null) free(m.appId, at);
        step = { kind: "move", from: at, to: s, slot: take(m.appId, s) };
        where.set(m.appId, s);
      }
    } else if (at !== null) {
      free(m.appId, at);
      step = { kind: "leave" };
      where.set(m.appId, null);
    }
    if (!step) continue;
    beats.push({
      t: 0, real: Date.parse(m.at), appId: m.appId, step,
      counts: slots.map((r) => r.filter((x) => x !== null).length), sent: sentSet.size, buried: dead.size,
      sends: sentSet.size > before, unbury: wasDead && !dead.has(m.appId),
    });
  }
  if (!beats.length) return { beats, T: 0 };
  const t0 = beats[0].real, span = beats[beats.length - 1].real - t0;
  beats.forEach((b, i) => { b.t = Math.round((span > 0 ? ((b.real - t0) / span) * o.lin : 0) + i * o.per); });
  return { beats, T: beats[beats.length - 1].t };
}

/** the real date at replay time τ: straight lines between the beats */
function realAt(beats: Beat[], tau: number) {
  if (!beats.length) return 0;
  if (tau <= beats[0].t) return beats[0].real;
  for (let i = 1; i < beats.length; i++) {
    const a = beats[i - 1], b = beats[i];
    if (tau <= b.t) return b.t > a.t ? a.real + ((tau - a.t) / (b.t - a.t)) * (b.real - a.real) : b.real;
  }
  return beats[beats.length - 1].real;
}

/** one calendar page's words: month and year on the strip, the day, the weekday */
const parts = (ms: number) => {
  const d = new Date(ms), l = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-GB", o);
  return { mon: `${l({ month: "short" })} ${d.getFullYear()}`.toUpperCase(), day: String(d.getDate()), wd: l({ weekday: "long" }) };
};
const dayKey = (ms: number) => new Date(ms).toDateString();
const CAL = { w: 84, h: 96, strip: 33 };   // a page, in drawing units; its top edge is the binding

/** a page of the calendar: month and year, a rule, the big day, the weekday (the words are rewritten by `calendar`) */
function Page({ ms }: { ms: number }) {
  const p = parts(ms), x = -CAL.w / 2;
  return (
    <>
      <rect x={x} y={0} width={CAL.w} height={CAL.h} rx={10} className="rp-paper" />
      <path d={`M${x} ${CAL.strip} V10 a10 10 0 0 1 10 -10 H${-x - 10} a10 10 0 0 1 10 10 V${CAL.strip} Z`} className="rp-strip" />
      <text y={23} textAnchor="middle" className="rp-mon" data-f="mon">{p.mon}</text>
      <line x1={x} x2={-x} y1={CAL.strip} y2={CAL.strip} className="rp-rule" />
      <text y={74} textAnchor="middle" className="rp-day" data-f="day">{p.day}</text>
      <text y={89} textAnchor="middle" className="rp-wd" data-f="wd">{p.wd}</text>
    </>
  );
}

/**
 * The date as a tear-off calendar (Jonno 2026-11-12: "calendar pages turning away as the number increases"). The page on
 * top folds up over its binding (scaleY to a line, then its blank back swinging up and away) and the next day's page is
 * already waiting underneath. The date moves faster than a page can turn when a burst of events is crowded together, so
 * a page turns at most once at a time and then goes straight to the latest day (skipping the days in between).
 */
function calendar(root: SVGGElement, calm: boolean) {
  const q = (pg: string) => root.querySelector<SVGGElement>(`[data-pg="${pg}"]`)!;
  const front = q("front"), under = q("under"), back = q("back"), shade = front.querySelector<SVGRectElement>(".rp-shade")!;
  const paint = (pg: Element, ms: number) => {
    const p = parts(ms);
    (["mon", "day", "wd"] as const).forEach((f) => { const t = pg.querySelector(`[data-f="${f}"]`); if (t) t.textContent = p[f]; });
  };
  const anims: Animation[] = [];
  const clear = () => { anims.splice(0).forEach((a) => a.cancel()); };
  let shown = 0, want = 0, busy = false, gen = 0;
  const FOLD = 110, SWING = 170;   // ms: the front folds flat, then the back swings up and away

  const flip = async () => {
    if (busy || dayKey(want) === dayKey(shown)) return;
    busy = true;
    const me = gen, next = want;
    paint(under, next);
    if (!calm) {
      const go = (el: Element, kf: Keyframe[], o: KeyframeAnimationOptions) => { const a = el.animate(kf, { fill: "forwards", ...o }); anims.push(a); return a.finished.catch(() => {}); };
      await Promise.all([
        go(front, [{ transform: "scaleY(1)" }, { transform: "scaleY(0)" }], { duration: FOLD, easing: "cubic-bezier(.5, 0, 1, .6)" }),
        go(shade, [{ opacity: 0 }, { opacity: 0.5 }], { duration: FOLD }),
        go(back, [{ transform: "scaleY(0)", opacity: 1 }, { transform: "scaleY(-1)", opacity: 1, offset: 0.7 }, { transform: "scaleY(-1.04)", opacity: 0 }],
          { duration: SWING, delay: FOLD, easing: "cubic-bezier(0, .5, .4, 1)" }),
      ]);
    }
    if (me !== gen) return;   // reset while turning
    paint(front, next);
    shown = next;
    clear();
    busy = false;
    void flip();
  };
  return {
    set(ms: number) { want = ms; void flip(); },
    reset(ms: number) { gen++; clear(); busy = false; shown = want = ms; paint(front, ms); paint(under, ms); },
    stop() { gen++; clear(); },
  };
}

/** a number that rolls over when it changes: the old one slides out, the new one in (up for more, down for fewer) */
function Roll({ v, className, ...p }: { v: number } & SVGProps<SVGTextElement>) {
  const [s, setS] = useState({ v, old: v, n: 0 });
  if (s.v !== v) setS({ v, old: s.v, n: s.n + 1 });
  return (
    <g className="roll" data-dir={s.v >= s.old ? "up" : "down"}>
      {s.n ? <text key={`o${s.n}`} {...p} className={`${className} roll-out`}>{s.old}</text> : null}
      <text key={`n${s.n}`} {...p} className={`${className}${s.n ? " roll-in" : ""}`}>{s.v}</text>
    </g>
  );
}

type Shown = { counts: number[]; sent: number; buried: number };
const ZERO: Shown = { counts: KEYS.map(() => 0), sent: 0, buried: 0 };

export function ClimbReplay({ moves }: { moves: ReplayMove[] }) {
  const { playing, stop } = useReplay();
  const { beats, T } = useMemo(() => script(moves), [moves]);
  const t0 = beats[0]?.real ?? 0, t1 = beats[beats.length - 1]?.real ?? 0;
  const apps = useMemo(() => [...new Set(beats.filter((b) => b.step.kind !== "reveal").map((b) => b.appId))], [beats]);
  const [shown, setShown] = useState<Shown>(ZERO);
  const layer = useRef<SVGGElement>(null);
  const pile = useRef<SVGGElement>(null);
  const cal = useRef<SVGGElement>(null);
  const bar = useRef<SVGLineElement>(null);

  useEffect(() => {
    const root = layer.current, cubes = pile.current;
    if (!playing || !root || !cubes) return;
    const svg = root.ownerSVGElement!;
    let live = true;
    const calm = reducedMotion();
    const timers: ReturnType<typeof setTimeout>[] = [];
    const anims: Animation[] = [];
    const chains = new Map<number, Promise<void>>();
    const pos = new Map<number, At>();
    const on = new Map<number, number>();   // app → the stage its cube stands on
    const z =new Map<Element, number>();   // a resting cube's paint key (layer, depth); Infinity in flight
    const cubeEl = (id: number) => cubes.querySelector<SVGGElement>(`.rp-cube[data-app="${id}"]`);
    const grave = (id: number) => svg.querySelector<SVGAElement>(`.gy-grave[data-grave="${id}"]`);
    const stageEl = (k: number) => svg.querySelector<SVGGElement>(k >= 5 ? ".cl-peak" : `.cl-step[data-s="${KEYS[k]}"]`);
    const countEl = (k: number) => root.querySelector<SVGGElement>(`.rp-k[data-k="${k}"]`);
    const graves = [...svg.querySelectorAll<SVGAElement>(".gy-grave")];
    graves.forEach((g) => { g.setAttribute("data-pending", "1"); g.removeAttribute("data-open"); g.removeAttribute("data-dig"); });
    cubes.querySelectorAll<SVGGElement>(".rp-cube").forEach((c) => { c.style.transform = ""; c.style.opacity = "0"; c.removeAttribute("data-fall"); });

    // the picture, kept here and copied to React whenever it changes
    const now: Shown = { counts: KEYS.map(() => 0), sent: 0, buried: 0 };
    const light = (k: number) => {
      const on = now.counts[k] > 0;
      stageEl(k)?.toggleAttribute("data-rp-on", on);
      countEl(k)?.toggleAttribute("data-on", on);
    };
    const sync = () => setShown({ counts: [...now.counts], sent: now.sent, buried: now.buried });
    const add = (k: number, d: number) => { now.counts[k] = Math.max(0, now.counts[k] + d); light(k); };
    KEYS.forEach((_, k) => light(k));
    sync();

    const place = (el: SVGGElement, p: At, o = 1) => { el.style.transform = `translate(${r1(p.x)}px, ${r1(p.y)}px)`; el.style.opacity = String(o); };
    const play = async (el: Element, kf: Keyframe[], ms: number, easing = "linear") => {
      if (calm || ms <= 0) return;
      const a = el.animate(kf, { duration: ms, easing, fill: "forwards" });
      anims.push(a);
      await a.finished.catch(() => {});
      a.cancel();
    };
    /** the stage it lands on lights up and gives a little jump, its number with it */
    const flash = (k: number, jump: boolean) => {
      if (calm) return;
      const top = stageEl(k)?.querySelector(":scope > .cl-t");
      if (top) void play(top, [{ filter: "brightness(1.9)" }, { filter: "brightness(1)" }], 800, "ease-out");
      if (!jump) return;
      const kf = [{ translate: "0 0" }, { translate: "0 -7px", offset: 0.35 }, { translate: "0 0" }];
      [stageEl(k), countEl(k)].forEach((el) => el && void play(el, kf, 420, "cubic-bezier(.3, .7, .4, 1)"));
    };
    // paint order: in flight on top; at rest, back to front within the pile
    const lastCube = () => cubes.lastElementChild;
    const fly = (el: SVGGElement) => { z.set(el, Infinity); if (lastCube() !== el) cubes.appendChild(el); };
    const rest = (el: SVGGElement, key: number) => {
      z.set(el, key);
      const after = [...cubes.children].find((c) => c !== el && (z.get(c) ?? 0) > key);
      if (after) cubes.insertBefore(el, after); else if (lastCube() !== el) cubes.appendChild(el);
    };

    /** a cube standing on stage k's top face (the middle), for the stairs on the way */
    const onStage = (k: number): At => { const s = stageTop(k); return { x: s.x, y: s.y + s.c.h - MINI.h - MINI.H }; };
    const slotAt = (k: number, n: number) => { const s = stageTop(k); return pileSpot(s.x, s.y, s.c, s.cells, n); };

    async function run(b: Beat) {
      const id = b.appId, el = cubeEl(id), st = b.step;
      if (st.kind === "reveal") {
        grave(id)?.removeAttribute("data-pending");
        now.buried++; sync();
        return;
      }
      if (!el) return;
      const p = pos.get(id);
      if (b.unbury) { now.buried = Math.max(0, now.buried - 1); sync(); }
      if (st.kind === "move") {
        const spot = slotAt(st.to, st.slot), dest = { x: spot.x, y: spot.y };
        el.setAttribute("data-s", KEYS[st.to]);
        el.removeAttribute("data-fall");
        const ways: Way[] = [], stops: number[] = [];   // stops: the stage under each waypoint after the first
        if (st.from === null || !p) {
          ways.push({ x: -30, y: onStage(0).y + 40 });
          place(el, ways[0]);
          for (let k = 0; k < st.to; k++) { ways.push(onStage(k)); stops.push(k); }
        } else {
          ways.push(p);
          add(st.from, -1); sync();
          for (let k = st.from + 1; k < st.to; k++) { ways.push(onStage(k)); stops.push(k); }
        }
        ways.push({ ...dest, spin: st.to - (st.from ?? -1) > 1 ? 1 : 0 });
        stops.push(st.to);
        fly(el);
        const tr = hopTrack(ways, { pace: PACE * Math.min(1.4, 1 + (ways.length - 2) * 0.1) });
        // each stair it bounces on lights as it lands
        tr.landings.slice(0, -1).forEach((l, n) => timers.push(setTimeout(() => live && flash(stops[n], false), l.t * 1000)));
        await play(el, toKeyframes(tr.frames, tr.duration), tr.duration * 1000);
        if (!live) return;
        place(el, dest);
        rest(el, spot.layer * 100 + spot.depth);
        pos.set(id, dest);
        on.set(id, st.to);
        add(st.to, 1);
        if (b.sends) now.sent++;
        sync();
        flash(st.to, true);
      } else if (st.kind === "nudge" && p) {
        // a stage done: a high bounce with a full spin, on the spot
        const tr = hopTrack([p, { ...p, lift: 30, spin: 1 }], { pace: PACE });
        const key = z.get(el) ?? 0;
        fly(el);
        await play(el, toKeyframes(tr.frames, tr.duration), tr.duration * 1000);
        if (!live) return;
        place(el, p);
        rest(el, key);
        flash(on.get(id) ?? 0, false);
      } else if (st.kind === "leave" && p) {
        add(on.get(id) ?? 0, -1); sync();
        await play(el, [{ transform: `translate(${p.x}px, ${p.y}px)`, opacity: 1 }, { transform: `translate(${p.x}px, ${p.y + 6}px) scale(.6)`, opacity: 0 }], 600);
        place(el, p, 0);
        pos.delete(id);
      } else if (st.kind === "fall" && p) {
        const s = stageTop(st.from);
        const edge = { x: s.x, y: s.y + 2 * s.c.h - MINI.h - MINI.H };   // over the top face's front corner
        const g = grave(id);
        const hole = g ? { x: Number(g.dataset.hx), y: Number(g.dataset.hy) - MINI.h - MINI.H } : { x: s.x - 20, y: s.y + 2 * s.c.h + s.c.H + 30 };
        add(st.from, -1); sync();
        fly(el);
        // to the edge, a beat there, then it turns blue-violet and tumbles off, slowly enough to follow
        const toEdge = hopTrack([p, { ...edge, lift: 12 }], { pace: PACE });
        await play(el, toKeyframes(toEdge.frames, toEdge.duration), toEdge.duration * 1000);
        if (!live) return;
        place(el, edge);
        el.setAttribute("data-fall", "1");
        // the grave shows up now (hole and lid, the stone still down), the lid opens as the cube comes down
        if (g) { g.setAttribute("data-dig", "1"); g.removeAttribute("data-pending"); }
        await new Promise((r) => timers.push(setTimeout(r, calm ? 0 : 320)));
        if (!live) return;
        const drop = hopTrack([edge, { ...hole, lift: 14, spin: 1 }], { pace: 0.62 });
        if (g) {
          // its shadow grows on the lid as it comes down; the lid opens just before it lands
          g.style.setProperty("--fall", `${Math.round(drop.duration * 1000)}ms`);
          g.setAttribute("data-falling", "1");
          timers.push(setTimeout(() => g.setAttribute("data-open", "1"), Math.max(0, drop.duration * 1000 - 520)));
        }
        await play(el, toKeyframes(drop.frames, drop.duration), drop.duration * 1000);
        g?.removeAttribute("data-falling");
        if (!live) return;
        thump(70, 0.16);
        await play(el, [{ transform: `translate(${hole.x}px, ${hole.y}px)`, opacity: 1 }, { transform: `translate(${hole.x}px, ${hole.y + GRAVE_DEPTH}px)`, opacity: 0 }], 520, "ease-in");
        place(el, hole, 0);
        pos.delete(id);
        now.buried++; sync();
        if (g) { g.removeAttribute("data-open"); g.removeAttribute("data-dig"); }
      }
    }

    const start = performance.now() + GROW_MS;
    beats.forEach((b) => {
      timers.push(setTimeout(() => {
        if (!live) return;
        const prev = chains.get(b.appId) ?? Promise.resolve();
        chains.set(b.appId, prev.then(() => (live ? run(b) : undefined)));
      }, GROW_MS + b.t));
    });
    // the date and the timeline run on their own clock, straight to the DOM (no re-render per frame)
    const pages = cal.current ? calendar(cal.current, calm) : null;
    pages?.reset(t0);
    let raf = 0;
    const tick = () => {
      const tau = Math.max(0, performance.now() - start);
      pages?.set(realAt(beats, tau));
      bar.current?.setAttribute("x2", String(r1(BAR.x + Math.min(1, T ? tau / T : 1) * BAR.w)));
      if (tau < T && live) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    timers.push(setTimeout(async () => {
      await Promise.all([...chains.values()]);
      if (live) timers.push(setTimeout(() => live && stop(), HOLD_MS));
    }, GROW_MS + T + 50));

    return () => {
      live = false;
      cancelAnimationFrame(raf);
      pages?.stop();
      timers.forEach(clearTimeout);
      anims.forEach((a) => a.cancel());
      graves.forEach((g) => { g.removeAttribute("data-pending"); g.removeAttribute("data-open"); g.removeAttribute("data-dig"); });
      KEYS.forEach((_, k) => stageEl(k)?.removeAttribute("data-rp-on"));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, beats]);

  const liveN = shown.counts.slice(1).reduce((a, b) => a + b, 0);
  const tickX = (b: Beat) => r1(BAR.x + (T ? b.t / T : 0) * BAR.w);
  return (
    <g className="rp" ref={layer} aria-hidden="true">
      {KEYS.map((k, i) => {
        const s = stageTop(i), f = faces(s.x, s.y, s.c);
        return (
          <g key={k} className="rp-k" data-k={i}>
            <g transform={f.leftT} data-s={k}>
              <Roll v={shown.counts[i]} x={s.c.a / 2} y={s.c.H * 0.7} className="cl-n rp-n" textAnchor="middle" style={{ fontSize: `${r1(s.c.a * 0.64)}px` }} />
            </g>
          </g>
        );
      })}
      <g ref={pile}>
        {apps.map((id) => (
          <g key={id} className="rp-cube" data-app={id}>
            <polygon points={mini.left} className="cl-l" />
            <polygon points={mini.right} className="cl-r" />
            <polygon points={mini.top} className="cl-t" />
          </g>
        ))}
      </g>
      <text x={BAR.x} y={42} className="rp-eye">Replay</text>
      <Roll v={shown.sent} x={BAR.x} y={112} className="rp-big" />
      <text x={BAR.x} y={136} className="rp-big-l">application{shown.sent === 1 ? "" : "s"} sent</text>
      <g className="rp-cal" ref={cal} transform="translate(318 38)">
        <rect x={-CAL.w / 2 + 5} y={8} width={CAL.w - 10} height={CAL.h} rx={10} className="rp-pad" />
        <rect x={-CAL.w / 2 + 2.5} y={4} width={CAL.w - 5} height={CAL.h} rx={10} className="rp-pad" />
        <g data-pg="under" className="rp-pg"><Page ms={t0} /></g>
        <g data-pg="front" className="rp-pg">
          <Page ms={t0} />
          <rect x={-CAL.w / 2} y={0} width={CAL.w} height={CAL.h} rx={10} className="rp-shade" />
        </g>
        <g data-pg="back" className="rp-pg"><rect x={-CAL.w / 2} y={0} width={CAL.w} height={CAL.h} rx={10} className="rp-back" /></g>
        {/* the binding: a punched hole in the strip and a wire loop standing up out of it */}
        {[-18, 18].map((x) => (
          <g key={x}>
            <circle cx={x} cy={8} r={3.6} className="rp-hole" />
            <path d={`M${x - 3.2} 8.5 V-1 a3.2 3.2 0 0 1 6.4 0 V8.5`} className="rp-wire-back" />
            <path d={`M${x - 3.2} 8.5 V-1 a3.2 3.2 0 0 1 6.4 0 V8.5`} className="rp-wire" />
          </g>
        ))}
      </g>
      <text x={BAR.x} y={164} className="rp-line">
        <tspan className="rp-b">{liveN}</tspan> live
        <tspan dx={8}>·</tspan>
        <tspan dx={8} className="rp-b">{shown.buried}</tspan> buried
      </text>
      <line x1={BAR.x} x2={BAR.x + BAR.w} y1={BAR.y} y2={BAR.y} className="rp-track" />
      <line x1={BAR.x} x2={BAR.x} y1={BAR.y} y2={BAR.y} className="rp-done" ref={bar} />
      {beats.filter((b) => b.sends).map((b, n) => <line key={`s${n}`} x1={tickX(b)} x2={tickX(b)} y1={BAR.y - 7} y2={BAR.y - 2} className="rp-tick" />)}
      {beats.filter((b) => b.step.kind === "fall" || b.step.kind === "reveal")
        .map((b, n) => <path key={`r${n}`} d={`M${tickX(b) - 2.5} ${BAR.y + 4} l5 5 m0 -5 l-5 5`} className="rp-x" />)}
      <text x={BAR.x} y={BAR.y + 24} className="rp-end">{fmt(t0)}</text>
      <text x={BAR.x + BAR.w} y={BAR.y + 24} className="rp-end" textAnchor="end">{fmt(t1)}</text>
    </g>
  );
}
