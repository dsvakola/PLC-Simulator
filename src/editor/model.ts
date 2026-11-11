// What the diagram editor knows about blocks: their pins and size, the text
// drawn on them, and the list of blocks the student can place.
import type { Block, BlockKind, Diagram } from "../api";
import { LIMITS } from "../limits";

export type PinType = "bit" | "num";

/** Grid of the drawing area, in drawing units. */
export const GRID = 20;

export interface Pin {
  x: number;
  y: number;
  type: PinType;
}

export interface Geometry {
  w: number;
  h: number;
  ins: Pin[];
  outs: Pin[];
}

/** Input and output pin types of a block. Mirrors BlockKind::pins in Rust. */
export function pinTypes(kind: BlockKind): { ins: PinType[]; outs: PinType[] } {
  switch (kind.k) {
    case "input":
    case "const":
      return { ins: [], outs: ["bit"] };
    case "output":
      // An output also gives its state, so it can be wired back (a latch).
      return { ins: ["bit"], outs: ["bit"] };
    case "flag":
    case "not":
    case "onDelay":
    case "onOffDelay":
      return { ins: ["bit"], outs: ["bit"] };
    case "analogInput":
      return { ins: [], outs: ["num"] };
    case "analogFlag":
    case "analogAmplifier":
      return { ins: ["num"], outs: ["num"] };
    case "and":
    case "or":
    case "nand":
    case "nor":
      return { ins: Array.from({ length: kind.inputs }, (): PinType => "bit"), outs: ["bit"] };
    case "xor":
    case "xnor":
    case "offDelay":
      return { ins: ["bit", "bit"], outs: ["bit"] };
    case "weeklyTimer":
    case "yearlyTimer":
      return { ins: [], outs: ["bit"] };
    case "analogComparator":
      return { ins: ["num", "num"], outs: ["bit"] };
    case "analogThreshold":
      return { ins: ["num"], outs: ["bit"] };
  }
}

const SMALL = new Set<string>(["input", "output", "flag", "analogInput", "analogFlag", "const"]);
const GATES = new Set<string>(["and", "or", "not", "nand", "nor", "xor", "xnor"]);

/** Size and pin positions of a block, relative to its top-left corner. Pins
 *  sit at the end of a 20 unit stub outside the box. */
export function geometry(b: BlockKind): Geometry {
  const { ins, outs } = pinTypes(b);
  const n = Math.max(1, ins.length, outs.length);
  const h = 40 + 20 * n;
  const w = SMALL.has(b.k) ? 60 : GATES.has(b.k) ? 80 : 120;
  const place = (types: PinType[], x: number): Pin[] =>
    types.length === 1
      ? types.map((type) => ({ x, y: h / 2, type }))
      : types.map((type, i) => ({ x, y: 30 + 20 * i, type }));
  return { w, h, ins: place(ins, -20), outs: place(outs, w + 20) };
}

/** The name shown above a block: I1, Q1, M1, AI1, AM1, or B01 for the rest. */
export function defaultLabel(b: Block): string {
  switch (b.k) {
    case "input":
      return `I${b.n}`;
    case "output":
      return `Q${b.n}`;
    case "flag":
      return `M${b.n}`;
    case "analogInput":
      return `AI${b.n}`;
    case "analogFlag":
      return `AM${b.n}`;
    default:
      return `B${String(b.id).padStart(2, "0")}`;
  }
}

/** A time in the shortest clear form: 500 ms, 5 s, 2 min, 1 h. */
export function formatTime(ms: number): string {
  if (ms >= 3_600_000 && ms % 3_600_000 === 0) return `${ms / 3_600_000} h`;
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000} min`;
  if (ms >= 1000 && ms % 1000 === 0) return `${ms / 1000} s`;
  if (ms >= 1000) return `${+(ms / 1000).toFixed(3)} s`;
  return `${ms} ms`;
}

export interface Symbol {
  /** Large symbol in the middle of the box. */
  big: string;
  /** Smaller lines of text (name and settings). */
  small: string[];
  /** Draw a small circle on the output (NOT, NAND, NOR, EXNOR). */
  negated: boolean;
}

const settings = (n: number): string => `${n} setting${n === 1 ? "" : "s"}`;

export function symbolOf(b: Block): Symbol {
  const sym = (big: string, negated = false): Symbol => ({ big, small: [], negated });
  const text = (...small: string[]): Symbol => ({ big: "", small, negated: false });
  switch (b.k) {
    case "input":
      return sym("I");
    case "output":
      return sym("Q");
    case "flag":
      return sym("M");
    case "analogInput":
      return sym("AI");
    case "analogFlag":
      return sym("AM");
    case "const":
      return sym(b.high ? "1" : "0");
    case "and":
      return sym("&");
    case "nand":
      return sym("&", true);
    case "or":
      return sym("≥1");
    case "nor":
      return sym("≥1", true);
    case "not":
      return sym("1", true);
    case "xor":
      return sym("=1");
    case "xnor":
      return sym("=1", true);
    case "onDelay":
      return text("On delay", formatTime(b.ms));
    case "offDelay":
      return text("Off delay", formatTime(b.ms));
    case "onOffDelay":
      return text("On/off delay", `${formatTime(b.onMs)} / ${formatTime(b.offMs)}`);
    case "weeklyTimer":
      return text("Weekly timer", settings(b.cams.length));
    case "yearlyTimer":
      return text("Yearly timer", settings(b.cams.length));
    case "analogAmplifier":
      return text("Amplifier", `×${b.gain} ${b.offset < 0 ? "−" : "+"} ${Math.abs(b.offset)}`);
    case "analogComparator":
      return text("Comparator", `on ${b.on} / off ${b.off}`);
    case "analogThreshold":
      return text("Threshold", `on ${b.on} / off ${b.off}`);
  }
}

// ---------- The list of blocks the student can place ----------

export interface PaletteItem {
  id: string;
  name: string;
  /** Short text on the small yellow chip beside the name. */
  chip: string;
  hint: string;
  /** A new block of this kind, numbered with the first free number. */
  make(d: Diagram): BlockKind;
}

export interface PaletteGroup {
  title: string;
  items: PaletteItem[];
}

function freeNumber(d: Diagram, k: BlockKind["k"], max: number): number {
  const used = new Set(d.blocks.filter((b) => b.k === k).map((b) => (b as unknown as { n: number }).n));
  for (let n = 1; n <= max; n++) if (!used.has(n)) return n;
  return 1;
}

export const PALETTE: PaletteGroup[] = [
  {
    title: "Constants",
    items: [
      {
        id: "input",
        name: "Input",
        chip: "I",
        hint: "Digital input I1 to I8: a push button or switch of the panel",
        make: (d) => ({ k: "input", n: freeNumber(d, "input", LIMITS.inputs) }),
      },
      {
        id: "output",
        name: "Output",
        chip: "Q",
        hint: "Digital output Q1 to Q4: a lamp, buzzer or motor of the panel",
        make: (d) => ({ k: "output", n: freeNumber(d, "output", LIMITS.outputs) }),
      },
      {
        id: "analogInput",
        name: "Analog input",
        chip: "AI",
        hint: "Analog input AI1 (terminal I7) or AI2 (I8): 0 to 1000 for 0 to 10 V, or a PT100 in tenths of a degree",
        make: (d) => ({ k: "analogInput", n: freeNumber(d, "analogInput", LIMITS.analogInputs) }),
      },
      {
        id: "flag",
        name: "Marker",
        chip: "M",
        hint: "Marker M1 to M27: a memory bit. A SCADA screen can write it",
        make: (d) => ({ k: "flag", n: freeNumber(d, "flag", LIMITS.markers) }),
      },
      {
        id: "analogFlag",
        name: "Analog marker",
        chip: "AM",
        hint: "Analog marker AM1 to AM16: a memory for an analog value. A SCADA screen can show or write it",
        make: (d) => ({ k: "analogFlag", n: freeNumber(d, "analogFlag", LIMITS.analogFlags) }),
      },
    ],
  },
  {
    title: "Basic functions",
    items: [
      { id: "and", name: "AND", chip: "&", hint: "On when all inputs are on", make: () => ({ k: "and", inputs: 2 }) },
      { id: "or", name: "OR", chip: "≥1", hint: "On when at least one input is on", make: () => ({ k: "or", inputs: 2 }) },
      { id: "not", name: "NOT", chip: "1", hint: "Turns on into off and off into on", make: () => ({ k: "not" }) },
      { id: "nand", name: "NAND", chip: "&", hint: "Off only when all inputs are on", make: () => ({ k: "nand", inputs: 2 }) },
      { id: "nor", name: "NOR", chip: "≥1", hint: "On only when all inputs are off", make: () => ({ k: "nor", inputs: 2 }) },
      { id: "xor", name: "EXOR", chip: "=1", hint: "On when the two inputs are different", make: () => ({ k: "xor" }) },
      { id: "xnor", name: "EXNOR", chip: "=1", hint: "On when the two inputs are the same", make: () => ({ k: "xnor" }) },
    ],
  },
  {
    title: "Timers",
    items: [
      {
        id: "onDelay",
        name: "On-delay timer",
        chip: "Ton",
        hint: "Output comes on after the input has been on for the set time",
        make: () => ({ k: "onDelay", ms: 1000 }),
      },
      {
        id: "offDelay",
        name: "Off-delay timer",
        chip: "Toff",
        hint: "Output stays on for the set time after the input goes off. The second pin resets it",
        make: () => ({ k: "offDelay", ms: 1000 }),
      },
      {
        id: "onOffDelay",
        name: "On/off-delay timer",
        chip: "T",
        hint: "Delays both the switch-on and the switch-off",
        make: () => ({ k: "onOffDelay", onMs: 1000, offMs: 1000 }),
      },
      {
        id: "weeklyTimer",
        name: "Weekly timer",
        chip: "Wk",
        hint: "Output is on at the set times on the set days of the week",
        make: () => ({ k: "weeklyTimer", cams: [{ days: 0b0011111, onMinute: 8 * 60, offMinute: 17 * 60 }] }),
      },
      {
        id: "yearlyTimer",
        name: "Yearly timer",
        chip: "Yr",
        hint: "Output is on between two dates of the year",
        make: () => ({ k: "yearlyTimer", cams: [{ onMonth: 6, onDay: 1, offMonth: 9, offDay: 1 }] }),
      },
    ],
  },
  {
    title: "Analog functions",
    items: [
      {
        id: "analogAmplifier",
        name: "Analog amplifier",
        chip: "×",
        hint: "Result = value × gain + offset",
        make: () => ({ k: "analogAmplifier", gain: 1, offset: 0 }),
      },
      {
        id: "analogComparator",
        name: "Analog comparator",
        chip: "A>B",
        hint: "Compares two analog values: on when the difference reaches the on-value",
        make: () => ({ k: "analogComparator", gain: 1, offset: 0, on: 10, off: 5 }),
      },
      {
        id: "analogThreshold",
        name: "Analog threshold trigger",
        chip: "A>",
        hint: "On when the value reaches the on-value, off when it falls below the off-value",
        make: () => ({ k: "analogThreshold", on: 10, off: 5 }),
      },
    ],
  },
];

export const findPaletteItem = (id: string): PaletteItem | undefined =>
  PALETTE.flatMap((g) => g.items).find((i) => i.id === id);
