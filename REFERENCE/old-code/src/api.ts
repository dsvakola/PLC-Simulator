// Every call into the Rust side goes through this file. The types mirror the
// Rust structs (camelCase on both sides).
import { Channel, invoke } from "@tauri-apps/api/core";

export type BreadboardKind = "full" | "half" | "mini" | "double" | "none";
export type RailPolarity = "positive" | "negative";

export interface Hole {
  id: string;
  x: number;
  y: number;
  strip: number;
}

export interface Rail {
  polarity: RailPolarity;
  lineY: number;
  y: number;
}

export interface Label {
  text: string;
  x: number;
  y: number;
}

export interface BreadboardLayout {
  kind: BreadboardKind;
  width: number;
  height: number;
  channelY: number;
  channelHeight: number;
  /** Further centre channels (double breadboard), by their top Y. */
  moreChannels: number[];
  /** Where two boards are joined (double breadboard). */
  seams: number[];
  holes: Hole[];
  rails: Rail[];
  labels: Label[];
  stripCount: number;
}

export interface AppInfo {
  name: string;
  version: string;
  developers: string[];
  organisation: string;
  website: string;
  email: string;
  github: string;
  licence: string;
}

export type Link = "website" | "email" | "github" | "esp8266Firmware";

export const getAppInfo = (): Promise<AppInfo> => invoke("get_app_info");

export const getBreadboardLayout = (kind: BreadboardKind): Promise<BreadboardLayout> =>
  invoke("get_breadboard_layout", { kind });

export const openLink = (link: Link): Promise<void> => invoke("open_link", { link });
/** Opens a link from an example's source code. Rust opens only the academy's
 *  own addresses (vsa.edu.in, github.com/dsvakola, the academy e-mail). */
export const openUrl = (url: string): Promise<void> => invoke("open_url", { url });

/** Turns any error from Rust into a sentence for the status bar. */
export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : "Something went wrong.";
}

// ---- Parts catalogue ----

export type Category =
  | "boards"
  | "chips"
  | "passive"
  | "inputs"
  | "lights"
  | "displays"
  | "sensors"
  | "motion"
  | "logic"
  | "power";

export interface PinDef {
  name: string;
  x: number;
  y: number;
}

export interface PartDef {
  kind: string;
  name: string;
  category: Category;
  width: number;
  height: number;
  pins: PinDef[];
  joined: string[][];
  breadboardFriendly: boolean;
}

// ---- Project ----

export interface PlacedPart {
  id: string;
  kind: string;
  x: number;
  y: number;
  /** Clockwise, in degrees; any angle. */
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  props: Record<string, string>;
  /** Stretched or bent legs, by pin: bend points then the leg end, in the part's own coordinates. */
  legs?: Record<string, Point[]>;
}

export type Endpoint = { type: "hole"; hole: string } | { type: "pin"; part: string; pin: string };

export interface Wire {
  id: string;
  from: Endpoint;
  to: Endpoint;
  color: string;
  /** Bend points between the two ends. */
  points: Point[];
  curved: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface Project {
  format: number;
  breadboard: BreadboardKind;
  parts: PlacedPart[];
  wires: Wire[];
}

export interface Net {
  pins: string[];
  strips: number[];
}

export interface Connections {
  nets: Net[];
  pinHoles: Record<string, string>;
  warnings: string[];
}

export interface OpenedProject {
  path: string;
  name: string;
  project: Project;
}

export const getCatalogue = (): Promise<PartDef[]> => invoke("get_catalogue");

export const getConnections = (project: Project): Promise<Connections> =>
  invoke("get_connections", { project });

/** Saves; with no path the student picks one. Returns [path, name] or null if cancelled. */
export const saveProject = (project: Project, path: string | null): Promise<[string, string] | null> =>
  invoke("save_project", { project, path });

export const openProject = (): Promise<OpenedProject | null> => invoke("open_project");

/** A project shown under File > Recent. */
export interface RecentFile {
  path: string;
  name: string;
}
export const recentFiles = (): Promise<RecentFile[]> => invoke("recent_files");
export const openRecent = (path: string): Promise<OpenedProject> => invoke("open_recent", { path });
export const clearRecent = (): Promise<void> => invoke("clear_recent");
/** The project file the program was started with (double-click on a .vsasim file), if any. */
export const startupProject = (): Promise<OpenedProject | null> => invoke("startup_project");

// ---- Ready-made examples (File > Examples) ----

export interface ExampleItem {
  id: string;
  title: string;
}
export interface ExampleBoard {
  id: string;
  name: string;
  items: ExampleItem[];
}
export interface ExampleSource {
  title: string;
  name: string;
  text: string;
}
export const exampleCatalog = (): Promise<ExampleBoard[]> => invoke("example_catalog");
export const exampleOpen = (board: string, id: string): Promise<OpenedProject> => invoke("example_open", { board, id });
export const exampleSource = (board: string, id: string): Promise<ExampleSource> => invoke("example_source", { board, id });

// ---- Simulation ----

export interface SimInput {
  pressed: string[];
  burnt: string[];
}

// ---- Running board programs ----

/** One update from the running programs (mirrors Rust RunOutput). */
export interface RunOutput {
  result: SimResult | null;
  /** New Serial text by board part id. */
  serial: Record<string, string>;
  /** Program time in milliseconds. */
  ms: number;
  faults: string[];
}

export interface LoadedProgram {
  name: string;
  /** Where the file is, so a new export is picked up automatically. */
  path: string;
  hex: string;
  bytes: number;
  /** Last change time of the file, in ms since 1970. */
  modified: number;
}

/** Program file type: Arduino .hex (Uno/Nano, or Mega 2560), MicroPython .py (Pico) or Arduino .bin (ESP32). */
export type ProgramFormat =
  | "hex"
  | "hex-mega"
  | "hex-atmega8"
  | "hex-atmega16"
  | "hex-atmega32"
  | "hex-atmega128"
  | "hex-8051-4k"
  | "hex-8051-8k"
  | "py"
  | "bin";

/** Asks for a program of the given type and checks it; null if cancelled. */
export const loadProgram = (format: ProgramFormat): Promise<LoadedProgram | null> => invoke("load_program", { format });

/** The program file again if it changed since `modified`, else null. */
export const refreshProgram = (path: string, modified: number): Promise<LoadedProgram | null> =>
  invoke("refresh_program", { path, modified });

/** Starts the board programs; `onEvent` gets the circuit state and Serial text. */
export const runStart = (project: Project, input: SimInput, onEvent: (o: RunOutput) => void): Promise<void> => {
  const ch = new Channel<RunOutput>();
  ch.onmessage = onEvent;
  return invoke("run_start", { project, input, onEvent: ch });
};
export const runUpdate = (project: Project): Promise<void> => invoke("run_update", { project });
export const runInput = (pressed: string[], burnt: string[]): Promise<void> => invoke("run_input", { pressed, burnt });
export const runSerial = (board: string, text: string): Promise<void> => invoke("run_serial", { board, text });
export const runStop = (): Promise<void> => invoke("run_stop");
/** Pauses the programs while the window is minimised or hidden. */
export const runPause = (paused: boolean): Promise<void> => invoke("run_pause", { paused });

/** Boards that run Arduino (.hex) programs. */
export const AVR_BOARDS = new Set(["arduino-uno", "arduino-uno-smd", "arduino-nano", "arduino-mega"]);

/** Boards that run MicroPython programs. */
export const PY_BOARDS = new Set(["pico-w"]);
/** Boards that run ESP32 / ESP8266 programs (Arduino .bin or MicroPython .py). */
export const ESP_BOARDS = new Set(["esp32-devkit", "esp8266-nodemcu"]);
/** Bare 8051 chips (AT89C51/52, AT89S51/52) that run .hex programs from Keil or SDCC. */
export const MCS51_CHIPS = new Set(["at89c51", "at89c52", "at89s51", "at89s52"]);
/** Bare ATmega chips that run .hex programs from the Arduino IDE (MiniCore, MightyCore, MegaCore) or Microchip Studio. */
export const AVR_CHIPS = new Set(["atmega8", "atmega16", "atmega32", "atmega128"]);
/** Flash memory of each bare ATmega chip, in KB. */
export const AVR_CHIP_KB: Record<string, number> = { atmega8: 8, atmega16: 16, atmega32: 32, atmega128: 128 };
/** Development boards: a chip with its crystal, capacitors and reset button. */
export const DEV_BOARDS = new Set(["dev-8051", "dev-atmega8", "dev-atmega16", "dev-atmega128"]);
/** 8051 chips and the 8051 board, for "Load 8051 program". */
export const MCS51_KINDS = new Set([...MCS51_CHIPS, "dev-8051"]);
/** ATmega chips and boards, for "Load ATmega program". */
export const AVR_KINDS = new Set([...AVR_CHIPS, "dev-atmega8", "dev-atmega16", "dev-atmega128"]);
/** The chip a part runs: the chip chosen on a development board, else the part itself. */
export const chipKind = (p: { kind: string; props: Record<string, string> }): string => {
  switch (p.kind) {
    case "dev-8051":
      return MCS51_CHIPS.has(p.props.chip ?? "") ? (p.props.chip ?? "at89s52") : "at89s52";
    case "dev-atmega8":
      return "atmega8";
    case "dev-atmega16":
      return p.props.chip === "atmega32" ? "atmega32" : "atmega16";
    case "dev-atmega128":
      return "atmega128";
    default:
      return p.kind;
  }
};
/** Boards (and bare chips) that can run a program in the simulator. */
export const PROGRAM_BOARDS = new Set([...AVR_BOARDS, ...PY_BOARDS, ...ESP_BOARDS, ...MCS51_CHIPS, ...AVR_CHIPS, ...DEV_BOARDS]);
/** The program file type a board takes. */
export const programFormat = (kind: string): ProgramFormat =>
  PY_BOARDS.has(kind)
    ? "py"
    : ESP_BOARDS.has(kind)
      ? "bin"
      : kind === "arduino-mega"
        ? "hex-mega"
        : MCS51_CHIPS.has(kind)
          ? kind.endsWith("52")
            ? "hex-8051-8k"
            : "hex-8051-4k"
          : AVR_CHIPS.has(kind)
            ? (`hex-${kind}` as ProgramFormat)
            : "hex";
export const hasProgram = (p: Project): boolean => p.parts.some((q) => PROGRAM_BOARDS.has(q.kind) && !!q.props.program);

// ---- ESP8266 MicroPython firmware (not shipped; the student adds it once) ----

export interface FirmwareStatus {
  present: boolean;
  /** The tested version, ESP8266_GENERIC v1.24.1. */
  tested: boolean;
}
export const esp8266FirmwareStatus = (): Promise<FirmwareStatus> => invoke("esp8266_firmware_status");
export const esp8266FirmwareChoose = (): Promise<FirmwareStatus | null> => invoke("esp8266_firmware_choose");
/** True if the project has an ESP8266 running MicroPython (a .py program, not an Arduino image). */
export const needsEsp8266Firmware = (p: Project): boolean =>
  p.parts.some((q) => q.kind === "esp8266-nodemcu" && typeof q.props.program === "string" && /\s/.test(q.props.program));

export interface PartState {
  current: number;
  voltage: number;
  level: number;
  channels: number[];
  on: boolean;
  burnt: boolean;
  hot: boolean;
  direction: number;
  /** What an I2C display shows while a program drives it. */
  screen?: Screen;
}

export interface Screen {
  /** LCD: 32 character codes (line 1, then line 2). */
  cells?: number[];
  /** LCD: 8 custom characters, 8 rows of 5 dots each. */
  cgram?: number[];
  /** LCD: cell with the cursor. */
  cursor?: number;
  /** LCD backlight, or OLED display on. */
  light: boolean;
  /** OLED: 64 rows of 128 pixels in base64, 16 bytes per row. */
  pixels?: string;
  contrast: number;
}

export interface SimResult {
  pins: Record<string, number>;
  parts: Record<string, PartState>;
  warnings: string[];
  converged: boolean;
}

export const simulate = (project: Project, input: SimInput): Promise<SimResult> => invoke("simulate", { project, input });

// ---- Preferences and export ----

/** File > Preferences (mirrors Rust Prefs). */
export interface Prefs {
  alignToGrid: boolean;
  curvyWires: boolean;
  showGrid: boolean;
  buzzerSound: boolean;
  autoReload: boolean;
  breadboard: BreadboardKind;
  exportDpi: number;
  exportFormat: "png" | "jpg";
}
export const getPrefs = (): Promise<Prefs> => invoke("get_prefs");
export const setPrefs = (prefs: Prefs): Promise<Prefs> => invoke("set_prefs", { prefs });

/** Asks where to save an exported picture and saves it. Returns the path, or null if cancelled. */
export const exportImage = (bytes: Uint8Array, format: "png" | "jpg", name: string): Promise<string | null> =>
  invoke("export_image", bytes, { headers: { format, name: name.replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 60) } });
