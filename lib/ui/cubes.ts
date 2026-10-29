/**
 * Isometric cube geometry and the pipeline's stages, shared by the Climb (/applications) and the weekly Blocks
 * for anything that draws the stairs.
 */

const T30 = Math.tan(Math.PI / 6);
export type Cube = { a: number; h: number; H: number };
/** an isometric cube: `a` = half its width; the top face is 2h tall and the sides H tall */
export const cube = (a: number): Cube => ({ a, h: a * T30, H: (2 * a) / Math.sqrt(3) });
export const r1 = (n: number) => Math.round(n * 10) / 10;
const pts = (p: number[][]) => p.map(([px, py]) => `${r1(px)},${r1(py)}`).join(" ");

/** the three visible faces of a cube whose top vertex is at (x, y), plus the skews that map local (0..a, 0..H) onto the sides */
export function faces(x: number, y: number, { a, h, H }: Cube) {
  const k = r1(T30 * 1000) / 1000;
  return {
    top: pts([[x, y], [x + a, y + h], [x, y + 2 * h], [x - a, y + h]]),
    left: pts([[x - a, y + h], [x, y + 2 * h], [x, y + 2 * h + H], [x - a, y + h + H]]),
    right: pts([[x, y + 2 * h], [x + a, y + h], [x + a, y + h + H], [x, y + 2 * h + H]]),
    /** the cube's footprint dropped below it: where its light falls */
    floor: pts([[x, y + H + 14], [x + a, y + h + H + 14], [x, y + 2 * h + H + 14], [x - a, y + h + H + 14]]),
    leftT: `matrix(1 ${k} 0 1 ${r1(x - a)} ${r1(y + h)})`,
    rightT: `matrix(1 ${-k} 0 1 ${r1(x)} ${r1(y + 2 * h)})`,
  };
}

/** 16-unit stroked paths, same grid as lib/ui/icons.tsx */
export const ICON: Record<string, readonly string[]> = {
  interested: ["M4.5 2h7v12l-3.5-2.6L4.5 14z"],
  applying: ["M10.6 2.4 13.6 5.4 6 13H3v-3z", "M9.1 3.9l3 3"],
  applied: ["M14 2 2 7l5 2 2 5z", "M14 2 7 9"],
  tests: ["M3 2.5h10v11.5H3z", "M6 1.5h4v2H6z", "m5.8 8.6 1.4 1.4 3-3.2"],
  hirevue: ["M1.5 4h9.5v8H1.5z", "m11 8 3.5-2.2v4.4z"],
  interview: ["M5.5 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M1.5 13.5c0-2.2 1.8-4 4-4s4 1.8 4 4", "M11 7.3a1.7 1.7 0 1 0 0-3.4", "M12 9.3c1.5.4 2.6 1.9 2.6 4.2"],
  offer: ["M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"],
};

export const STAIRS = [
  // Interested and Applying are one stage here: both mean "not sent yet" (Jonno 2026-10-27: three blocks for nearly the same step)
  { key: "applying", label: "To send", statuses: ["interested", "applying"] },
  { key: "applied", label: "Sent", statuses: ["applied"] },
  { key: "tests", label: "Tests", statuses: ["tests", "tests_done"] },
  { key: "hirevue", label: "HireVue", statuses: ["hirevue", "hirevue_done"] },
  { key: "interview", label: "Interview", statuses: ["interview", "interview_done"] },
] as const;
