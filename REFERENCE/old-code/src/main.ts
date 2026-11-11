import "./styles.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  clearRecent,
  errorText,
  exampleCatalog,
  exampleOpen,
  exampleSource,
  exportImage,
  getAppInfo,
  getPrefs,
  getBreadboardLayout,
  getCatalogue,
  esp8266FirmwareStatus,
  hasProgram,
  loadProgram,
  needsEsp8266Firmware,
  openProject,
  openRecent,
  recentFiles,
  refreshProgram,
  runInput,
  runPause,
  runSerial,
  runStart,
  runStop,
  runUpdate,
  saveProject,
  setPrefs,
  simulate,
  startupProject,
  AVR_BOARDS,
  MCS51_CHIPS,
  AVR_CHIPS,
  AVR_CHIP_KB,
  MCS51_KINDS,
  AVR_KINDS,
  chipKind,
  ESP_BOARDS,
  PROGRAM_BOARDS,
  PY_BOARDS,
  programFormat,
  type BreadboardKind,
  type ExampleBoard,
  type PartDef,
  type PlacedPart,
  type Prefs,
  type RecentFile,
  type RunOutput,
  type SimResult,
} from "./api";
import { ControlPopup } from "./ui/control";
import { Editor, newProject } from "./editor";
import { showAbout } from "./ui/about";
import { showHelp } from "./ui/help";
import { showSource } from "./ui/source";
import { ensureEsp8266Firmware, showFirmware } from "./ui/firmware";
import { ask, askForm, askNumber } from "./ui/confirm";
import { installDefs } from "./ui/defs";
import { icons } from "./ui/icons";
import { Inspector } from "./ui/inspector";
import { buildMenuBar, menuOpen, showContextMenu, type MenuItem } from "./ui/menu";
import { buildPalette } from "./ui/palette";
import { rasterise } from "./ui/picture";
import { buzz } from "./ui/sound";
import { Workspace } from "./ui/workspace";

/** Jumper wire colours, in the order students know from breadboard kits. */
const WIRE_COLORS: Array<[string, string]> = [
  ["Blue", "#1e6fd9"],
  ["Red", "#d62f2f"],
  ["Black", "#262626"],
  ["Yellow", "#f5c400"],
  ["Green", "#2ea84f"],
  ["Grey", "#8c8c8c"],
  ["White", "#f4f4f4"],
  ["Orange", "#f07c16"],
  ["Ochre", "#b8860b"],
  ["Cyan", "#18b8c9"],
  ["Brown", "#8b4513"],
  ["Purple", "#8e44ad"],
  ["Pink", "#e86fae"],
];

const BREADBOARDS: Array<[BreadboardKind, string]> = [
  ["full", "Full breadboard (63 columns)"],
  ["half", "Half breadboard (30 columns)"],
  ["mini", "Mini breadboard (17 columns)"],
  ["double", "Double breadboard, for ESP boards (two halves joined)"],
  ["none", "No breadboard (wire parts directly)"],
];

function $(selector: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`Missing element ${selector}`);
  return node;
}

const tb = (id: string, icon: string, label: string, title: string): string =>
  `<button class="tb-btn" id="${id}" title="${title}">${icon}<span>${label}</span></button>`;

function shell(): void {
  $("#app").innerHTML = `
    <nav class="menubar" id="menubar" aria-label="Menu"></nav>
    <div class="tabbar">
      <button class="tab active" id="tab-bb">${icons.breadboard}<span>Breadboard</span></button>
      <button class="tab" id="tab-code">${icons.code}<span>Code</span></button>
      <span class="spacer"></span>
      <span class="tab-project" id="project-name">Untitled</span>
    </div>
    <main class="stage" id="stage">
      <div class="workspace" id="workspace"><div class="sim-banner" id="sim-banner" hidden></div><div class="empty-note">No project is open.<br/>Use <b>File &gt; New</b> (Ctrl+N) or <b>File &gt; Open</b> (Ctrl+O).</div></div>
      <div class="code-view" id="code-view" hidden>
        <div class="code-card" id="code-card"></div>
      </div>
      <section class="serial" id="serial">
        <div class="serial-grip" id="serial-grip" title="Drag to change the height (double-click: normal height)"></div>
        <div class="serial-head">${icons.serial}<span id="serial-title">Serial Monitor</span><span class="spacer"></span>
          <button class="btn small serial-clear" id="btn-serial-clear" title="Clear the output">Clear</button>
          <button class="icon-btn small-btn" id="btn-serial-close" title="Close Serial Monitor (Ctrl+Shift+M)" aria-label="Close Serial Monitor">${icons.close}</button>
        </div>
        <pre class="serial-body" id="serial-body">Serial output from the board will appear here when programs run.</pre>
        <form class="serial-send" id="serial-send"><input id="serial-input" autocomplete="off" placeholder="Message to the board (Enter to send)"/><button class="btn small">Send</button></form>
      </section>
    </main>
    <aside class="dock">
      <section class="dock-panel parts-panel">
        <div class="dock-title">Parts<button class="dock-close" id="btn-parts-close" title="Hide the Parts bin (View menu brings it back)" aria-label="Hide the Parts bin">${icons.close}</button></div>
        <div class="dock-body" id="palette"></div>
      </section>
      <section class="dock-panel inspector-panel">
        <div class="dock-title">Inspector<button class="dock-close" id="btn-inspector-close" title="Hide the Inspector (View menu brings it back)" aria-label="Hide the Inspector">${icons.close}</button></div>
        <div class="dock-body inspector" id="inspector"></div>
      </section>
    </aside>
    <div class="bottombar">
      ${tb("tb-rot-left", icons.rotateLeft, "Rotate", "Rotate 90° anticlockwise (Ctrl+Shift+R)")}
      ${tb("tb-rot-right", icons.rotate, "Rotate", "Rotate 90° clockwise (Ctrl+R)")}
      ${tb("tb-flip-h", icons.flipH, "Flip", "Flip horizontal")}
      ${tb("tb-flip-v", icons.flipV, "Flip", "Flip vertical")}
      ${tb("tb-delete", icons.trash, "Delete", "Delete the selected part or wire (Del)")}
      <div class="tb-sep"></div>
      <button class="sim-toggle" id="btn-sim" title="Start or stop the simulation (F5)">${icons.simulate}<span>Simulate</span></button>
      <div class="routing" id="routing"></div>
      <span class="spacer"></span>
      ${tb("tb-zoom-out", icons.zoomOut, "Zoom out", "Zoom out (Ctrl+-)")}
      <span class="zoom-text" id="zoom-text">100%</span>
      ${tb("tb-zoom-in", icons.zoomIn, "Zoom in", "Zoom in (Ctrl++)")}
      ${tb("tb-fit", icons.fit, "Fit in Window", "Fit in window (Ctrl+0)")}
      ${tb("tb-actual", icons.actual, "Actual Size", "Actual size (Ctrl+1)")}
    </div>
    <footer class="statusbar">
      <span id="status-text">Ready</span>
      <span class="spacer"></span>
      <span id="status-hover"></span>
      <button class="status-btn" id="btn-serial-open" title="Show Serial Monitor (Ctrl+Shift+M)">${icons.serial}<span id="serial-open-label">Serial Monitor</span></button>
      <span id="status-xy" class="status-xy"></span>
      <span id="status-version"></span>
    </footer>`;
}

function setStatus(text: string, isError = false): void {
  const s = $("#status-text");
  s.textContent = text;
  s.classList.toggle("error", isError);
}

const SHORTCUTS: Array<[string, string]> = [
  ["F5", "Start or stop the simulation"],
  ["Esc", "Stop the simulation (or cancel a wire being drawn)"],
  ["F1", "Open the User Guide"],
  ["F11", "Presentation mode: full screen, hide the side panes and the Serial Monitor"],
  ["While simulating", "Hold a push button with the mouse; click a slide or toggle switch to flip it; click a knob, LDR, thermistor or IR sensor"],
  ["Ctrl+N / Ctrl+O / Ctrl+S", "New, open, save project"],
  ["Ctrl+Z / Ctrl+Y", "Undo, redo"],
  ["Ctrl+D", "Duplicate the selected part"],
  ["Delete", "Delete the selected part or wire"],
  ["Ctrl+R or R", "Rotate 90° clockwise"],
  ["Ctrl+Shift+R", "Rotate 90° anticlockwise"],
  ["Ctrl+Alt+R", "Rotate 45° clockwise"],
  ["Drag from a hole or pin", "Draw a wire"],
  ["Drag a wire", "Bend it; hold Shift for a right angle"],
  ["Double-click a bend", "Remove the bend"],
  ["Ctrl+Shift+M", "Show or hide the Serial Monitor"],
  ["Ctrl+0 / Ctrl+1", "Fit in window, actual size"],
];

async function main(): Promise<void> {
  installDefs();
  shell();
  const showError = (msg: string): void => setStatus(msg, true);

  let parts: PartDef[] = [];
  try {
    parts = await getCatalogue();
  } catch (e) {
    showError(errorText(e));
  }
  const editor = new Editor(new Map(parts.map((p) => [p.kind, p])), showError);
  let contextMenu: (x: number, y: number) => void = () => undefined;
  let onPress: (id: string, down: boolean) => void = () => undefined;
  const controls = new ControlPopup($("#workspace"), editor);
  editor.subscribe(() => controls.sync());
  const workspace = new Workspace($("#workspace"), editor, {
    onHover: (text) => {
      $("#status-hover").textContent = text;
    },
    onZoom: (percent) => {
      $("#zoom-text").textContent = `${percent}%`;
    },
    onStatus: (text) => setStatus(text),
    onContextMenu: (x, y) => contextMenu(x, y),
    onPress: (id, down) => onPress(id, down),
    onControl: (id, x, y) => controls.open(id, x, y),
    onPartDialog: (id) => void showSupply(id),
    onPointer: (x, y) => {
      $("#status-xy").textContent = `x: ${x.toFixed(3)}  y: ${y.toFixed(3)} in`;
    },
  });
  let closed = false;
  buildPalette($("#palette"), parts, (kind, e, props) => {
    if (!closed) workspace.beginPlace(kind, e, props);
  });

  let shownBoard: BreadboardKind | null = null;
  const syncBreadboard = async (): Promise<void> => {
    const kind = editor.project.breadboard;
    if (kind === shownBoard) return;
    shownBoard = kind;
    try {
      workspace.setBreadboard(await getBreadboardLayout(kind));
      workspace.render();
    } catch (e) {
      showError(errorText(e));
    }
  };

  const win = getCurrentWindow();
  let lastTitle = "";

  // ---- Simulation ----

  let running = false;
  let simTicket = 0;
  const burnt = new Set<string>();
  const banner = $("#sim-banner");

  /** Tells the student what they can work with the mouse in this circuit. */
  const simHints = (kinds: Set<string>): string => {
    const hints: string[] = [];
    if (kinds.has("push-button") || kinds.has("push-button-2pin")) hints.push("hold a push button down with the mouse");
    if (["slide-switch", "switch-spst", "switch-spdt", "switch-dpdt"].some((k) => kinds.has(k))) hints.push("click a switch to flip it");
    const names: Record<string, string> = {
      potentiometer: "potentiometer",
      ldr: "LDR",
      thermistor: "thermistor",
      "hc-sr04": "ultrasonic sensor",
      dht11: "DHT11",
      pir: "PIR sensor",
      "ir-sensor": "IR sensor",
    };
    const adjustable = Object.keys(names).filter((k) => kinds.has(k)).map((k) => names[k]);
    if (adjustable.length) hints.push(`click the ${adjustable.join(", ")} to change it`);
    if (kinds.has("dc-supply")) hints.push("drag the supply knobs to set volts and current");
    if (!hints.length) return "";
    const t = hints.join("; ");
    return ` ${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
  };

  const showSim = (r: SimResult | null): void => {
    workspace.sim = r;
    workspace.render();
    inspector.update();
    const buzzers = r ? Object.entries(r.parts).filter(([id, s]) => s.on && editor.part(id)?.kind === "buzzer") : [];
    buzz(soundOn && buzzers.length ? Math.max(...buzzers.map(([, s]) => s.level)) : 0);
    if (!r) {
      banner.hidden = true;
      return;
    }
    const LED_KINDS = new Set(["led", "rgb-led", "rgb-led-2pin"]);
    const leds = Object.entries(r.parts).filter(([id, s]) => s.on && LED_KINDS.has(editor.part(id)?.kind ?? "")).length;
    if (r.warnings.length) {
      banner.hidden = false;
      banner.className = "sim-banner warn";
      banner.textContent = `⚠ ${r.warnings[0]}${r.warnings.length > 1 ? `  (+${r.warnings.length - 1} more)` : ""}`;
      banner.title = r.warnings.join("\n");
    } else {
      banner.hidden = false;
      banner.className = "sim-banner ok";
      const kinds = new Set(editor.project.parts.map((p) => p.kind));
      const ledText = [...kinds].some((k) => LED_KINDS.has(k)) ? ` · ${leds} LED${leds === 1 ? "" : "s"} on` : "";
      const head = programMode ? `Program running · ${(programMs / 1000).toFixed(1)} s` : "Simulating";
      banner.textContent = `${head}${ledText}.${simHints(kinds)}`;
      banner.title = "";
    }
  };

  // ---- Board programs ----
  let programMode = false;
  let programMs = 0;
  let serialFresh = true;
  const serialBody = $("#serial-body");
  const appendSerial = (text: string): void => {
    if (serialFresh) {
      serialBody.textContent = "";
      serialFresh = false;
    }
    serialBody.classList.add("live");
    const atEnd = serialBody.scrollTop + serialBody.clientHeight >= serialBody.scrollHeight - 4;
    serialBody.textContent += text;
    // Keep the monitor light on long runs.
    const t = serialBody.textContent ?? "";
    if (t.length > 60000) serialBody.textContent = t.slice(t.length - 40000);
    if (atEnd) serialBody.scrollTop = serialBody.scrollHeight;
  };
  /** Empties the Serial Monitor or Shell and shows its starting hint. */
  const resetSerial = (): void => {
    serialFresh = true;
    serialBody.classList.remove("live");
    serialBody.textContent =
      $("#serial-title").textContent === "Shell"
        ? "MicroPython output will appear here when the program runs."
        : "Serial output from the board will appear here when programs run.";
  };
  /** True if the board runs a MicroPython (.py) program. */
  const runsPython = (b: PlacedPart): boolean =>
    PY_BOARDS.has(b.kind) || (ESP_BOARDS.has(b.kind) && !!b.props.program && (b.props.programName ?? "").toLowerCase().endsWith(".py"));
  /** Names the lower pane after the programs loaded: Shell for MicroPython (as in Thonny), Serial Monitor for Arduino. */
  const updateSerialTitle = (): void => {
    const boards = editor.project.parts.filter((p) => PROGRAM_BOARDS.has(p.kind) && p.props.program);
    const py = boards.filter(runsPython).length;
    const title = py === 0 ? "Serial Monitor" : py === boards.length ? "Shell" : "Serial Monitor / Shell";
    if ($("#serial-title").textContent === title) return;
    $("#serial-title").textContent = title;
    $("#serial-open-label").textContent = title;
    $("#btn-serial-close").title = `Close ${title} (Ctrl+Shift+M)`;
    $("#btn-serial-open").title = `Show ${title} (Ctrl+Shift+M)`;
    ($("#serial-input") as HTMLInputElement).placeholder =
      py === boards.length && py > 0 ? "Type into the Shell (Enter to send)" : "Message to the board (Enter to send)";
    if (serialFresh)
      serialBody.textContent =
        py === boards.length && py > 0
          ? "MicroPython output will appear here when the program runs."
          : "Serial output from the board will appear here when programs run.";
  };
  const onRun = (o: RunOutput): void => {
    if (!running || !programMode) return;
    programMs = o.ms;
    for (const [id, text] of Object.entries(o.serial)) {
      const boards = editor.project.parts.filter((p) => PROGRAM_BOARDS.has(p.kind) && p.props.program);
      const p = editor.part(id);
      appendSerial(boards.length > 1 && p ? text.replace(/^/gm, `[${editor.label(p)}] `) : text);
    }
    if (o.faults[0]) setStatus(o.faults[0], true);
    if (o.result) {
      const fresh = Object.entries(o.result.parts).filter(([id, s]) => s.burnt && !burnt.has(id));
      for (const [id] of fresh) burnt.add(id);
      showSim(o.result);
    }
  };
  /** The ESP8266 MicroPython firmware has been added (it is not shipped with the program). */
  let esp8266Ready = false;
  esp8266FirmwareStatus()
    .then((s) => {
      esp8266Ready = s.present;
    })
    .catch(() => {
      esp8266Ready = false;
    });
  const startProgram = async (): Promise<void> => {
    programMode = true;
    programMs = 0;
    serialFresh = true;
    try {
      await runStart(editor.project, { pressed: [...workspace.pressed], burnt: [...burnt] }, onRun);
    } catch (e) {
      showError(errorText(e));
      setRunning(false);
    }
  };

  const resimulate = async (): Promise<void> => {
    if (!running) return;
    if (programMode !== hasProgram(editor.project)) {
      // A program was loaded or removed while simulating: start again.
      setRunning(true);
      return;
    }
    if (programMode) {
      runUpdate(editor.project).catch((e) => showError(errorText(e)));
      return;
    }
    const ticket = ++simTicket;
    try {
      const r = await simulate(editor.project, { pressed: [...workspace.pressed], burnt: [...burnt] });
      if (ticket !== simTicket || !running) return;
      // A part that burns stays broken for the rest of this run.
      const fresh = Object.entries(r.parts).filter(([id, s]) => s.burnt && !burnt.has(id));
      if (fresh.length) {
        for (const [id] of fresh) burnt.add(id);
        const warnings = r.warnings;
        const again = await simulate(editor.project, { pressed: [...workspace.pressed], burnt: [...burnt] });
        if (ticket !== simTicket || !running) return;
        again.warnings = [...new Set([...warnings, ...again.warnings])];
        showSim(again);
        return;
      }
      showSim(r);
    } catch (e) {
      showError(errorText(e));
    }
  };

  /** Why the circuit cannot be simulated yet, or null if it can. */
  const simBlocker = (): string | null => {
    const ps = editor.project.parts;
    if (!ps.length) return "Nothing to simulate yet. Drag parts from the Parts bin onto the breadboard first.";
    const powered = ps.some((p) => {
      const c = editor.defs.get(p.kind)?.category;
      return c === "boards" || c === "power";
    });
    if (!powered) return "Add a power source first: a battery or an Arduino board.";
    return null;
  };

  const setRunning = (on: boolean): void => {
    const why = on ? (closed ? "No project is open. Use File > New or File > Open." : simBlocker()) : null;
    if (why) {
      if (running) setRunning(false);
      setStatus(why, true);
      return;
    }
    if (on && !esp8266Ready && needsEsp8266Firmware(editor.project)) {
      // MicroPython on the ESP8266 needs the firmware the student adds once.
      if (running) setRunning(false);
      void ensureEsp8266Firmware(setStatus).then((ok) => {
        esp8266Ready = ok;
        if (ok) setRunning(true);
        else setStatus("The ESP8266 MicroPython program cannot run until its firmware is added (File > ESP8266 MicroPython firmware…).", true);
      });
      return;
    }
    if (programMode) void runStop();
    programMode = false;
    running = on;
    // Watch the simulation: leave the Code tab.
    if (on && !$("#code-view").hidden) showTab(false);
    burnt.clear();
    workspace.pressed.clear();
    const b = $("#btn-sim");
    b.classList.toggle("running", on);
    b.innerHTML = on ? `${icons.stop}<span>Stop</span>` : `${icons.simulate}<span>Simulate</span>`;
    document.body.classList.toggle("simulating", on);
    if (on && hasProgram(editor.project)) {
      setStatus("Program running on the board. Change the circuit and it updates at once.");
      void startProgram();
    } else if (on) {
      setStatus("Simulation running. Change the circuit and it updates at once.");
      void resimulate();
    } else {
      simTicket++;
      controls.close();
      showSim(null);
      setStatus("Simulation stopped.");
    }
  };
  onPress = (id, down) => {
    if (down) workspace.pressed.add(id);
    else workspace.pressed.delete(id);
    workspace.render();
    if (programMode) runInput([...workspace.pressed], [...burnt]).catch((e) => showError(errorText(e)));
    else void resimulate();
  };
  let soundOn = true;

  // ---- Preferences ----

  let prefs: Prefs = {
    alignToGrid: true,
    curvyWires: false,
    showGrid: true,
    buzzerSound: true,
    autoReload: true,
    breadboard: "half",
    exportDpi: 300,
    exportFormat: "png",
  };
  const applyPrefs = (): void => {
    workspace.alignToGrid = prefs.alignToGrid;
    workspace.curvyWires = prefs.curvyWires;
    document.body.classList.toggle("no-grid", !prefs.showGrid);
    soundOn = prefs.buzzerSound;
  };
  /** Changes some preferences and saves them. */
  const updatePrefs = (change: Partial<Prefs>): void => {
    prefs = { ...prefs, ...change };
    applyPrefs();
    setPrefs(prefs)
      .then((p) => (prefs = p))
      .catch((e) => showError(errorText(e)));
  };
  const setAlign = (on: boolean): void => {
    updatePrefs({ alignToGrid: on });
    if (on) {
      const n = editor.snapAll(snap);
      setStatus(n ? `Align to grid is on: ${n} part${n === 1 ? "" : "s"} moved onto the grid. Ctrl+Z puts them back.` : "Align to grid is on.");
    } else {
      setStatus("Align to grid is off: parts move freely. Their pins only connect when they sit exactly on a hole or pin.");
    }
  };

  // ---- Actions used by buttons, menus and keys ----

  const selectedPart = (): string | null => (editor.selection?.type === "part" ? editor.selection.id : null);
  const selectedWire = (): string | null => (editor.selection?.type === "wire" ? editor.selection.id : null);
  const snap = workspace.snapPart.bind(workspace);

  const rotate = (deg: number): void => {
    const id = selectedPart();
    if (id) editor.rotatePart(id, deg, snap);
  };
  const flip = (axis: "h" | "v"): void => {
    const id = selectedPart();
    if (id) editor.flipPart(id, axis, snap);
  };
  const setAngle = async (): Promise<void> => {
    const id = selectedPart();
    const p = id ? editor.part(id) : undefined;
    if (!p) return;
    const v = await askNumber("Rotate part", "Angle (clockwise; use a minus sign for anticlockwise)", p.rotation, "degrees");
    if (v !== null) editor.setRotation(p.id, v, snap);
  };
  const deleteSelected = (): void => {
    const what = editor.deleteSelection();
    if (what) setStatus(`${what} deleted. Press Ctrl+Z to bring it back.`);
  };
  const duplicate = (): void => {
    const p = editor.duplicateSelection();
    if (p) setStatus(`${editor.label(p)} added.`);
  };
  const setWireColor = (color: string): void => {
    workspace.wireColor = color;
    const id = selectedWire();
    if (id) editor.setWireColor(id, color);
  };

  const serialShown = (): boolean => !$("#stage").classList.contains("no-serial");
  const toggleSerial = (show = !serialShown()): void => {
    $("#stage").classList.toggle("no-serial", !show);
    $("#btn-serial-open").classList.toggle("shown", !show);
  };

  // ---- Panes and presentation mode ----
  const paneShown = (name: "parts" | "inspector"): boolean => !document.body.classList.contains(`no-${name}`);
  const syncDock = (): void => {
    document.body.classList.toggle("no-dock", !paneShown("parts") && !paneShown("inspector"));
    // The workspace changed size: keep the circuit in view.
    requestAnimationFrame(() => workspace.fit());
  };
  const togglePane = (name: "parts" | "inspector", show = !paneShown(name)): void => {
    document.body.classList.toggle(`no-${name}`, !show);
    syncDock();
  };
  /** What was shown before presentation mode, to put back afterwards. */
  let beforePresent: { parts: boolean; inspector: boolean; serial: boolean } | null = null;
  const presenting = (): boolean => beforePresent !== null;
  const togglePresent = async (): Promise<void> => {
    if (beforePresent) {
      const b = beforePresent;
      beforePresent = null;
      document.body.classList.remove("presenting");
      document.body.classList.toggle("no-parts", !b.parts);
      document.body.classList.toggle("no-inspector", !b.inspector);
      toggleSerial(b.serial);
      await win.setFullscreen(false).catch(() => undefined);
      syncDock();
      setStatus("Presentation mode off.");
      return;
    }
    beforePresent = { parts: paneShown("parts"), inspector: paneShown("inspector"), serial: serialShown() };
    document.body.classList.add("presenting", "no-parts", "no-inspector");
    toggleSerial(false);
    await win.setFullscreen(true).catch(() => undefined);
    syncDock();
    setStatus("Presentation mode: press F11 or Esc to come back.");
  };

  const showTab = (code: boolean): void => {
    $("#tab-bb").classList.toggle("active", !code);
    $("#tab-code").classList.toggle("active", code);
    $("#workspace").hidden = code;
    $("#code-view").hidden = !code;
    if (code) renderCode();
  };

  // ---- Code tab: programs on the boards ----

  /** The board a program goes to: the selected board, else the first one that runs programs. */
  const programBoard = (only?: Set<string>): PlacedPart | undefined => {
    const kinds = only ?? PROGRAM_BOARDS;
    const id = selectedPart();
    const sel = id ? editor.part(id) : undefined;
    if (sel && kinds.has(sel.kind)) return sel;
    return editor.project.parts.find((p) => kinds.has(p.kind));
  };
  const importProgram = async (board?: PlacedPart, only?: Set<string>): Promise<void> => {
    const b = board ?? programBoard(only);
    if (!b) {
      showTab(true);
      setStatus(
        only === PY_BOARDS
          ? "Place a Raspberry Pi Pico W first (Parts bin → Boards), then load its program."
          : only === AVR_BOARDS
            ? "Place an Arduino Uno, Nano or Mega 2560 first, then load its program."
            : only === ESP_BOARDS
              ? "Place an ESP32 DevKit or ESP8266 NodeMCU first (Parts bin → Boards), then load its program."
              : only === MCS51_KINDS
                ? "Place an 8051 chip first (Parts bin → Microcontroller chips), then load its program."
                : only === AVR_KINDS
                  ? "Place an ATmega chip first (Parts bin → Microcontroller chips), then load its program."
                : "Place an Arduino Uno, Nano, Mega 2560, ESP32 DevKit, ESP8266 NodeMCU or Raspberry Pi Pico W first, then load its program.",
        true,
      );
      return;
    }
    try {
      const prog = await loadProgram(programFormat(chipKind(b)));
      if (!prog) return;
      const python = prog.name.toLowerCase().endsWith(".py");
      editor.setProps(b.id, {
        program: prog.hex,
        programName: prog.name,
        programBytes: String(prog.bytes),
        programPath: prog.path,
        programModified: String(prog.modified),
      });
      setStatus(
        `${prog.name} loaded on ${editor.label(b)}. Press Simulate (F5) to run it. ${python ? "Saving it again in Thonny" : "A new export from the Arduino IDE"} is picked up by itself.`,
      );
      if (python && b.kind === "esp8266-nodemcu" && !esp8266Ready) esp8266Ready = await ensureEsp8266Firmware(setStatus);
    } catch (e) {
      showError(errorText(e));
    }
  };
  const escHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const renderCode = (): void => {
    const card = $("#code-card");
    const boards = editor.project.parts.filter((p) => ["boards", "chips"].includes(editor.defs.get(p.kind)?.category ?? ""));
    const has = (test: (kind: string) => boolean): boolean => boards.some((b) => test(b.kind));
    const rows = boards
      .map((b) => {
        const name = escHtml(editor.label(b));
        if (!PROGRAM_BOARDS.has(b.kind)) {
          return `<div class="prog-row"><div class="prog-board">${name}</div><div class="prog-info muted">This board does not run programs.</div></div>`;
        }
        const esp = ESP_BOARDS.has(b.kind);
        const python = PY_BOARDS.has(b.kind) || (esp && !!b.props.program && (b.props.programName ?? "").toLowerCase().endsWith(".py"));
        const size = Number(b.props.programBytes ?? "0");
        const prog = b.props.program
          ? `<b>${escHtml(b.props.programName ?? (python ? "main.py" : esp ? "program.bin" : "program.hex"))}</b> · ${
              python
                ? `${b.props.program.trimEnd().split("\n").length} lines`
                : esp
                  ? `${(size / 1024).toFixed(0)} KB of ${b.kind === "esp8266-nodemcu" ? 1024 : 1280} KB`
                  : MCS51_CHIPS.has(chipKind(b))
                    ? `${size} bytes of ${chipKind(b).endsWith("52") ? 8 : 4} KB`
                    : AVR_CHIPS.has(chipKind(b))
                      ? `${size} bytes of ${AVR_CHIP_KB[chipKind(b)] ?? 32} KB`
                    : `${(size / 1024).toFixed(1)} KB of ${b.kind === "arduino-mega" ? 248 : 32} KB`
            }`
          : `<span class="muted">No program yet</span>`;
        const preview =
          python && b.props.program ? `<details class="prog-code"><summary>Show the program</summary><pre>${escHtml(b.props.program)}</pre></details>` : "";
        return `<div class="prog-row"><div class="prog-board">${name}</div><div class="prog-info">${prog}</div>
          <button class="btn small" data-load="${escHtml(b.id)}">${icons.upload} ${b.props.program ? "Change" : python ? "Load .py" : esp ? "Load .bin or .py" : "Load .hex"}…</button>
          ${b.props.program ? `<button class="btn small" data-remove="${escHtml(b.id)}">Remove</button>` : ""}
          ${b.props.exampleSource ? `<button class="btn small" data-source="${escHtml(b.props.exampleSource)}">${icons.code} Source code</button>` : ""}${preview}</div>`;
      })
      .join("");
    card.innerHTML = `
      <h2>${icons.code} Code</h2>
      ${rows ? `<div class="prog-rows">${rows}</div>` : ""}
      ${has((k) => k === "arduino-uno" || k === "arduino-nano" || k === "arduino-uno-smd") ? `<p><b>Arduino Uno or Nano:</b> in the Arduino IDE choose <b>Sketch → Export Compiled Binary</b>,
      then load the file ending in <b>.ino.standard.hex</b> (not the one “with_bootloader”).</p>` : ""}
      ${has((k) => k === "arduino-mega") ? `<p><b>Arduino Mega 2560:</b> choose the board <b>Arduino Mega or Mega 2560</b>, then <b>Sketch → Export Compiled Binary</b>,
      and load the <b>.hex</b> file (not the one “with_bootloader”). <code>Serial1</code>, <code>Serial2</code> and
      <code>Serial3</code> lines appear in the Serial Monitor marked [Serial1], [Serial2] and [Serial3]; what you type goes to <code>Serial</code>.</p>` : ""}
      ${has((k) => k === "esp32-devkit") ? `<p><b>ESP32 DevKit:</b> in the Arduino IDE choose the board <b>ESP32 Dev Module</b>, then <b>Sketch → Export Compiled Binary</b>,
      and load the file ending in <b>.ino.bin</b> from the sketch's <b>build</b> folder. For MicroPython, load a <b>.py</b> file
      saved from Thonny instead. The blue on-board LED is GPIO 2 (<code>Pin(2)</code>); <code>analogRead</code> and
      <code>ADC</code> work on GPIO 32 to 39.</p>` : ""}
      ${has((k) => k === "esp8266-nodemcu") ? `<p><b>ESP8266 NodeMCU:</b> in the Arduino IDE choose the board <b>NodeMCU 1.0 (ESP-12E Module)</b>, then
      <b>Sketch → Export Compiled Binary</b>, and load the file ending in <b>.ino.nodemcu.bin</b>. For MicroPython, load a
      <b>.py</b> file. Use the GPIO numbers in your program: D1 = 5, D2 = 4, D5 = 14, D6 = 12, D7 = 13 (D0 = 16, D3 = 0,
      D4 = 2, D8 = 15). The blue LED on the module is GPIO 2 and lights when the pin is <b>LOW</b>. <code>analogRead(A0)</code>
      or <code>ADC(0)</code> reads 0 to 1024 for 0 to 3.2 V.</p>` : ""}
      ${has((k) => MCS51_KINDS.has(k)) ? `<p><b>AT89C51 / AT89C52 / AT89S51 / AT89S52 (8051):</b> build your program with <b>Keil µVision</b> (tick
      <b>Create HEX File</b> in Options for Target → Output) or with <b>SDCC</b> (<code>sdcc main.c</code>, then
      <code>packihx main.ihx &gt; main.hex</code>), and load the <b>.hex</b> file. Wire the chip as on a real board: VCC (pin 40)
      to +5 V, GND (pin 20) to ground, EA (pin 31) to +5 V, a crystal on XTAL1/XTAL2 with 22 pF capacitors to ground, and
      RST (pin 9) to ground through a resistor (a button to +5 V resets the chip). Port 0 needs 10 kΩ pull-up resistors.
      Text sent with <code>SBUF</code> on TXD appears in the Serial Monitor.</p>` : ""}
      ${has((k) => AVR_KINDS.has(k)) ? `<p><b>ATmega8 / ATmega16 / ATmega32 / ATmega128:</b> in the Arduino IDE install <b>MiniCore</b> (ATmega8),
      <b>MightyCore</b> (ATmega16, ATmega32) or <b>MegaCore</b> (ATmega128), choose the chip, set <b>Clock</b> to the same speed as
      in the simulator (for example <b>16 MHz external</b>), then <b>Sketch → Export Compiled Binary</b> and load the <b>.hex</b> file
      (not the one “with_bootloader”). A <b>.hex</b> file from Microchip Studio or avr-gcc works too. Wire the chip as on a real
      board: VCC and AVCC to +5 V, GND to ground, and a crystal on XTAL1/XTAL2 with 22 pF capacitors to ground, or choose the
      internal 1 MHz or 8 MHz clock in the Inspector. RESET has a pull-up inside; a button to ground resets the chip.
      <code>Serial</code> text appears in the Serial Monitor.</p>` : ""}
      ${has((k) => PY_BOARDS.has(k)) ? `<p><b>Raspberry Pi Pico W:</b> write your MicroPython program in Thonny, save it on <b>This computer</b> as a <b>.py</b> file,
      then load that file here. Use <code>Pin("LED")</code> for the on-board LED.</p>` : ""}
      ${rows ? "" : `<p class="prog-empty">Place an Arduino Uno, Nano, Mega 2560, ESP32 DevKit, ESP8266 NodeMCU or Raspberry Pi Pico W (Parts bin → Boards), or an 8051 or ATmega chip (Parts bin → Microcontroller chips) on the workspace first.</p>`}
      <p class="muted">Press <b>Simulate</b> (F5) to run. The board's pins drive your circuit, buttons and sensors are read by the program,
      and <code>Serial.print</code> or <code>print()</code> text appears in the Serial Monitor. Type in the Serial Monitor to answer
      <code>input()</code>; when a Python program ends you can type commands at the <code>&gt;&gt;&gt;</code> prompt.</p>`;
    for (const btn of card.querySelectorAll<HTMLButtonElement>("[data-load]")) {
      btn.addEventListener("click", () => void importProgram(editor.part(btn.dataset.load ?? "")));
    }
    for (const btn of card.querySelectorAll<HTMLButtonElement>("[data-source]")) {
      btn.addEventListener("click", () => {
        const [board = "", ...rest] = (btn.dataset.source ?? "").split("/");
        exampleSource(board, rest.join("/"))
          .then((s) => showSource(s, setStatus))
          .catch((e) => showError(errorText(e)));
      });
    }
    for (const btn of card.querySelectorAll<HTMLButtonElement>("[data-remove]")) {
      btn.addEventListener("click", () => {
        const id = btn.dataset.remove ?? "";
        editor.setProps(id, { program: null, programName: null, programBytes: null, programPath: null, programModified: null });
        setStatus("Program removed.");
      });
    }
  };

  // The Serial Monitor / Shell height: drag its top edge, like Arduino IDE and Thonny.
  {
    const stage = $("#stage");
    const grip = $("#serial-grip");
    const setHeight = (h: number): void => {
      const max = Math.max(80, stage.clientHeight - 120);
      const v = Math.round(Math.min(max, Math.max(60, h)));
      stage.style.setProperty("--serial-h", `${v}px`);
      try {
        localStorage.setItem("serialHeight", String(v));
      } catch {
        // Not saved; the height still applies now.
      }
    };
    try {
      const saved = Number(localStorage.getItem("serialHeight"));
      if (saved > 0) stage.style.setProperty("--serial-h", `${saved}px`);
    } catch {
      // Use the normal height.
    }
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      grip.classList.add("dragging");
      const move = (ev: PointerEvent): void => setHeight(stage.getBoundingClientRect().bottom - ev.clientY);
      const up = (): void => {
        grip.classList.remove("dragging");
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", up);
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);
    });
    grip.addEventListener("dblclick", () => setHeight(140));
  }

  $("#serial-send").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#serial-input") as HTMLInputElement;
    const board = programBoard();
    if (!programMode || !board?.props.program) {
      setStatus("Start the simulation with a program on the board first (F5).", true);
      return;
    }
    runSerial(board.id, `${input.value}\n`).catch((err) => showError(errorText(err)));
    input.value = "";
  });

  const showShortcuts = (): void => {
    void ask("Keyboard and mouse", SHORTCUTS.map(([k, d]) => `${k}: ${d}`).join("\n"), [{ id: "ok", label: "OK", primary: true }]);
  };

  const inspector = new Inspector($("#inspector"), editor, {
    snap,
    sim: () => workspace.sim,
    wireColors: WIRE_COLORS,
    setWireColor,
    breadboards: BREADBOARDS,
  });

  editor.subscribe(() => {
    void syncBreadboard();
    workspace.render();
    inspector.update();
    const hasSel = editor.selection !== null;
    const isPart = editor.selection?.type === "part";
    for (const id of ["#tb-rot-left", "#tb-rot-right", "#tb-flip-h", "#tb-flip-v"]) ($(id) as HTMLButtonElement).disabled = !isPart;
    ($("#tb-delete") as HTMLButtonElement).disabled = !hasSel;
    const nets = editor.connections?.nets.filter((n) => n.pins.length > 1).length ?? 0;
    $("#routing").textContent = `${editor.project.parts.length} parts · ${editor.project.wires.length} wires · ${nets} connections`;
    const name = `${editor.name}${editor.dirty ? " •" : ""}`;
    $("#project-name").textContent = name;
    const title = `${name} - VSA Simulator`;
    if (title !== lastTitle) {
      lastTitle = title;
      win.setTitle(title).catch(() => undefined);
    }
    if (!$("#code-view").hidden) renderCode();
    updateSerialTitle();
    const why = simBlocker();
    const simBtn = $("#btn-sim") as HTMLButtonElement;
    simBtn.disabled = !running && why !== null;
    simBtn.title = why ?? (running ? "Stop the simulation (Esc or F5)" : "Start the simulation (F5)");
    if (running && why) {
      setRunning(false);
      setStatus(why, true);
    } else if (running) void resimulate();
    else {
      const warn = editor.connections?.warnings[0];
      if (warn) setStatus(warn, true);
    }
  });

  // ---- Files ----

  /** Asks to save unsaved work. Returns false if the student cancels. */
  const confirmLeave = async (): Promise<boolean> => {
    if (!editor.dirty) return true;
    const a = await ask("Save your changes?", `"${editor.name}" has changes that are not saved yet.`, [
      { id: "save", label: "Save", primary: true },
      { id: "discard", label: "Don't save" },
      { id: "cancel", label: "Cancel" },
    ]);
    if (a === "save") return save(false);
    return a === "discard";
  };

  const save = async (saveAs: boolean): Promise<boolean> => {
    if (closed) return false;
    try {
      const r = await saveProject(editor.project, saveAs ? null : editor.path);
      if (!r) return false;
      editor.markSaved(r[0], r[1]);
      setStatus(`Saved to ${r[0]}`);
      void loadRecent();
      return true;
    } catch (e) {
      showError(errorText(e));
      return false;
    }
  };

  const open = async (path?: string): Promise<void> => {
    if (!(await confirmLeave())) return;
    try {
      const r = path ? await openRecent(path) : await openProject();
      if (!r) return;
      setRunning(false);
      setClosed(false);
      editor.load(r.project, r.path, r.name);
      resetSerial();
      setStatus(`Opened ${r.path}`);
      requestAnimationFrame(() => workspace.fit());
    } catch (e) {
      showError(errorText(e));
    }
    void loadRecent();
  };

  /** File > Examples: opens a ready-made circuit with its program, as a new unsaved project. */
  const openExample = async (board: string, id: string): Promise<void> => {
    if (!(await confirmLeave())) return;
    try {
      const r = await exampleOpen(board, id);
      setRunning(false);
      setClosed(false);
      editor.load(r.project, null, r.name);
      resetSerial();
      setStatus(`Opened example ${r.name}. Press Simulate (F5), or choose Source code in the Code tab to read the program.`);
      requestAnimationFrame(() => workspace.fit());
      if (!esp8266Ready && needsEsp8266Firmware(r.project)) esp8266Ready = await ensureEsp8266Firmware(setStatus);
    } catch (e) {
      showError(errorText(e));
    }
  };

  const blank = (): ReturnType<typeof newProject> => ({ ...newProject(), breadboard: prefs.breadboard });

  /** After File > Close the work area is empty until File > New or File > Open. */
  const setClosed = (on: boolean): void => {
    closed = on;
    document.body.classList.toggle("no-project", on);
  };
  const fresh = async (closing = false): Promise<void> => {
    if (!(await confirmLeave())) return;
    setRunning(false);
    editor.load(blank(), null, "Untitled");
    setClosed(closing);
    resetSerial();
    setStatus(closing ? "Project closed. Use File > New or File > Open to start again." : "New project.");
    requestAnimationFrame(() => workspace.fit());
  };

  void win.onCloseRequested(async (event) => {
    if (!editor.dirty) return;
    event.preventDefault();
    if (await confirmLeave()) await win.destroy();
  });


  // ---- Export as picture ----

  const exportPicture = async (): Promise<void> => {
    const f = await askForm(
      "Export as picture",
      [
        {
          id: "format",
          label: "Format",
          type: "select",
          value: prefs.exportFormat,
          options: [
            ["png", "PNG, see-through background"],
            ["jpg", "JPG, white background"],
          ],
        },
        {
          id: "dpi",
          label: "Resolution",
          type: "select",
          value: String(prefs.exportDpi),
          options: [
            ["300", "300 dpi"],
            ["400", "400 dpi"],
            ["500", "500 dpi"],
            ["600", "600 dpi (sharpest)"],
          ],
          hint: "Dots per inch. Higher is sharper when printed, and makes a bigger file.",
        },
      ],
      "Export…",
    );
    if (!f) return;
    const format = f.format === "jpg" ? "jpg" : "png";
    const dpi = Math.min(600, Math.max(300, Number(f.dpi) || 300));
    updatePrefs({ exportFormat: format, exportDpi: dpi });
    const pic = workspace.exportSvg("VSA Simulator");
    if (!pic) {
      setStatus("There is nothing to export yet.", true);
      return;
    }
    setStatus("Making the picture…");
    try {
      const bytes = await rasterise(pic.svg, pic.width, pic.height, dpi, format);
      const path = await exportImage(bytes, format, editor.name);
      setStatus(path ? `Picture saved to ${path}` : "Export cancelled.");
    } catch (e) {
      showError(errorText(e));
    }
  };

  // ---- Variable DC supply properties ----

  const showSupply = async (id: string): Promise<void> => {
    const p = editor.part(id);
    if (!p) return;
    const f = await askForm(
      `${editor.label(p)} properties`,
      [
        { id: "volts", label: "Voltage", type: "number", value: p.props.volts ?? "5", min: 0, max: 30, step: 0.1, unit: "V", hint: "0 to 30 V. Logic ICs (74xx) and 5 V modules need 5 V." },
        {
          id: "current",
          label: "Current limit",
          type: "number",
          value: p.props.current ?? "1",
          min: 0.01,
          max: 5,
          step: 0.01,
          unit: "A",
          hint: "0.01 to 5 A. Above this the supply holds the current and the CC light comes on.",
        },
      ],
      "Apply",
    );
    if (!f) return;
    const clamp = (x: unknown, lo: number, hi: number, d: number): string => {
      const n = Number(x);
      return String(Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d);
    };
    editor.setProps(id, { volts: clamp(f.volts, 0, 30, 5), current: clamp(f.current, 0.01, 5, 1) });
    setStatus(`${editor.label(p)} set to ${clamp(f.volts, 0, 30, 5)} V, limit ${clamp(f.current, 0.01, 5, 1)} A.`);
  };

  // ---- Preferences window ----

  const showPrefs = async (): Promise<void> => {
    const f = await askForm(
      "Preferences",
      [
        { id: "alignToGrid", label: "Align to grid", type: "check", value: prefs.alignToGrid, hint: "Parts snap to the 0.1 inch grid and into breadboard holes." },
        { id: "curvyWires", label: "Curvy wires", type: "check", value: prefs.curvyWires, hint: "New wires are drawn as smooth curves instead of straight lines." },
        { id: "showGrid", label: "Show grid", type: "check", value: prefs.showGrid },
        { id: "buzzerSound", label: "Buzzer sound", type: "check", value: prefs.buzzerSound },
        {
          id: "autoReload",
          label: "Reload programs when they change",
          type: "check",
          value: prefs.autoReload,
          hint: "A new export from the Arduino IDE is loaded by itself.",
        },
        {
          id: "breadboard",
          label: "Breadboard for new projects",
          type: "select",
          value: prefs.breadboard,
          options: BREADBOARDS.map(([k, n]) => [k, n]),
        },
      ],
      "Save",
    );
    if (!f) return;
    const wasAligned = prefs.alignToGrid;
    const bb = BREADBOARDS.find(([k]) => k === f.breadboard)?.[0] ?? prefs.breadboard;
    updatePrefs({
      curvyWires: f.curvyWires === true,
      showGrid: f.showGrid === true,
      buzzerSound: f.buzzerSound === true,
      autoReload: f.autoReload === true,
      breadboard: bb,
    });
    const align = f.alignToGrid === true;
    if (align !== wasAligned) setAlign(align);
    else setStatus("Preferences saved.");
  };

  // ---- Recent projects ----

  let recent: RecentFile[] = [];
  const loadRecent = async (): Promise<void> => {
    try {
      recent = await recentFiles();
    } catch {
      recent = [];
    }
  };
  const folderOf = (path: string): string => {
    const parts = path.split(/[\\/]/);
    return parts.length > 1 ? (parts[parts.length - 2] ?? "") : "";
  };
  let examples: ExampleBoard[] = [];
  exampleCatalog()
    .then((list) => {
      examples = list;
    })
    .catch(() => {
      examples = [];
    });
  const exampleItems = (): MenuItem[] =>
    examples.map(
      (b): MenuItem => ({
        label: b.name,
        submenu: () => b.items.map((i): MenuItem => ({ label: i.title, action: () => void openExample(b.id, i.id) })),
      }),
    );
  const recentItems = (): MenuItem[] => [
    ...recent.map((r, i): MenuItem => ({ label: `${i + 1}  ${r.name}`, shortcut: folderOf(r.path), action: () => void open(r.path) })),
    "-",
    {
      label: "Clear recent list",
      action: () => {
        recent = [];
        clearRecent().catch((e) => showError(errorText(e)));
      },
    },
  ];

  // ---- Programs that change on disk ----

  // When the Arduino IDE exports the program again, load the new one. A
  // running board restarts with it, like a real upload.
  let checking = false;
  const checkPrograms = async (): Promise<void> => {
    if (checking || document.hidden || !prefs.autoReload) return;
    checking = true;
    try {
      for (const b of editor.project.parts) {
        const path = b.props.programPath;
        if (!PROGRAM_BOARDS.has(b.kind) || !path) continue;
        const prog = await refreshProgram(path, Number(b.props.programModified ?? "0"));
        const cur = editor.part(b.id);
        if (!prog || !cur || cur.props.programPath !== path) continue;
        if (prog.hex === cur.props.program) {
          // Saved again with the same program: just remember the new time.
          editor.setProp(cur.id, "programModified", String(prog.modified), false);
          continue;
        }
        editor.setProps(cur.id, {
          program: prog.hex,
          programName: prog.name,
          programBytes: String(prog.bytes),
          programModified: String(prog.modified),
        });
        if (programMode) appendSerial(`\n--- New program loaded: ${prog.name} ---\n`);
        setStatus(`New ${prog.name} loaded on ${editor.label(cur)}${running ? " and restarted" : ""}.`);
      }
    } catch {
      // A file in the middle of being written: try again next time.
    } finally {
      checking = false;
    }
  };
  window.setInterval(() => void checkPrograms(), 1000);

  // ---- Pause while nobody is looking ----

  const syncPause = async (): Promise<void> => {
    let hidden = document.hidden;
    try {
      hidden = hidden || (await win.isMinimized());
    } catch {
      // Keep the page's own idea of being hidden.
    }
    if (programMode) runPause(hidden).catch(() => undefined);
    if (!hidden) void checkPrograms();
  };
  document.addEventListener("visibilitychange", () => void syncPause());
  void win.onResized(() => void syncPause());

  // ---- Menus ----

  const hasPart = (): boolean => selectedPart() !== null;
  const hasWire = (): boolean => selectedWire() !== null;
  const wireColorItems = (): MenuItem[] =>
    WIRE_COLORS.map(([n, c]) => ({
      label: n,
      color: c,
      checked: () => {
        const id = selectedWire();
        return id ? editor.wire(id)?.color === c : workspace.wireColor === c;
      },
      action: () => setWireColor(c),
    }));
  const rotateItems = (): MenuItem[] => [
    { label: "Rotate 45° clockwise", shortcut: "Ctrl+Alt+R", enabled: hasPart, action: () => rotate(45) },
    { label: "Rotate 90° clockwise", shortcut: "Ctrl+R", enabled: hasPart, action: () => rotate(90) },
    { label: "Rotate 180°", enabled: hasPart, action: () => rotate(180) },
    { label: "Rotate 90° anticlockwise", shortcut: "Ctrl+Shift+R", enabled: hasPart, action: () => rotate(-90) },
    { label: "Rotate 45° anticlockwise", enabled: hasPart, action: () => rotate(-45) },
    { label: "Set angle…", enabled: hasPart, action: () => void setAngle() },
  ];
  const partItems = (): MenuItem[] => [
    ...rotateItems(),
    "-",
    { label: "Flip horizontal", enabled: hasPart, action: () => flip("h") },
    { label: "Flip vertical", enabled: hasPart, action: () => flip("v") },
    "-",
    { label: "Bring to front", enabled: hasPart, action: () => editor.reorderPart(selectedPart() ?? "", true) },
    { label: "Send to back", enabled: hasPart, action: () => editor.reorderPart(selectedPart() ?? "", false) },
    "-",
    { label: "Duplicate", shortcut: "Ctrl+D", enabled: hasPart, action: duplicate },
    { label: "Delete", shortcut: "Del", enabled: hasPart, action: deleteSelected },
  ];
  const wireItems = (): MenuItem[] => {
    const id = selectedWire();
    const w = id ? editor.wire(id) : undefined;
    return [
      { label: "Wire colour", submenu: wireColorItems },
      "-",
      { label: "Straight", enabled: hasWire, checked: () => w?.curved === false, action: () => w && editor.setWireCurved(w.id, false) },
      { label: "Curved", enabled: hasWire, checked: () => w?.curved === true, action: () => w && editor.setWireCurved(w.id, true) },
      { label: "Remove all bends", enabled: () => (w?.points.length ?? 0) > 0, action: () => w && editor.setWirePoints(w.id, []) },
      "-",
      {
        label: "New wires are curved",
        checked: () => workspace.curvyWires,
        action: () => {
          updatePrefs({ curvyWires: !workspace.curvyWires });
          setStatus(workspace.curvyWires ? "New wires will be curved." : "New wires will be straight.");
        },
      },
      "-",
      { label: "Delete wire", shortcut: "Del", enabled: hasWire, action: deleteSelected },
    ];
  };
  const removeBreadboard = (): void => {
    editor.setBreadboard("none");
    setStatus("Breadboard deleted. Wire the parts to each other directly. View > Breadboard brings one back; Undo also works.");
  };
  const viewItems = (): MenuItem[] => [
    { label: "Breadboard view", shortcut: "Ctrl+1", checked: () => $("#tab-bb").classList.contains("active"), action: () => showTab(false) },
    { label: "Code view", checked: () => $("#tab-code").classList.contains("active"), action: () => showTab(true) },
    "-",
    { label: "Zoom in", shortcut: "Ctrl++", action: () => workspace.zoomBy(1.25) },
    { label: "Zoom out", shortcut: "Ctrl+-", action: () => workspace.zoomBy(0.8) },
    { label: "Fit in window", shortcut: "Ctrl+0", action: () => workspace.fit() },
    { label: "Actual size", action: () => workspace.actualSize() },
    "-",
    {
      label: "Show grid",
      checked: () => !document.body.classList.contains("no-grid"),
      action: () => updatePrefs({ showGrid: !prefs.showGrid }),
    },
    {
      label: "Breadboard",
      submenu: () =>
        BREADBOARDS.map(([k, n]) => ({ label: n, checked: () => editor.project.breadboard === k, action: () => editor.setBreadboard(k) })),
    },
    { label: "Delete breadboard", enabled: () => !closed && editor.project.breadboard !== "none", action: removeBreadboard },
    "-",
    { label: "Serial Monitor", shortcut: "Ctrl+Shift+M", checked: serialShown, action: () => toggleSerial() },
    { label: "Parts bin", checked: () => paneShown("parts"), action: () => togglePane("parts") },
    { label: "Inspector", checked: () => paneShown("inspector"), action: () => togglePane("inspector") },
    "-",
    { label: "Presentation mode", shortcut: "F11", checked: presenting, action: () => void togglePresent() },
  ];

  /** Enables a program loader only while a board of that kind is placed. */
  const placed = (kinds: Set<string>) => (): boolean => editor.project.parts.some((p) => kinds.has(p.kind));

  buildMenuBar($("#menubar"), [
    {
      label: "File",
      items: () => [
        { label: "New", shortcut: "Ctrl+N", action: () => void fresh() },
        { label: "Open…", shortcut: "Ctrl+O", action: () => void open() },
        { label: "Recent", enabled: () => recent.length > 0, submenu: recentItems },
        { label: "Examples", enabled: () => examples.length > 0, submenu: exampleItems },
        { label: "Close", shortcut: "Ctrl+W", action: () => void fresh(true) },
        "-",
        { label: "Save", shortcut: "Ctrl+S", action: () => void save(false) },
        { label: "Save as…", shortcut: "Ctrl+Shift+S", action: () => void save(true) },
        "-",
        { label: "Export as picture (PNG/JPG)…", shortcut: "Ctrl+E", action: () => void exportPicture() },
        { label: "Load Arduino Uno / Nano / Mega program (.hex)…", enabled: placed(AVR_BOARDS), action: () => void importProgram(undefined, AVR_BOARDS) },
        { label: "Load ESP32 / ESP8266 program (.bin or .py)…", enabled: placed(ESP_BOARDS), action: () => void importProgram(undefined, ESP_BOARDS) },
        {
          label: "ESP8266 MicroPython firmware…",
          action: () =>
            void showFirmware(false, setStatus).then((ok) => {
              if (ok) esp8266Ready = true;
            }),
        },
        { label: "Load Pico W program (.py)…", enabled: placed(PY_BOARDS), action: () => void importProgram(undefined, PY_BOARDS) },
        { label: "Load 8051 program (.hex)…", enabled: placed(MCS51_KINDS), action: () => void importProgram(undefined, MCS51_KINDS) },
        { label: "Load ATmega program (.hex)…", enabled: placed(AVR_KINDS), action: () => void importProgram(undefined, AVR_KINDS) },
        "-",
        { label: "Preferences…", shortcut: "Ctrl+,", action: () => void showPrefs() },
        "-",
        { label: "Exit", shortcut: "Alt+F4", action: () => void win.close() },
      ],
    },
    {
      label: "Edit",
      items: () => [
        { label: "Undo", shortcut: "Ctrl+Z", enabled: () => editor.canUndo, action: () => editor.undo() },
        { label: "Redo", shortcut: "Ctrl+Y", enabled: () => editor.canRedo, action: () => editor.redo() },
        "-",
        { label: "Duplicate", shortcut: "Ctrl+D", enabled: hasPart, action: duplicate },
        { label: "Delete", shortcut: "Del", enabled: () => editor.selection !== null, action: deleteSelected },
        { label: "Delete breadboard", enabled: () => !closed && editor.project.breadboard !== "none", action: removeBreadboard },
        "-",
        { label: "Select none", shortcut: "Esc", enabled: () => editor.selection !== null, action: () => editor.select(null) },
        "-",
        { label: "Align to grid", checked: () => prefs.alignToGrid, action: () => setAlign(!prefs.alignToGrid) },
      ],
    },
    { label: "Part", items: partItems },
    { label: "Wire", items: wireItems },
    { label: "View", items: viewItems },
    {
      label: "Simulate",
      items: () => [
        {
          label: running ? "Stop simulation" : "Start simulation",
          shortcut: running ? "Esc" : "F5",
          enabled: () => running || simBlocker() === null,
          action: () => setRunning(!running),
        },
        { label: "Reset burnt parts", enabled: () => running && burnt.size > 0, action: () => setRunning(true) },
        "-",
        { label: "Buzzer sound", checked: () => soundOn, action: () => updatePrefs({ buzzerSound: !soundOn }) },
      ],
    },
    {
      label: "Help",
      items: () => [
        { label: "User Guide", shortcut: "F1", action: () => showHelp(showError) },
        { label: "Keyboard and mouse…", action: showShortcuts },
        "-",
        { label: "About VSA Simulator", action: () => void showAbout(showError) },
      ],
    },
  ]);

  contextMenu = (x, y) => {
    const sel = editor.selection;
    if (sel?.type === "part") showContextMenu(partItems(), x, y);
    else if (sel?.type === "wire") showContextMenu(wireItems(), x, y);
    else showContextMenu(viewItems(), x, y);
  };

  // ---- Buttons and keys ----

  $("#tab-bb").addEventListener("click", () => showTab(false));
  $("#tab-code").addEventListener("click", () => showTab(true));
  $("#tb-rot-left").addEventListener("click", () => rotate(-90));
  $("#tb-rot-right").addEventListener("click", () => rotate(90));
  $("#tb-flip-h").addEventListener("click", () => flip("h"));
  $("#tb-flip-v").addEventListener("click", () => flip("v"));
  $("#tb-delete").addEventListener("click", deleteSelected);
  $("#btn-sim").addEventListener("click", () => setRunning(!running));
  $("#tb-zoom-in").addEventListener("click", () => workspace.zoomBy(1.25));
  $("#tb-zoom-out").addEventListener("click", () => workspace.zoomBy(0.8));
  $("#tb-fit").addEventListener("click", () => workspace.fit());
  $("#tb-actual").addEventListener("click", () => workspace.actualSize());
  $("#btn-serial-close").addEventListener("click", () => toggleSerial(false));
  $("#btn-serial-clear").addEventListener("click", () => {
    if (running && programMode) {
      serialBody.textContent = "";
      serialFresh = false;
    } else resetSerial();
  });
  $("#btn-parts-close").addEventListener("click", () => togglePane("parts", false));
  $("#btn-inspector-close").addEventListener("click", () => togglePane("inspector", false));
  $("#btn-serial-open").addEventListener("click", () => toggleSerial(true));

  document.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    // Esc stops the simulation, even while typing in the Serial Monitor.
    if (e.key === "Escape" && running && !menuOpen() && !document.querySelector("dialog[open]") && !workspace.cancelWire()) {
      setRunning(false);
      e.preventDefault();
      return;
    }
    if (e.key === "F1" && !document.querySelector("dialog[open]")) {
      showHelp(showError);
      e.preventDefault();
      return;
    }
    if (e.key === "F11" && !document.querySelector("dialog[open]")) {
      void togglePresent();
      e.preventDefault();
      return;
    }
    if (t.tagName === "INPUT" || t.tagName === "SELECT" || menuOpen() || document.querySelector("dialog[open]")) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === "z" && !e.shiftKey) editor.undo();
    else if (ctrl && (k === "y" || (k === "z" && e.shiftKey))) editor.redo();
    else if (ctrl && k === "s") void save(e.shiftKey);
    else if (ctrl && k === "o") void open();
    else if (ctrl && k === "n") void fresh();
    else if (ctrl && k === "w") void fresh(true);
    else if (ctrl && k === "e") void exportPicture();
    else if (ctrl && k === ",") void showPrefs();
    else if (ctrl && k === "d") duplicate();
    else if (ctrl && e.shiftKey && k === "m") toggleSerial();
    else if (ctrl && (k === "=" || k === "+")) workspace.zoomBy(1.25);
    else if (ctrl && k === "-") workspace.zoomBy(0.8);
    else if (ctrl && k === "0") workspace.fit();
    else if (ctrl && k === "1") workspace.actualSize();
    else if (ctrl && e.altKey && k === "r") rotate(45);
    else if (ctrl && e.shiftKey && k === "r") rotate(-90);
    else if (!e.altKey && k === "r") rotate(90);
    else if (!ctrl && (k === "delete" || k === "backspace")) deleteSelected();
    else if (k === "f5") setRunning(!running);
    else if (k === "escape" && presenting() && !workspace.cancelWire()) void togglePresent();
    else if (k === "escape") {
      if (!workspace.cancelWire()) editor.select(null);
      setStatus("Ready");
    } else return;
    e.preventDefault();
  });
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  try {
    const info = await getAppInfo();
    $("#status-version").textContent = `Version ${info.version}`;
  } catch (e) {
    showError(errorText(e));
  }
  void loadRecent();
  try {
    prefs = await getPrefs();
  } catch (e) {
    showError(errorText(e));
  }
  applyPrefs();
  if (!editor.dirty && editor.project.parts.length === 0) editor.load(blank(), null, "Untitled");
  editor.notify();
  await syncBreadboard();
  inspector.update();
  workspace.fit();
  setStatus("Ready. Drag parts from the Parts bin onto the breadboard, then press Simulate.");
  // Started by double-clicking a project file: open it.
  try {
    const r = await startupProject();
    if (r) {
      setClosed(false);
      editor.load(r.project, r.path, r.name);
      resetSerial();
      setStatus(`Opened ${r.path}`);
      requestAnimationFrame(() => workspace.fit());
      void loadRecent();
    }
  } catch (e) {
    showError(errorText(e));
  }
}

main().catch((e: unknown) => {
  // Show start-up problems instead of an empty window.
  const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
  document.body.insertAdjacentHTML("beforeend", `<pre class="fatal"></pre>`);
  const pre = document.querySelector(".fatal");
  if (pre) pre.textContent = `VSA Simulator could not start:\n${msg}`;
});
