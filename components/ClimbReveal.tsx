"use client";

/**
 * The payoff for the platinum badge and the Roles cube (Jonno 2026-11-04, reworked 2026-11-07): once the stairs have
 * risen, each Gmail stage move he hasn't seen plays out on the Climb, one at a time, as a ball-like cube:
 *
 *  1. The scene dims (stages, minis) and the moved cube bounces in from the left, tilting as it goes.
 *  2. It lands on the stage it was at: that stage lights up, and the cube makes one extra, higher bounce straight up on
 *     it ("this is where it was").
 *  3. It bounces up the stairs, lighting each stage it touches, one arc after another, spinning once round the top of
 *     the last arc.
 *  4. It crashes into the pile it joins. The cubes there are light and rigid on a flat top: they are ploughed into,
 *     slide, knock each other, and the ones pushed over the edge fall off; then everything that moved flies back into
 *     its place in the formation (lib/ui/bounce.ts is all of the physics; nothing squashes or wobbles).
 *  5. The destination stage lights platinum, the dim lifts. Each landing ticks a quiet thump (lib/ui/sound.ts).
 *
 * The first three moves play in full; any more just appear in place. Then all of them, rejections included, are marked
 * seen, so the badge and cube go away. The toast (components/Celebrate.tsx) follows each move with the words.
 *
 * Climb.tsx tags each moved mini with `data-hop="from>to"` (stage indexes, -1 = off the climb) and every mini with
 * `data-cell="u,v,layer"` (its place on the pile); this only animates. The minis keep a platinum tint until the page is
 * left. Reduced motion: no travel, no sound, the toasts still come in turn.
 *
 * Rejections (Jonno 2026-11-10: "watch an application fall off into a grave"), after the forward moves: the camera
 * starts down to the graveyard (components/ClimbStage.tsx), the rejected cube (`data-fall`, waiting on the stage it had
 * reached) teeters, hops to the stage's front edge and tumbles off it into its grave: the lid slides open (`data-open`),
 * the cube drops into the hole and sinks, the lid closes and the headstone rises (`data-bury` until then). The view stays in the graveyard, where the rating card asks about it.
 *
 * It also writes the line for rejections in the Climb's head ("Since you last looked: X said no. Next up: Y"), and
 * holds on to the moves it opened with: the revalidate after markMovesSeen sends an empty list, which must not wipe it.
 */
import { useEffect, useState } from "react";
import { markMovesSeen } from "@/app/actions";
import type { NewsMove } from "@/lib/queries";
import { hopTrack, scatter, toKeyframes, type Pose, type Way } from "@/lib/ui/bounce";
import { cube } from "@/lib/ui/cubes";
import { thump } from "@/lib/ui/sound";
import { emitMoved, reducedMotion } from "./motion";
import { showGraveyard } from "./ClimbStage";
import { GRAVE_DEPTH } from "./Graveyard";

const AFTER_ENTRANCE = 1500;
const BETWEEN = 3000;   // after one cube has come to rest, before the next sets off (the toast's words need a moment too)
const FULL = 3;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const idsOf = (ms: NewsMove[]) => ms.map((m) => m.emailId).join(",");

const cubeOf = (mini: Element) => mini.querySelector<SVGGElement>(".cl-cube")!;
/** a mini's bottom-face centre, in the drawing's units: the point it stands on */
const footOf = (mini: Element) => {
  const b = cubeOf(mini).getBBox();
  return { x: b.x + b.width / 2, y: b.y + b.height - cube(b.width / 2).h };
};

/** where a cube coming to a stage lands: on top of its highest mini (the pile), else on the stage's own top face */
function surface(stage: Element) {
  let top: SVGGElement | null = null;
  stage.querySelectorAll(".cl-mini:not([data-wait])").forEach((m) => {
    const c = cubeOf(m);
    if (!top || c.getBBox().y < top.getBBox().y) top = c;
  });
  if (top) {
    const b = (top as SVGGElement).getBBox();
    return { x: b.x + b.width / 2, y: b.y + cube(b.width / 2).h };
  }
  const t = stage.querySelector<SVGGraphicsElement>(":scope > .cl-t")!.getBBox();
  return { x: t.x + t.width / 2, y: t.y + t.height / 2 };
}

export function ClimbReveal({ moves: fresh, nextUp = null }: { moves: NewsMove[]; nextUp?: { jobId: number; company: string } | null }) {
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
    const anims: Animation[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => { timers.push(setTimeout(fn, ms)); };

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
      const [from, to] = (el.dataset.hop ?? "").split(">").map(Number);
      const svg = el.ownerSVGElement;
      const stages = svg ? [...svg.querySelectorAll(":scope > .cl-step, :scope > .cl-peak")] : [];
      if (calm || !svg || Number.isNaN(to) || !stages[to]) { el.removeAttribute("data-wait"); return; }
      const dest = stages[to];
      el.removeAttribute("data-wait");

      // the journey, in the drawing's units: in from the left, onto the stage it was at (and a higher bounce there),
      // up each stair on the way, and home. `at[i]` is the stage waypoint i belongs to.
      const body = cubeOf(el), rest = footOf(el), mini1 = cube(body.getBBox().width / 2);
      const spots: Way[] = [], at: (number | null)[] = [];
      const origin = from >= 0 ? surface(stages[from]) : null;
      const first = origin ?? surface(stages[0]);
      spots.push({ x: -36, y: first.y + 34 }); at.push(null);
      if (origin) { spots.push(origin, { ...origin, lift: 80 }); at.push(from, from); }   // where it was, then the pogo on it
      for (let k = from >= 0 ? from + 1 : 0; k < to; k++) { spots.push(surface(stages[k])); at.push(k); }
      const lone = dest.querySelectorAll(".cl-mini:not([data-wait])").length === 1;
      spots.push({ ...rest, spin: 1 }); at.push(to);                                      // a full spin on the last arc
      if (lone) { spots.push({ ...rest, lift: 16 }); at.push(to); }                       // nothing to crash into: it just rebounds
      spots[1] = { ...spots[1], spin: 1 };                                                // and a full spin on the way in too (the first arc must not be a plain lean)
      const pts = spots.map((p) => ({ ...p, x: p.x - rest.x, y: p.y - rest.y }));
      const legs = pts.length - 1;
      const track = hopTrack(pts, { ceil: 8 - body.getBBox().y, pace: Math.min(1.5, Math.max(1, 1 + (legs - 3) * 0.14)) });
      const tLand = track.landings[lone ? track.landings.length - 2 : track.landings.length - 1].t;

      // the crash: the cubes standing on the destination, and the newcomer among them
      let heroFrames: Pose[] = track.frames, total = track.duration;
      const run: Animation[] = [];
      if (!lone) {
        const A = dest.querySelector<SVGGraphicsElement>(":scope > .cl-t")!.getBBox().width / 2;
        const minis = [...dest.querySelectorAll<SVGAElement>(".cl-mini:not([data-wait])")];
        const bodies = minis.map((m) => { const [u, v, layer] = (m.dataset.cell ?? "1,1,0").split(",").map(Number); return { u: ((u + 0.5) / 3) * A, v: ((v + 0.5) / 3) * A, layer, hero: m === el }; });
        const last = track.landings[track.landings.length - 1];
        const sc = scatter(bodies, { A, R: mini1.a * 0.6, layerH: mini1.H, drop: dest.querySelector<SVGGraphicsElement>(":scope > .cl-l")!.getBBox().height, hit: { vx: last.vx, vy: last.vy } });
        minis.forEach((m, i) => {
          const tr = sc.tracks[i];
          if (m === el) {   // its spin ended on a whole turn: carry that on, so the crash starts from the same angle
            const turns = track.frames[track.frames.length - 1].rot;
            heroFrames = [...track.frames, ...tr.slice(1).map((f) => ({ ...f, t: f.t + tLand, rot: f.rot + turns }))];
            return;
          }
          if (!tr.some((f) => f.x || f.y)) return;
          const d = tr[tr.length - 1].t;
          run.push(cubeOf(m).animate(toKeyframes(tr, d), { duration: d * 1000, delay: tLand * 1000, easing: "linear" }));
        });
        total = tLand + sc.duration;
      }
      run.push(body.animate(toKeyframes(heroFrames, total), { duration: total * 1000, easing: "linear" }));
      anims.push(...run);

      // the dim, the lights and the thumps follow the landings
      svg.setAttribute("data-replay", "1");
      track.landings.forEach((l) => {
        const k = at[l.at];
        if (k === null) return;
        const stage = stages[k];
        const crash = l.at === (lone ? at.length - 2 : at.length - 1);
        later(() => {
          stage.setAttribute("data-lit", "1");
          if (from >= 0 && l.at === 1) stage.setAttribute("data-from", "1");   // the first landing: where it was
          if (crash) stage.setAttribute("data-news", "1");
          thump(crash ? 85 : 150 + 18 * k, crash ? 0.2 : 0.07);
        }, l.t * 1000);
      });
      await Promise.all(run.map((a) => a.finished.catch(() => {})));
      await wait(500);
      svg.removeAttribute("data-replay");
      stages.forEach((s) => { s.removeAttribute("data-lit"); s.removeAttribute("data-from"); });
      later(() => dest.removeAttribute("data-news"), 2600);
    }

    const falls = [...new Set(moves.filter((m) => m.to === "rejected").map((m) => m.applicationId))];
    const faller = (id: number) => document.querySelector<SVGAElement>(`.cl-mini[data-fall="${id}"]`);
    const grave = (id: number) => document.querySelector<SVGAElement>(`.gy-grave[data-grave="${id}"]`);
    // in place at once: the cube gone from its stage, the headstone up (attributes React doesn't manage, see above)
    const settle = (id: number) => { faller(id)?.setAttribute("data-gone", "1"); grave(id)?.setAttribute("data-risen", "1"); };
    // a remount (React's dev double-run, or new news) starts the burials over: undo what a cleanup settled
    if (!calm) falls.slice(0, FULL).forEach((id) => { faller(id)?.removeAttribute("data-gone"); grave(id)?.removeAttribute("data-risen"); });

    async function bury(id: number, first: boolean) {
      const el = faller(id), g = grave(id);
      if (calm || !el || !g) { settle(id); if (g) showGraveyard(true); return; }
      const body = cubeOf(el), rest = footOf(el);
      const stage = el.closest(".cl-step")!;
      const top = stage.querySelector<SVGGraphicsElement>(":scope > .cl-t")!.getBBox();
      const edge = { x: top.x + top.width / 2 - rest.x, y: top.y + top.height - rest.y };   // the top face's front corner
      // the hole's centre on the ground (the graves sit untransformed in the same drawing, so these are its units)
      const spot = { x: Number(g.dataset.hx), y: Number(g.dataset.hy) };

      // the camera sets off first (it has furthest to go), while the cube teeters on the brink
      if (first) showGraveyard(true);
      const rock = body.animate([{ rotate: "0deg" }, { rotate: "-9deg" }, { rotate: "7deg" }, { rotate: "-4deg" }, { rotate: "0deg" }],
        { duration: 700, easing: "ease-in-out" });
      anims.push(rock);
      await rock.finished.catch(() => {});
      if (!live) return;

      const track = hopTrack([{ x: 0, y: 0 }, { ...edge, lift: 12 }, { x: spot.x - rest.x, y: spot.y - rest.y, lift: 8, spin: 1 }], { pace: 0.85 });
      later(() => g.setAttribute("data-open", "1"), Math.max(0, track.duration * 1000 - 450));   // the lid slides away as it comes down
      const fall = body.animate(toKeyframes(track.frames, track.duration), { duration: track.duration * 1000, easing: "linear", fill: "forwards" });
      anims.push(fall);
      later(() => thump(150, 0.06), track.landings[0].t * 1000);
      // off the edge: its shadow grows on the lid as it comes down
      later(() => {
        g.style.setProperty("--fall", `${Math.round((track.duration - track.landings[0].t) * 1000)}ms`);
        g.setAttribute("data-falling", "1");
      }, track.landings[0].t * 1000);
      await fall.finished.catch(() => {});
      g.removeAttribute("data-falling");
      if (!live) return;
      thump(70, 0.22);
      // it sinks into the hole, the lid slides shut over it, and the headstone comes up
      const end = track.frames[track.frames.length - 1];
      const sink = body.animate([
        { transform: `translate(${end.x}px, ${end.y}px)`, opacity: 1 },
        { transform: `translate(${end.x}px, ${end.y + GRAVE_DEPTH}px)`, opacity: 0 },
      ], { duration: 420, easing: "ease-in", fill: "forwards" });
      anims.push(sink);
      await sink.finished.catch(() => {});
      el.setAttribute("data-gone", "1");
      g.removeAttribute("data-open");
      g.setAttribute("data-risen", "1");
    }

    (async () => {
      await wait(AFTER_ENTRANCE);
      for (const [n, m] of forward.entries()) {
        if (!live) return;
        const el = mini(m);
        if (n >= FULL) { el?.removeAttribute("data-wait"); continue; }
        if (el) await hop(el);
        if (!live) return;
        emitMoved({ jobId: m.jobId, company: m.company, from: m.from ?? "discovered", to: m.to, replay: true });
        if (n < Math.min(forward.length, FULL) - 1) await wait(BETWEEN);
      }
      if (forward.length && falls.length) await wait(BETWEEN);
      for (const [n, id] of falls.entries()) {
        if (!live) return;
        if (n >= FULL) { settle(id); continue; }
        await bury(id, n === 0);
        if (n < Math.min(falls.length, FULL) - 1) await wait(900);
      }
      if (live) await markMovesSeen({ ids: moves.map((m) => m.emailId) });
    })();
    return () => {
      live = false;
      anims.forEach((a) => a.cancel());
      timers.forEach(clearTimeout);
      document.querySelectorAll(".cl-svg").forEach((s) => s.removeAttribute("data-replay"));
      document.querySelectorAll("[data-lit], [data-from]").forEach((s) => { s.removeAttribute("data-lit"); s.removeAttribute("data-from"); });
      forward.forEach((m) => mini(m)?.removeAttribute("data-wait"));
      falls.forEach((id) => { settle(id); grave(id)?.removeAttribute("data-open"); });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const saidNo = [...new Set(moves.filter((m) => m.to === "rejected").map((m) => m.company))];
  if (!saidNo.length) return null;
  return (
    <p className="cl-said">
      Since you last looked: {saidNo.join(", ")} said no.
      {nextUp ? <> Next up: <a href={`/jobs/${nextUp.jobId}`} className="link-mint">{nextUp.company} →</a></> : null}
    </p>
  );
}
