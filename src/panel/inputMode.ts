// How inputs I1 to I4 behave in the simulation. It is one setting per input,
// shared by the board switch and the I block of the program, with the modes
// of the usual PLC software. Kept in the panel's fixedProps of "swI1" ...
import type { FormField } from "../ui/confirm";

export type InputMode = "switch" | "make" | "break" | "frequency";

export interface ModeSetting {
  mode: InputMode;
  hz: number;
}

export const MIN_HZ = 0.1;
export const MAX_HZ = 50;

/** The setting kept in the props (projects from 0.0.2 used "contact" and "action"). */
export function readMode(props: Record<string, string> | undefined): ModeSetting {
  const p = props ?? {};
  const hz = Math.min(MAX_HZ, Math.max(MIN_HZ, Number(p.hz) || 1));
  switch (p.mode) {
    case "switch":
    case "make":
    case "break":
    case "frequency":
      return { mode: p.mode, hz };
  }
  // Version 0.0.2 kept "contact" and "action".
  if (p.action === "maintained") return { mode: "switch", hz };
  if (p.action || p.contact) return { mode: p.contact === "nc" ? "break" : "make", hz };
  // New inputs are on/off switches, as in the usual PLC software.
  return { mode: "switch", hz };
}

export function writeMode(props: Record<string, string> | undefined, s: ModeSetting): Record<string, string> {
  const { contact: _c, action: _a, ...rest } = props ?? {};
  const out: Record<string, string> = { ...rest, mode: s.mode };
  if (s.mode === "frequency") out.hz = String(Math.min(MAX_HZ, Math.max(MIN_HZ, s.hz)));
  else delete out.hz;
  return out;
}

/** Two short lines printed under a board switch. */
export function modeCaption(s: ModeSetting): [string, string] {
  switch (s.mode) {
    case "switch":
      return ["Switch", "on / off"];
    case "make":
      return ["Push button", "make (NO)"];
    case "break":
      return ["Push button", "break (NC)"];
    case "frequency":
      return ["Frequency", `${+s.hz.toFixed(2)} Hz`];
  }
}

/** The fields of the "Simulation" part of a settings dialog. */
export function modeFields(s: ModeSetting, hint: string): FormField[] {
  return [
    { id: "simHead", label: "Simulation", type: "heading" },
    {
      id: "mode",
      label: "Mode",
      type: "select",
      value: s.mode,
      options: [
        ["switch", "Switch (on/off, stays where it is put)"],
        ["make", "Momentary push button (make)"],
        ["break", "Momentary push button (break)"],
        ["frequency", "Frequency"],
      ],
      hint,
    },
    { id: "hz", label: "Frequency", type: "number", value: String(s.hz), min: MIN_HZ, max: MAX_HZ, step: "any", unit: "Hz", hint: "Used in Frequency mode only: the input switches on and off by itself." },
  ];
}

export function modeFrom(v: Record<string, string | boolean>): ModeSetting {
  const m = v.mode;
  const mode: InputMode = m === "switch" || m === "break" || m === "frequency" ? m : "make";
  const hz = Math.min(MAX_HZ, Math.max(MIN_HZ, Number(v.hz) || 1));
  return { mode, hz };
}
