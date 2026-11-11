// Settings dialog of a SCADA screen item: its text, the PLC point it is
// linked to, and its colour, range or unit.
import type { ScadaItem } from "../api";
import { LIMITS } from "../limits";
import { askForm, type FormField } from "../ui/confirm";
import { KINDS } from "./scadaDraw";

/** The PLC points an item may be linked to. */
function tagOptions(it: ScadaItem): Array<[string, string]> {
  const k = KINDS[it.kind];
  const list = (letter: string, n: number, what: string): Array<[string, string]> =>
    Array.from({ length: n }, (_, i): [string, string] => [`${letter}${i + 1}`, `${letter}${i + 1} - ${what}`]);
  if (!k || k.tag === null) return [];
  if (k.tag === "bit") {
    if (k.writes) return [...list("I", 4, "board switch / input"), ...list("M", LIMITS.markers, "marker")];
    return [...list("Q", LIMITS.outputs, "output"), ...list("I", LIMITS.inputs, "input"), ...list("M", LIMITS.markers, "marker")];
  }
  if (k.writes) return list("AM", LIMITS.analogFlags, "analog marker");
  return [
    ["AI1", "AI1 - analog input I7"],
    ["AI2", "AI2 - analog input I8"],
    ...list("AM", LIMITS.analogFlags, "analog marker"),
  ];
}

const COLORS: Array<[string, string]> = [
  ["green", "Green"],
  ["red", "Red"],
  ["amber", "Amber"],
  ["blue", "Blue"],
  ["white", "White"],
];

export async function editScadaItem(it: ScadaItem): Promise<{ label: string; tag: string; props: Record<string, string> } | null> {
  const k = KINDS[it.kind];
  if (!k) return null;
  const fields: FormField[] = [
    { id: "label", label: it.kind === "text" ? "Text" : "Name shown under it", type: "text", value: it.label, maxLength: 60 },
  ];
  const opts = tagOptions(it);
  if (opts.length) {
    fields.push({
      id: "tag",
      label: "PLC point",
      type: "select",
      value: it.tag || (opts[0]?.[0] ?? ""),
      options: opts,
      hint: k.hint,
    });
  }
  if (it.kind === "lamp" || it.kind === "button") {
    fields.push({ id: "color", label: "Colour", type: "select", value: it.props.color ?? "green", options: COLORS });
  }
  if (["number", "bar", "tank", "slider"].includes(it.kind)) {
    const p = it.props;
    if (it.kind !== "number") {
      fields.push(
        { id: "min", label: "Lowest value", type: "number", value: p.min ?? "0", min: -32768, max: 32767, step: 1, unit: "" },
        { id: "max", label: "Highest value", type: "number", value: p.max ?? "1000", min: -32768, max: 32767, step: 1, unit: "" },
      );
    }
    fields.push(
      { id: "scale", label: "Show the value times", type: "number", value: p.scale ?? "1", min: -1000, max: 1000, step: "any", unit: "", hint: "For example 0.01 shows AI1 (0-1000) in volts, 0.1 shows a PT100 in °C." },
      { id: "decimals", label: "Decimals", type: "number", value: p.decimals ?? "0", min: 0, max: 4, step: 1, unit: "" },
      { id: "unit", label: "Unit", type: "text", value: p.unit ?? "", maxLength: 8 },
    );
  }
  if (it.kind === "text") {
    fields.push({ id: "size", label: "Text size", type: "number", value: it.props.size ?? "22", min: 10, max: 60, step: 1, unit: "" });
  }
  const v = await askForm(k.name, fields);
  if (!v) return null;
  const props: Record<string, string> = {};
  for (const key of ["color", "min", "max", "scale", "decimals", "unit", "size"]) {
    const x = v[key];
    if (typeof x === "string" && x !== "") props[key] = x;
  }
  return { label: String(v.label ?? "").trim(), tag: typeof v.tag === "string" ? v.tag : "", props };
}
