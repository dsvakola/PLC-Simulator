// Drawings of the control panel. Everything is SVG, so it stays sharp at any
// zoom. Each device function draws with its top-left corner at (0, 0).
import type { DeviceDef, DeviceState, FixedDevice, PlacedDevice, SimFrame } from "../api";
import { modeCaption, readMode } from "./inputMode";

export const COLORS: Record<string, string> = {
  red: "#d9342b",
  amber: "#f0a020",
  blue: "#2a62c9",
  green: "#2fa34a",
  white: "#f4f4f0",
  yellow: "#f2d21b",
  black: "#222222",
  brown: "#7a4a24",
  grey: "#8d96a3",
  orange: "#e8791f",
  earth: "#2fa34a",
};

/** Insulation colours the student can choose for a jumper wire. "earth" is green and yellow. */
export const WIRE_COLORS = ["red", "blue", "black", "brown", "yellow", "white", "earth"] as const;

export const colorHex = (name: string | undefined, fallback = "#8d96a3"): string => COLORS[name ?? ""] ?? fallback;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const SANS = "'Segoe UI', system-ui, sans-serif";
const NAVY = "#2e2a7f";
const INK = "#1d2430";

const text = (t: string, x: number, y: number, size: number, fill = INK, weight = 700, anchor = "middle", extra = ""): string =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${SANS}" font-weight="${weight}" font-size="${size}" fill="${fill}"${extra}>${esc(t)}</text>`;

/** Earth symbol, centred on (x, y). */
export function earthMark(x: number, y: number, s = 1): string {
  return (
    `<g stroke="${INK}" stroke-width="${2.4 * s}" stroke-linecap="round" fill="none">` +
    `<path d="M${x} ${y - 13 * s}V${y - 2 * s}M${x - 13 * s} ${y - 2 * s}H${x + 13 * s}M${x - 9 * s} ${y + 4 * s}H${x + 9 * s}M${x - 5 * s} ${y + 10 * s}H${x + 5 * s}M${x - 2 * s} ${y + 15 * s}H${x + 2 * s}"/></g>`
  );
}

/** A screw terminal with its slot, as on the real connector strips. */
export function screw(x: number, y: number, r = 10): string {
  return (
    `<circle cx="${x}" cy="${y}" r="${r}" fill="#f4f5f6" stroke="#2b2f36" stroke-width="2"/>` +
    `<line x1="${x - r * 0.62}" y1="${y + r * 0.62}" x2="${x + r * 0.62}" y2="${y - r * 0.62}" stroke="#2b2f36" stroke-width="2.2"/>`
  );
}

function dome(cx: number, cy: number, r: number, color: string, lit: boolean): string {
  const c = colorHex(color);
  return (
    (lit ? `<circle cx="${cx}" cy="${cy}" r="${r + 16}" fill="${c}" opacity="0.35"/>` : "") +
    `<circle cx="${cx}" cy="${cy}" r="${r + 3}" fill="#1d1d1d"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"${lit ? "" : ' opacity="0.55"'}/>` +
    (lit ? `<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="#ffffff" opacity="0.35"/>` : "") +
    `<ellipse cx="${cx - r * 0.3}" cy="${cy - r * 0.42}" rx="${r * 0.42}" ry="${r * 0.24}" fill="#ffffff" opacity="${lit ? 0.7 : 0.35}"/>`
  );
}

function led(x: number, y: number, on: boolean, color = "#3bdc6c"): string {
  return `<circle cx="${x}" cy="${y}" r="5.5" fill="${on ? color : "#20262e"}" stroke="#0d1014" stroke-width="1"/>` + (on ? `<circle cx="${x}" cy="${y}" r="10" fill="${color}" opacity="0.3"/>` : "");
}

/** What the board shows while the simulation runs; null when it is not running. */
export type SimView = SimFrame | null;

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${two(h)}:${two(m % 60)}:${two(s % 60)}`;
}

/** Our own PLC module: 8 inputs, 4 relay outputs, a display and status lights. */
function plcModule(w: number, h: number, sim: SimView): string {
  const band = 100;
  let s =
    `<defs><linearGradient id="plcBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6c7a8d"/><stop offset="1" stop-color="#4f5b6b"/></linearGradient></defs>` +
    `<rect x="0" y="0" width="${w}" height="${h}" rx="10" fill="#22272f"/>` +
    `<rect x="6" y="6" width="${w - 12}" height="${h - 12}" rx="7" fill="url(#plcBody)"/>` +
    `<rect x="6" y="6" width="${w - 12}" height="${band}" rx="7" fill="#3a4350"/>` +
    `<rect x="6" y="${h - band - 6}" width="${w - 12}" height="${band}" rx="7" fill="#3a4350"/>`;
  // Supply and inputs along the top, each input with its light.
  const top = ["P1", "P2", "I1", "I2", "I3", "I4", "I5", "I6", "I7", "I8"];
  top.forEach((name, i) => {
    const x = 40 + i * 47;
    s += text(name, x, 32, 22, "#ffffff", 700) + screw(x, 60, 11);
    if (i >= 2) s += led(x, 90, sim !== null && (sim.inputs[i - 2] ?? false));
  });
  // Display.
  const run = sim !== null && !sim.tripped;
  const mono = ' font-family="Consolas, monospace"';
  s +=
    `<rect x="22" y="118" width="268" height="152" rx="6" fill="#1b2027"/>` +
    `<rect x="30" y="126" width="252" height="136" rx="3" fill="${run ? "#b9d89a" : "#9fb08c"}"/>`;
  if (sim) {
    const ai = (v: number): string => (v / 100).toFixed(2);
    s +=
      text(sim.tripped ? "SUPPLY OFF" : "RUN", 42, 158, 26, sim.tripped ? "#8a1a14" : "#24331a", 800, "start") +
      text(fmtTime(sim.timeMs), 272, 158, 17, "#24331a", 600, "end") +
      text(`I ${sim.inputs.map((x, i) => (x ? String(i + 1) : "·")).join(" ")}`, 42, 190, 18, "#24331a", 700, "start", mono) +
      text(`Q ${sim.outputs.map((x, i) => (x ? String(i + 1) : "·")).join(" ")}`, 42, 216, 18, "#24331a", 700, "start", mono) +
      text(`AI1 ${ai(sim.analog[0] ?? 0)} AI2 ${ai(sim.analog[1] ?? 0)}`, 42, 246, 17, "#24331a", 600, "start");
  } else {
    s += text("STOP", 42, 158, 26, "#5a3a10", 800, "start") + text("Press Simulate", 42, 194, 18, "#2f3b26", 600, "start") + text("to run", 42, 218, 18, "#2f3b26", 600, "start");
  }
  // RUN and STOP lights in a row under the display.
  s +=
    led(36, 290, run, "#3bdc6c") +
    text("RUN", 48, 296, 17, "#ffffff", 700, "start") +
    led(118, 290, !run, sim?.tripped ? "#ff4a3d" : "#f2a52b") +
    text(sim?.tripped ? "FAULT" : "STOP", 130, 296, 17, "#ffffff", 700, "start");
  // Keys and the name plate.
  const kx = 326;
  const ky = 120;
  s +=
    `<g fill="#2d343e" stroke="#151a20" stroke-width="1.5">` +
    `<rect x="${kx + 48}" y="${ky}" width="40" height="30" rx="4"/><rect x="${kx}" y="${ky + 36}" width="40" height="30" rx="4"/>` +
    `<rect x="${kx + 96}" y="${ky + 36}" width="40" height="30" rx="4"/><rect x="${kx + 48}" y="${ky + 72}" width="40" height="30" rx="4"/></g>` +
    `<g fill="#c9d2dd"><path d="M${kx + 68} ${ky + 7}l9 15h-18z"/><path d="M${kx + 11} ${ky + 51}l15 -9v18z"/><path d="M${kx + 125} ${ky + 51}l-15 -9v18z"/><path d="M${kx + 68} ${ky + 95}l9 -15h-18z"/></g>` +
    `<rect x="${kx}" y="${ky + 116}" width="56" height="30" rx="4" fill="#2d343e" stroke="#151a20"/>` +
    text("ESC", kx + 28, ky + 137, 15, "#e1e7ee", 700) +
    `<rect x="${kx + 80}" y="${ky + 116}" width="56" height="30" rx="4" fill="#2b7a3d" stroke="#151a20"/>` +
    text("OK", kx + 108, ky + 137, 15, "#ffffff", 700) +
    text("VRA PLC 8/4", kx - 6, 288, 22, "#ffffff", 800, "start") +
    text("8 DI · 4 relay DO · 24 V DC", kx - 6, 308, 13, "#e1e7ee", 600, "start");
  // Relay outputs along the bottom: two terminals each, and a light.
  for (let q = 0; q < 4; q++) {
    const x = 46 + q * 120;
    s += text("1", x, h - 80, 18, "#ffffff", 700) + text("2", x + 36, h - 80, 18, "#ffffff", 700);
    s += screw(x, h - 56, 11) + screw(x + 36, h - 56, 11);
    s += text(`Q${q + 1}`, x + 18, h - 16, 22, "#ffffff", 800) + led(x + 56, h - 24, sim !== null && (sim.outputs[q] ?? false), "#f2a52b");
  }
  return s;
}
/** A device of the board itself. `props` are its settings. */
export function drawFixed(f: FixedDevice, props: Record<string, string>, sim: SimView): string {
  const { w, h } = f;
  const cx = w / 2;
  switch (f.kind) {
    case "boardLamp": {
      const q = Number(f.label.slice(1)) - 1;
      const lit = sim !== null && !sim.tripped && (sim.outputs[q] ?? false);
      return `<rect x="0" y="0" width="${w}" height="${h}" fill="transparent"/>` + text(f.label, cx, 28, 28) + dome(cx, 85, 34, f.color, lit);
    }
    case "boardSwitch": {
      const k = Number(f.label.slice(1)) - 1;
      const pressed = sim !== null && (sim.switches[k] ?? false);
      const [line1, line2] = modeCaption(readMode(props));
      const r = pressed ? 31 : 34;
      return (
        `<rect x="0" y="0" width="${w}" height="${h}" fill="transparent"/>` +
        text(f.label, cx, 28, 28) +
        `<circle cx="${cx}" cy="85" r="37" fill="#1d1d1d" opacity="0.18"/>` +
        `<circle cx="${cx}" cy="85" r="${r}" fill="${pressed ? "#b9bec5" : "#d9dcdf"}" stroke="#2b2f36" stroke-width="3"/>` +
        `<circle cx="${cx}" cy="85" r="${pressed ? 13 : 10}" fill="#16191d"/>` +
        text(line1, cx, 140, 17, "#3b4350", 700) + text(line2, cx, 160, 16, "#3b4350", 600)
      );
    }
    case "qConnector": {
      let s = `<rect x="0" y="55" width="${w}" height="66" rx="8" fill="#b9bcc0" stroke="#3b3f46" stroke-width="2.5"/>`;
      for (let i = 0; i < 4; i++) {
        const base = 185 * i;
        if (i > 0) s += `<line x1="${base}" y1="55" x2="${base}" y2="121" stroke="#ffffff" stroke-width="3"/>`;
        s += text(`Q${i + 1}`, base + 95, 36, 30);
        s += text("+", base + 50, 160, 30) + text("−", base + 95, 160, 30) + earthMark(base + 140, 152, 1);
      }
      return s;
    }
    case "iConnector": {
      let s = `<rect x="72" y="0" width="56" height="${h}" rx="8" fill="#b9bcc0" stroke="#3b3f46" stroke-width="2.5"/>`;
      [8, 7, 6, 5].forEach((n, k) => {
        const base = 180 * k;
        if (k > 0) s += `<line x1="72" y1="${base}" x2="128" y2="${base}" stroke="#ffffff" stroke-width="3"/>`;
        s += text(`I${n}`, 0, 0, 30, INK, 700, "middle", ` transform="translate(42 ${base + 90}) rotate(-90)" dy="10"`);
        s += text("+", 165, base + 50, 28) + text("−", 165, base + 100, 28) + text("S", 165, base + 150, 22);
        if (n >= 7) s += text("0–10 V", 160, base + 172, 15, "#3b4350", 700);
      });
      return s;
    }
    case "plc":
      return plcModule(w, h, sim);
    default:
      return `<rect x="0" y="0" width="${w}" height="${h}" fill="#ddd"/>`;
  }
}

const plate = (w: number, h: number): string => `<rect x="0" y="0" width="${w}" height="${h}" rx="8" fill="#f6f7f9" stroke="#9aa3ae" stroke-width="2"/>`;

function pushCap(cx: number, cy: number, r: number, color: string, pressed: boolean): string {
  const c = colorHex(color);
  const rr = pressed ? r - 3 : r;
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r + 7}" fill="#1d1d1d"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="${c}"${pressed ? ' opacity="0.8"' : ""}/>` +
    `<circle cx="${cx}" cy="${cy}" r="${rr * 0.55}" fill="#ffffff" opacity="${pressed ? 0.1 : 0.22}"/>`
  );
}

function sensorTarget(x: number, y: number): string {
  return `<rect x="${x}" y="${y}" width="16" height="40" rx="2" fill="#9aa3ae" stroke="#4b525c" stroke-width="2"/><path d="M${x + 3} ${y + 6}l10 6M${x + 3} ${y + 18}l10 6M${x + 3} ${y + 30}l10 6" stroke="#6d7580" stroke-width="1.5"/>`;
}

/** Where a repeating animation of `period` ms is now, so it carries on smoothly when the drawing is rebuilt. */
const phase = (period: number): number => Math.round(performance.now() % period);

/** A device the student added, with its live state while the simulation runs. */
export function drawExtra(d: PlacedDevice, def: DeviceDef, st: DeviceState | undefined): string {
  // Drawn at the basic size, then enlarged by def.scale.
  const w = def.w / def.scale;
  const h = def.h / def.scale;
  const cx = w / 2;
  const name = d.label || def.short;
  const short = name.length > 20 ? `${name.slice(0, 19)}…` : name;
  const caption = `<title>${esc(d.label ? `${d.label} (${def.name})` : def.name)}</title>` + text(short, cx, -7, 15, INK, 700);
  const on = st?.on ?? false;
  const act = st?.act ?? false;
  let body = "";
  switch (def.kind) {
    case "pushNo":
    case "pushNc":
      body =
        pushCap(cx, 44, 24, d.props.color ?? (def.kind === "pushNo" ? "green" : "red"), act) +
        text(def.kind === "pushNo" ? "NO" : "NC", cx, 90, 14, "#b3261e");
      break;
    case "toggle": {
      const dx = act ? 14 : -14;
      body =
        `<rect x="${cx - 26}" y="22" width="52" height="56" rx="6" fill="#2f363f"/>` +
        `<line x1="${cx}" y1="58" x2="${cx + dx}" y2="30" stroke="#c9d0d8" stroke-width="7" stroke-linecap="round"/>` +
        `<circle cx="${cx}" cy="58" r="8" fill="#8d96a3"/>` +
        text(act ? "ON" : "OFF", cx, 94, 14, act ? "#1f7a3a" : "#5a6270");
      break;
    }
    case "limitNo":
    case "limitNc": {
      const ang = act ? 18 : 40;
      const ex = cx + 26 + Math.cos((ang * Math.PI) / 180) * 26;
      const ey = 42 - Math.sin((ang * Math.PI) / 180) * 26;
      body =
        `<rect x="${cx - 30}" y="34" width="56" height="40" rx="4" fill="#d4a017" stroke="#6b5420" stroke-width="2"/>` +
        `<line x1="${cx + 22}" y1="42" x2="${ex}" y2="${ey}" stroke="#444c56" stroke-width="5" stroke-linecap="round"/>` +
        `<circle cx="${ex}" cy="${ey}" r="7" fill="#e3e7ec" stroke="#444c56" stroke-width="2"/>` +
        text(def.kind === "limitNo" ? "NO" : "NC", cx - 2, 60, 14, "#2b2210");
      break;
    }
    case "proxPnp":
    case "prox2w": {
      const len = 70;
      body =
        `<rect x="18" y="34" width="${len}" height="30" rx="3" fill="#b5bcc5" stroke="#5a626d" stroke-width="2"/>` +
        `<path d="M28 34v30M38 34v30M48 34v30M58 34v30M68 34v30" stroke="#8d96a3" stroke-width="1.5"/>` +
        `<rect x="${18 + len}" y="38" width="8" height="22" rx="2" fill="#e05a2a"/>` +
        `<circle cx="26" cy="28" r="5" fill="${on || (def.kind === "prox2w" && act) ? "#ffd21f" : "#5f5a3a"}" stroke="#333"/>` +
        (act ? sensorTarget(w - 26, 29) : "") +
        text(act ? "target" : "no target", cx, 92, 14, "#5a6270", 600);
      break;
    }
    case "photoPnp":
      body =
        `<rect x="16" y="28" width="56" height="44" rx="5" fill="#3b4350" stroke="#1d2229" stroke-width="2"/>` +
        `<circle cx="72" cy="50" r="9" fill="#9fd3ff" stroke="#1d2229" stroke-width="2"/>` +
        `<circle cx="28" cy="38" r="5" fill="${on ? "#ffd21f" : "#5f5a3a"}" stroke="#222"/>` +
        (act ? sensorTarget(w - 32, 30) + `<line x1="82" y1="50" x2="${w - 32}" y2="50" stroke="#ff4a3d" stroke-width="2" stroke-dasharray="4 3"/>` : `<line x1="82" y1="50" x2="${w - 8}" y2="50" stroke="#ff4a3d" stroke-width="2" stroke-dasharray="4 3" opacity="0.6"/>`) +
        text(act ? "object" : "clear", cx, 92, 14, "#5a6270", 600);
      break;
    case "pot": {
      const v = st ? st.value : 50;
      const a = ((-135 + v * 2.7) * Math.PI) / 180;
      let ticks = "";
      for (let i = 0; i <= 10; i++) {
        const t = ((-135 + i * 27 - 90) * Math.PI) / 180;
        ticks += `<line x1="${cx + Math.cos(t) * 34}" y1="${52 + Math.sin(t) * 34}" x2="${cx + Math.cos(t) * 39}" y2="${52 + Math.sin(t) * 39}" stroke="#5a6270" stroke-width="2"/>`;
      }
      body =
        ticks +
        `<circle cx="${cx}" cy="52" r="27" fill="#3b4350" stroke="#1d2229" stroke-width="2"/>` +
        `<line x1="${cx}" y1="52" x2="${cx + Math.sin(a) * 22}" y2="${52 - Math.cos(a) * 22}" stroke="#f2f4f7" stroke-width="4" stroke-linecap="round"/>` +
        text(st ? (on ? `${(v / 10).toFixed(2)} V` : "no supply") : "0–10 V", cx, 102, 14, on ? "#1f5fa8" : "#5a6270", 700);
      break;
    }
    case "pt100": {
      const t = st ? st.value : 25;
      body =
        `<rect x="${cx - 22}" y="14" width="44" height="30" rx="6" fill="#3b4350" stroke="#1d2229" stroke-width="2"/>` +
        `<rect x="${cx - 5}" y="44" width="10" height="56" rx="5" fill="#c3c9d1" stroke="#6b737d" stroke-width="2"/>` +
        text("PT100", cx, 34, 14, "#e9eef5", 700) +
        text(st ? `${t.toFixed(1)} °C` : "°C", cx + 36, 80, 14, "#b3261e", 700);
      break;
    }
    case "lamp":
      body = dome(cx, 46, 26, d.props.color ?? "green", on);
      break;
    case "buzzer":
      body =
        `<circle cx="${cx}" cy="48" r="28" fill="#1d1d1d"/><circle cx="${cx}" cy="48" r="21" fill="#2f363f"/><circle cx="${cx}" cy="48" r="6" fill="#0d0f12"/>` +
        (on ? `<g class="pulse" style="animation-delay:-${phase(400)}ms" stroke="#e05a2a" stroke-width="3" fill="none" stroke-linecap="round"><path d="M${cx + 32} 34a20 20 0 0 1 0 28M${cx - 32} 34a20 20 0 0 0 0 28"/></g>` : "");
      break;
    case "hooter":
      body =
        `<path d="M${cx - 38} 36h16l30 -16v56l-30 -16h-16z" fill="#c44a1e" stroke="#6a2a10" stroke-width="2" stroke-linejoin="round"/>` +
        (on ? `<g class="pulse" style="animation-delay:-${phase(400)}ms" stroke="#c44a1e" stroke-width="3" fill="none" stroke-linecap="round"><path d="M${cx + 16} 34a18 18 0 0 1 0 28M${cx + 26} 26a30 30 0 0 1 0 44"/></g>` : "");
      break;
    case "motor": {
      const dir = st?.dir ?? 0;
      const spin = dir === 0 ? "" : dir > 0 ? "spin" : "spin rev";
      body =
        `<rect x="18" y="20" width="76" height="62" rx="10" fill="#2c6fb5" stroke="#173d66" stroke-width="2"/>` +
        `<path d="M24 28h64M24 38h64M24 48h64M24 58h64M24 68h64" stroke="#5a92cf" stroke-width="2"/>` +
        `<rect x="94" y="44" width="16" height="12" fill="#8d96a3" stroke="#4b525c" stroke-width="2"/>` +
        `<g class="${spin}" style="animation-delay:-${phase(500)}ms"><circle cx="118" cy="50" r="13" fill="#e3e7ec" stroke="#4b525c" stroke-width="2"/><path d="M118 38v24M106 50h24" stroke="#4b525c" stroke-width="3"/></g>` +
        text("M", 56, 59, 26, "#ffffff", 800) +
        text(dir > 0 ? "running ↻" : dir < 0 ? "running ↺ (reversed)" : "stopped", cx, 104, 14, dir ? "#1f7a3a" : "#5a6270", 600);
      break;
    }
    case "contactor":
      body =
        `<rect x="22" y="12" width="${w - 44}" height="82" rx="6" fill="#e9ecef" stroke="#5a626d" stroke-width="2"/>` +
        `<rect x="${cx - 18}" y="${on ? 30 : 22}" width="36" height="18" rx="3" fill="${on ? "#2fa34a" : "#8d96a3"}" stroke="#3b4350"/>` +
        text(on ? "I" : "O", cx, on ? 44 : 36, 12, "#ffffff", 800) +
        `<path d="M40 74h20M${on ? "60 74l20 0" : "60 74l18 -9"}M80 74h28" stroke="#1d2430" stroke-width="2.5" fill="none" stroke-linecap="round"/>` +
        text("K", 38, 40, 16, "#1d2430", 800);
      break;
    default:
      body = "";
  }
  // Terminal marks are drawn by the editor with the terminals.
  return `<g transform="scale(${def.scale})">${plate(w, h)}${caption}${body}</g>`;
}

/** The board, after the academy's drawing: a light panel with its title. */
export function drawBoard(width: number, height: number): string {
  return (
    `<rect x="4" y="6" width="${width}" height="${height}" rx="10" fill="#00000033"/>` +
    `<rect x="0" y="0" width="${width}" height="${height}" rx="10" fill="#eceeef" stroke="#4a4f57" stroke-width="3"/>` +
    text("Vidyasagar Academy’s PLC Control Panel", 690, 82, 40, NAVY, 800)
  );
}

/** The bench around the board, where devices may also be placed. */
export function drawBench(width: number, height: number): string {
  return (
    `<defs><pattern id="benchGrid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#b5bcc6" stroke-width="1"/></pattern></defs>` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#d3d8df"/>` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#benchGrid)"/>`
  );
}
