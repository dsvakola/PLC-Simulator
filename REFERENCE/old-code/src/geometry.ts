// Shared geometry. These rules match the Rust side (vra-core/src/project.rs),
// so a pin drawn in a hole is also counted as connected to it.
// A part is first mirrored (flip), then turned clockwise about the centre of
// its box, then moved so the unturned box has its corner at (x, y).
import type { PartDef, PlacedPart } from "./api";

export interface Point {
  x: number;
  y: number;
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Normalises an angle to -180 < a <= 180, rounded to 0.1 degree. */
export function normaliseAngle(a: number): number {
  let r = ((a % 360) + 360) % 360;
  if (r > 180) r -= 360;
  return Math.round(r * 10) / 10;
}

/** Position on the workspace of a point (x, y) given in the part's own coordinates. */
export function toWorldPoint(p: PlacedPart, def: PartDef, x: number, y: number): Point {
  const lx = p.flipH ? def.width - x : x;
  const ly = p.flipV ? def.height - y : y;
  const cx = def.width / 2;
  const cy = def.height / 2;
  const dx = lx - cx;
  const dy = ly - cy;
  const t = (p.rotation * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: p.x + cx + round3(dx * c - dy * s), y: p.y + cy + round3(dx * s + dy * c) };
}

/** The opposite of toWorldPoint: a workspace point in the part's own coordinates. */
export function toLocalPoint(p: PlacedPart, def: PartDef, x: number, y: number): Point {
  const cx = def.width / 2;
  const cy = def.height / 2;
  const dx = x - p.x - cx;
  const dy = y - p.y - cy;
  const t = (-p.rotation * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const lx = cx + dx * c - dy * s;
  const ly = cy + dx * s + dy * c;
  return { x: round3(p.flipH ? def.width - lx : lx), y: round3(p.flipV ? def.height - ly : ly) };
}

/** Where a pin is in the part's own coordinates: the end of its leg if the leg was moved. */
export function pinLocal(p: Pick<PlacedPart, "legs">, def: PartDef, pinName: string): Point | null {
  const leg = p.legs?.[pinName];
  const end = leg?.[leg.length - 1];
  if (end) return end;
  const pin = def.pins.find((q) => q.name === pinName);
  return pin ? { x: pin.x, y: pin.y } : null;
}

/** SVG transform that draws a part at its position, angle and flips. */
export function partTransform(p: PlacedPart, def: PartDef): string {
  let t = `translate(${p.x} ${p.y})`;
  if (p.rotation) t += ` rotate(${p.rotation} ${def.width / 2} ${def.height / 2})`;
  if (p.flipH || p.flipV) {
    t += ` translate(${p.flipH ? def.width : 0} ${p.flipV ? def.height : 0}) scale(${p.flipH ? -1 : 1} ${p.flipV ? -1 : 1})`;
  }
  return t;
}

/** Box around a placed part on the workspace (after turning). */
export function partBounds(p: PlacedPart, def: PartDef): { minX: number; minY: number; maxX: number; maxY: number } {
  const corners = [
    toWorldPoint(p, def, 0, 0),
    toWorldPoint(p, def, def.width, 0),
    toWorldPoint(p, def, 0, def.height),
    toWorldPoint(p, def, def.width, def.height),
  ];
  return {
    minX: Math.min(...corners.map((c) => c.x)),
    minY: Math.min(...corners.map((c) => c.y)),
    maxX: Math.max(...corners.map((c) => c.x)),
    maxY: Math.max(...corners.map((c) => c.y)),
  };
}

export function pinWorld(p: PlacedPart, def: PartDef, pinName: string): Point | null {
  const pin = pinLocal(p, def, pinName);
  return pin ? toWorldPoint(p, def, pin.x, pin.y) : null;
}

export const key = (x: number, y: number): string => `${Math.round(x)},${Math.round(y)}`;
