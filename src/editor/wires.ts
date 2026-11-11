// Paths of the program's wires. A wire runs at right angles: it leaves an
// output across, then turns up or down, across, and so on, and reaches the
// input across. Its path is the list of corners between the two pins; an
// empty list means the path is worked out automatically.
//
// In a full path [output, corner 1, ..., corner n, input] the pieces take
// turns: piece 0 runs across, piece 1 up or down, piece 2 across ... and the
// last piece runs across into the input, so n is always even.
import type { Point } from "../api";

const STUB = 20;

const same = (p: Point, q: Point): boolean => p.x === q.x && p.y === q.y;

/** Space taken by the two blocks a wire joins, so a wire going back to the
 *  left can run round them instead of through them. */
export interface Around {
  top: number;
  bottom: number;
}

/** The corners of the automatic path from output a to input b. */
export function autoCorners(a: Point, b: Point, around?: Around): Point[] {
  if (b.x - a.x >= 20) {
    const mx = a.x + (b.x - a.x) / 2;
    return [
      { x: mx, y: a.y },
      { x: mx, y: b.y },
    ];
  }
  // The input is left of the output: go round, above or below both blocks,
  // whichever is shorter.
  const xa = a.x + STUB;
  const xb = b.x - STUB;
  let my = a.y === b.y ? a.y + 80 : (a.y + b.y) / 2;
  if (around) {
    const up = Math.abs(a.y - around.top) + Math.abs(b.y - around.top);
    const down = Math.abs(a.y - around.bottom) + Math.abs(b.y - around.bottom);
    my = up <= down ? around.top : around.bottom;
  }
  return [
    { x: xa, y: a.y },
    { x: xa, y: my },
    { x: xb, y: my },
    { x: xb, y: b.y },
  ];
}

/** A valid list of corners: an even number, at right angles. */
function valid(a: Point, c: Point[], b: Point): boolean {
  if (c.length === 0 || c.length % 2 !== 0) return false;
  const full = [a, ...c, b];
  for (let i = 0; i < full.length - 1; i++) {
    const p = full[i] as Point;
    const q = full[i + 1] as Point;
    if (i % 2 === 0 ? p.y !== q.y : p.x !== q.x) return false;
  }
  return true;
}

/** Corners from the clicks made while a wire was drawn (from the output to
 *  the input): the wire goes across, then up or down, to each click. */
export function fromClicks(a: Point, clicks: Point[], b: Point): Point[] {
  if (clicks.length === 0) return [];
  const c: Point[] = [];
  let y = a.y;
  for (const k of clicks) {
    c.push({ x: k.x, y }, { x: k.x, y: k.y });
    y = k.y;
  }
  // From the last click: up or down to the input's height, then across.
  const last = clicks[clicks.length - 1] as Point;
  c.pop();
  c.push({ x: last.x, y: b.y });
  return simplify(a, c, b);
}

/** Takes out corners that do nothing: repeated points and corners on a straight line. */
export function simplify(a: Point, corners: Point[], b: Point): Point[] {
  let c = corners.map((p) => ({ ...p }));
  for (let changed = true; changed && c.length >= 2; ) {
    changed = false;
    const full = [a, ...c, b];
    for (let i = 1; i < full.length - 1; i++) {
      const p = full[i - 1] as Point;
      const q = full[i] as Point;
      const r = full[i + 1] as Point;
      // A corner in a straight line (or on top of a neighbour) and its
      // partner go together, so the pieces keep taking turns.
      if ((p.x === q.x && q.x === r.x) || (p.y === q.y && q.y === r.y) || same(p, q)) {
        const k = i - 1;
        const partner = k + 1 < c.length ? k + 1 : k - 1;
        const next = c.filter((_, j) => j !== k && j !== partner);
        if (next.length === 0 || valid(a, next, b)) {
          c = next;
          changed = true;
          break;
        }
      }
    }
  }
  return valid(a, c, b) ? c : [];
}

/** The corners to draw, after the blocks at either end have moved: the first
 *  and last corners follow the heights of the pins. */
export function fitted(a: Point, corners: Point[], b: Point, around?: Around): Point[] {
  if (corners.length < 2 || corners.length % 2 !== 0) return autoCorners(a, b, around);
  const c = corners.map((p) => ({ ...p }));
  (c[0] as Point).y = a.y;
  (c[c.length - 1] as Point).y = b.y;
  return valid(a, c, b) ? c : autoCorners(a, b, around);
}

/** Every point of the path, from the output to the input. */
export function fullPath(a: Point, corners: Point[], b: Point, around?: Around): Point[] {
  return [a, ...fitted(a, corners, b, around), b];
}

export function pathData(full: Point[]): string {
  return full.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join("");
}

/** Moves piece i of a full path: a piece across moves up or down to `to.y`,
 *  a piece up or down moves sideways to `to.x`. The pieces at the pins get a
 *  new step next to the pin, so the pin itself stays put. Returns the corners. */
export function movePiece(full: Point[], i: number, to: Point): Point[] {
  const f = full.map((p) => ({ ...p }));
  const last = f.length - 2;
  if (i < 0 || i > last) return f.slice(1, -1);
  if (i % 2 === 1) {
    (f[i] as Point).x = to.x;
    (f[i + 1] as Point).x = to.x;
    return f.slice(1, -1);
  }
  const y = to.y;
  const a = f[0] as Point;
  const b = f[f.length - 1] as Point;
  if (i === 0 && i === last) return f.slice(1, -1);
  if (i === 0) {
    // Step down (or up) just after the output.
    const sx = a.x + STUB;
    (f[1] as Point).y = y;
    return [{ x: sx, y: a.y }, { x: sx, y }, ...f.slice(1, -1)];
  }
  if (i === last) {
    const sx = b.x - STUB;
    (f[i] as Point).y = y;
    return [...f.slice(1, -1), { x: sx, y }, { x: sx, y: b.y }];
  }
  (f[i] as Point).y = y;
  (f[i + 1] as Point).y = y;
  return f.slice(1, -1);
}

/** Moves corner k of a full path (1 to n): the two pieces that meet there move. */
export function moveCorner(full: Point[], k: number, to: Point): Point[] {
  // Piece k - 1 runs across when k is odd, otherwise piece k does.
  const across = k % 2 === 1 ? k - 1 : k;
  const upDown = k % 2 === 1 ? k : k - 1;
  const first = movePiece(full, upDown, to);
  const a = full[0] as Point;
  const b = full[full.length - 1] as Point;
  // Moving the up-and-down piece never adds corners, so `across` still points at the same piece.
  return movePiece([a, ...first, b], across, to);
}

/** Which piece of a full path is nearest to `at`. */
export function pieceAt(full: Point[], at: Point): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < full.length - 1; i++) {
    const p = full[i] as Point;
    const q = full[i + 1] as Point;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.min(1, Math.max(0, ((at.x - p.x) * dx + (at.y - p.y) * dy) / len2));
    const d = Math.hypot(p.x + t * dx - at.x, p.y + t * dy - at.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
