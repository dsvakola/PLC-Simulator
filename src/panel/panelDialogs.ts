// Settings dialogs of the control panel's devices.
import type { DeviceDef, FixedDevice, PlacedDevice } from "../api";
import { askForm, type FormField } from "../ui/confirm";
import { modeFields, modeFrom, readMode, writeMode } from "./inputMode";

const LAMP_COLORS: Array<[string, string]> = [
  ["red", "Red"],
  ["amber", "Amber"],
  ["green", "Green"],
  ["blue", "Blue"],
  ["yellow", "Yellow"],
  ["white", "White"],
];
const BUTTON_COLORS: Array<[string, string]> = [
  ["green", "Green"],
  ["red", "Red"],
  ["black", "Black"],
  ["blue", "Blue"],
  ["yellow", "Yellow"],
];

const HINTS: Record<string, string> = {
  proxPnp: "Brown (BN) to +24 V, blue (BU) to 0 V, black (BK) to the signal terminal S of an input.",
  photoPnp: "Brown (BN) to +24 V, blue (BU) to 0 V, black (BK) to the signal terminal S of an input.",
  prox2w: "A 2-wire sensor works like a switch: one wire to +24 V, the other to the signal terminal S.",
  pot: "+24 to +24 V, 0V to 0 V and OUT to the signal terminal S of I7 or I8. It gives 0 to 10 V.",
  pt100: "White (WH) to the signal terminal S of I7 or I8, both red wires (RD) to 0 V of the same input.",
  motor: "Join + and − to an output, and the earth terminal ⏚ to an earth terminal of the Q connector.",
  contactor: "Coil A1 and A2 on an output; the contact 13–14 switches a load, for example a motor.",
};

/** Settings of a device the student added: its name and, for lamps and push buttons, the colour. */
export async function editDevice(d: PlacedDevice, def: DeviceDef): Promise<{ label: string; props: Record<string, string> } | null> {
  const fields: FormField[] = [
    {
      id: "label",
      label: "Your name for this device",
      type: "text",
      value: d.label,
      maxLength: 24,
      hint: HINTS[def.kind] ?? "Shown above the device. Leave it empty to show the kind of device.",
    },
  ];
  if (def.kind === "lamp") {
    fields.push({ id: "color", label: "Colour", type: "select", value: d.props.color ?? "green", options: LAMP_COLORS });
  } else if (def.kind === "pushNo" || def.kind === "pushNc") {
    fields.push({ id: "color", label: "Button colour", type: "select", value: d.props.color ?? (def.kind === "pushNo" ? "green" : "red"), options: BUTTON_COLORS });
  }
  const v = await askForm(def.name, fields);
  if (!v) return null;
  const props = { ...d.props };
  if (typeof v.color === "string") props.color = v.color;
  return { label: String(v.label ?? "").trim(), props };
}

/** Settings of a switch on the board (I1 to I4): the same mode as the I block of the program. */
export async function editFixed(f: FixedDevice, props: Record<string, string>): Promise<Record<string, string> | null> {
  if (f.kind !== "boardSwitch") return null;
  const v = await askForm(
    `Switch ${f.label}`,
    modeFields(readMode(props), `Wired inside the panel to input ${f.label}. This is the same setting as on the ${f.label} block of the program.`),
  );
  if (!v) return null;
  return writeMode(props, modeFrom(v));
}
