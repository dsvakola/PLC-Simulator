// Every call into the Rust side goes through this file. The types mirror the
// Rust structs (camelCase on both sides).
import { Channel, invoke } from "@tauri-apps/api/core";

// ---- About ----

export interface AppInfo {
  name: string;
  version: string;
  developers: string[];
  organisation: string;
  website: string;
  email: string;
  licence: string;
}

export type Link = "website" | "email";

export const getAppInfo = (): Promise<AppInfo> => invoke("get_app_info");
export const openLink = (link: Link): Promise<void> => invoke("open_link", { link });

/** Turns any error from Rust into a sentence for the status bar. */
export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : "Something went wrong.";
}

// ---- Ladder program (mirrors plc_core::plc) ----

export type Cell =
  | { k: "empty" }
  | { k: "wire" }
  | { k: "no"; a: string }
  | { k: "nc"; a: string }
  | { k: "pos"; a: string }
  | { k: "neg"; a: string }
  | { k: "not" }
  | { k: "coil"; a: string }
  | { k: "nCoil"; a: string }
  | { k: "set"; a: string }
  | { k: "reset"; a: string }
  | { k: "ton"; t: string; pt: string }
  | { k: "tof"; t: string; pt: string }
  | { k: "tp"; t: string; pt: string }
  | { k: "ctu"; c: string; pv: string; r: string }
  | { k: "ctd"; c: string; pv: string; ld: string }
  | { k: "cmp"; op: string; a: string; b: string }
  | { k: "move"; a: string; dst: string }
  | { k: "math"; op: string; a: string; b: string; dst: string };

export interface Network {
  comment: string;
  rows: Cell[][];
  /** [row, col]: joins row and row + 1 at the right edge of column col. */
  links: Array<[number, number]>;
}

export interface Ladder {
  networks: Network[];
  /** Scan cycle time in ms (0 means the default, 10). */
  scanMs: number;
  /** Names for addresses, e.g. "I0.0" -> "Start button". */
  symbols: Record<string, string>;
}

// ---- Function block diagram (mirrors plc_core::fbd) ----

export interface WeeklyCam {
  /** Bit 0 = Monday ... bit 6 = Sunday. */
  days: number;
  /** Minutes after midnight. */
  onMinute: number;
  offMinute: number;
}

export interface YearlyCam {
  onMonth: number;
  onDay: number;
  offMonth: number;
  offDay: number;
}

export type BlockKind =
  | { k: "input"; n: number }
  | { k: "output"; n: number }
  | { k: "flag"; n: number }
  | { k: "const"; high: boolean }
  | { k: "analogInput"; n: number }
  | { k: "analogFlag"; n: number }
  | { k: "and"; inputs: number }
  | { k: "or"; inputs: number }
  | { k: "nand"; inputs: number }
  | { k: "nor"; inputs: number }
  | { k: "not" }
  | { k: "xor" }
  | { k: "xnor" }
  | { k: "onDelay"; ms: number }
  | { k: "offDelay"; ms: number }
  | { k: "onOffDelay"; onMs: number; offMs: number }
  | { k: "weeklyTimer"; cams: WeeklyCam[] }
  | { k: "yearlyTimer"; cams: YearlyCam[] }
  | { k: "analogAmplifier"; gain: number; offset: number }
  | { k: "analogComparator"; gain: number; offset: number; on: number; off: number }
  | { k: "analogThreshold"; on: number; off: number };

export type Block = BlockKind & {
  id: number;
  x: number;
  y: number;
  /** A name the student gave the block. */
  label: string;
  /** Shifts of the default name (I1, Q1, B03) and of the student's name from their usual places. */
  titleDx: number;
  titleDy: number;
  labelDx: number;
  labelDy: number;
};

/** A wire from an output pin to an input pin (pins count from 0). */
export interface Wire {
  fromBlock: number;
  fromPin: number;
  toBlock: number;
  toPin: number;
  /** Clicked corners from version 0.0.4 (turned into `corners` when opened). */
  points?: Point[];
  /** The path: every corner from the output to the input, at right angles. Empty: drawn automatically. */
  corners: Point[];
}

export interface Diagram {
  blocks: Block[];
  wires: Wire[];
  scanMs: number;
}

// ---- Control panel (mirrors plc_core::panel) ----

/** An extra device the student added to the board. */
export interface PlacedDevice {
  id: number;
  kind: string;
  x: number;
  y: number;
  label: string;
  props: Record<string, string>;
}

/** A jumper wire between two terminals (terminal ids such as "btn1.a" or "d3.p"). */
export interface PanelWire {
  from: string;
  to: string;
  color: string;
  /** Bends, from the "from" end to the "to" end. */
  points: Point[];
  /** A smooth curve through the bends instead of straight pieces. */
  curved: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface Panel {
  devices: PlacedDevice[];
  wires: PanelWire[];
  /** Settings of the fixed devices, by device id. */
  fixedProps: Record<string, Record<string, string>>;
}

export interface PanelTerminal {
  id: string;
  name: string;
  /** Measured from the top-left corner of the device. */
  x: number;
  y: number;
}

export interface FixedDevice {
  id: string;
  kind: string;
  /** The name engraved on the board: I1, Q1, A1 ... */
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  terminals: PanelTerminal[];
}

export interface DeviceDef {
  kind: string;
  name: string;
  /** Short name printed above the device on the panel. */
  short: string;
  /** Heading in the device list: "Switches", "Sensors", "Analog", "Loads". */
  group: string;
  /** Size on the panel; the drawing is made at w / scale by h / scale and enlarged. */
  w: number;
  h: number;
  scale: number;
  /** `mark` is printed beside the terminal: "+", "−", "WH" ... */
  terminals: Array<{ name: string; mark: string; x: number; y: number }>;
}

export interface PanelLayout {
  /** Size of the board. */
  width: number;
  height: number;
  /** Size of the work area: the board and the bench around it. */
  workWidth: number;
  workHeight: number;
  fixed: FixedDevice[];
  catalog: DeviceDef[];
}

export interface PanelError {
  /** Index of the wire to blame, if one wire is. */
  wire: number | null;
  message: string;
  /** A gentle warning rather than a mistake. */
  warning: boolean;
}

export const getPanelLayout = (): Promise<PanelLayout> => invoke("get_panel_layout");
export const checkPanel = (panel: Panel): Promise<PanelError[]> => invoke("check_panel", { panel });

/** A mistake found in a diagram; `block` is the block it belongs to, if any. */
export interface DiagramError {
  block: number | null;
  message: string;
}

/** Checks a diagram the way the CPU does before it runs. An empty list means no mistakes. */
export const checkFbd = (diagram: Diagram): Promise<DiagramError[]> => invoke("check_fbd", { diagram });

// ---- Simulation (mirrors plc_core::sim) ----

/** Date and time for the weekly and yearly timers. */
export interface Clock {
  year: number;
  month: number;
  day: number;
  /** 0 = Monday ... 6 = Sunday. */
  weekday: number;
  /** Minutes after midnight. */
  minute: number;
}

export interface DeviceState {
  id: number;
  /** Lamp lit, buzzer sounding, coil pulled in, sensor output on, knob powered, PT100 connected. */
  on: boolean;
  /** Motor: 1 forwards, -1 backwards, 0 standing. */
  dir: number;
  /** Pressed, switched, or a target in front of the sensor. */
  act: boolean;
  /** Knob 0 to 100 %, PT100 in °C. */
  value: number;
}

export interface SimFrame {
  scans: number;
  timeMs: number;
  /** I1 to I8 as the PLC sees them. */
  inputs: boolean[];
  /** Q1 to Q4. */
  outputs: boolean[];
  /** AI1 (I7) and AI2 (I8). */
  analog: number[];
  /** Board switches I1 to I4 operated. */
  switches: boolean[];
  /** A short circuit has switched the supply off. */
  tripped: boolean;
  devices: DeviceState[];
  /** [block id, value on its output]. */
  blocks: Array<[number, boolean | number]>;
  clock: Clock;
}

/** RUN. Rejects with the diagram's mistakes (DiagramError[]). */
export function simStart(diagram: Diagram, panel: Panel, clock: Clock, clockSpeed: number, onFrame: (f: SimFrame) => void): Promise<void> {
  const ch = new Channel<SimFrame>();
  ch.onmessage = onFrame;
  return invoke("sim_start", { diagram, panel, clock, clockSpeed, onFrame: ch });
}
/** Pause: the program and its timers stand still. */
export const simPause = (paused: boolean): Promise<void> => invoke("sim_pause", { paused });
/** Sets the simulated clock (weekly and yearly timers) while running. */
export const simClock = (clock: Clock, clockSpeed: number): Promise<void> => invoke("sim_clock", { clock, clockSpeed });
export const simStop = (): Promise<void> => invoke("sim_stop");
/** Mouse button down or up on a switch: "swI1" to "swI4", or a device "d<number>". */
export const simPress = (target: string, down: boolean): Promise<void> => invoke("sim_press", { target, down });
/** A slider moved: knob (%) or PT100 (°C). */
export const simValue = (target: string, value: number): Promise<void> => invoke("sim_value", { target, value });

// ---- Project files ----

export interface Project {
  format: number;
  cpu: string;
  comment: string;
  /** "fbd" or "lad". */
  language: "fbd" | "lad";
  ladder: Ladder;
  fbd: Diagram;
  panel: Panel;
}

export interface OpenedProject {
  path: string;
  name: string;
  project: Project;
}

export interface RecentFile {
  path: string;
  name: string;
}

export const newProject = (): Promise<Project> => invoke("new_project");
/** Saves; with no path the student picks one. Returns [path, name] or null if cancelled. */
export const saveProject = (project: Project, path: string | null): Promise<[string, string] | null> =>
  invoke("save_project", { project, path });
export const openProject = (): Promise<OpenedProject | null> => invoke("open_project");
export const recentFiles = (): Promise<RecentFile[]> => invoke("recent_files");
export const openRecent = (path: string): Promise<OpenedProject> => invoke("open_recent", { path });
export const clearRecent = (): Promise<void> => invoke("clear_recent");
/** The project file the program was started with (double-click), if any. */
export const startupProject = (): Promise<OpenedProject | null> => invoke("startup_project");

// ---- Preferences (Tools > Options) ----

export interface Prefs {
  theme: "dark" | "light";
  showAddresses: boolean;
  showSymbols: boolean;
  /** New wires on the control panel are smooth curves. */
  curvyWires: boolean;
}
export const getPrefs = (): Promise<Prefs> => invoke("get_prefs");
export const setPrefs = (prefs: Prefs): Promise<Prefs> => invoke("set_prefs", { prefs });
