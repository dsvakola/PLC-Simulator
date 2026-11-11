// The settings dialog of a block: its number, times, thresholds and the
// student's own name for it.
import type { Block, BlockKind, WeeklyCam, YearlyCam } from "../api";
import { LIMITS } from "../limits";
import { askForm, type FormField } from "../ui/confirm";
import { modeFields, modeFrom, type ModeSetting } from "../panel/inputMode";
import { defaultLabel } from "./model";

type Values = Record<string, string | boolean>;

const MAX_TIME_MS = 99 * 3_600_000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const UNITS: Array<[string, string, number]> = [
  ["ms", "milliseconds", 1],
  ["s", "seconds", 1000],
  ["min", "minutes", 60_000],
  ["h", "hours", 3_600_000],
];

const str = (v: Values, id: string): string => {
  const x = v[id];
  return typeof x === "string" ? x : "";
};
const num = (v: Values, id: string): number => {
  const n = Number(str(v, id));
  return Number.isFinite(n) ? n : 0;
};
const int = (v: Values, id: string): number => Math.round(num(v, id));
const bool = (v: Values, id: string): boolean => v[id] === true;

function numberField(id: string, label: string, value: number, min: number, max: number, step: number | "any", unit = ""): FormField {
  return { id, label, type: "number", value: String(value), min, max, step, unit };
}

function timeFields(id: string, label: string, ms: number): FormField[] {
  // The largest unit that divides the time evenly.
  const unit = [...UNITS].reverse().find(([, , f]) => ms % f === 0 && ms >= f) ?? UNITS[1] ?? UNITS[0];
  const [u, , factor] = unit ?? ["s", "seconds", 1000];
  return [
    numberField(`${id}V`, label, ms / factor, 0, MAX_TIME_MS, "any"),
    { id: `${id}U`, label: "Unit", type: "select", value: u, options: UNITS.map(([k, name]) => [k, name]) },
  ];
}

function readTime(v: Values, id: string): number {
  const factor = UNITS.find(([k]) => k === str(v, `${id}U`))?.[2] ?? 1000;
  return Math.min(MAX_TIME_MS, Math.max(0, Math.round(num(v, `${id}V`) * factor)));
}

const hhmm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const minutes = (s: string): number => {
  const [h, m] = s.split(":");
  const r = Number(h) * 60 + Number(m);
  return Number.isFinite(r) ? Math.min(1439, Math.max(0, r)) : 0;
};

function numbered(b: Block & { n: number }, letters: string, max: number): FormField {
  return {
    id: "n",
    label: "Number",
    type: "select",
    value: String(b.n),
    options: Array.from({ length: max }, (_, i): [string, string] => [String(i + 1), `${letters}${i + 1}`]),
  };
}

/** Asks for the settings of a block. Resolves to the new kind and name, or null if cancelled.
 *  For an input, `inputMode` is the simulation mode of I1 to I4 (shared with the board switches). */
export async function editBlock(
  b: Block,
  inputMode?: (n: number) => ModeSetting,
): Promise<{ kind: BlockKind; label: string; resetNames: boolean; mode?: ModeSetting } | null> {
  const fields: FormField[] = [];
  let build: (v: Values) => BlockKind = () => b;

  switch (b.k) {
    case "input":
      fields.push(numbered(b, "I", LIMITS.inputs));
      build = (v) => ({ k: "input", n: int(v, "n") });
      if (b.n <= 4 && inputMode) {
        fields.push(...modeFields(inputMode(b.n), `This is the same setting as switch I${b.n} on the Control Panel.`));
      } else {
        fields.push({ id: "simHead", label: "Simulation: I5 to I8 are set by the devices wired to them on the Control Panel", type: "heading" });
      }
      break;
    case "output":
      fields.push(numbered(b, "Q", LIMITS.outputs));
      build = (v) => ({ k: "output", n: int(v, "n") });
      break;
    case "flag":
      fields.push(numbered(b, "M", LIMITS.markers));
      build = (v) => ({ k: "flag", n: int(v, "n") });
      break;
    case "analogInput":
      fields.push(numbered(b, "AI", LIMITS.analogInputs));
      build = (v) => ({ k: "analogInput", n: int(v, "n") });
      break;
    case "analogFlag":
      fields.push(numbered(b, "AM", LIMITS.analogFlags));
      build = (v) => ({ k: "analogFlag", n: int(v, "n") });
      break;
    case "and":
    case "or":
    case "nand":
    case "nor": {
      const k = b.k;
      fields.push({
        id: "inputs",
        label: "Number of inputs",
        type: "select",
        value: String(b.inputs),
        options: [["2", "2"], ["3", "3"], ["4", "4"]],
        hint: "Wires that no longer fit are removed.",
      });
      build = (v) => ({ k, inputs: int(v, "inputs") });
      break;
    }
    case "onDelay":
      fields.push(...timeFields("t", "Delay time", b.ms));
      build = (v) => ({ k: "onDelay", ms: readTime(v, "t") });
      break;
    case "offDelay":
      fields.push(...timeFields("t", "Delay time", b.ms));
      build = (v) => ({ k: "offDelay", ms: readTime(v, "t") });
      break;
    case "onOffDelay":
      fields.push(...timeFields("on", "Switch-on delay", b.onMs), ...timeFields("off", "Switch-off delay", b.offMs));
      build = (v) => ({ k: "onOffDelay", onMs: readTime(v, "on"), offMs: readTime(v, "off") });
      break;
    case "weeklyTimer": {
      const cams = b.cams;
      for (let i = 0; i < 3; i++) {
        const c = cams[i];
        fields.push(
          { id: `h${i}`, label: `Setting ${i + 1}`, type: "heading" },
          { id: `e${i}`, label: "Use this setting", type: "check", value: c !== undefined },
          { id: `d${i}`, label: "Days", type: "days", value: c?.days ?? 0b0011111 },
          { id: `on${i}`, label: "Switch on at", type: "time", value: hhmm(c?.onMinute ?? 480) },
          { id: `off${i}`, label: "Switch off at", type: "time", value: hhmm(c?.offMinute ?? 1020) },
        );
      }
      build = (v) => ({
        k: "weeklyTimer",
        cams: [0, 1, 2]
          .filter((i) => bool(v, `e${i}`))
          .map((i): WeeklyCam => ({ days: int(v, `d${i}`), onMinute: minutes(str(v, `on${i}`)), offMinute: minutes(str(v, `off${i}`)) })),
      });
      break;
    }
    case "yearlyTimer": {
      const cams = b.cams;
      const months = MONTHS.map((m, i): [string, string] => [String(i + 1), m]);
      for (let i = 0; i < 3; i++) {
        const c = cams[i];
        fields.push(
          { id: `h${i}`, label: `Setting ${i + 1}`, type: "heading" },
          { id: `e${i}`, label: "Use this setting", type: "check", value: c !== undefined },
          { id: `om${i}`, label: "Switch on: month", type: "select", value: String(c?.onMonth ?? 6), options: months },
          numberField(`od${i}`, "Switch on: day", c?.onDay ?? 1, 1, 31, 1),
          { id: `fm${i}`, label: "Switch off: month", type: "select", value: String(c?.offMonth ?? 9), options: months },
          numberField(`fd${i}`, "Switch off: day", c?.offDay ?? 1, 1, 31, 1),
        );
      }
      build = (v) => ({
        k: "yearlyTimer",
        cams: [0, 1, 2]
          .filter((i) => bool(v, `e${i}`))
          .map((i): YearlyCam => ({ onMonth: int(v, `om${i}`), onDay: int(v, `od${i}`), offMonth: int(v, `fm${i}`), offDay: int(v, `fd${i}`) })),
      });
      break;
    }
    case "analogAmplifier":
      fields.push(
        numberField("gain", "Gain", b.gain, -100, 100, "any"),
        numberField("offset", "Offset", b.offset, -32768, 32767, 1),
      );
      build = (v) => ({ k: "analogAmplifier", gain: num(v, "gain"), offset: int(v, "offset") });
      break;
    case "analogComparator":
      fields.push(
        numberField("gain", "Gain", b.gain, -100, 100, "any"),
        numberField("offset", "Offset", b.offset, -32768, 32767, 1),
        numberField("on", "On when the difference reaches", b.on, -32768, 32767, 1),
        numberField("off", "Off when it falls below", b.off, -32768, 32767, 1),
      );
      build = (v) => ({ k: "analogComparator", gain: num(v, "gain"), offset: int(v, "offset"), on: int(v, "on"), off: int(v, "off") });
      break;
    case "analogThreshold":
      fields.push(
        numberField("on", "On when the value reaches", b.on, -32768, 32767, 1),
        numberField("off", "Off when it falls below", b.off, -32768, 32767, 1),
      );
      build = (v) => ({ k: "analogThreshold", on: int(v, "on"), off: int(v, "off") });
      break;
    case "const":
    case "not":
    case "xor":
    case "xnor":
      break;
  }

  fields.push({
    id: "label",
    label: "Your name for this block",
    type: "text",
    value: b.label,
    maxLength: 40,
    hint: "Shown below the block, in the middle. Drag it to move it. Leave it empty for none.",
  });
  fields.push({
    id: "resetNames",
    label: "Put both names back in their usual places",
    type: "check",
    value: false,
  });

  const v = await askForm(`Block ${defaultLabel(b)}`, fields);
  if (!v) return null;
  const kind = build(v);
  const mode = kind.k === "input" && kind.n <= 4 && typeof v.mode === "string" ? modeFrom(v) : undefined;
  return { kind, label: str(v, "label").trim(), resetNames: bool(v, "resetNames"), mode };
}
