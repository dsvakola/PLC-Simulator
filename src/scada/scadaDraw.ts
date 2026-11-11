// Drawings of the SCADA screen items, in SVG. Each item is drawn with its
// top-left corner at (0, 0) and its live value (or null when not running).
import type { ScadaItem } from "../api";

export interface KindInfo {
  name: string;
  w: number;
  h: number;
  /** "bit": I, Q or M; "num": AI or AM; null: no tag. */
  tag: "bit" | "num" | null;
  writes: boolean;
  hint: string;
}

export const KINDS: Record<string, KindInfo> = {
  button: { name: "Push button", w: 90, h: 90, tag: "bit", writes: true, hint: "Works while pressed: I1 to I4 or a marker M" },
  switch: { name: "Switch", w: 90, h: 90, tag: "bit", writes: true, hint: "On or off: I1 to I4 or a marker M" },
  lamp: { name: "Lamp", w: 80, h: 90, tag: "bit", writes: false, hint: "Lights when its point is on: I, Q or M" },
  number: { name: "Number display", w: 170, h: 74, tag: "num", writes: false, hint: "Shows an analog value: AI or AM" },
  bar: { name: "Bar graph", w: 80, h: 190, tag: "num", writes: false, hint: "A bar for an analog value: AI or AM" },
  slider: { name: "Slider", w: 230, h: 80, tag: "num", writes: true, hint: "Sets an analog marker AM" },
  text: { name: "Text", w: 200, h: 40, tag: null, writes: false, hint: "A title or a note" },
  tank: { name: "Tank", w: 140, h: 190, tag: "num", writes: false, hint: "Shows a level: AI or AM" },
  motor: { name: "Motor", w: 120, h: 100, tag: "bit", writes: false, hint: "Turns when its point is on" },
  valve: { name: "Valve", w: 100, h: 80, tag: "bit", writes: false, hint: "Open (green) when its point is on" },
  conveyor: { name: "Conveyor", w: 240, h: 80, tag: "bit", writes: false, hint: "Runs when its point is on" },
};

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const SANS = "'Segoe UI', system-ui, sans-serif";
const INK = "#1d2430";
const COLORS: Record<string, string> = { green: "#2fa34a", red: "#d9342b", amber: "#f0a020", blue: "#2a62c9", white: "#f4f4f0" };

const text = (t: string, x: number, y: number, size: number, fill = INK, weight = 700, anchor = "middle"): string =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${SANS}" font-weight="${weight}" font-size="${size}" fill="${fill}">${esc(t)}</text>`;

const num = (p: Record<string, string>, k: string, d: number): number => {
  const v = Number(p[k]);
  return Number.isFinite(v) && p[k] !== undefined && p[k] !== "" ? v : d;
};

/** The range of an analog item. */
export function range(it: ScadaItem): [number, number] {
  const lo = num(it.props, "min", 0);
  const hi = num(it.props, "max", 1000);
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}

/** An analog value as shown: value x scale, with its decimals and unit. */
export function formatValue(it: ScadaItem, v: number): string {
  const shown = v * num(it.props, "scale", 1);
  const dec = Math.max(0, Math.min(4, Math.round(num(it.props, "decimals", 0))));
  const unit = it.props.unit ? ` ${it.props.unit}` : "";
  return `${shown.toFixed(dec)}${unit}`;
}

const phase = (period: number): number => Math.round(performance.now() % period);

/** Draws one item. `value` is its live value, or null when not simulating. */
export function drawItem(it: ScadaItem, value: boolean | number | null, held = false): string {
  const k = KINDS[it.kind];
  if (!k) return "";
  const w = it.w || k.w;
  const h = it.h || k.h;
  const cx = w / 2;
  const on = value === true;
  const v = typeof value === "number" ? value : 0;
  const label = it.label ? text(it.label, cx, h - 4, 14) : "";
  const tag = it.tag ? text(it.tag, w - 4, 14, 11, "#6b7684", 700, "end") : "";
  switch (it.kind) {
    case "button": {
      const down = held || (on && it.tag.startsWith("M"));
      return (
        `<rect x="${cx - 32}" y="6" width="64" height="58" rx="10" fill="#e1e5ea" stroke="#4b525c" stroke-width="2"/>` +
        `<circle cx="${cx}" cy="${down ? 37 : 35}" r="${down ? 20 : 22}" fill="${down ? "#1f6fc4" : COLORS[it.props.color ?? "green"] ?? "#2fa34a"}" stroke="#1d2229" stroke-width="2"/>` +
        `<circle cx="${cx - 7}" cy="28" r="6" fill="#ffffff" opacity="${down ? 0.15 : 0.35}"/>` +
        label +
        tag
      );
    }
    case "switch":
      return (
        `<rect x="${cx - 32}" y="10" width="64" height="50" rx="25" fill="${on ? "#bfe8c9" : "#e1e5ea"}" stroke="#4b525c" stroke-width="2"/>` +
        `<circle cx="${on ? cx + 14 : cx - 14}" cy="35" r="18" fill="${on ? "#1f9d47" : "#8d96a3"}" stroke="#1d2229" stroke-width="2"/>` +
        text(on ? "ON" : "OFF", on ? cx - 14 : cx + 14, 40, 11, on ? "#1f6b33" : "#5a6270") +
        label +
        tag
      );
    case "lamp": {
      const c = COLORS[it.props.color ?? "green"] ?? "#2fa34a";
      return (
        (on ? `<circle cx="${cx}" cy="36" r="36" fill="${c}" opacity="0.3"/>` : "") +
        `<circle cx="${cx}" cy="36" r="27" fill="#1d1d1d"/>` +
        `<circle cx="${cx}" cy="36" r="23" fill="${c}" opacity="${on ? 1 : 0.35}"/>` +
        `<ellipse cx="${cx - 7}" cy="27" rx="9" ry="5" fill="#ffffff" opacity="0.45"/>` +
        label +
        tag
      );
    }
    case "number":
      return (
        `<rect x="2" y="2" width="${w - 4}" height="${h - 24}" rx="6" fill="#16202b" stroke="#4b525c" stroke-width="2"/>` +
        `<text x="${w - 14}" y="${(h - 24) / 2 + 12}" text-anchor="end" font-family="Consolas, 'Courier New', monospace" font-weight="700" font-size="26" fill="#58e07c">${esc(value === null ? "----" : formatValue(it, v))}</text>` +
        label +
        tag
      );
    case "bar": {
      const [lo, hi] = range(it);
      const f = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
      const bh = h - 50;
      return (
        `<rect x="${cx - 18}" y="8" width="36" height="${bh}" rx="4" fill="#e1e5ea" stroke="#4b525c" stroke-width="2"/>` +
        `<rect x="${cx - 15}" y="${8 + 3 + (bh - 6) * (1 - f)}" width="30" height="${(bh - 6) * f}" rx="2" fill="#1f6fc4"/>` +
        text(value === null ? "" : formatValue(it, v), cx, h - 24, 12, INK, 700) +
        label
      );
    }
    case "slider": {
      const [lo, hi] = range(it);
      const f = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
      const x0 = 18;
      const x1 = w - 18;
      const kx = x0 + (x1 - x0) * f;
      return (
        `<rect class="slider-track" x="${x0}" y="26" width="${x1 - x0}" height="8" rx="4" fill="#c9d0d8"/>` +
        `<rect x="${x0}" y="26" width="${kx - x0}" height="8" rx="4" fill="#1f6fc4"/>` +
        `<circle cx="${kx}" cy="30" r="12" fill="#ffffff" stroke="#1f6fc4" stroke-width="3"/>` +
        text(value === null ? "" : formatValue(it, v), cx, 14, 12, INK, 700) +
        label +
        tag
      );
    }
    case "text":
      return text(it.label || "Text", 0, num(it.props, "size", 22), num(it.props, "size", 22), it.props.color === "blue" ? "#1f4fa8" : INK, 700, "start");
    case "tank": {
      const [lo, hi] = range(it);
      const f = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
      const th = h - 40;
      return (
        `<path d="M14 10V${th}a8 8 0 0 0 8 8H${w - 22}a8 8 0 0 0 8 -8V10" fill="#eef3f8" stroke="#4b525c" stroke-width="3"/>` +
        `<rect x="17" y="${10 + (th - 10) * (1 - f)}" width="${w - 34}" height="${(th - 10) * f + 5}" fill="#4a9be0" opacity="0.85"/>` +
        text(value === null ? "" : formatValue(it, v), cx, th / 2 + 10, 15, INK, 800) +
        label +
        tag
      );
    }
    case "motor": {
      const spin = on ? ` class="spin" style="animation-delay:-${phase(500)}ms"` : "";
      return (
        `<rect x="8" y="14" width="66" height="54" rx="9" fill="${on ? "#2c6fb5" : "#7d8894"}" stroke="#1d2229" stroke-width="2"/>` +
        text("M", 41, 50, 24, "#ffffff", 800) +
        `<rect x="74" y="35" width="14" height="12" fill="#8d96a3" stroke="#4b525c" stroke-width="2"/>` +
        `<g${spin}><circle cx="100" cy="41" r="13" fill="#e3e7ec" stroke="#4b525c" stroke-width="2"/><path d="M100 29v24M88 41h24" stroke="#4b525c" stroke-width="3"/></g>` +
        label +
        tag
      );
    }
    case "valve": {
      const c = on ? "#2fa34a" : "#9aa3ae";
      return (
        `<path d="M0 30h18M${w - 18} 30h18" stroke="#4b525c" stroke-width="8"/>` +
        `<path d="M18 12L${cx} 30L18 48zM${w - 18} 12L${cx} 30L${w - 18} 48z" fill="${c}" stroke="#1d2229" stroke-width="2"/>` +
        `<path d="M${cx} 30V10M${cx - 12} 10h24" stroke="#1d2229" stroke-width="3"/>` +
        label +
        tag
      );
    }
    case "conveyor": {
      let chevrons = "";
      for (let x = 30; x < w - 30; x += 30) chevrons += `<path d="M${x} 18l8 8-8 8" stroke="#ffffff" stroke-width="3" fill="none"/>`;
      return (
        `<rect x="10" y="12" width="${w - 20}" height="28" rx="14" fill="#3b4350" stroke="#1d2229" stroke-width="2"/>` +
        `<circle cx="24" cy="26" r="9" fill="#c9d0d8" stroke="#1d2229"/><circle cx="${w - 24}" cy="26" r="9" fill="#c9d0d8" stroke="#1d2229"/>` +
        `<g${on ? ` class="belt" style="animation-delay:-${phase(600)}ms"` : ""}>${chevrons}</g>` +
        label +
        tag
      );
    }
    default:
      return "";
  }
}

/** A small picture for the list of items. */
export function thumb(kind: string): string {
  const it: ScadaItem = { id: 0, kind, x: 0, y: 0, w: 0, h: 0, label: "", tag: "", props: {} };
  const k = KINDS[kind];
  if (!k) return "";
  const v = k.tag === "num" ? 600 : true;
  return `<svg viewBox="-4 -4 ${k.w + 8} ${k.h + 8}" width="28" height="28" aria-hidden="true">${drawItem(it, kind === "text" ? null : v)}</svg>`;
}
