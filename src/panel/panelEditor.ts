// The control panel editor: the academy board (wired inside), the devices the
// student adds on the board or on the bench below it, and the jumper wires
// between terminals. 100% zoom means the board fills the width of the window;
// Ctrl + mouse wheel zooms with the top-left corner kept in place.
//
// Wires: drag the middle of a wire to bend it (hold Shift for a right angle),
// double-click a bend to remove it, drag a wire end to another terminal, and
// right-click a wire for its colour, straight or curvy, and delete.
//
// While the simulation runs nothing can be changed; the switches, push
// buttons, sensors and knobs are operated with the mouse instead.
import type { DeviceDef, Panel, PanelError, PanelLayout, PanelWire, PlacedDevice, Point, SimFrame } from "../api";
import { colorHex, drawBench, drawBoard, drawExtra, drawFixed, screw, WIRE_COLORS } from "./draw";
import { showContextMenu, type CtxEntry } from "../ui/contextMenu";

/** A device that was copied, for Paste. */
let deviceClip: PlacedDevice | null = null;

const NS = "http://www.w3.org/2000/svg";
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const MAX_UNDO = 200;
const MAX_BENDS = 64;
const BLUE = "#1f6fc4";
const RED = "#d33a32";
/** Room around the work area in the drawing: at the sides, above (for device names) and below. */
const PAD_X = 12;
const PAD_TOP = 34;
const PAD_BOTTOM = 16;

/** Devices operated with a click while the simulation runs. */
const OPERABLE = new Set(["pushNo", "pushNc", "toggle", "limitNo", "limitNc", "proxPnp", "photoPnp", "prox2w"]);
/** Devices with a slider while the simulation runs: [lowest, highest, step, unit]. */
const SLIDERS: Record<string, [number, number, number, string]> = {
  pot: [0, 100, 1, "%"],
  pt100: [-50, 400, 0.5, "°C"],
};

export interface PanelHooks {
  changed(): void;
  status(text: string, isError?: boolean): void;
  history(canUndo: boolean, canRedo: boolean): void;
  /** The zoom changed; 100 means the board fills the width. */
  zoom(percent: number): void;
  /** Double-click on a device: added devices by number, board devices by id. */
  edit(target: { fixed: false; id: number } | { fixed: true; id: string }): void;
  /** While simulating: the mouse button goes down or up on a switch ("swI1" or "d3"). */
  press(target: string, down: boolean): void;
  /** While simulating: a slider moved. */
  value(target: string, value: number): void;
}

type Sel = { t: "device"; id: number } | { t: "wire"; i: number } | null;

type Drag =
  | { t: "move"; id: number; cx: number; cy: number; ox: number; oy: number; moved: boolean; before: string }
  | { t: "wire"; from: string; x: number; y: number }
  | { t: "grab"; i: number; cx: number; cy: number; at: Point; before: string }
  | { t: "bend"; i: number; index: number; moved: boolean; before: string }
  | { t: "end"; i: number; end: "from" | "to"; x: number; y: number; before: string }
  /** Moving the view: an empty spot dragged, or the middle mouse button. */
  | { t: "pan"; cx: number; cy: number; sl: number; st: number };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The usual colour of a wire to this terminal, or null. */
function supplyColor(id: string): string | null {
  if (/^(icon\.I\dp|qcon\.Q\dp)$/.test(id)) return "red";
  if (/^(icon\.I\dn|qcon\.Q\dn)$/.test(id)) return "blue";
  if (/^qcon\.Q\dg$/.test(id) || /^d\d+\.g$/.test(id)) return "earth";
  return null;
}

/** Straight pieces through the points, or a smooth curve through them. */
export function wirePath(pts: Point[], curved: boolean): string {
  const first = pts[0];
  if (!first) return "";
  if (!curved) return pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
  if (pts.length === 2) {
    // No bends: the wire hangs down a little, like a real jumper wire.
    const b = pts[1] as Point;
    const sag = 36 + Math.min(80, Math.hypot(b.x - first.x, b.y - first.y) * 0.15);
    return `M${first.x} ${first.y}C${first.x} ${first.y + sag} ${b.x} ${b.y + sag} ${b.x} ${b.y}`;
  }
  // A Catmull-Rom curve through every bend, drawn as cubic pieces.
  let d = `M${first.x} ${first.y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? (pts[i] as Point);
    const p1 = pts[i] as Point;
    const p2 = pts[i + 1] as Point;
    const p3 = pts[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`;
  }
  return d;
}

export class PanelEditor {
  private panel: Panel = { devices: [], wires: [], fixedProps: {} };
  /** Zoom compared with "the board fills the width" (1 = 100%). */
  private rel = 1;
  /** Drawing units to screen pixels. */
  private zoom = 0.6;
  private sel: Sel = null;
  private errors = new Set<number>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private readonly svg: SVGSVGElement;
  private drag: Drag | null = null;
  private raf = 0;
  private lastClick: { key: string; t: number } | null = null;
  /** Colour of the next jumper wire. */
  wireColor = "yellow";
  /** New wires are smooth curves (Tools > Options). */
  curvyWires = false;
  private readonly terminals = new Map<string, { x: number; y: number }>();
  /** The picture from the running simulation; null when it is not running. */
  private sim: SimFrame | null = null;
  private simKey = "";
  /** The switch held down with the mouse while simulating. */
  private held: string | null = null;
  private slider: HTMLElement | null = null;
  private menu: HTMLElement | null = null;

  constructor(
    private readonly scroller: HTMLElement,
    private readonly layout: PanelLayout,
    private readonly hooks: PanelHooks,
  ) {
    this.svg = document.createElementNS(NS, "svg");
    this.svg.classList.add("panel-svg");
    this.svg.setAttribute("role", "img");
    this.svg.setAttribute("aria-label", "Control panel");
    scroller.appendChild(this.svg);
    this.rebuildTerminals();
    this.svg.addEventListener("pointerdown", this.onDown);
    this.svg.addEventListener("pointermove", this.onMove);
    this.svg.addEventListener("pointerup", this.onUp);
    this.svg.addEventListener("pointercancel", this.onUp);
    this.svg.addEventListener("contextmenu", this.onContext);
    // No automatic scrolling with the middle button: it moves the view instead.
    scroller.addEventListener("mousedown", (e) => {
      if (e.button === 1) e.preventDefault();
    });
    scroller.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        this.setZoom(this.rel * Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );
    scroller.addEventListener("scroll", () => {
      this.closeSlider();
      this.closeMenu();
    });
    // When the window changes size, 100% changes with it.
    new ResizeObserver(() => this.applyZoom()).observe(scroller);
    this.render();
  }

  // ----- Data -----

  get data(): Panel {
    return this.panel;
  }

  /** Shows the panel of the open project. It is edited in place. */
  setPanel(p: Panel): void {
    this.panel = p;
    this.panel.fixedProps ??= {};
    for (const w of this.panel.wires) {
      w.points ??= [];
      w.curved ??= true;
    }
    // Keep every device inside the work area (earlier versions had a bigger bench).
    for (const d of this.panel.devices) {
      const def = this.def(d.kind);
      if (!def) continue;
      const q = this.place(def, d.x, d.y);
      d.x = q.x;
      d.y = q.y;
    }
    this.sel = null;
    this.errors.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.rebuildTerminals();
    this.hooks.history(false, false);
    this.fit();
  }

  private def(kind: string): DeviceDef | undefined {
    return this.layout.catalog.find((c) => c.kind === kind);
  }

  private device(id: number): PlacedDevice | undefined {
    return this.panel.devices.find((d) => d.id === id);
  }

  private rebuildTerminals(): void {
    this.terminals.clear();
    for (const f of this.layout.fixed) for (const t of f.terminals) this.terminals.set(t.id, { x: f.x + t.x, y: f.y + t.y });
    for (const d of this.panel.devices) {
      const def = this.def(d.kind);
      if (!def) continue;
      for (const t of def.terminals) this.terminals.set(`d${d.id}.${t.name}`, { x: d.x + t.x, y: d.y + t.y });
    }
  }

  setErrors(errors: PanelError[]): void {
    this.errors.clear();
    for (const e of errors) if (e.wire !== null && !e.warning) this.errors.add(e.wire);
    this.render();
  }

  /** The settings of a board device, for its settings dialog. */
  fixedProps(id: string): Record<string, string> {
    return this.panel.fixedProps[id] ?? {};
  }

  // ----- Simulation -----

  get simulating(): boolean {
    return this.sim !== null;
  }

  /** Shows a picture from the running simulation, or null when it stops. */
  setSim(frame: SimFrame | null): void {
    if (frame && !this.sim) {
      this.sel = null;
      this.drag = null;
      this.closeMenu();
    }
    this.sim = frame;
    if (!frame) {
      this.held = null;
      this.closeSlider();
    }
    const key = frame
      ? JSON.stringify([frame.inputs, frame.outputs, frame.analog, frame.switches, frame.tripped, frame.devices, Math.floor(frame.timeMs / 1000)])
      : "";
    if (key !== this.simKey) {
      this.simKey = key;
      this.render();
      this.updateSlider();
    }
  }

  private startPan(e: PointerEvent): void {
    this.drag = { t: "pan", cx: e.clientX, cy: e.clientY, sl: this.scroller.scrollLeft, st: this.scroller.scrollTop };
    this.svg.setPointerCapture(e.pointerId);
    this.svg.classList.add("panning");
  }

  private simDown(e: PointerEvent): void {
    const dev = (e.target as Element).closest<SVGElement>(".dev");
    if (!dev || dev.dataset.fixed === "plc" || dev.dataset.fixed?.startsWith("lamp") || dev.dataset.fixed?.endsWith("con")) {
      this.closeSlider();
      this.startPan(e);
      return;
    }
    if (dev.dataset.fixed?.startsWith("swI")) {
      this.held = dev.dataset.fixed;
    } else if (dev.dataset.id) {
      const d = this.device(Number(dev.dataset.id));
      if (!d) return;
      if (SLIDERS[d.kind]) {
        this.openSlider(d, dev);
        return;
      }
      if (OPERABLE.has(d.kind)) this.held = `d${d.id}`;
    }
    if (this.held) {
      this.closeSlider();
      this.svg.setPointerCapture(e.pointerId);
      this.hooks.press(this.held, true);
    }
  }

  private openSlider(d: PlacedDevice, el: Element): void {
    this.closeSlider();
    const range = SLIDERS[d.kind];
    if (!range) return;
    const [lo, hi, step, unit] = range;
    const st = this.sim?.devices.find((x) => x.id === d.id);
    const box = document.createElement("div");
    box.className = "sim-slider";
    box.dataset.id = String(d.id);
    const title = document.createElement("div");
    title.className = "sim-slider-title";
    title.textContent = d.label || this.def(d.kind)?.name || "";
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(lo);
    input.max = String(hi);
    input.step = String(step);
    input.value = String(st?.value ?? (lo + hi) / 2);
    input.setAttribute("aria-label", title.textContent);
    const out = document.createElement("output");
    const show = (): void => {
      const v = Number(input.value);
      out.textContent = d.kind === "pot" ? `${v} %  =  ${(v / 10).toFixed(1)} V` : `${v.toFixed(1)} ${unit}`;
    };
    show();
    input.addEventListener("input", () => {
      show();
      this.hooks.value(`d${d.id}`, Number(input.value));
    });
    box.append(title, input, out);
    document.body.appendChild(box);
    const r = el.getBoundingClientRect();
    const bw = box.offsetWidth;
    box.style.left = `${clamp(r.left + r.width / 2 - bw / 2, 8, window.innerWidth - bw - 8)}px`;
    box.style.top = `${clamp(r.bottom + 6, 8, window.innerHeight - box.offsetHeight - 8)}px`;
    input.focus();
    this.slider = box;
    const outside = (ev: PointerEvent): void => {
      if (!box.contains(ev.target as Node) && !el.contains(ev.target as Node)) this.closeSlider();
    };
    setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
    box.addEventListener("remove-me", () => document.removeEventListener("pointerdown", outside, true));
  }

  private updateSlider(): void {
    const box = this.slider;
    if (!box) return;
    const st = this.sim?.devices.find((x) => String(x.id) === box.dataset.id);
    box.classList.toggle("dead", st !== undefined && !st.on);
  }

  private closeSlider(): void {
    if (!this.slider) return;
    this.slider.dispatchEvent(new Event("remove-me"));
    this.slider.remove();
    this.slider = null;
  }

  // ----- Changes with undo -----

  private pushUndo(before: string): void {
    if (this.undoStack[this.undoStack.length - 1] !== before) {
      this.undoStack.push(before);
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    }
    this.redoStack = [];
  }

  private touched(): void {
    this.errors.clear();
    this.rebuildTerminals();
    this.hooks.changed();
    this.hooks.history(this.undoStack.length > 0, this.redoStack.length > 0);
    this.render();
  }

  private mutate(change: () => void): void {
    if (this.sim) return;
    const before = JSON.stringify(this.panel);
    change();
    this.pushUndo(before);
    this.touched();
  }

  private restore(json: string): void {
    const o = JSON.parse(json) as Panel;
    this.panel.devices = o.devices;
    this.panel.wires = o.wires;
    this.panel.fixedProps = o.fixedProps ?? {};
    this.sel = null;
    this.touched();
  }

  undo(): void {
    if (this.sim) return;
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(JSON.stringify(this.panel));
    this.restore(prev);
  }

  redo(): void {
    if (this.sim) return;
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(JSON.stringify(this.panel));
    this.restore(next);
  }

  // ----- Devices -----

  private place(def: DeviceDef, x: number, y: number): { x: number; y: number } {
    return {
      x: clamp(Math.round(x), 0, this.layout.workWidth - def.w),
      y: clamp(Math.round(y), 0, this.layout.workHeight - def.h),
    };
  }

  addDevice(kind: string, x: number, y: number): void {
    const def = this.def(kind);
    if (!def || this.sim) return;
    let id = 0;
    this.mutate(() => {
      id = this.panel.devices.reduce((m, d) => Math.max(m, d.id), 0) + 1;
      const p = this.place(def, x, y);
      this.panel.devices.push({
        id,
        kind,
        x: p.x,
        y: p.y,
        label: "",
        props: kind === "lamp" ? { color: "green" } : kind === "pushNo" ? { color: "green" } : kind === "pushNc" ? { color: "red" } : {},
      });
    });
    this.sel = { t: "device", id };
    this.render();
  }

  /** Puts a device in a free place on the bench below the board. */
  addAtFreeSpot(kind: string): void {
    const def = this.def(kind);
    if (!def) return;
    const free = (x: number, y: number): boolean =>
      !this.panel.devices.some((d) => {
        const o = this.def(d.kind);
        return o !== undefined && x < d.x + o.w + 20 && x + def.w + 20 > d.x && y < d.y + o.h + 40 && y + def.h + 40 > d.y;
      });
    const y = this.layout.height + 50;
    for (let x = 20; x + def.w <= this.layout.workWidth; x += 40) {
      if (free(x, y)) {
        this.addDevice(kind, x, y);
        this.reveal(y + def.h);
        return;
      }
    }
    this.addDevice(kind, 20, y);
    this.reveal(y + def.h);
  }

  /** Scrolls down so that a new device on the bench can be seen. */
  private reveal(bottom: number): void {
    const s = this.scroller;
    const px = (bottom + PAD_TOP + 10) * this.zoom;
    if (px > s.scrollTop + s.clientHeight) s.scrollTop = px - s.clientHeight;
  }

  /** Places a device where the student dropped it. False if it is not over the drawing. */
  dropAt(kind: string, clientX: number, clientY: number): boolean {
    const r = this.scroller.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return false;
    const def = this.def(kind);
    if (!def) return false;
    const p = this.worldPoint(clientX, clientY);
    this.addDevice(kind, p.x - def.w / 2, p.y - def.h / 2);
    return true;
  }

  applyDeviceEdit(id: number, label: string, props: Record<string, string>): void {
    this.mutate(() => {
      const d = this.device(id);
      if (d) {
        d.label = label;
        d.props = props;
      }
    });
  }

  applyFixedEdit(id: string, props: Record<string, string>): void {
    this.mutate(() => {
      this.panel.fixedProps[id] = props;
    });
  }

  deleteSelection(): void {
    const sel = this.sel;
    if (!sel || this.sim) return;
    this.mutate(() => {
      if (sel.t === "device") {
        this.panel.devices = this.panel.devices.filter((d) => d.id !== sel.id);
        const prefix = `d${sel.id}.`;
        this.panel.wires = this.panel.wires.filter((w) => !w.from.startsWith(prefix) && !w.to.startsWith(prefix));
      } else {
        this.panel.wires = this.panel.wires.filter((_, i) => i !== sel.i);
      }
      this.sel = null;
    });
  }

  get hasSelection(): boolean {
    return this.sel !== null && !this.sim;
  }

  // ----- Wires -----

  /** Changes the colour for new wires and, if a wire is selected, that wire. */
  setWireColor(color: string): void {
    this.wireColor = color;
    const sel = this.sel;
    if (sel?.t === "wire") {
      this.mutate(() => {
        const w = this.panel.wires[sel.i];
        if (w) w.color = color;
      });
    }
  }

  private joined(a: string, b: string, except = -1): boolean {
    return this.panel.wires.some((w, i) => i !== except && ((w.from === a && w.to === b) || (w.from === b && w.to === a)));
  }

  private connect(a: string, b: string): void {
    if (a === b) return;
    if (this.joined(a, b)) {
      this.hooks.status("These two terminals are already joined by a wire.", true);
      return;
    }
    this.mutate(() => {
      this.panel.wires.push({ from: a, to: b, color: supplyColor(a) ?? supplyColor(b) ?? this.wireColor, points: [], curved: this.curvyWires });
    });
    this.sel = { t: "wire", i: this.panel.wires.length - 1 };
    this.render();
  }

  removeAllWires(): void {
    if (this.panel.wires.length === 0) return;
    this.mutate(() => {
      this.panel.wires = [];
      this.sel = null;
    });
  }

  get wireCount(): number {
    return this.panel.wires.length;
  }

  /** Every point of a wire: its two ends and the bends between them. */
  private wirePoints(w: PanelWire, i: number): Point[] | null {
    const dr = this.drag;
    let a: Point | undefined = this.terminals.get(w.from);
    let b: Point | undefined = this.terminals.get(w.to);
    if (dr?.t === "end" && dr.i === i) {
      if (dr.end === "from") a = dr;
      else b = dr;
    }
    if (!a || !b) return null;
    return [a, ...w.points, b];
  }

  /** Which gap between the points of a wire is nearest to `at` (0 = before the first bend). */
  private segmentAt(pts: Point[], at: Point): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i] as Point;
      const q = pts[i + 1] as Point;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len2 = dx * dx + dy * dy || 1;
      const t = clamp(((at.x - p.x) * dx + (at.y - p.y) * dy) / len2, 0, 1);
      const d = Math.hypot(p.x + t * dx - at.x, p.y + t * dy - at.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Moves bend `index` of wire `i` to the pointer; with Shift it lines up at a right angle. */
  private dragBend(i: number, index: number, e: PointerEvent): void {
    const w = this.panel.wires[i];
    const pts = w ? this.wirePoints(w, i) : null;
    if (!w || !pts) return;
    let at = this.worldPoint(e.clientX, e.clientY);
    if (e.shiftKey) {
      const prev = pts[index] as Point;
      const next = pts[index + 2] as Point;
      const c1 = { x: prev.x, y: next.y };
      const c2 = { x: next.x, y: prev.y };
      at = Math.hypot(c1.x - at.x, c1.y - at.y) <= Math.hypot(c2.x - at.x, c2.y - at.y) ? c1 : c2;
    } else {
      at = { x: Math.round(at.x), y: Math.round(at.y) };
    }
    w.points[index] = at;
  }

  // ----- Right-click menu of a wire -----

  // ----- Copy and paste of devices -----

  private selectedDevice(): PlacedDevice | undefined {
    return this.sel?.t === "device" ? this.device(this.sel.id) : undefined;
  }

  get canCopy(): boolean {
    return !this.sim && this.selectedDevice() !== undefined;
  }

  get canPaste(): boolean {
    return !this.sim && deviceClip !== null;
  }

  /** Copies the selected device (its kind, name and settings; not its wires). */
  copy(): void {
    const d = this.selectedDevice();
    if (!d) return;
    deviceClip = structuredClone(d);
    this.hooks.status("Device copied.");
  }

  cut(): void {
    if (!this.canCopy) return;
    this.copy();
    this.deleteSelection();
  }

  /** Pastes the copied device at `at` (drawing units), or beside the original. */
  paste(at?: Point): void {
    const c = deviceClip;
    const def = c ? this.def(c.kind) : undefined;
    if (!c || !def || this.sim) return;
    this.addDevice(c.kind, at ? at.x - def.w / 2 : c.x + 40, at ? at.y - def.h / 2 : c.y + 40);
    const sel = this.selectedDevice();
    if (sel) {
      sel.label = c.label;
      sel.props = { ...c.props };
      this.render();
    }
    this.hooks.status("Device pasted. Wire it to the connectors.");
  }

  // ----- Right-click menus -----

  private readonly onContext = (e: MouseEvent): void => {
    e.preventDefault();
    if (this.sim) return;
    const t = e.target as Element;
    const at = this.worldPoint(e.clientX, e.clientY);
    const dev = t.closest<SVGElement>(".dev");
    const wire = t.closest<SVGElement>(".pwire");
    if (!wire) {
      let items: CtxEntry[];
      if (dev?.dataset.id) {
        const id = Number(dev.dataset.id);
        this.sel = { t: "device", id };
        this.render();
        items = [
          { label: "Settings…", action: () => this.hooks.edit({ fixed: false, id }) },
          "-",
          { label: "Cut", shortcut: "Ctrl+X", action: () => this.cut() },
          { label: "Copy", shortcut: "Ctrl+C", action: () => this.copy() },
          { label: "Paste", shortcut: "Ctrl+V", enabled: this.canPaste, action: () => this.paste(at) },
          { label: "Delete (with its wires)", shortcut: "Del", action: () => this.deleteSelection() },
        ];
      } else if (dev?.dataset.fixed?.startsWith("swI")) {
        const id = dev.dataset.fixed;
        items = [{ label: `Switch ${id.slice(2)} settings…`, action: () => this.hooks.edit({ fixed: true, id }) }];
      } else {
        items = [
          { label: "Paste here", shortcut: "Ctrl+V", enabled: this.canPaste, action: () => this.paste(at) },
          "-",
          { label: "Zoom 100%", shortcut: "Ctrl+0", action: () => this.fit() },
          { label: "Remove all wires", enabled: this.panel.wires.length > 0, action: () => this.removeAllWires() },
        ];
      }
      showContextMenu(e.clientX, e.clientY, items);
      return;
    }
    const i = Number(wire.dataset.i);
    const w = this.panel.wires[i];
    if (!w) return;
    this.sel = { t: "wire", i };
    this.render();
    this.openMenu(e.clientX, e.clientY, i, w);
  };

  private openMenu(x: number, y: number, i: number, w: PanelWire): void {
    this.closeMenu();
    const m = document.createElement("div");
    m.className = "ctx-menu";
    m.setAttribute("role", "menu");
    const sw = WIRE_COLORS.map(
      (c) => `<button class="swatch${w.color === c ? " on" : ""}" data-color="${c}" title="${c}" aria-label="${c} wire" style="--c:${colorHex(c)}"></button>`,
    ).join("");
    m.innerHTML =
      `<div class="ctx-swatches">${sw}</div>` +
      `<button class="ctx-item" data-act="straight" role="menuitemradio" aria-checked="${!w.curved}">${w.curved ? "" : "✓ "}Straight</button>` +
      `<button class="ctx-item" data-act="curved" role="menuitemradio" aria-checked="${w.curved}">${w.curved ? "✓ " : ""}Curvy</button>` +
      `<button class="ctx-item" data-act="unbend"${w.points.length ? "" : " disabled"}>Remove all bends</button>` +
      `<div class="ctx-sep"></div>` +
      `<button class="ctx-item" data-act="delete">Delete wire</button>`;
    m.addEventListener("click", (ev) => {
      const b = (ev.target as Element).closest<HTMLElement>("button");
      if (!b) return;
      const color = b.dataset.color;
      const act = b.dataset.act;
      this.closeMenu();
      if (act === "delete") {
        this.sel = { t: "wire", i };
        this.deleteSelection();
        return;
      }
      this.mutate(() => {
        const ww = this.panel.wires[i];
        if (!ww) return;
        if (color) ww.color = color;
        if (act === "straight") ww.curved = false;
        if (act === "curved") ww.curved = true;
        if (act === "unbend") ww.points = [];
      });
    });
    document.body.appendChild(m);
    m.style.left = `${clamp(x, 4, window.innerWidth - m.offsetWidth - 4)}px`;
    m.style.top = `${clamp(y, 4, window.innerHeight - m.offsetHeight - 4)}px`;
    this.menu = m;
    const outside = (ev: Event): void => {
      if (ev instanceof KeyboardEvent ? ev.key === "Escape" : !m.contains(ev.target as Node)) this.closeMenu();
    };
    setTimeout(() => {
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("keydown", outside, true);
    }, 0);
    m.addEventListener("remove-me", () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", outside, true);
    });
  }

  private closeMenu(): void {
    if (!this.menu) return;
    this.menu.dispatchEvent(new Event("remove-me"));
    this.menu.remove();
    this.menu = null;
  }

  // ----- Zoom -----

  /** Zoom at which the board fills the width of the window. */
  private base(): number {
    const w = this.scroller.clientWidth;
    return w > 0 ? (w - 1) / (this.layout.workWidth + PAD_X * 2) : 0.6;
  }

  /** Works out the zoom again (after a zoom step or a change of window size). The view's top-left corner stays put. */
  private applyZoom(): void {
    const old = this.zoom;
    const nz = this.rel * this.base();
    if (Math.abs(nz - old) < 1e-6) return;
    const wx = this.scroller.scrollLeft / old;
    const wy = this.scroller.scrollTop / old;
    this.zoom = nz;
    this.render();
    this.scroller.scrollLeft = wx * nz;
    this.scroller.scrollTop = wy * nz;
  }

  get zoomPercent(): number {
    return Math.round(this.rel * 100);
  }

  /** Sets the zoom: 1 is 100%, where the board fills the width. */
  setZoom(rel: number): void {
    this.closeSlider();
    this.closeMenu();
    this.rel = clamp(rel, MIN_ZOOM, MAX_ZOOM);
    this.applyZoom();
    this.hooks.zoom(this.zoomPercent);
  }

  zoomBy(factor: number): void {
    this.setZoom(this.rel * factor);
  }

  /** Back to 100%, at the top-left corner. */
  fit(): void {
    this.rel = 1;
    this.zoom = this.base();
    this.render();
    this.scroller.scrollLeft = 0;
    this.scroller.scrollTop = 0;
    this.hooks.zoom(100);
  }

  private worldPoint(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.svg.getBoundingClientRect();
    return { x: (clientX - r.left) / this.zoom - PAD_X, y: (clientY - r.top) / this.zoom - PAD_TOP };
  }

  // ----- Mouse -----

  private doubleClick(key: string): boolean {
    const now = performance.now();
    if (this.lastClick?.key === key && now - this.lastClick.t < 450) {
      this.lastClick = null;
      return true;
    }
    this.lastClick = { key, t: now };
    return false;
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.button === 1) {
      this.closeMenu();
      this.startPan(e);
      return;
    }
    if (e.button !== 0) return;
    this.closeMenu();
    if (this.sim) {
      this.simDown(e);
      return;
    }
    const t = e.target as Element;
    // Handles of the selected wire: a bend or an end.
    const handle = t.closest<SVGElement>(".bend, .wend");
    if (handle?.dataset.wire) {
      const i = Number(handle.dataset.wire);
      const w = this.panel.wires[i];
      if (!w) return;
      if (handle.dataset.bend !== undefined) {
        const index = Number(handle.dataset.bend);
        if (this.doubleClick(`b:${i}:${index}`)) {
          this.mutate(() => {
            w.points.splice(index, 1);
          });
          this.hooks.status("Bend removed.");
          return;
        }
        this.drag = { t: "bend", i, index, moved: false, before: JSON.stringify(this.panel) };
      } else {
        const end = handle.dataset.end === "from" ? "from" : "to";
        const p = this.worldPoint(e.clientX, e.clientY);
        this.drag = { t: "end", i, end, x: p.x, y: p.y, before: JSON.stringify(this.panel) };
      }
      this.svg.setPointerCapture(e.pointerId);
      return;
    }
    const term = t.closest<SVGElement>(".term");
    if (term?.dataset.id) {
      const p = this.worldPoint(e.clientX, e.clientY);
      this.drag = { t: "wire", from: term.dataset.id, x: p.x, y: p.y };
      this.svg.setPointerCapture(e.pointerId);
      return;
    }
    const dev = t.closest<SVGElement>(".dev");
    if (dev) {
      if (dev.dataset.fixed) {
        // A board device: it cannot be moved. Double-click opens its settings.
        this.sel = null;
        if (this.doubleClick(`f:${dev.dataset.fixed}`)) this.hooks.edit({ fixed: true, id: dev.dataset.fixed });
        this.render();
        return;
      }
      const id = Number(dev.dataset.id);
      const d = this.device(id);
      if (!d) return;
      const changed = !(this.sel?.t === "device" && this.sel.id === id);
      this.sel = { t: "device", id };
      this.drag = { t: "move", id, cx: e.clientX, cy: e.clientY, ox: d.x, oy: d.y, moved: false, before: JSON.stringify(this.panel) };
      this.svg.setPointerCapture(e.pointerId);
      if (changed) this.render();
      return;
    }
    const wire = t.closest<SVGElement>(".pwire");
    if (wire) {
      // Select the wire; dragging it adds a bend where it was grabbed.
      const i = Number(wire.dataset.i);
      this.sel = { t: "wire", i };
      this.drag = { t: "grab", i, cx: e.clientX, cy: e.clientY, at: this.worldPoint(e.clientX, e.clientY), before: JSON.stringify(this.panel) };
      this.svg.setPointerCapture(e.pointerId);
      this.render();
      return;
    }
    // An empty spot: select nothing, and drag to move the view.
    if (this.sel) {
      this.sel = null;
      this.render();
    }
    this.startPan(e);
  };

  private readonly onMove = (e: PointerEvent): void => {
    const dr = this.drag;
    if (dr?.t === "pan") {
      this.scroller.scrollLeft = dr.sl - (e.clientX - dr.cx);
      this.scroller.scrollTop = dr.st - (e.clientY - dr.cy);
      return;
    }
    if (!dr || this.sim) return;
    if (dr.t === "move") {
      const dx = (e.clientX - dr.cx) / this.zoom;
      const dy = (e.clientY - dr.cy) / this.zoom;
      if (!dr.moved && Math.hypot(dx, dy) * this.zoom < 4) return;
      dr.moved = true;
      const d = this.device(dr.id);
      const def = d ? this.def(d.kind) : undefined;
      if (!d || !def) return;
      const p = this.place(def, dr.ox + dx, dr.oy + dy);
      d.x = p.x;
      d.y = p.y;
      this.rebuildTerminals();
    } else if (dr.t === "grab") {
      if (Math.hypot(e.clientX - dr.cx, e.clientY - dr.cy) < 4) return;
      const w = this.panel.wires[dr.i];
      const pts = w ? this.wirePoints(w, dr.i) : null;
      if (!w || !pts) return;
      if (w.points.length >= MAX_BENDS) {
        this.hooks.status(`A wire can have at most ${MAX_BENDS} bends.`, true);
        this.drag = null;
        return;
      }
      const index = this.segmentAt(pts, dr.at);
      w.points.splice(index, 0, dr.at);
      this.drag = { t: "bend", i: dr.i, index, moved: true, before: dr.before };
      this.dragBend(dr.i, index, e);
    } else if (dr.t === "bend") {
      dr.moved = true;
      this.dragBend(dr.i, dr.index, e);
    } else {
      const p = this.worldPoint(e.clientX, e.clientY);
      dr.x = p.x;
      dr.y = p.y;
    }
    this.schedule();
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (this.svg.hasPointerCapture(e.pointerId)) this.svg.releasePointerCapture(e.pointerId);
    if (this.drag?.t === "pan") {
      this.drag = null;
      this.svg.classList.remove("panning");
      return;
    }
    if (this.held) {
      this.hooks.press(this.held, false);
      this.held = null;
      return;
    }
    const dr = this.drag;
    this.drag = null;
    if (!dr || this.sim) return;
    if (dr.t === "move") {
      if (dr.moved) {
        this.pushUndo(dr.before);
        this.touched();
      } else {
        if (this.doubleClick(`d:${dr.id}`)) this.hooks.edit({ fixed: false, id: dr.id });
        this.render();
      }
    } else if (dr.t === "bend") {
      if (dr.moved) {
        this.pushUndo(dr.before);
        this.touched();
        this.hooks.status("Wire bent. Hold Shift for a right angle; double-click a bend to remove it.");
      }
    } else if (dr.t === "grab") {
      this.render();
    } else {
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<SVGElement>(".term");
      const target = el?.dataset.id && this.svg.contains(el) ? el.dataset.id : null;
      if (dr.t === "wire") {
        if (target) this.connect(dr.from, target);
      } else {
        const w = this.panel.wires[dr.i];
        const other = w ? (dr.end === "from" ? w.to : w.from) : "";
        if (w && target && target !== other && target !== (dr.end === "from" ? w.from : w.to)) {
          if (this.joined(target, other, dr.i)) {
            this.hooks.status("These two terminals are already joined by a wire.", true);
          } else {
            w[dr.end] = target;
            this.pushUndo(dr.before);
            this.touched();
            this.hooks.status("Wire end moved.");
          }
        }
      }
      this.render();
    }
  };

  cancelDrag(): void {
    this.closeSlider();
    this.closeMenu();
    if (this.drag?.t === "wire" || this.drag?.t === "end") {
      this.drag = null;
      this.render();
    }
  }

  // ----- Drawing -----

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  /** A screw terminal; `mark` is printed above it (none for the connector strips, which have their own). */
  private terminalSvg(id: string, x: number, y: number, mark: string | null): string {
    return (
      `<g class="term" data-id="${esc(id)}"><title>${esc(id)}</title>${screw(x, y, 10)}` +
      `<circle class="term-hit" cx="${x}" cy="${y}" r="15" fill="transparent" pointer-events="all"/></g>` +
      (mark
        ? `<text x="${x}" y="${y - 16}" text-anchor="middle" font-family="'Segoe UI', sans-serif" font-size="19" font-weight="700" fill="#2b3340" pointer-events="none">${esc(mark)}</text>`
        : "")
    );
  }

  private render(): void {
    const z = this.zoom;
    const w = this.layout.workWidth + PAD_X * 2;
    const h = this.layout.workHeight + PAD_TOP + PAD_BOTTOM;
    this.svg.setAttribute("width", String(Math.floor(w * z)));
    this.svg.setAttribute("height", String(Math.floor(h * z)));
    this.svg.setAttribute("viewBox", `${-PAD_X} ${-PAD_TOP} ${w} ${h}`);
    this.svg.classList.toggle("simulating", this.sim !== null);
    let s = drawBench(this.layout.workWidth, this.layout.workHeight) + drawBoard(this.layout.width, this.layout.height);
    const states = new Map((this.sim?.devices ?? []).map((d) => [d.id, d]));

    // The board's own devices.
    for (const f of this.layout.fixed) {
      const live = this.sim !== null && f.kind === "boardSwitch" ? " live" : "";
      s += `<g class="dev fixed${live}" data-fixed="${esc(f.id)}" transform="translate(${f.x} ${f.y})">${drawFixed(f, this.panel.fixedProps[f.id] ?? {}, this.sim)}</g>`;
    }
    // The student's devices.
    for (const d of this.panel.devices) {
      const def = this.def(d.kind);
      if (!def) continue;
      const sel = this.sel?.t === "device" && this.sel.id === d.id;
      const live = this.sim !== null && (OPERABLE.has(d.kind) || SLIDERS[d.kind]) ? " live" : "";
      s += `<g class="dev extra${live}" data-id="${d.id}" transform="translate(${d.x} ${d.y})">`;
      if (sel) s += `<rect x="-6" y="-32" width="${def.w + 12}" height="${def.h + 38}" rx="8" fill="none" stroke="${BLUE}" stroke-width="3" stroke-dasharray="8 5"/>`;
      s += drawExtra(d, def, states.get(d.id)) + `</g>`;
    }
    // Terminals sit above their devices.
    for (const f of this.layout.fixed) for (const t of f.terminals) s += this.terminalSvg(t.id, f.x + t.x, f.y + t.y, null);
    for (const d of this.panel.devices) {
      const def = this.def(d.kind);
      if (!def) continue;
      for (const t of def.terminals) s += this.terminalSvg(`d${d.id}.${t.name}`, d.x + t.x, d.y + t.y, t.mark);
    }
    // Jumper wires on top.
    let handles = "";
    this.panel.wires.forEach((wr: PanelWire, i) => {
      const pts = this.wirePoints(wr, i);
      if (!pts) return;
      const path = wirePath(pts, wr.curved);
      const sel = this.sel?.t === "wire" && this.sel.i === i;
      const bad = this.errors.has(i);
      const moving = this.drag?.t === "end" && this.drag.i === i;
      s +=
        `<g class="pwire" data-i="${i}"${moving ? ' opacity="0.6" pointer-events="none"' : ""}>` +
        `<path d="${path}" fill="none" stroke="transparent" stroke-width="18" pointer-events="stroke"/>` +
        `<path d="${path}" fill="none" stroke="${bad ? RED : sel ? BLUE : "#00000066"}" stroke-width="${bad || sel ? 11 : 8}" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<path d="${path}" fill="none" stroke="${colorHex(wr.color, "#f0c020")}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` +
        (wr.color === "earth" ? `<path d="${path}" fill="none" stroke="${colorHex("yellow")}" stroke-width="5" stroke-dasharray="9 9"/>` : "") +
        `</g>`;
      if (sel && !this.sim && !moving) {
        // Handles: the bends, and the two ends (drag an end to another terminal).
        wr.points.forEach((p, j) => {
          handles += `<circle class="bend" data-wire="${i}" data-bend="${j}" cx="${p.x}" cy="${p.y}" r="7" fill="#ffffff" stroke="${BLUE}" stroke-width="3"><title>Drag to move this bend (Shift: right angle). Double-click to remove it.</title></circle>`;
        });
        const a = pts[0] as Point;
        const b = pts[pts.length - 1] as Point;
        for (const [end, p] of [["from", a], ["to", b]] as const) {
          handles += `<circle class="wend" data-wire="${i}" data-end="${end}" cx="${p.x}" cy="${p.y}" r="12" fill="${BLUE}" fill-opacity="0.25" stroke="${BLUE}" stroke-width="3"><title>Drag this end to another terminal</title></circle>`;
        }
      }
    });
    s += handles;
    const dr = this.drag;
    if (dr?.t === "wire") {
      const a = this.terminals.get(dr.from);
      if (a) s += `<path d="${wirePath([a, dr], this.curvyWires)}" fill="none" stroke="${BLUE}" stroke-width="4" stroke-dasharray="10 7" stroke-linecap="round" pointer-events="none"/>`;
    }
    this.svg.innerHTML = s;
  }
}
