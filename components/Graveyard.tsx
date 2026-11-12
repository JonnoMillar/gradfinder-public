/**
 * The graveyard under the Climb (Jonno 2026-11-10: "a cool application graveyard below ... watch an application fall
 * off into a grave"). Reworked twice the same day, his words: graves "in vertical lines, not clustered", "the same bright
 * lines and glow" as the climb, "one gravestone shape", no dirt, the hole the size a climb cube "would literally" drop
 * into; then smaller, more space, blue-purple, no column titles, no ground line or colour change ("they should feel like
 * they coexist in the same world"), a soft glow from below, and a hole as wide as the stone, longer than it is wide,
 * touching the stone's foot, with a lighter opaque lid so open and shut read clearly.
 *
 *  - Third pass (2026-11-11, his words: "the climb is a real 3d scene and the graveyard is literally underneath it ...
 *    big cubes floating in mid air in the sky ... the graveyard is the flat floor all the way down below", rows
 *    "diagonal (SE->NW), matching the isometric plane"): the graves lie on the floor (FLOOR_Y), each floating cube casts
 *    its shadow straight down onto it, a faint grid gives the floor its plane. Still true isometric, so nothing shrinks
 *    with distance (that keeps a climb cube the size of its hole); the height reads from the drop and the shadows.
 *  - It sits below the stairs in the same drawing. "View graveyard" pans the camera down (components/ClimbStage.tsx),
 *    so the stairs slide up and mostly out of shot and the floor comes into view.
 *  - Every rejected application is buried under the stage it had reached (`endedFrom()`), in a row of headstones side
 *    by side along the floor's SE-NW diagonal, centred straight under the stage, oldest at the back (NW), newest at the
 *    front (SE). One it can't place goes under Sent.
 *  - A grave, on the cubes' isometric ground: a headstone whose face looks south-west (the same way as a cube's left
 *    face), engraved RIP, and in front of it, flush with the stone's foot, a lid over a hole as wide as the stone and
 *    longer than a climb cube.
 *  - Hover (or tab to) a grave: the lid slides away under the ground, the cube's ghost rises out of the hole (translucent,
 *    a wavy Pac-Man skirt, two hollow eyes), the company's name above it; leave and it sinks back and the lid slides shut.
 *    Click opens the role.
 *  - A rejection he hasn't seen yet is buried by ClimbReveal (`data-bury`, the stone stays down until the cube is in).
 *    The replay (ClimbReplay) hides every grave (`data-pending`) and fills them in date order. Both open the lid with
 *    `data-open` and aim the falling cube at `data-hx`/`data-hy`, the hole's centre on the ground.
 *
 * Pure SVG from the server; the lid, the ghost and the glow are CSS. Colour: one blue-violet (--gy), not the stages'.
 */
import type { ApplicationRow } from "@/lib/queries";
import { cube, faces, r1, stageTop, STAIRS } from "@/lib/ui/cubes";

export const WORLD_H = 730;   // the whole drawing: the climb (0..430) and the graveyard under it
export const PAN = 290;       // how far the camera drops to show the graveyard

export type Buried = { app: ApplicationRow; stage: number; known: boolean; fresh: boolean };

const T30 = Math.tan(Math.PI / 6);
const GHOST = cube(9.5);              // a climb cube's size (MINI in lib/ui/cubes.ts)
// a grave in ground units (u runs south-east, v south-west; a climb cube's side is 9.5)
const SW = 12, ST = 2.5, SH = 19;     // the stone: width (u), thickness (v), height to the top of its arch
const HL = 17;                        // the hole: as wide as the stone (u 0..SW), HL long (v ST..ST+HL), touching its foot
const DEPTH = 12;                     // how deep the hole's walls drop
export const GRAVE_DEPTH = DEPTH;
const PITCH = 22;                     // a row's step along u: a grave's width and a gap
const VC = ST + HL / 2;               // a grave's hole centre, back from its stones' line
const PER_ROW = 5;
/**
 * The floor: the ground the stage cubes float above. The stairs step east (screen right) and rise 28 a step, so the
 * point straight under each stage's centre lands on one horizontal line, FLOOR_Y: stage 0 hangs ~190 above it, the
 * summit ~330. (Isometric: straight down in the world is straight down on screen.)
 */
export const FLOOR_Y = 580;
const NAME_MAX = 20;
const clip = (s: string) => (s.length > NAME_MAX ? `${s.slice(0, NAME_MAX - 1)}…` : s);
const pts = (p: number[][]) => p.map(([x, y]) => `${r1(x)},${r1(y)}`).join(" ");

/** a scalloped edge from a to b: n bumps hanging down by d (the ghost's skirt) */
function skirt(a: number[], b: number[], n = 3, d = 3.4) {
  let s = "";
  for (let k = 0; k < n; k++) {
    const p = (t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const m = p((k + 0.5) / n), e = p((k + 1) / n);
    s += ` Q${r1(m[0])} ${r1(m[1] + d * 2)} ${r1(e[0])} ${r1(e[1])}`;
  }
  return s;
}

/** the ghost: a cube's top half, its sides ending in a wavy skirt, two hollow eyes on its south-west face */
function Ghost({ x, y }: { x: number; y: number }) {
  const { a, h, H } = GHOST;
  const f = faces(x, y, GHOST);
  const left = `M${r1(x - a)} ${r1(y + h)} L${r1(x)} ${r1(y + 2 * h)} L${r1(x)} ${r1(y + 2 * h + H)}${skirt([x, y + 2 * h + H], [x - a, y + h + H])} Z`;
  const right = `M${r1(x)} ${r1(y + 2 * h)} L${r1(x + a)} ${r1(y + h)} L${r1(x + a)} ${r1(y + h + H)}${skirt([x + a, y + h + H], [x, y + 2 * h + H])} Z`;
  return (
    <g className="gy-ghost">
      <path d={left} className="gy-gl" />
      <path d={right} className="gy-gr" />
      <polygon points={f.top} className="gy-gt" />
      <g transform={f.leftT} className="gy-eyes">
        <ellipse cx={a * 0.32} cy={H * 0.4} rx={1.5} ry={2.2} />
        <ellipse cx={a * 0.7} cy={H * 0.4} rx={1.5} ry={2.2} />
      </g>
    </g>
  );
}

/** one grave with its back corner (u = 0, v = 0) at (x0, y0) on the ground */
function Grave({ b, x0, y0 }: { b: Buried; x0: number; y0: number }) {
  const P = (u: number, v: number, down = 0) => [x0 + u - v, y0 + (u + v) * T30 + down];
  const id = b.app.id;
  // the hole and its lid: the same rectangle on the ground, its back edge the stone's foot; inside it the two far walls
  // show, dropping DEPTH
  const [v0, v1] = [ST, ST + HL];
  const hole = [P(0, v0), P(SW, v0), P(SW, v1), P(0, v1)];
  const backWall = pts([P(0, v0), P(SW, v0), P(SW, v0, DEPTH), P(0, v0, DEPTH)]);
  const leftWall = pts([P(0, v0), P(0, v1), P(0, v1, DEPTH), P(0, v0, DEPTH)]);
  const [hx, hy] = P(SW / 2, (v0 + v1) / 2);
  // the ghost rises inside a window whose bottom is the hole's two front edges, so it comes up out of the hole
  const [lx] = P(0, v1), [rx] = P(SW, v0);
  const window = pts([P(0, v1), P(SW, v1), P(SW, v0), [rx, hy - 90], [lx, hy - 90]]);
  // the headstone: a slab in the plane v = ST (parallel to a cube's left face, so its face looks south-west), its
  // thickness a darker copy set back to v = 0
  const rr = SW / 2;
  const slab = `M0 0 V${r1(-(SH - rr))} A${r1(rr)} ${r1(rr)} 0 0 1 ${SW} ${r1(-(SH - rr))} V0 Z`;
  const plane = (v: number) => { const [sx, sy] = P(0, v); return `matrix(1 ${r1(T30 * 1000) / 1000} 0 1 ${r1(sx)} ${r1(sy)})`; };
  const ghostY = hy - 2 * GHOST.h - GHOST.H - 8;
  const reached = b.known ? STAIRS[b.stage].label : null;
  return (
    <a href={`/jobs/${b.app.jobId}`} className="gy-grave" data-grave={id}
       data-hx={r1(hx)} data-hy={r1(hy)} data-bury={b.fresh ? "1" : undefined}>
      <title>{`${b.app.company}: ${b.app.title}. Rejected${reached ? ` at ${reached}` : " (stage not recorded)"}.`}</title>
      <defs>
        <clipPath id={`gy-h${id}`}><polygon points={pts(hole)} /></clipPath>
        <clipPath id={`gy-w${id}`}><polygon points={window} /></clipPath>
      </defs>
      <rect x={r1(x0 - v1 - 2)} y={r1(y0 - SH - 2)} width={r1(SW + v1 + 4)} height={r1(SH + (SW + v1) * T30 + 4)} className="gy-hit" />
      <polygon points={pts(hole.map(([x, y]) => [x, y + 6]))} className="gy-glow" filter="url(#cl-blur)" />
      <g className="gy-stone">
        <path d={slab} transform={plane(0)} className="gy-back" />
        <path d={slab} transform={plane(ST)} className="gy-face" />
        <text x={rr} y={r1(-SH * 0.48)} transform={plane(ST)} textAnchor="middle" className="gy-rip">RIP</text>
      </g>
      <g clipPath={`url(#gy-h${id})`}>
        <polygon points={pts(hole)} className="gy-pit" />
        <polygon points={backWall} className="gy-wall" />
        <polygon points={leftWall} className="gy-wall gy-wall--l" />
        {/* the lid slides off along u (south-east) and out of the hole's clip, as if under the ground */}
        <polygon points={pts(hole)} className="gy-lid" style={{ ["--sx" as string]: `${SW}px`, ["--sy" as string]: `${r1(SW * T30)}px` }} />
      </g>
      {/* a falling cube's shadow on the lid, growing and darkening as it comes down (data-falling) */}
      <polygon points={pts([[hx, hy - GHOST.h], [hx + GHOST.a, hy], [hx, hy + GHOST.h], [hx - GHOST.a, hy]])} className="gy-shade" />
      <polygon points={pts(hole)} className="gy-rim" />
      <g clipPath={`url(#gy-w${id})`}><Ghost x={hx} y={ghostY} /></g>
      <text x={r1(hx)} y={r1(ghostY - 7)} textAnchor="middle" className="gy-name">{clip(b.app.company)}</text>
    </a>
  );
}

/**
 * The graves under one stage: a row of headstones side by side along u (the floor's SE-NW diagonal), centred on the
 * point of the floor straight under the stage, oldest at the back (NW), newest at the front (SE).
 */
function Row({ x, graves }: { x: number; graves: Buried[] }) {
  const shown = graves.slice(0, PER_ROW);
  const extra = graves.length - shown.length;
  // grave n's back corner on the ground, relative to the point under the stage: u along the row, v back by VC so the
  // holes' middle line runs through that point
  const at = (n: number) => {
    const u = (n - (shown.length - 1) / 2) * PITCH - SW / 2;
    return { x0: x + u + VC, y0: FLOOR_Y + (u - VC) * T30 };
  };
  const end = at(shown.length);
  return (
    <g className="gy-row">
      {shown.map((b, n) => <Grave key={b.app.id} b={b} {...at(n)} />)}
      {extra > 0 ? <text x={r1(end.x0 - VC + 4)} y={r1(end.y0 + VC * T30 + 4)} className="gy-more">+{extra}</text> : null}
    </g>
  );
}

/** a faint grid on the floor, fading out from the middle: lines along u and v every G ground units around (cx, FLOOR_Y) */
function Floor({ cx }: { cx: number }) {
  const G = 42, N = 12, L = G * N;
  const Q = (u: number, v: number) => `${r1(cx + u - v)},${r1(FLOOR_Y + (u + v) * T30)}`;
  const d = Array.from({ length: 2 * N + 1 }, (_, k) => (k - N) * G)
    .map((k) => `M${Q(-L, k)}L${Q(L, k)}M${Q(k, -L)}L${Q(k, L)}`).join("");
  return <path d={d} className="gy-grid" mask="url(#gy-fade)" />;
}

/** a floating cube's shadow on the floor straight below it: its footprint, soft */
function Shadow({ i }: { i: number }) {
  const s = stageTop(i), { a, h } = s.c;
  const pts2 = [[s.x, FLOOR_Y - h], [s.x + a, FLOOR_Y], [s.x, FLOOR_Y + h], [s.x - a, FLOOR_Y]];
  return <polygon points={pts(pts2)} className="gy-cast" filter="url(#cl-blur)" />;
}

/**
 * The floor far below the floating stairs: a faint grid, each cube's shadow straight under it, a soft blue-violet light,
 * and a row of graves under each stage (all at the same depth, side by side, so they never overlap). `xs` = each stage's
 * x; `buried` oldest first.
 */
export function Graveyard({ buried, xs }: { buried: Buried[]; xs: readonly number[] }) {
  return (
    <g className="gy" aria-label={`Graveyard: ${buried.length} rejection${buried.length === 1 ? "" : "s"}`}>
      <defs>
        <radialGradient id="gy-under" cx="0.5" cy="1" r="0.75">
          <stop offset="0" className="gy-under-0" />
          <stop offset="1" className="gy-under-1" />
        </radialGradient>
        <radialGradient id="gy-fade-g" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.25" stopColor="white" />
          <stop offset="1" stopColor="black" />
        </radialGradient>
        <mask id="gy-fade" maskUnits="userSpaceOnUse" x={0} y={FLOOR_Y - 200} width={960} height={400}>
          <rect x={0} y={FLOOR_Y - 200} width={960} height={400} fill="url(#gy-fade-g)" />
        </mask>
      </defs>
      <rect x={-40} y={300} width={1040} height={WORLD_H - 300 + 20} fill="url(#gy-under)" className="gy-under" />
      <Floor cx={480} />
      {[0, 1, 2, 3, 4, 5].map((i) => <Shadow key={i} i={i} />)}
      {buried.length
        ? [...STAIRS].reverse().map((s) => {
          const i = STAIRS.indexOf(s);
          const here = buried.filter((b) => b.stage === i);
          return here.length ? <Row key={s.key} x={xs[i]} graves={here} /> : null;
        })
        : <text x={354} y={FLOOR_Y + 60} className="cl-sub" textAnchor="middle">Nothing buried yet.</text>}
    </g>
  );
}
