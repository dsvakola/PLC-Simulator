import "./styles.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  checkFbd,
  checkPanel,
  clearRecent,
  errorText,
  getAppInfo,
  getPanelLayout,
  getPrefs,
  newProject,
  openProject,
  openRecent,
  recentFiles,
  saveProject,
  setPrefs,
  simClock,
  simPause,
  simPress,
  simStart,
  simStop,
  simValue,
  startupProject,
  type Clock,
  type DiagramError,
  type OpenedProject,
  type Prefs,
  type Project,
  type RecentFile,
  type SimFrame,
} from "./api";
import { editBlock } from "./editor/blockDialogs";
import { FbdEditor } from "./editor/fbdEditor";
import { PALETTE, defaultLabel, findPaletteItem, type PaletteItem } from "./editor/model";
import { buildPalette } from "./editor/palette";
import { colorHex, WIRE_COLORS } from "./panel/draw";
import { editDevice, editFixed } from "./panel/panelDialogs";
import { PanelEditor } from "./panel/panelEditor";
import { buildDevicePalette } from "./panel/panelPalette";
import { setSounds } from "./panel/sound";
import { readMode, writeMode } from "./panel/inputMode";
import { showAbout } from "./ui/about";
import { ask, askForm } from "./ui/confirm";
import { showHelp } from "./ui/help";
import { makeDialogsMovable } from "./ui/movable";
import { SimStrip } from "./ui/simStrip";
import { closeContextMenu, contextMenuOpen, showContextMenu } from "./ui/contextMenu";
import { icons } from "./ui/icons";
import { buildMenuBar, menuOpen, type MenuDef, type MenuItem } from "./ui/menu";
import appIconUrl from "./assets/app-icon.svg";

const appWindow = getCurrentWindow();

// ---------- State ----------

type Tab = "program" | "panel";

const state = {
  project: null as Project | null,
  /** Where the project is saved; null for a new project. */
  path: null as string | null,
  name: "Untitled project",
  dirty: false,
  prefs: { theme: "light", showAddresses: true, showSymbols: true, curvyWires: false } as Prefs,
  recent: [] as RecentFile[],
  version: "",
  tab: "program" as Tab,
  /** Undo and redo buttons and zoom, kept for each tab. */
  history: { program: [false, false], panel: [false, false] } as Record<Tab, [boolean, boolean]>,
  zoom: { program: 100, panel: 100 } as Record<Tab, number>,
  /** The program is running on the Control Panel. */
  running: false,
  /** The supply has switched off after a short circuit. */
  tripped: false,
  /** Tools > Simulated clock: the PC clock, or a date and time set by the teacher, and its speed. */
  simClock: { usePc: true, date: "", time: "08:00", speed: 1 },
};

let editor: FbdEditor;
let panelEditor: PanelEditor | null = null;
let panelShown = false;

/** What both editors can do, so the menus and keys work on the tab in front. */
interface ActiveEditor {
  undo(): void;
  redo(): void;
  deleteSelection(): void;
  zoomBy(factor: number): void;
  setZoom(z: number): void;
  fit(): void;
  cancelDrag(): void;
  cut(): void;
  copy(): void;
  paste(): void;
  readonly hasSelection: boolean;
  readonly canCopy: boolean;
  readonly canPaste: boolean;
}
const active = (): ActiveEditor => (state.tab === "panel" && panelEditor ? panelEditor : editor);

// ---------- Small helpers ----------

function $(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Missing element ${selector}`);
  return el;
}

function setStatus(text: string, isError = false): void {
  const s = $("#status-text");
  s.textContent = text;
  s.classList.toggle("error", isError);
}
const showError = (msg: string): void => setStatus(msg, true);

// ---------- Window layout ----------

const tb = (id: string, icon: string, label: string, title: string, disabled = false): string =>
  `<button class="tool" id="${id}" title="${title}" aria-label="${label}"${disabled ? " disabled" : ""}>${icon}<span>${label}</span></button>`;

const dtb = (id: string, icon: string, title: string, disabled = false): string =>
  `<button class="tool icon-only" id="${id}" title="${title}" aria-label="${title}"${disabled ? " disabled" : ""}>${icon}</button>`;

const zoomButtons = (p: string): string =>
  `${dtb(`${p}-zoom-in`, icons.zoomIn, "Zoom in (Ctrl + mouse wheel up)")}
   ${dtb(`${p}-zoom-out`, icons.zoomOut, "Zoom out (Ctrl + mouse wheel down)")}
   ${dtb(`${p}-zoom-100`, icons.actual, "Zoom 100% (Ctrl+0)")}
   ${dtb(`${p}-fit`, icons.fit, "Fit everything in the window")}`;

function shell(): void {
  $("#app").innerHTML = `
    <header class="appbar">
      <div class="brand"><img src="${appIconUrl}" width="22" height="22" alt="" /><span>PLC Simulator</span></div>
      <nav class="menubar" id="menubar" aria-label="Main menu"></nav>
      <div class="appbar-project" id="appbar-project" title="Project name"></div>
    </header>
    <div class="toolbar" role="toolbar" aria-label="Tools">
      ${tb("tb-new", icons.newFile, "New", "New project (Ctrl+N)")}
      ${tb("tb-open", icons.open, "Open", "Open a project (Ctrl+O)")}
      ${tb("tb-save", icons.save, "Save", "Save the project (Ctrl+S)")}
      <span class="tool-sep"></span>
      ${tb("tb-undo", icons.undo, "Undo", "Undo (Ctrl+Z)", true)}
      ${tb("tb-redo", icons.redo, "Redo", "Redo (Ctrl+Y)", true)}
      <span class="tool-sep"></span>
      ${tb("tb-check", icons.check, "Check program", "Look for mistakes in the diagram")}
      ${tb("tb-check-panel", icons.check, "Check wiring", "Look for mistakes in the wiring of the panel")}
      <span class="tool-sep"></span>
      ${tb("tb-sim", icons.run, "Simulate", "Run the program on the Control Panel (F5)")}
    </div>
    <nav class="tabs" role="tablist" aria-label="Parts of the project">
      <button class="tab-btn active" id="tab-program" role="tab" aria-selected="true">${icons.program}<span>Program</span></button>
      <button class="tab-btn" id="tab-panel" role="tab" aria-selected="false">${icons.cpu}<span>Control Panel</span></button>
      <button class="tab-btn" role="tab" disabled title="The SCADA Screen comes in a later step">${icons.watch}<span>SCADA Screen</span></button>
    </nav>
    <div class="workbench" id="bench-program">
      <aside class="pane" aria-label="Tools">
        <div class="pane-head"><span>Tools</span></div>
        <div class="pane-body">
          <section class="pane-section">
            <h4>Diagrams</h4>
            <div class="diagram-item" title="The program of this project">${icons.program}<span id="diagram-name">Diagram 1</span><em id="diagram-lang">FBD</em></div>
          </section>
          <section class="pane-section">
            <h4>Instructions</h4>
            <div id="palette" class="palette"></div>
          </section>
        </div>
      </aside>
      <main class="editor" aria-label="Diagram editor">
        <div class="editor-head">Diagram Editor</div>
        <div class="diagram-bar" role="toolbar" aria-label="Diagram tools">
          ${dtb("db-select", icons.pointer, "Select and move blocks")}
          <span class="tool-sep"></span>
          ${zoomButtons("db")}
          <span class="tool-sep"></span>
          ${dtb("db-delete", icons.trash, "Delete the selected block or wire (Delete)")}
          <span class="spacer"></span>
          <span class="hint">Drag blocks from the left. Drag from the end of a pin to another pin to join them. Double-click a block for its settings. Drag a name to move it.</span>
        </div>
        <div class="canvas" id="canvas"></div>
        <div class="sim-strip" id="sim-bar" hidden aria-label="Inputs and outputs while simulating"></div>
      </main>
    </div>
    <div class="workbench right" id="bench-panel" hidden>
      <main class="editor" aria-label="Control panel">
        <div class="editor-head">Control Panel</div>
        <div class="diagram-bar" role="toolbar" aria-label="Panel tools">
          ${zoomButtons("pb")}
          <span class="tool-sep"></span>
          ${dtb("pb-delete", icons.trash, "Delete the selected device or wire (Delete)")}
          <span class="tool-sep"></span>
          <span class="bar-label">Wire colour</span>
          ${WIRE_COLORS.map((c) => `<button class="swatch" data-color="${c}" title="${c}" aria-label="${c} wire" style="--c:${colorHex(c)}"></button>`).join("")}
          <span class="spacer"></span>
          <span class="hint" id="panel-hint"></span>
        </div>
        <div class="canvas panel-canvas" id="panel-canvas"></div>
      </main>
      <aside class="pane pane-right" aria-label="Devices">
        <div class="pane-head"><span>Devices</span></div>
        <div class="pane-body">
          <section class="pane-section">
            <h4>Field devices</h4>
            <div id="device-palette" class="palette"></div>
          </section>
          <section class="pane-section">
            <h4>Wiring</h4>
            <p class="pane-note">The lamps, switches I1 to I4 and both connectors are wired to the PLC inside the panel. Wire your devices to the Q and I connectors.</p>
            <div class="wiring-actions">
              <button class="btn small" id="btn-clear-wires">Remove all wires</button>
            </div>
          </section>
        </div>
      </aside>
    </div>
    <footer class="statusbar">
      <span id="status-text">Ready</span>
      <span class="spacer"></span>
      <span id="status-zoom" title="Zoom (Ctrl + mouse wheel)">100%</span>
      <span id="status-version"></span>
    </footer>`;
}

// ---------- Drawing the window ----------

function renderTitle(): void {
  const mark = state.dirty ? " *" : "";
  $("#appbar-project").textContent = `${state.name}${mark}`;
  document.title = `${state.name}${mark} - PLC Simulator`;
  appWindow.setTitle(document.title).catch(() => undefined);
  $("#diagram-lang").textContent = (state.project?.language ?? "fbd").toUpperCase();
}

function markDirty(): void {
  state.dirty = true;
  renderTitle();
}

function showHistory(): void {
  const [u, r] = state.history[state.tab];
  ($("#tb-undo") as HTMLButtonElement).disabled = !u;
  ($("#tb-redo") as HTMLButtonElement).disabled = !r;
}

function setHistory(tab: Tab, canUndo: boolean, canRedo: boolean): void {
  state.history[tab] = [canUndo, canRedo];
  if (tab === state.tab) showHistory();
}

function setZoomText(tab: Tab, percent: number): void {
  state.zoom[tab] = percent;
  if (tab === state.tab) $("#status-zoom").textContent = `${percent}%`;
}

function setTab(tab: Tab): void {
  if (tab === "panel" && !panelEditor) {
    showError("The control panel could not be loaded.");
    return;
  }
  state.tab = tab;
  $("#bench-program").hidden = tab !== "program";
  $("#bench-panel").hidden = tab !== "panel";
  $("#tab-program").classList.toggle("active", tab === "program");
  $("#tab-panel").classList.toggle("active", tab === "panel");
  $("#tab-program").setAttribute("aria-selected", String(tab === "program"));
  $("#tab-panel").setAttribute("aria-selected", String(tab === "panel"));
  $("#tb-check").hidden = tab !== "program";
  $("#tb-check-panel").hidden = tab !== "panel";
  showHistory();
  $("#status-zoom").textContent = `${state.zoom[tab]}%`;
  // The panel is measured when it is first shown, so it can fit the window.
  if (tab === "panel" && !panelShown) {
    panelShown = true;
    panelEditor?.fit();
  }
}

// ---------- Projects ----------

// ---------- Simulation ----------

const EDIT_HINT = "Drag from a terminal to another to wire them. Drag a wire to bend it (Shift: 90°), right-click it for more. Double-click a switch I1 to I4 for its settings.";
const RUN_HINT = "Simulating: click the switches, push buttons and sensors; click a knob or PT100 for its slider.";

function showSimButton(): void {
  const b = $("#tb-sim");
  b.classList.toggle("on", state.running);
  b.innerHTML = state.running ? `${icons.stop}<span>Stop</span>` : `${icons.run}<span>Simulate</span>`;
  b.title = state.running ? "Stop the simulation (F5)" : "Run the program on the Control Panel (F5)";
  $("#panel-hint").textContent = state.running ? RUN_HINT : EDIT_HINT;
  document.body.classList.toggle("simulating", state.running);
}

let strip: SimStrip;

/** The date and time the weekly and yearly timers start from. */
function startClock(): Clock {
  const sc = state.simClock;
  const now = new Date();
  let when = now;
  if (!sc.usePc) {
    const [y, mo, da] = sc.date.split("-").map(Number);
    const [h, mi] = sc.time.split(":").map(Number);
    const t = new Date(y || now.getFullYear(), (mo || now.getMonth() + 1) - 1, da || now.getDate(), h || 0, mi || 0);
    if (!Number.isNaN(t.getTime())) when = t;
  }
  return {
    year: when.getFullYear(),
    month: when.getMonth() + 1,
    day: when.getDate(),
    weekday: (when.getDay() + 6) % 7,
    minute: when.getHours() * 60 + when.getMinutes(),
  };
}

/** Tools > Simulated clock. */
async function showClockDialog(): Promise<void> {
  const sc = state.simClock;
  const today = new Date();
  const iso = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const r = await askForm("Simulated clock", [
    {
      id: "source",
      label: "Clock",
      type: "select",
      value: sc.usePc ? "pc" : "set",
      options: [
        ["pc", "The PC's date and time"],
        ["set", "This date and time"],
      ],
      hint: "The weekly and yearly timers of the program follow this clock while simulating.",
    },
    { id: "date", label: "Date", type: "date", value: sc.date || iso(today) },
    { id: "time", label: "Time", type: "time", value: sc.time || "08:00" },
    {
      id: "speed",
      label: "Speed",
      type: "select",
      value: String(sc.speed),
      options: [
        ["1", "Real time"],
        ["60", "Fast: 1 minute every second"],
        ["3600", "Very fast: 1 hour every second"],
      ],
      hint: "Run the clock faster to test timers without waiting.",
    },
  ]);
  if (!r) return;
  state.simClock = {
    usePc: r.source !== "set",
    date: String(r.date ?? ""),
    time: String(r.time ?? "08:00"),
    speed: Number(r.speed) || 1,
  };
  if (state.running) {
    simClock(startClock(), state.simClock.speed).catch((e: unknown) => showError(errorText(e)));
    setStatus("The simulated clock was set.");
  }
}

function onFrame(f: SimFrame): void {
  if (!state.running) return;
  panelEditor?.setSim(f);
  editor.setLive(f.blocks);
  strip.update(f);
  const kinds = new Map((panelEditor?.data.devices ?? []).map((d) => [d.id, d.kind]));
  const sounding = (kind: string): boolean => f.devices.some((d) => d.on && kinds.get(d.id) === kind);
  setSounds(sounding("buzzer"), sounding("hooter"));
  if (f.tripped && !state.tripped) {
    state.tripped = true;
    showError("Short circuit! The 24 V supply has switched off. Stop the simulation, check the wiring, then run it again.");
  }
}

async function startSim(): Promise<void> {
  if (state.running || !state.project || !panelEditor) return;
  const clock = startClock();
  state.running = true;
  state.tripped = false;
  active().cancelDrag();
  try {
    await simStart(editor.diagram, panelEditor.data, clock, state.simClock.speed, onFrame);
  } catch (e) {
    state.running = false;
    showSimButton();
    if (Array.isArray(e)) {
      const errors = e as DiagramError[];
      editor.setErrors(errors);
      setTab("program");
      const nameOf = (id: number | null): string => {
        const b = editor.diagram.blocks.find((x) => x.id === id);
        return b ? `${defaultLabel(b)}: ` : "";
      };
      await report("Simulate", "", errors.map((x) => `${nameOf(x.block)}${x.message}`));
      setStatus("Correct the program first, then press Simulate again.", true);
    } else {
      showError(errorText(e));
    }
    return;
  }
  strip.start(editor.diagram, (n) => readMode(panelEditor?.fixedProps(`swI${n}`)));
  if (state.tab !== "program") setTab("panel");
  showSimButton();
  setStatus("RUN: the program is running. Use the switches on the Control Panel or the buttons under the diagram.");
}

async function stopSim(reason?: string): Promise<void> {
  if (!state.running) return;
  state.running = false;
  setSounds(false, false);
  try {
    await simStop();
  } catch (e) {
    showError(errorText(e));
  }
  panelEditor?.setSim(null);
  editor.setLive(null);
  strip.hide();
  showSimButton();
  if (reason) setStatus(reason, true);
  else setStatus("STOP: the simulation has stopped. You can change the program and the wiring again.");
}

const toggleSim = (): Promise<void> => (state.running ? stopSim() : startSim());

function load(opened: OpenedProject | { path: null; name: string; project: Project }): void {
  state.project = opened.project;
  state.path = opened.path || null;
  state.name = opened.name;
  state.dirty = false;
  opened.project.panel ??= { devices: [], wires: [], fixedProps: {} };
  editor.setDiagram(opened.project.fbd);
  panelEditor?.setPanel(opened.project.panel);
  if (panelEditor && panelShown) panelEditor.fit();
  renderTitle();
}

async function refreshRecent(): Promise<void> {
  try {
    state.recent = await recentFiles();
  } catch {
    state.recent = [];
  }
}

/** Saves; returns false if the student cancelled or saving failed. */
async function save(as: boolean): Promise<boolean> {
  if (!state.project) return false;
  try {
    const r = await saveProject(state.project, as ? null : state.path);
    if (!r) return false;
    [state.path, state.name] = r;
    state.dirty = false;
    renderTitle();
    setStatus(`Saved ${state.path}`);
    await refreshRecent();
    return true;
  } catch (e) {
    showError(errorText(e));
    return false;
  }
}

/** Asks about unsaved changes. True when it is fine to go on. */
async function confirmDiscard(): Promise<boolean> {
  if (!state.dirty) return true;
  const answer = await ask("Save changes?", `Do you want to save the changes to "${state.name}" first?`, [
    { id: "save", label: "Save", primary: true },
    { id: "discard", label: "Don't save" },
    { id: "cancel", label: "Cancel" },
  ]);
  if (answer === "save") return save(false);
  return answer === "discard";
}

async function doNew(): Promise<void> {
  if (!(await confirmDiscard())) return;
  await stopSim();
  try {
    load({ path: null, name: "Untitled project", project: await newProject() });
    setStatus("New project");
  } catch (e) {
    showError(errorText(e));
  }
}

async function doOpen(path?: string): Promise<void> {
  if (!(await confirmDiscard())) return;
  await stopSim();
  try {
    const opened = path ? await openRecent(path) : await openProject();
    if (!opened) return;
    load(opened);
    setStatus(`Opened ${opened.path}`);
  } catch (e) {
    showError(errorText(e));
  }
  await refreshRecent();
}

// ---------- The diagram and the panel ----------

function addItem(item: PaletteItem): void {
  editor.addAtFreeSpot(item.make(editor.diagram));
  setStatus(`${item.name} added. Drag it where you want it.`);
}

async function editBlockById(id: number): Promise<void> {
  const b = editor.diagram.blocks.find((x) => x.id === id);
  if (!b) return;
  const r = await editBlock(b, (n) => readMode(panelEditor?.fixedProps(`swI${n}`)));
  if (!r) return;
  if (state.running) await stopSim("The simulation stopped because the program was changed. Press Simulate to run the new program.");
  editor.applyEdit(id, r.kind, r.label, r.resetNames);
  // The simulation mode of I1 to I4 is shared with the board switches.
  if (r.mode && r.kind.k === "input" && panelEditor) {
    const key = `swI${r.kind.n}`;
    const old = panelEditor.fixedProps(key);
    const next = writeMode(old, r.mode);
    if (JSON.stringify(old) !== JSON.stringify(next)) panelEditor.applyFixedEdit(key, next);
  }
}

async function report(title: string, ok: string, lines: string[], warnings: string[] = []): Promise<void> {
  if (lines.length === 0 && warnings.length === 0) {
    setStatus("No mistakes found.");
    await ask(title, ok, [{ id: "ok", label: "OK", primary: true }]);
    return;
  }
  const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (lines.length > 0) showError(`${plural(lines.length, "mistake")} found.`);
  else setStatus(`No mistakes, ${plural(warnings.length, "warning")}.`);
  const parts: string[] = [];
  if (lines.length > 0) parts.push(lines.join("\n"));
  if (warnings.length > 0) parts.push(`Warnings:\n${warnings.map((w) => `• ${w}`).join("\n")}`);
  await ask(title, parts.join("\n\n"), [{ id: "ok", label: "OK", primary: true }]);
}

async function checkProgram(): Promise<void> {
  try {
    const errors = await checkFbd(editor.diagram);
    editor.setErrors(errors);
    const nameOf = (id: number | null): string => {
      const b = editor.diagram.blocks.find((x) => x.id === id);
      return b ? `${defaultLabel(b)}: ` : "";
    };
    await report("Check program", "No mistakes found. The diagram is ready for the Control Panel.", errors.map((e) => `${nameOf(e.block)}${e.message}`));
  } catch (e) {
    showError(errorText(e));
  }
}

async function checkWiring(): Promise<void> {
  if (!panelEditor) return;
  try {
    const errors = await checkPanel(panelEditor.data);
    panelEditor.setErrors(errors);
    const text = (e: (typeof errors)[number]): string => (e.wire !== null ? `Wire ${e.wire + 1}: ${e.message}` : e.message);
    await report(
      "Check wiring",
      "No mistakes found in the wiring.",
      errors.filter((e) => !e.warning).map(text),
      errors.filter((e) => e.warning).map(text),
    );
  } catch (e) {
    showError(errorText(e));
  }
}

async function editPanelTarget(t: { fixed: false; id: number } | { fixed: true; id: string }): Promise<void> {
  if (!panelEditor || state.running) return;
  if (t.fixed) {
    const f = panelLayoutFixed(t.id);
    if (!f) return;
    const props = await editFixed(f, panelEditor.fixedProps(t.id));
    if (props) panelEditor.applyFixedEdit(t.id, props);
    return;
  }
  const d = panelEditor.data.devices.find((x) => x.id === t.id);
  const def = d ? panelCatalog().find((c) => c.kind === d.kind) : undefined;
  if (!d || !def) return;
  const r = await editDevice(d, def);
  if (r) panelEditor.applyDeviceEdit(d.id, r.label, r.props);
}

let layoutCache: Awaited<ReturnType<typeof getPanelLayout>> | null = null;
const panelLayoutFixed = (id: string) => layoutCache?.fixed.find((f) => f.id === id);
const panelCatalog = () => layoutCache?.catalog ?? [];

// ---------- Settings ----------

async function applyPrefs(p: Prefs, saveThem: boolean): Promise<void> {
  state.prefs = p;
  document.documentElement.dataset.theme = p.theme;
  if (panelEditor) panelEditor.curvyWires = p.curvyWires ?? false;
  if (saveThem) {
    try {
      state.prefs = await setPrefs(p);
    } catch (e) {
      showError(errorText(e));
    }
  }
}

async function showOptions(): Promise<void> {
  const r = await askForm("Options", [
    {
      id: "theme",
      label: "Colour theme",
      type: "select",
      value: state.prefs.theme,
      options: [
        ["light", "Light (classroom projector)"],
        ["dark", "Dark (control room)"],
      ],
      hint: "The drawing area always stays white, so the black block borders show well.",
    },
    {
      id: "curvyWires",
      label: "New wires on the Control Panel are curvy",
      type: "check",
      value: state.prefs.curvyWires ?? false,
      hint: "Otherwise new wires are straight. Right-click a wire to change it later.",
    },
  ]);
  if (!r) return;
  await applyPrefs({ ...state.prefs, theme: r.theme === "dark" ? "dark" : "light", curvyWires: r.curvyWires === true }, true);
}

async function toggleFullscreen(): Promise<void> {
  try {
    await appWindow.setFullscreen(!(await appWindow.isFullscreen()));
  } catch (e) {
    showError(errorText(e));
  }
}

function showShortcuts(): void {
  const rows: Array<[string, string]> = [
    ["Ctrl+N / Ctrl+O / Ctrl+S", "New, open, save project"],
    ["Ctrl+Shift+S", "Save as"],
    ["Ctrl+Z / Ctrl+Y", "Undo, redo"],
    ["Delete", "Delete the selected blocks, device or wire"],
    ["Ctrl+A", "Select every block of the program, to move them together"],
    ["Ctrl+X / Ctrl+C / Ctrl+V", "Cut, copy, paste blocks (or a device on the Control Panel)"],
    ["Right-click", "A menu with what can be done there"],
    ["Esc", "Stop the simulation, or cancel a wire being drawn"],
    ["Shift + click", "Add a block to the selection"],
    ["Middle mouse button", "Move the view"],
    ["Ctrl + mouse wheel", "Zoom in and out"],
    ["Ctrl+0", "Zoom 100%"],
    ["F5", "Simulate: run or stop the program on the Control Panel"],
    ["Ctrl++ / Ctrl+-", "Zoom in, zoom out"],
    ["Double-click a block or device", "Its settings and your own name for it"],
    ["F1", "User Guide"],
    ["F11", "Full screen"],
  ];
  const d = document.createElement("dialog");
  d.className = "ask shortcuts";
  d.innerHTML = `<button class="icon-btn about-close" aria-label="Close">${icons.close}</button><h2>Keyboard shortcuts</h2>
    <table>${rows.map(([k, t]) => `<tr><td><kbd>${k}</kbd></td><td>${t}</td></tr>`).join("")}</table>`;
  d.querySelector(".about-close")?.addEventListener("click", () => d.close());
  d.addEventListener("close", () => d.remove());
  d.addEventListener("click", (e) => {
    if (e.target === d) d.close();
  });
  document.body.appendChild(d);
  d.showModal();
}

// ---------- Menus ----------

const soon = (label: string, shortcut?: string): MenuItem => ({ label, shortcut, enabled: () => false });

function menus(): MenuDef[] {
  return [
    {
      label: "File",
      items: () => [
        { label: "New project", shortcut: "Ctrl+N", action: () => void doNew() },
        { label: "Open…", shortcut: "Ctrl+O", action: () => void doOpen() },
        {
          label: "Open recent",
          enabled: () => state.recent.length > 0,
          submenu: () => [
            ...state.recent.map((r): MenuItem => ({ label: r.name, action: () => void doOpen(r.path) })),
            "-",
            {
              label: "Clear the list",
              action: () => {
                clearRecent()
                  .then(refreshRecent)
                  .catch((e: unknown) => showError(errorText(e)));
              },
            },
          ],
        },
        "-",
        { label: "Save", shortcut: "Ctrl+S", action: () => void save(false) },
        { label: "Save as…", shortcut: "Ctrl+Shift+S", action: () => void save(true) },
        "-",
        { label: "Exit", shortcut: "Alt+F4", action: () => void appWindow.close() },
      ],
    },
    {
      label: "Edit",
      items: () => [
        { label: "Undo", shortcut: "Ctrl+Z", action: () => active().undo() },
        { label: "Redo", shortcut: "Ctrl+Y", action: () => active().redo() },
        "-",
        { label: "Cut", shortcut: "Ctrl+X", enabled: () => !state.running && active().canCopy, action: () => active().cut() },
        { label: "Copy", shortcut: "Ctrl+C", enabled: () => active().canCopy, action: () => active().copy() },
        { label: "Paste", shortcut: "Ctrl+V", enabled: () => !state.running && active().canPaste, action: () => active().paste() },
        { label: "Delete", shortcut: "Del", enabled: () => active().hasSelection, action: () => active().deleteSelection() },
        "-",
        { label: "Select all", shortcut: "Ctrl+A", enabled: () => state.tab === "program", action: () => editor.selectAll() },
      ],
    },
    {
      label: "View",
      items: () => [
        { label: "Zoom in", shortcut: "Ctrl++", action: () => active().zoomBy(1.25) },
        { label: "Zoom out", shortcut: "Ctrl+-", action: () => active().zoomBy(0.8) },
        { label: "Zoom 100%", shortcut: "Ctrl+0", action: () => active().setZoom(1) },
        { label: "Fit in window", action: () => active().fit() },
        "-",
        {
          label: "Theme",
          submenu: () => [
            {
              label: "Light (classroom projector)",
              checked: () => state.prefs.theme === "light",
              action: () => void applyPrefs({ ...state.prefs, theme: "light" }, true),
            },
            {
              label: "Dark (control room)",
              checked: () => state.prefs.theme === "dark",
              action: () => void applyPrefs({ ...state.prefs, theme: "dark" }, true),
            },
          ],
        },
        "-",
        { label: "Full screen", shortcut: "F11", action: () => void toggleFullscreen() },
      ],
    },
    {
      label: "Insert",
      items: () =>
        state.tab === "panel" && panelEditor
          ? panelCatalog().map(
              (c): MenuItem => ({
                label: c.name,
                enabled: () => !state.running,
                action: () => {
                  panelEditor?.addAtFreeSpot(c.kind);
                  setStatus(`${c.name} added. Drag it where you want it.`);
                },
              }),
            )
          : PALETTE.map(
              (g): MenuItem => ({
                label: g.title,
                submenu: () => g.items.map((i): MenuItem => ({ label: i.name, action: () => addItem(i) })),
              }),
            ),
    },
    {
      label: "PLC",
      items: () => [
        { label: "Check program", action: () => void checkProgram() },
        { label: "Check wiring", action: () => void checkWiring() },
        "-",
        { label: "Remove all wires", enabled: () => !state.running && (panelEditor?.wireCount ?? 0) > 0, action: () => panelEditor?.removeAllWires() },
        "-",
        { label: "Switch to RUN", shortcut: "F5", enabled: () => !state.running, action: () => void startSim() },
        { label: "Switch to STOP", shortcut: "F5", enabled: () => state.running, action: () => void stopSim() },
      ],
    },
    {
      label: "Simulation",
      items: () => [
        { label: "Simulate on the Control Panel", shortcut: "F5", checked: () => state.running, action: () => void toggleSim() },
        "-",
        soon("Allow SCADA connection from another PC"),
      ],
    },
    {
      label: "Tools",
      items: () => [{ label: "Simulated clock…", action: () => void showClockDialog() }, "-", { label: "Options…", action: () => void showOptions() }],
    },
    {
      label: "Help",
      items: () => [
        { label: "User Guide", shortcut: "F1", action: () => showHelp(showError) },
        { label: "Keyboard shortcuts", action: showShortcuts },
        "-",
        { label: "About PLC Simulator", action: () => void showAbout(showError) },
      ],
    },
  ];
}

// ---------- Events ----------

const typing = (): boolean => {
  const a = document.activeElement;
  return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement;
};

function wire(): void {
  $("#tb-new").addEventListener("click", () => void doNew());
  $("#tb-open").addEventListener("click", () => void doOpen());
  $("#tb-save").addEventListener("click", () => void save(false));
  $("#tb-undo").addEventListener("click", () => active().undo());
  $("#tb-redo").addEventListener("click", () => active().redo());
  $("#tb-check").addEventListener("click", () => void checkProgram());
  $("#tb-check-panel").addEventListener("click", () => void checkWiring());
  $("#tb-sim").addEventListener("click", () => void toggleSim());
  $("#tab-program").addEventListener("click", () => setTab("program"));
  $("#tab-panel").addEventListener("click", () => setTab("panel"));
  for (const p of ["db", "pb"]) {
    $(`#${p}-zoom-in`).addEventListener("click", () => active().zoomBy(1.25));
    $(`#${p}-zoom-out`).addEventListener("click", () => active().zoomBy(0.8));
    $(`#${p}-zoom-100`).addEventListener("click", () => active().setZoom(1));
    $(`#${p}-fit`).addEventListener("click", () => active().fit());
    $(`#${p}-delete`).addEventListener("click", () => active().deleteSelection());
  }
  $("#btn-clear-wires").addEventListener("click", () => panelEditor?.removeAllWires());
  for (const sw of document.querySelectorAll<HTMLElement>(".swatch")) {
    sw.addEventListener("click", () => {
      const color = sw.dataset.color ?? "yellow";
      panelEditor?.setWireColor(color);
      for (const o of document.querySelectorAll(".swatch")) o.classList.toggle("on", o === sw);
    });
  }
  document.querySelector<HTMLElement>('.swatch[data-color="yellow"]')?.classList.add("on");

  document.addEventListener("keydown", (e) => {
    if (menuOpen() || document.querySelector("dialog[open]")) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    let handled = true;
    if (ctrl && key === "n") void doNew();
    else if (ctrl && key === "o") void doOpen();
    else if (ctrl && e.shiftKey && key === "s") void save(true);
    else if (ctrl && key === "s") void save(false);
    else if (ctrl && key === "z" && !typing()) active().undo();
    else if (ctrl && key === "y" && !typing()) active().redo();
    else if (ctrl && key === "x" && !typing()) {
      if (!state.running) active().cut();
    } else if (ctrl && key === "c" && !typing()) active().copy();
    else if (ctrl && key === "v" && !typing()) {
      if (!state.running) active().paste();
    } else if (ctrl && key === "a" && !typing()) {
      if (state.tab === "program") editor.selectAll();
    } else if (ctrl && key === "0") active().setZoom(1);
    else if (ctrl && (key === "=" || key === "+")) active().zoomBy(1.25);
    else if (ctrl && key === "-") active().zoomBy(0.8);
    else if ((e.key === "Delete" || e.key === "Backspace") && !typing()) active().deleteSelection();
    else if (e.key === "Escape") {
      // Esc stops the simulation, as in the usual PLC software; otherwise it cancels a wire being drawn.
      if (contextMenuOpen()) closeContextMenu();
      else if (state.running) void stopSim();
      else active().cancelDrag();
    }
    else if (e.key === "F1") showHelp(showError);
    else if (e.key === "F5") void toggleSim();
    else if (e.key === "F11") void toggleFullscreen();
    // Keys the web view would otherwise use to reload, print or search the page.
    else if ((ctrl && ["r", "p", "f", "g", "u"].includes(key)) || e.key === "F3" || e.key === "F7") handled = true;
    else handled = false;
    if (handled) e.preventDefault();
  });
  // Ctrl + wheel must zoom the drawing only, never the whole page.
  window.addEventListener("wheel", (e) => e.ctrlKey && e.preventDefault(), { passive: false });
  // The web view's own right-click menu (Reload, Inspect) is not wanted, except in text boxes.
  document.addEventListener("contextmenu", (e) => {
    if (!(e.target as Element).closest("input, textarea")) e.preventDefault();
  });

  void appWindow.onCloseRequested(async (e) => {
    // As in any professional program: while a dialog is open, the main
    // window cannot be closed. The dialog gives a small shake instead.
    const open = document.querySelector<HTMLDialogElement>("dialog[open]");
    if (open) {
      e.preventDefault();
      open.classList.remove("nudge");
      void open.offsetWidth;
      open.classList.add("nudge");
      open.focus();
      return;
    }
    if (!state.dirty) return;
    e.preventDefault();
    if (await confirmDiscard()) {
      state.dirty = false;
      await appWindow.destroy();
    }
  });
}

// ---------- Start ----------

async function main(): Promise<void> {
  shell();
  makeDialogsMovable();
  buildMenuBar($("#menubar"), menus());
  editor = new FbdEditor($("#canvas"), {
    changed: () => {
      markDirty();
      if (state.running) void stopSim("The simulation stopped because the program was changed. Press Simulate to run the new program.");
    },
    status: setStatus,
    history: (u, r) => setHistory("program", u, r),
    zoom: (percent) => setZoomText("program", percent),
    edit: (id) => void editBlockById(id),
  });
  buildPalette($("#palette"), {
    add: addItem,
    drop: (item, x, y) => {
      if (!editor.dropAt(item.make(editor.diagram), x, y)) setStatus("Drop the block on the drawing area.", true);
    },
  });
  try {
    const layout = await getPanelLayout();
    layoutCache = layout;
    const pe = new PanelEditor($("#panel-canvas"), layout, {
      changed: markDirty,
      status: setStatus,
      history: (u, r) => setHistory("panel", u, r),
      zoom: (percent) => setZoomText("panel", percent),
      edit: (t) => void editPanelTarget(t),
      press: (target, down) => void simPress(target, down).catch((e: unknown) => showError(errorText(e))),
      value: (target, v) => void simValue(target, v).catch((e: unknown) => showError(errorText(e))),
    });
    panelEditor = pe;
    buildDevicePalette($("#device-palette"), layout.catalog, {
      allowed: () => {
        if (state.running) setStatus("Stop the simulation to add devices.", true);
        return !state.running;
      },
      add: (kind) => {
        pe.addAtFreeSpot(kind);
        setStatus("Device added. Drag it where you want it.");
      },
      drop: (kind, x, y) => {
        if (!pe.dropAt(kind, x, y)) setStatus("Drop the device on the board.", true);
      },
    });
  } catch (e) {
    showError(errorText(e));
  }
  // Right-click on the lists of blocks and devices.
  $("#palette").addEventListener("contextmenu", (e) => {
    const el = (e.target as Element).closest<HTMLElement>(".pal-item");
    const item = el?.dataset.id ? findPaletteItem(el.dataset.id) : undefined;
    if (!item) return;
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [{ label: `Add ${item.name} to the diagram`, enabled: !state.running, action: () => addItem(item) }]);
  });
  $("#device-palette").addEventListener("contextmenu", (e) => {
    const kind = (e.target as Element).closest<HTMLElement>(".dev-item")?.dataset.kind;
    const def = kind ? panelCatalog().find((c) => c.kind === kind) : undefined;
    if (!kind || !def) return;
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      {
        label: `Add ${def.name} to the bench`,
        enabled: !state.running,
        action: () => {
          setTab("panel");
          panelEditor?.addAtFreeSpot(kind);
        },
      },
    ]);
  });
  strip = new SimStrip($("#sim-bar"), {
    press: (target, down) => void simPress(target, down).catch((e: unknown) => showError(errorText(e))),
    pause: (paused) => {
      simPause(paused).catch((e: unknown) => showError(errorText(e)));
      setStatus(paused ? "Paused: time stands still. Press the green button to go on." : "RUN: the program is running.");
    },
    stop: () => void stopSim(),
    clock: () => void showClockDialog(),
  });
  wire();
  showSimButton();
  setTab("program");
  try {
    await applyPrefs(await getPrefs(), false);
  } catch {
    // Defaults stay in place.
  }
  try {
    const info = await getAppInfo();
    state.version = info.version;
    $("#status-version").textContent = `Version ${info.version}`;
  } catch (e) {
    showError(errorText(e));
  }
  try {
    const opened = await startupProject();
    if (opened) load(opened);
    else load({ path: null, name: "Untitled project", project: await newProject() });
  } catch (e) {
    showError(errorText(e));
    if (!state.project) {
      load({
        path: null,
        name: "Untitled project",
        project: {
          format: 2,
          cpu: "c14",
          comment: "",
          language: "fbd",
          ladder: { networks: [], scanMs: 10, symbols: {} },
          fbd: { blocks: [], wires: [], scanMs: 10 },
          panel: { devices: [], wires: [], fixedProps: {} },
        },
      });
    }
  }
  await refreshRecent();
}

void main();
