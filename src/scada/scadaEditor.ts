// The SCADA screen editor: the student places operator items (buttons,
// switches, lamps, displays, plant symbols) on a screen and links each one to
// a PLC point. While the simulation runs, the screen is live: lamps and
// displays follow the PLC, and buttons, switches and sliders write to it.
import type { Scada, ScadaError, ScadaItem, SimFrame } from "../api";
import { showContextMenu, type CtxEntry } from "../ui/contextMenu";
import { KINDS, drawItem, range } from "./scadaDraw";

const NS = "http://www.w3.org/2000/svg";
/** The operator screen, in drawing units. */
export const SCREEN_W = 1280;
export const SCREEN_H = 760;
const GRID = 10;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3;
const MAX_UNDO = 200;
const SEL = "#e0201b";
const RED = "#d33a32";

export interface ScadaHooks {
  changed(): void;
  status(text: string, isError?: boolean): void;
  history(canUndo: boolean, canRedo: boolean): void;
  zoom(percent: number): void;
  edit(id: number): void;
  /** While simulating: a button went down or up. */
  press(tag: string, down: boolean): void;
  /** While simulating: a switch was clicked; `on` is the state it should get. */
  toggle(tag: string, on: boolean): void;
  /** While simulating: a slider moved. */
  analog(tag: string, value: number): void;
}

type Drag =
  | { t: "move"; id: number; cx: number; cy: number; ox: number; oy: number; moved: boolean; before: string }
  | { t: "slider"; id: number }
  | { t: "pan"; cx: number; cy: number; sl: number; st: number };

const snap = (v: number): number => Math.round(v / GRID) * GRID;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

let clipboard: ScadaItem | null = null;

/** The live value of a tag in a frame. */
export function tagValue(f: SimFrame, tag: string): boolean | number | null {
  const m = /^(AM|AI|I|Q|M)(\d+)$/.exec(tag.trim().toUpperCase());
  if (!m) return null;
  const n = Number(m[2]) - 1;
  switch (m[1]) {
    case "I":
      return f.inputs[n] ?? null;
    case "Q":
      return f.outputs[n] ?? null;
    case "M":
      return f.markers[n] ?? null;
    case "AI":
      return f.analog[n] ?? null;
    case "AM":
      return f.analogMarkers[n] ?? null;
  }
  return null;
}

export class ScadaEditor {
  private s: Scada = { items: [] };
  private zoom = 1;
  private sel: number | null = null;
  private errors = new Map<number, string>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private readonly svg: SVGSVGElement;
  private drag: Drag | null = null;
  private raf = 0;
  private lastClick: { id: number; t: number } | null = null;
  private sim: SimFrame | null = null;
  private simKey = "";
  private held: number | null = null;

  constructor(
    private readonly scroller: HTMLElement,
    private readonly hooks: ScadaHooks,
  ) {
    this.svg = document.createElementNS(NS, "svg");
    this.svg.classList.add("scada-svg");
    this.svg.setAttribute("role", "img");
    this.svg.setAttribute("aria-label", "SCADA screen");
    scroller.appendChild(this.svg);
    this.svg.addEventListener("pointerdown", this.onDown);
    this.svg.addEventListener("pointermove", this.onMove);
    this.svg.addEventListener("pointerup", this.onUp);
    this.svg.addEventListener("pointercancel", this.onUp);
    this.svg.addEventListener("contextmenu", this.onContext);
    scroller.addEventListener("mousedown", (e) => {
      if (e.button === 1) e.preventDefault();
    });
    scroller.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );
    this.render();
  }

  // ----- Data -----

  get data(): Scada {
    return this.s;
  }

  setScada(s: Scada): void {
    this.s = s;
    this.s.items ??= [];
    this.sel = null;
    this.errors.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.hooks.history(false, false);
    this.render();
  }

  private item(id: number): ScadaItem | undefined {
    return this.s.items.find((i) => i.id === id);
  }

  itemById(id: number): ScadaItem | undefined {
    return this.item(id);
  }

  setErrors(errors: ScadaError[]): void {
    this.errors.clear();
    for (const e of errors) if (e.item !== null && !this.errors.has(e.item)) this.errors.set(e.item, e.message);
    this.render();
  }

  // ----- Simulation -----

  setSim(f: SimFrame | null): void {
    if (f && !this.sim) this.sel = null;
    this.sim = f;
    if (!f) this.held = null;
    const key = f ? JSON.stringify(this.s.items.map((i) => tagValue(f, i.tag))) : "";
    if (key !== this.simKey) {
      this.simKey = key;
      this.render();
    }
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
    this.hooks.changed();
    this.hooks.history(this.undoStack.length > 0, this.redoStack.length > 0);
    this.render();
  }

  private mutate(change: () => void): void {
    if (this.sim) return;
    const before = JSON.stringify(this.s);
    change();
    this.pushUndo(before);
    this.touched();
  }

  undo(): void {
    if (this.sim) return;
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(JSON.stringify(this.s));
    this.s.items = (JSON.parse(prev) as Scada).items;
    this.sel = null;
    this.touched();
  }

  redo(): void {
    if (this.sim) return;
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(JSON.stringify(this.s));
    this.s.items = (JSON.parse(next) as Scada).items;
    this.sel = null;
    this.touched();
  }

  // ----- Items -----

  addItem(kind: string, x: number, y: number): void {
    const k = KINDS[kind];
    if (!k || this.sim) return;
    let id = 0;
    this.mutate(() => {
      id = this.s.items.reduce((m, i) => Math.max(m, i.id), 0) + 1;
      this.s.items.push({
        id,
        kind,
        x: clamp(snap(x), 0, SCREEN_W - k.w),
        y: clamp(snap(y), 0, SCREEN_H - k.h),
        w: k.w,
        h: k.h,
        label: kind === "text" ? "Title" : "",
        tag: "",
        props: {},
      });
    });
    this.sel = id;
    this.render();
    this.hooks.status(`${k.name} added. Double-click it to link it to a PLC point.`);
  }

  /** Puts an item in a free place near the top left. */
  addAtFreeSpot(kind: string): void {
    const k = KINDS[kind];
    if (!k) return;
    for (let y = 20; y + k.h < SCREEN_H; y += 20) {
      for (let x = 20; x + k.w < SCREEN_W; x += 20) {
        const free = !this.s.items.some((i) => x < i.x + i.w + 20 && x + k.w + 20 > i.x && y < i.y + i.h + 20 && y + k.h + 20 > i.y);
        if (free) {
          this.addItem(kind, x, y);
          return;
        }
      }
    }
    this.addItem(kind, 20, 20);
  }

  dropAt(kind: string, clientX: number, clientY: number): boolean {
    const r = this.scroller.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return false;
    const k = KINDS[kind];
    if (!k) return false;
    const p = this.worldPoint(clientX, clientY);
    this.addItem(kind, p.x - k.w / 2, p.y - k.h / 2);
    return true;
  }

  applyEdit(id: number, label: string, tag: string, props: Record<string, string>): void {
    this.mutate(() => {
      const it = this.item(id);
      if (!it) return;
      it.label = label;
      it.tag = tag;
      it.props = props;
    });
  }

  deleteSelection(): void {
    const id = this.sel;
    if (id === null || this.sim) return;
    this.mutate(() => {
      this.s.items = this.s.items.filter((i) => i.id !== id);
      this.sel = null;
    });
  }

  get hasSelection(): boolean {
    return this.sel !== null && !this.sim;
  }

  get canCopy(): boolean {
    return this.sel !== null;
  }

  get canPaste(): boolean {
    return clipboard !== null && !this.sim;
  }

  copy(): void {
    const it = this.sel !== null ? this.item(this.sel) : undefined;
    if (!it) return;
    clipboard = structuredClone(it);
    this.hooks.status("Item copied.");
  }

  cut(): void {
    if (this.sim) return;
    this.copy();
    this.deleteSelection();
  }

  paste(at?: { x: number; y: number }): void {
    const c = clipboard;
    if (!c || this.sim) return;
    let id = 0;
    this.mutate(() => {
      id = this.s.items.reduce((m, i) => Math.max(m, i.id), 0) + 1;
      const x = at ? at.x - c.w / 2 : c.x + 20;
      const y = at ? at.y - c.h / 2 : c.y + 20;
      this.s.items.push({ ...structuredClone(c), id, x: clamp(snap(x), 0, SCREEN_W - c.w), y: clamp(snap(y), 0, SCREEN_H - c.h) });
    });
    this.sel = id;
    this.render();
  }

  // ----- Zoom -----

  get zoomPercent(): number {
    return Math.round(this.zoom * 100);
  }

  setZoom(z: number): void {
    const nz = clamp(z, MIN_ZOOM, MAX_ZOOM);
    const wx = this.scroller.scrollLeft / this.zoom;
    const wy = this.scroller.scrollTop / this.zoom;
    this.zoom = nz;
    this.render();
    this.scroller.scrollLeft = wx * nz;
    this.scroller.scrollTop = wy * nz;
    this.hooks.zoom(this.zoomPercent);
  }

  zoomBy(f: number): void {
    this.setZoom(this.zoom * f);
  }

  /** The whole screen in the window. */
  fit(): void {
    const w = this.scroller.clientWidth;
    const h = this.scroller.clientHeight;
    this.zoom = w > 0 && h > 0 ? clamp(Math.min((w - 30) / (SCREEN_W + 40), (h - 30) / (SCREEN_H + 40)), MIN_ZOOM, MAX_ZOOM) : 1;
    this.render();
    this.scroller.scrollLeft = 0;
    this.scroller.scrollTop = 0;
    this.hooks.zoom(this.zoomPercent);
  }

  cancelDrag(): void {
    if (this.drag?.t === "move") {
      this.drag = null;
      this.render();
    }
  }

  private worldPoint(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.svg.getBoundingClientRect();
    return { x: (clientX - r.left) / this.zoom - 20, y: (clientY - r.top) / this.zoom - 20 };
  }

  // ----- Mouse -----

  private sliderValue(it: ScadaItem, clientX: number): number {
    const p = this.worldPoint(clientX, 0);
    const f = clamp((p.x - it.x - 18) / (it.w - 36), 0, 1);
    const [lo, hi] = range(it);
    return Math.round(lo + (hi - lo) * f);
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.button === 1) {
      this.drag = { t: "pan", cx: e.clientX, cy: e.clientY, sl: this.scroller.scrollLeft, st: this.scroller.scrollTop };
      this.svg.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const g = (e.target as Element).closest<SVGElement>(".sitem");
    const it = g ? this.item(Number(g.dataset.id)) : undefined;
    if (this.sim) {
      // Operating the screen.
      if (!it || !it.tag) return;
      if (it.kind === "button") {
        this.held = it.id;
        this.svg.setPointerCapture(e.pointerId);
        this.hooks.press(it.tag, true);
        this.render();
      } else if (it.kind === "switch") {
        const now = this.sim ? (this.valueOf(it) === true) : false;
        this.hooks.toggle(it.tag, !now);
      } else if (it.kind === "slider") {
        this.drag = { t: "slider", id: it.id };
        this.svg.setPointerCapture(e.pointerId);
        this.hooks.analog(it.tag, this.sliderValue(it, e.clientX));
      }
      return;
    }
    if (!it) {
      this.sel = null;
      this.render();
      return;
    }
    const changed = this.sel !== it.id;
    this.sel = it.id;
    this.drag = { t: "move", id: it.id, cx: e.clientX, cy: e.clientY, ox: it.x, oy: it.y, moved: false, before: JSON.stringify(this.s) };
    this.svg.setPointerCapture(e.pointerId);
    if (changed) this.render();
  };

  private readonly onMove = (e: PointerEvent): void => {
    const dr = this.drag;
    if (!dr) return;
    if (dr.t === "pan") {
      this.scroller.scrollLeft = dr.sl - (e.clientX - dr.cx);
      this.scroller.scrollTop = dr.st - (e.clientY - dr.cy);
      return;
    }
    if (dr.t === "slider") {
      const it = this.item(dr.id);
      if (it) this.hooks.analog(it.tag, this.sliderValue(it, e.clientX));
      return;
    }
    const dx = (e.clientX - dr.cx) / this.zoom;
    const dy = (e.clientY - dr.cy) / this.zoom;
    if (!dr.moved && Math.hypot(dx, dy) * this.zoom < 4) return;
    dr.moved = true;
    const it = this.item(dr.id);
    if (!it) return;
    it.x = clamp(snap(dr.ox + dx), 0, SCREEN_W - it.w);
    it.y = clamp(snap(dr.oy + dy), 0, SCREEN_H - it.h);
    if (!this.raf) {
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.render();
      });
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (this.svg.hasPointerCapture(e.pointerId)) this.svg.releasePointerCapture(e.pointerId);
    if (this.held !== null) {
      const it = this.item(this.held);
      this.held = null;
      if (it) this.hooks.press(it.tag, false);
      this.render();
      return;
    }
    const dr = this.drag;
    this.drag = null;
    if (!dr || dr.t !== "move") return;
    if (dr.moved) {
      this.pushUndo(dr.before);
      this.touched();
      return;
    }
    const now = performance.now();
    if (this.lastClick?.id === dr.id && now - this.lastClick.t < 450) {
      this.lastClick = null;
      this.hooks.edit(dr.id);
    } else {
      this.lastClick = { id: dr.id, t: now };
    }
  };

  private readonly onContext = (e: MouseEvent): void => {
    e.preventDefault();
    if (this.sim) return;
    const g = (e.target as Element).closest<SVGElement>(".sitem");
    const at = this.worldPoint(e.clientX, e.clientY);
    let items: CtxEntry[];
    if (g) {
      const id = Number(g.dataset.id);
      this.sel = id;
      this.render();
      items = [
        { label: "Settings…", action: () => this.hooks.edit(id) },
        "-",
        { label: "Cut", shortcut: "Ctrl+X", action: () => this.cut() },
        { label: "Copy", shortcut: "Ctrl+C", action: () => this.copy() },
        { label: "Paste", shortcut: "Ctrl+V", enabled: this.canPaste, action: () => this.paste(at) },
        { label: "Delete", shortcut: "Del", action: () => this.deleteSelection() },
      ];
    } else {
      items = [
        { label: "Paste here", shortcut: "Ctrl+V", enabled: this.canPaste, action: () => this.paste(at) },
        { label: "Fit in window", action: () => this.fit() },
      ];
    }
    showContextMenu(e.clientX, e.clientY, items);
  };

  // ----- Drawing -----

  private valueOf(it: ScadaItem): boolean | number | null {
    return this.sim ? tagValue(this.sim, it.tag) : null;
  }

  private render(): void {
    const z = this.zoom;
    const w = SCREEN_W + 40;
    const h = SCREEN_H + 40;
    this.svg.setAttribute("width", String(Math.round(w * z)));
    this.svg.setAttribute("height", String(Math.round(h * z)));
    this.svg.setAttribute("viewBox", `-20 -20 ${w} ${h}`);
    this.svg.classList.toggle("simulating", this.sim !== null);
    let s =
      `<defs><pattern id="scadaGrid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="10" cy="10" r="0.8" fill="#c3cad3"/></pattern></defs>` +
      `<rect x="0" y="0" width="${SCREEN_W}" height="${SCREEN_H}" rx="6" fill="#f7f9fb" stroke="#8d96a3" stroke-width="2"/>` +
      (this.sim ? "" : `<rect x="0" y="0" width="${SCREEN_W}" height="${SCREEN_H}" fill="url(#scadaGrid)"/>`);
    if (this.s.items.length === 0 && !this.sim) {
      s += `<text x="${SCREEN_W / 2}" y="${SCREEN_H / 2}" text-anchor="middle" font-family="'Segoe UI', sans-serif" font-size="20" fill="#8d96a3">Drag items from the right onto this screen, then double-click each one to link it to a PLC point.</text>`;
    }
    for (const it of this.s.items) {
      const sel = this.sel === it.id;
      const err = this.errors.get(it.id);
      s += `<g class="sitem k-${it.kind}${this.sim && KINDS[it.kind]?.writes ? " live" : ""}" data-id="${it.id}" transform="translate(${it.x} ${it.y})">`;
      s += `<rect x="0" y="0" width="${it.w}" height="${it.h}" fill="transparent"/>`;
      if (err) s += `<rect x="-5" y="-5" width="${it.w + 10}" height="${it.h + 10}" fill="none" stroke="${RED}" stroke-width="2" stroke-dasharray="6 4"><title>${err.replace(/[<&]/g, "")}</title></rect>`;
      s += drawItem(it, this.valueOf(it), this.held === it.id);
      if (sel && !this.sim) {
        for (const [cx, cy] of [
          [0, 0],
          [it.w, 0],
          [0, it.h],
          [it.w, it.h],
        ] as const) {
          s += `<rect x="${cx - 6}" y="${cy - 6}" width="12" height="12" fill="${SEL}" stroke="#7a0c0c" pointer-events="none"/>`;
        }
      }
      s += `</g>`;
    }
    this.svg.innerHTML = s;
  }
}
