import { describe, expect, it } from "vitest";
import { excitedTrack, hopTrack, scatter, toKeyframes, type Body } from "@/lib/ui/bounce";
import { stageOf } from "@/lib/ui/cubes";

describe("hopTrack", () => {
  const ways = [{ x: -300, y: 40 }, { x: -140, y: 30 }, { x: -140, y: 30, lift: 80 }, { x: 0, y: 0, spin: 1 }];
  const { frames, landings, duration } = hopTrack(ways);

  it("lands on every waypoint after the first, in order, and rests flat on the last", () => {
    expect(landings.map((l) => l.at)).toEqual([1, 2, 3]);
    expect(landings[0].t).toBeLessThan(landings[1].t);
    const end = frames[frames.length - 1];
    expect([end.x, end.y]).toEqual([0, 0]);
    expect(Math.abs(end.rot % 360)).toBeLessThan(0.01);
    expect(end.t).toBeCloseTo(duration, 5);
  });

  it("is rigid: poses carry position, rotation and opacity only, never a scale", () => {
    expect(Object.keys(frames[0]).sort()).toEqual(["o", "rot", "t", "x", "y"]);
    expect(toKeyframes(frames, duration)[0].transform).not.toMatch(/scale/);
  });

  it("is a real arc, higher on a longer or taller hop, and the extra bounce goes higher than the first", () => {
    const leg = (i: number) => frames.filter((f) => f.t >= (landings[i - 1]?.t ?? 0) && f.t <= landings[i].t);
    const peak = (i: number) => -Math.min(...leg(i).map((f) => f.y));
    expect(peak(0) + 30).toBeGreaterThan(80);   // a long hop is high: its top is 80+ above where it lands
    expect(peak(1) + 30).toBeGreaterThan(75);   // the pogo: lift 80 straight above the stage it stands on (a plain in-place hop is 34)
  });

  it("is quick: a hop is well under a second", () => {
    expect(landings[1].t - landings[0].t).toBeLessThan(0.8);
  });

  it("spins a full turn on the leg that asks for it, round the middle of the arc, and not on the others", () => {
    const spinLeg = frames.filter((f) => f.t >= landings[1].t);
    const rots = spinLeg.map((f) => f.rot);
    expect(Math.max(...rots)).toBeGreaterThan(340);
    const first = frames.filter((f) => f.t <= landings[0].t);
    expect(Math.max(...first.map((f) => Math.abs(f.rot)))).toBeLessThan(20);
    // rotation is mostly done by 85% of the spin leg and has barely begun by 10%
    const t0 = landings[1].t, T = duration - t0;
    const at = (k: number) => spinLeg.reduce((b, f) => (Math.abs(f.t - (t0 + k * T)) < Math.abs(b.t - (t0 + k * T)) ? f : b)).rot;
    expect(at(0.08)).toBeLessThan(90);
    expect(at(0.5)).toBeGreaterThan(120);
    expect(at(0.5)).toBeLessThan(240);
  });

  it("respects the ceiling", () => {
    const low = hopTrack([{ x: -60, y: 20 }, { x: 0, y: 0 }], { ceil: -4 });
    expect(Math.min(...low.frames.map((f) => f.y))).toBeGreaterThanOrEqual(-4.01);
  });

  it("an in-place hop (same stage) still jumps", () => {
    const h = hopTrack([{ x: 0, y: 0 }, { x: 0, y: 0 }]);
    expect(Math.min(...h.frames.map((f) => f.y))).toBeLessThan(-30);
  });
});

describe("excitedTrack (the Roles cube's idle)", () => {
  const { frames, duration } = excitedTrack(19);

  it("starts and ends standing still, flat, so the loop has no seam", () => {
    const end = frames[frames.length - 1];
    expect([frames[0].x, frames[0].y, frames[0].rot]).toEqual([0, 0, 0]);
    expect([end.x, end.y, end.rot % 360]).toEqual([0, 0, 0]);   // a whole number of turns is flat
    expect(frames[frames.length - 1].t).toBeCloseTo(duration, 6);
  });

  it("rocks about its bottom edge (tilts both ways, shifting sideways with the tilt), then jumps, spins a full turn, and rests", () => {
    const rock = frames.filter((f) => f.t < 0.9);
    expect(Math.max(...rock.map((f) => f.rot))).toBeGreaterThan(6);
    expect(Math.min(...rock.map((f) => f.rot))).toBeLessThan(-6);
    const tilted = rock.find((f) => f.rot > 8)!;
    expect(tilted.x).toBeGreaterThan(2);
    expect(Math.max(...frames.map((f) => f.rot))).toBeGreaterThan(340);
    expect(-Math.min(...frames.map((f) => f.y))).toBeGreaterThan(40);
  });

  it("is rigid and spends most of the loop waiting, not fidgeting", () => {
    expect(Object.keys(frames[0]).sort()).toEqual(["o", "rot", "t", "x", "y"]);
    const still = frames.filter((f) => f.t > duration - 2.2);
    expect(still.every((f) => f.y === 0 && f.rot === still[0].rot && f.rot % 360 === 0)).toBe(true);   // no slow unwinding while it waits
  });
});

describe("rotation is continuous (no frame-to-frame jump near 180: a fast spin is ~40 per frame, a wrap seam would be 180+)", () => {
  const worst = (fs: { rot: number }[]) => Math.max(...fs.slice(1).map((f, i) => Math.abs(f.rot - fs[i].rot)));
  it("hops, with spins on several legs", () => {
    const h = hopTrack([{ x: -500, y: 80 }, { x: -280, y: 40, spin: 1 }, { x: -280, y: 40, lift: 80 }, { x: -140, y: 20, spin: 1 }, { x: 0, y: 0, spin: 1 }]);
    expect(worst(h.frames)).toBeLessThan(90);
    expect(h.frames[h.frames.length - 1].rot).toBeCloseTo(1080, 3);
  });
  it("the Roles cube loop", () => { expect(worst(excitedTrack(19).frames)).toBeLessThan(90); });
  it("a pile that tumbles and flies back", () => {
    const A = 42, p = A / 3, c = (u: number, v: number, hero = false): Body => ({ u: (u + 0.5) * p, v: (v + 0.5) * p, layer: 0, hero });
    const s = scatter([c(2, 1), c(2, 2, true), c(1, 1), c(2, 0)], { A, R: 5.7, layerH: 11, drop: 60, hit: { vx: 400, vy: 900 } });
    for (const tr of s.tracks) expect(worst(tr)).toBeLessThan(90);
  });
});

describe("scatter", () => {
  const A = 42, pitch = A / 3;
  const cell = (u: number, v: number, hero = false, layer = 0): Body => ({ u: (u + 0.5) * pitch, v: (v + 0.5) * pitch, layer, hero });
  const opts = { A, R: 5.7, layerH: 11, drop: 60, hit: { vx: 240, vy: 600 } };
  const pile = [cell(1, 1), cell(0, 1), cell(1, 0), cell(2, 1), cell(1, 2, true)];
  const r = scatter(pile, opts);

  it("every cube ends exactly in its place, flat and visible", () => {
    for (const tr of r.tracks) {
      const end = tr[tr.length - 1];
      expect(end.x).toBeCloseTo(0, 6); expect(end.y).toBeCloseTo(0, 6); expect(end.o).toBe(1);
      expect(Math.abs(end.rot % 360)).toBeLessThan(0.01);
    }
  });

  it("the newcomer's crash moves the cubes it hits, and they slide (no spring: x never reverses mid-slide)", () => {
    const moved = r.tracks.filter((tr, i) => !pile[i].hero && Math.max(...tr.map((f) => Math.hypot(f.x, f.y))) > 5);
    expect(moved.length).toBeGreaterThan(0);
    const slide = moved[0].filter((f) => f.t < r.settled);
    const xs = slide.map((f) => f.x);
    const reversals = xs.slice(2).filter((x, k) => Math.sign(x - xs[k + 1]) !== Math.sign(xs[k + 1] - xs[k]) && Math.abs(x - xs[k + 1]) > 0.2).length;
    expect(reversals).toBeLessThanOrEqual(1);
  });

  it("nothing rotates while it is just sliding on the face", () => {
    const stayed = r.tracks.filter((tr) => tr.every((f) => f.y <= 1 && f.o === 1));
    expect(stayed.length).toBeGreaterThan(0);
    for (const tr of stayed) expect(Math.max(...tr.filter((f) => f.t < r.settled).map((f) => Math.abs(f.rot)))).toBe(0);
  });

  it("cubes pushed past the edge fall and tumble to the floor, or drop out of sight behind", () => {
    const fell = [
      scatter([cell(2, 1), cell(2, 2, true)], opts),
      scatter([cell(1, 0), cell(0, 0, true)], opts),
      scatter([cell(0, 1), cell(1, 1), cell(0, 2, true)], { ...opts, hit: { vx: 400, vy: 900 } }),
    ];
    const any = fell.some((s) => s.tracks.some((tr) => tr.some((f) => f.y > 25 || f.o < 1)));
    expect(any).toBe(true);
    for (const s of fell) for (const tr of s.tracks) expect(tr.some((f) => Math.abs(f.rot) > 20) || tr.every((f) => f.y <= 25 && f.o === 1)).toBe(true);
  });

  it("a cube stacked on one that slides away drops to the face", () => {
    const s = scatter([cell(1, 1), cell(1, 1, false, 1), cell(2, 1, true)], opts);
    const stacked = s.tracks[1];
    expect(Math.max(...stacked.map((f) => f.y))).toBeGreaterThan(5);   // it came down (its own height is 11)
    const end = stacked[stacked.length - 1];
    expect(end.x).toBeCloseTo(0, 6); expect(end.y).toBeCloseTo(0, 6);
  });

  it("a lone newcomer does not need anyone to hit", () => {
    const s = scatter([cell(1, 1, true)], opts);
    expect(s.tracks[0].length).toBeGreaterThan(1);
  });
});

describe("stageOf", () => {
  it("maps statuses to stairs, offer to the summit, the rest off the climb", () => {
    expect(["interested", "applying", "applied", "tests_done", "hirevue", "interview_done", "offer", "rejected", "discovered", null].map(stageOf))
      .toEqual([0, 0, 1, 2, 3, 4, 5, -1, -1, -1]);
  });
});


