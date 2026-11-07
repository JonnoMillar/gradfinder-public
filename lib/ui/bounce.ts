/**
 * The happy cube's physics, as pure functions that return keyframes (components/ClimbReveal.tsx and Celebrate.tsx play
 * them with the Web Animations API). No library and no per-frame JS: a path is sampled once at 60 fps, played back
 * linearly. Units are the drawing's own (SVG user units), y points down, a "pose" is a translation from where the
 * cube finally rests. Cubes are RIGID (Jonno 2026-11-07: "solid, non-malleable"): nothing squashes, stretches or wobbles.
 *
 *  - hopTrack: a cube bounces through waypoints like a ball, on true parabolas, one leg after the next with no pause
 *    between, tilting into its direction; one leg can carry a full spin that happens around the top of the arc.
 *  - scatter: what the cubes already standing on a stage do when it crashes in. They are light cubes on a flat top
 *    face: the newcomer plough into them, they slide with friction, knock each other (elastic collisions), the ones
 *    pushed past the edge fall (and tumble) onto the floor or behind the stage, then every cube that moved flies back
 *    to its place in the formation on a quick arc.
 */

export interface Pt { x: number; y: number }
export interface Pose { t: number; x: number; y: number; rot: number; o: number }
export interface Landing { t: number; at: number; vx: number; vy: number; speed: number }
/** a waypoint: `lift` = height of the arc into it, `spin` = full turns made during that arc (around its top) */
export interface Way extends Pt { lift?: number; spin?: number }

const DT = 1 / 60;
export const G = 1700;                       // units per second squared: a rubber ball's, in this drawing
const T30 = Math.tan(Math.PI / 6);

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const smooth = (k: number) => { const c = clamp(k, 0, 1); return c * c * c * (c * (c * 6 - 15) + 10); };

/** One ballistic leg a → b: its top is `lift` above the higher end (never above `ceil`). t starts at 0, ends on the landing. */
function leg(a: Pt, b: Pt, o: { g: number; lift: number; spin: number; rot0?: number; ceil?: number; o0?: number }) {
  const top = Math.max(o.ceil ?? -Infinity, Math.min(a.y, b.y) - o.lift);
  const up = Math.sqrt((2 * (a.y - top)) / o.g), down = Math.sqrt((2 * (b.y - top)) / o.g);
  const T = up + down, dir = Math.sign(b.x - a.x) || 1;
  const rot0 = o.rot0 ?? 0;
  const frames: Pose[] = [];
  const n = Math.max(1, Math.round(T / DT));
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * T, k = i / n;
    const y = s < up ? top + (a.y - top) * (1 - s / up) ** 2 : top + (b.y - top) * ((s - up) / down) ** 2;
    // a lean into the direction of travel that is gone by the landing, the spin held for the middle of the arc, and
    // whatever tilt it left with eased out (so it always lands flat)
    const rot = rot0 * (1 - smooth(k)) + dir * 14 * Math.sin(Math.PI * k) * (o.spin ? 0.3 : 1) + dir * 360 * o.spin * smooth((k - 0.12) / 0.76);
    frames.push({ t: s, x: a.x + (b.x - a.x) * k, y, rot, o: (o.o0 ?? 1) + (1 - (o.o0 ?? 1)) * smooth(k * 4) });
  }
  return { frames, T, vx: (b.x - a.x) / T, vy: o.g * down };
}

/** A cube travelling `ways[0] → … → ways[n-1]` (translations; the last is where it rests, usually 0,0), arcs one after another. */
export function hopTrack(ways: Way[], o: { ceil?: number; pace?: number } = {}) {
  const frames: Pose[] = [];
  const landings: Landing[] = [];
  const g = G * (o.pace ?? 1) ** 2;
  let t = 0, base = 0;   // base: turns made so far, kept (not wrapped to 0) so rotation never jumps between two keyframes
  for (let i = 0; i < ways.length - 1; i++) {
    const a = ways[i], b = ways[i + 1];
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const l = leg(a, b, { g, lift: b.lift ?? clamp(34 + dist * 0.32, 34, 84), spin: b.spin ?? 0, ceil: o.ceil });
    l.frames.forEach((f, k) => { if (i === 0 || k > 0) frames.push({ ...f, t: t + f.t, rot: f.rot + base }); });
    base += (Math.sign(b.x - a.x) || 1) * 360 * (b.spin ?? 0);
    t += l.T;
    landings.push({ t, at: i + 1, vx: l.vx, vy: l.vy, speed: Math.hypot(l.vx, l.vy) });
  }
  if (!frames.length) frames.push({ t: 0, x: ways[0]?.x ?? 0, y: ways[0]?.y ?? 0, rot: 0, o: 1 });
  return { frames, landings, duration: t };
}

/**
 * The Roles page cube's idle (components/MovedCube.tsx): an excited little show on a loop. It rocks side to side about its
 * bottom edge, hops, hops higher with a full spin, does a quick low hop, then stands still for a while before the next show.
 * `half` = half the cube's height (the pivot of the rock). Rigid throughout, and every pose is a translation from standing.
 */
export function excitedTrack(half: number, rest = 2.4) {
  const frames: Pose[] = [];
  let t = 0;
  for (; t < 0.9; t += DT) {
    const th = 12 * (1 - t / 0.9) ** 1.2 * Math.sin(2 * Math.PI * 3.5 * t), r = (th * Math.PI) / 180;
    frames.push({ t, x: half * Math.sin(r), y: half * (1 - Math.cos(r)), rot: th, o: 1 });   // a rotation about the bottom edge, as a centre rotation plus a shift
  }
  const s = { x: 0, y: 0 };
  const hop = hopTrack([s, { ...s, lift: 24 }, { ...s, lift: 50, spin: 1 }, { ...s, lift: 18 }]);
  hop.frames.forEach((f, k) => { if (k > 0) frames.push({ ...f, t: t + f.t }); });
  t += hop.duration;
  frames.push({ t: t + rest, x: 0, y: 0, rot: hop.frames[hop.frames.length - 1].rot, o: 1 });   // standing still (a whole number of turns: flat)
  return { frames, duration: t + rest };
}

// ------------------------------------------------------------------------------------------------ the crash

/** a cube standing on the stage's top face: its place in the formation, in ground units (the face is the square [0, A]²) */
export interface Body { u: number; v: number; layer: number; hero?: boolean }
const MU = 380;          // sliding friction (ground units / s²)
const E_CUBE = 0.55;     // how lively cube-on-cube collisions are
const E_FLOOR = 0.35;
type Mode = 0 | 1 | 2 | 3;   // on the face · in the air · on the floor · behind the stage (hidden)

/**
 * The newcomer (the body flagged `hero`) lands in its own place travelling `hit.vx` (screen units/s, + = rightwards) and
 * ploughs on along the ground. Screen ground axes: u goes right-and-down, v left-and-down, so rightwards is (1, -1).
 * `A` face size, `R` collision radius, `layerH` one cube's height, `drop` how far the floor is below the face.
 * Returns one pose track per body (t = 0 at impact, relative to its own place) and when it all ends.
 */
export function scatter(bodies: Body[], o: { A: number; R: number; layerH: number; drop: number; hit: { vx: number; vy: number } }) {
  const n = bodies.length;
  const p = bodies.map((b) => ({ u: b.u, v: b.v, du: 0, dv: 0, z: b.layer * o.layerH, vz: 0, layer: b.layer, mode: 0 as Mode, rot: 0, w: 0, backAt: -1, moved: false, fell: false }));
  const rest = bodies.map((b) => ({ u: b.u, v: b.v, z: b.layer * o.layerH }));
  const h = bodies.findIndex((b) => b.hero);
  if (h >= 0) {
    // it keeps its way in (rightwards on screen) but swerves toward the rest of the pile, so it always hits something
    const s = clamp(0.7 * Math.abs(o.hit.vx) + 0.12 * o.hit.vy, 170, 300), dir = Math.sign(o.hit.vx) || 1;
    let ux = dir / Math.SQRT2, uy = -dir / Math.SQRT2;
    const others = bodies.filter((_, i) => i !== h && bodies[i].layer === bodies[h].layer);
    if (others.length) {
      // aim: toward the nearest cubes (weight 1/d²), mostly
      let cu = 0, cv = 0;
      for (const b of others) { const du = b.u - bodies[h].u, dv = b.v - bodies[h].v, d2 = du * du + dv * dv || 1; cu += du / d2; cv += dv / d2; }
      const d = Math.hypot(cu, cv);
      if (d > 0) { ux = 0.35 * ux + 0.65 * (cu / d); uy = 0.35 * uy + 0.65 * (cv / d); const m = Math.hypot(ux, uy) || 1; ux /= m; uy /= m; }
    }
    p[h].du = s * ux; p[h].dv = s * uy;
  }
  const tracks: Pose[][] = bodies.map(() => []);
  const pose = (i: number, t: number): Pose => {
    const q = p[i], du = q.u - rest[i].u, dv = q.v - rest[i].v;
    return { t, x: du - dv, y: T30 * (du + dv) - (q.z - rest[i].z), rot: q.rot, o: q.backAt < 0 ? 1 : clamp(1 - (t - q.backAt) / 0.15, 0, 1) };
  };
  const inside = (q: { u: number; v: number }) => q.u >= 0 && q.u <= o.A && q.v >= 0 && q.v <= o.A;
  const restless = () => p.some((q) => q.mode === 1 || (q.mode !== 3 && Math.hypot(q.du, q.dv) > 3));

  let t = 0;
  for (; t < 2.2; t += DT) {
    for (let i = 0; i < n; i++) {
      const q = p[i];
      if (q.mode === 0 || q.mode === 2) {          // sliding: friction slows it to a stop
        const sp = Math.hypot(q.du, q.dv);
        if (sp > 0) { const k = Math.max(0, sp - MU * DT) / sp; q.du *= k; q.dv *= k; }
      }
      q.u += q.du * DT; q.v += q.dv * DT;
      if (q.mode === 1) {                           // falling: gravity, a tumble, then land on the face or the floor
        q.vz -= G * DT; q.z += q.vz * DT; q.rot += q.w * DT;
        const floor = -o.drop, onFace = inside(q);
        if (onFace && q.z <= 0) { q.z = 0; q.layer = 0; if (q.vz < -150) { q.vz = -q.vz * E_FLOOR; q.w *= 0.5; } else { q.vz = 0; q.mode = 0; q.w = 0; } }
        else if (!onFace && q.z <= floor) { q.z = floor; if (q.vz < -150) { q.vz = -q.vz * E_FLOOR; q.w *= 0.5; } else { q.vz = 0; q.mode = 2; q.w = 0; } }
      }
    }
    // cubes knocking into cubes (same layer, still standing on something)
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = p[i], b = p[j];
      if ((a.mode !== 0 && a.mode !== 2) || a.mode !== b.mode || a.layer !== b.layer) continue;
      const dx = b.u - a.u, dy = b.v - a.v, d = Math.hypot(dx, dy);
      if (d >= 2 * o.R || d === 0) continue;
      const nx = dx / d, ny = dy / d, vn = (b.du - a.du) * nx + (b.dv - a.dv) * ny;
      if (vn < 0) { const j2 = (-(1 + E_CUBE) * vn) / 2; a.du -= j2 * nx; a.dv -= j2 * ny; b.du += j2 * nx; b.dv += j2 * ny; }
      const push = (2 * o.R - d) / 2; a.u -= nx * push; a.v -= ny * push; b.u += nx * push; b.v += ny * push;
    }
    // support: a cube whose centre has left the face (or whose cube below has gone) falls
    for (let i = 0; i < n; i++) {
      const q = p[i];
      if (q.mode !== 0) continue;
      const held = q.layer === 0 ? inside(q) : p.some((r, k) => k !== i && r.mode === 0 && r.layer === q.layer - 1 && Math.hypot(r.u - q.u, r.v - q.v) < 1.3 * o.R);
      if (held) continue;
      q.mode = 1; q.fell = true; q.vz = 0;
      const sx = q.du - q.dv;                      // screen speed, so it tumbles the way it is going
      q.w = clamp(sx * 3, -700, 700) || 240;
      if (!inside(q) && (q.u < 0 || q.v < 0) && q.backAt < 0) q.backAt = t;   // off the back edges: it drops out of sight behind the stage
    }
    for (let i = 0; i < n; i++) { if (p[i].moved === false && (Math.hypot(p[i].u - rest[i].u, p[i].v - rest[i].v) > 0.5 || p[i].z !== rest[i].z)) p[i].moved = true; tracks[i].push(pose(i, t)); }
    if (t > 0.1 && !restless()) { t += DT; break; }
  }
  const settled = t;

  // everything that moved flies back to its place, nearest the crash first, the low layers before the high
  const order = p.map((_, i) => i).filter((i) => p[i].moved || p[i].fell).sort((a, b) => Math.hypot(p[a].u - rest[h >= 0 ? h : a].u, p[a].v - rest[h >= 0 ? h : a].v) - Math.hypot(p[b].u - rest[h >= 0 ? h : b].u, p[b].v - rest[h >= 0 ? h : b].v));
  let end = settled;
  order.forEach((i, rank) => {
    const from = pose(i, settled);
    const tl = settled + 0.28 + rank * 0.06 + rest[i].z / Math.max(1, o.layerH) * 0.12;
    tracks[i].push({ ...from, t: tl });
    const dist = Math.hypot(from.x, from.y);
    // it eases from wherever the tumble left it to the nearest whole turn (which looks flat), never through a jump
    const flat = Math.round(from.rot / 360) * 360;
    const back = leg({ x: from.x, y: from.y }, { x: 0, y: 0 }, { g: G * 1.15, lift: clamp(10 + dist * 0.45, 10, 60), spin: p[i].fell ? 1 : 0, rot0: from.rot - flat, o0: from.o });
    back.frames.forEach((f, k) => { if (k > 0) tracks[i].push({ ...f, t: tl + f.t, rot: f.rot + flat }); });
    end = Math.max(end, tl + back.T);
  });
  return { tracks, duration: end, settled };
}

/** Keyframes for the Web Animations API from a sampled track (opacity only if the track ever fades). */
export function toKeyframes(frames: Pose[], duration: number): Keyframe[] {
  const fades = frames.some((f) => f.o < 1);
  return frames.map((f) => ({
    offset: Math.min(1, f.t / duration),
    transform: `translate(${f.x.toFixed(2)}px, ${f.y.toFixed(2)}px) rotate(${f.rot.toFixed(2)}deg)`,
    ...(fades ? { opacity: f.o.toFixed(2) } : {}),
    easing: "linear",
  }));
}
