// The diagram editor: a drawing area with a dotted grid where the student
// places blocks, moves them and joins them with wires. Zoom with Ctrl and the
// mouse wheel. Everything is drawn as SVG, so it stays sharp at any zoom and
// on any screen scaling.
//
// It works like the usual PLC software: drag from a pin to another pin (a
// straight line follows the mouse, and the nearest pin that fits is picked);
// wires run at right angles and find their own way. A selected wire
// shows red squares on its corners and blue dots on its pieces: drag them (or
// the wire itself) to change its path; double-click one to let the path be
// drawn automatically again. Ctrl+A selects everything,
// a frame drawn on an empty spot selects the blocks inside it, Shift+click
// adds a block, and the selected blocks move together. The middle mouse
// button moves the view.
import type { Block, BlockKind, Diagram, DiagramError, Point, Wire } from "../api";
import { GRID, defaultLabel, geometry, pinTypes, symbolOf } from "./model";
import { showContextMenu, type CtxEntry } from "../ui/contextMenu";
import { LIMITS } from "../limits";
import { fromClicks, fullPath, moveCorner, movePiece, pathData, pieceAt, simplify, type Around } from "./wires";

const NS = "http://www.w3.org/2000/svg";
const FILL = "#FFDF8C";
const INK = "#111111";
const BLUE = "#1f6fc4";
const RED = "#d33a32";
/** While simulating, as in the usual PLC software: a signal that is 1 is red, a signal that is 0 is blue. */
const LIVE = "#e0201b";
const LIVE_OFF = "#1f4fd6";
const SEL = "#e0201b";
const OK_PIN = "#2fa34a";
const TNR = "'Times New Roman', Times, serif";
const CAL = "Calibri, Carlito, 'Segoe UI', sans-serif";
/** 11 pt and 10 pt in drawing units (1 pt = 96/72 units at 100% zoom). */
const SIZE_DEFAULT_LABEL = (11 * 96) / 72;
const SIZE_USER_LABEL = (10 * 96) / 72;
const MAX_CORNERS = 64;
const HANDLE_BLUE = "#1a3fd6";

/** Blocks that were copied (with the wires between them), shared by Copy and Paste. */
let clipboard: { blocks: Block[]; wires: Wire[] } | null = null;

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
const MAX_UNDO = 200;

export interface EditorHooks {
  /** The diagram was changed by the student. */
  changed(): void;
  status(text: string, isError?: boolean): void;
  history(canUndo: boolean, canRedo: boolean): void;
  /** Zoom in percent. */
  zoom(percent: number): void;
  /** The student asked to change the settings of a block (double-click). */
  edit(id: number): void;
}

interface PinRef {
  block: number;
  dir: "in" | "out";
  idx: number;
}

type Sel = { t: "blocks"; ids: Set<number> } | { t: "wire"; i: number } | null;

type Drag =
  | {
      t: "move";
      ids: number[];
      /** The block that was grabbed (for a double-click). */
      id: number;
      cx: number;
      cy: number;
      orig: Map<number, Point>;
      corners: Map<number, Point[]>;
      moved: boolean;
      before: string;
    }
  | {
      /** Moving the default name (I1, Q1 ...) or the student's name of a block. */
      t: "name";
      id: number;
      which: "title" | "label";
      cx: number;
      cy: number;
      ox: number;
      oy: number;
      moved: boolean;
      before: string;
    }
  /** Drawing a new wire from a pin (`moved`: the mouse has left the pin). */
  | { t: "wire"; from: PinRef; x: number; y: number; sx: number; sy: number; moved: boolean }
  /** A frame that selects the blocks inside it. */
  | { t: "box"; x0: number; y0: number; x: number; y: number; add: boolean }
  /** Changing the path of a wire: one of its pieces, or one of its corners. */
  | { t: "piece"; i: number; piece: number; base: Point[]; cx: number; cy: number; moved: boolean; before: string }
  | { t: "corner"; i: number; k: number; base: Point[]; cx: number; cy: number; moved: boolean; before: string }
  /** Moving the view with the middle mouse button. */
  | { t: "pan"; cx: number; cy: number; sl: number; st: number };

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const snap = (v: number): number => Math.round(v / GRID) * GRID;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));


/** The value an unwired input of a gate counts as, or null for other blocks. */
function freeInputValue(k: BlockKind["k"]): string | null {
  if (k === "and" || k === "nand") return "1";
  if (k === "or" || k === "nor" || k === "xor" || k === "xnor") return "0";
  return null;
}

export class FbdEditor {
  private d: Diagram = { blocks: [], wires: [], scanMs: 10 };
  private zoom = 1;
  private sel: Sel = null;
  private errors = new Map<number, string>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private readonly svg: SVGSVGElement;
  private drag: Drag | null = null;
  private raf = 0;
  private lastClick: { key: string; t: number } | null = null;
  /** The pin under the pointer while a wire is drawn, and whether it can take the wire. */
  private hover: (PinRef & { ok: boolean }) | null = null;
  /** Output values of the blocks while the simulation runs; null otherwise. */
  private live: Map<number, boolean | number> | null = null;
  private liveKey = "";

  constructor(
    private readonly scroller: HTMLElement,
    private readonly hooks: EditorHooks,
  ) {
    this.svg = document.createElementNS(NS, "svg");
    this.svg.classList.add("diagram");
    this.svg.setAttribute("role", "img");
    this.svg.setAttribute("aria-label", "Function block diagram");
    scroller.appendChild(this.svg);
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
        const r = scroller.getBoundingClientRect();
        this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false },
    );
    this.render();
  }

  // ----- The diagram -----

  get diagram(): Diagram {
    return this.d;
  }

  /** Shows a diagram (the one of the open project). It is edited in place. */
  setDiagram(d: Diagram): void {
    this.d = d;
    this.sel = null;
    // Wires from version 0.0.4 kept clicked corners; turn them into paths.
    for (const w of d.wires) {
      w.corners ??= [];
      const old = w.points ?? [];
      if (old.length > 0 && w.corners.length === 0) {
        const ends = this.wireEnds(w);
        if (ends) w.corners = fromClicks(ends[0], old, ends[1]);
      }
      w.points = [];
    }
    this.errors.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.zoom = 1;
    this.scroller.scrollLeft = 0;
    this.scroller.scrollTop = 0;
    this.render();
    this.hooks.history(false, false);
    this.hooks.zoom(100);
  }

  private block(id: number): Block | undefined {
    return this.d.blocks.find((b) => b.id === id);
  }

  /** Marks the blocks that have mistakes (from Check program). */
  setErrors(errors: DiagramError[]): void {
    this.errors.clear();
    for (const e of errors) {
      if (e.block !== null && !this.errors.has(e.block)) this.errors.set(e.block, e.message);
    }
    this.render();
  }

  /** Shows the program running: [block id, output value] pairs, or null when it stops. */
  setLive(values: Array<[number, boolean | number]> | null): void {
    const key = values ? JSON.stringify(values) : "";
    if (key === this.liveKey) return;
    this.liveKey = key;
    this.live = values ? new Map(values) : null;
    this.render();
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
    const before = JSON.stringify(this.d);
    change();
    this.pushUndo(before);
    this.touched();
  }

  private restore(json: string): void {
    const o = JSON.parse(json) as Diagram;
    this.d.blocks = o.blocks;
    this.d.wires = o.wires;
    this.d.scanMs = o.scanMs;
    this.sel = null;
    this.touched();
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(JSON.stringify(this.d));
    this.restore(prev);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(JSON.stringify(this.d));
    this.restore(next);
  }

  // ----- Placing, changing and deleting blocks -----

  /** Adds a block with its top-left corner at (x, y) in drawing units. */
  addBlock(kind: BlockKind, x: number, y: number): void {
    let id = 0;
    this.mutate(() => {
      id = this.d.blocks.reduce((m, b) => Math.max(m, b.id), 0) + 1;
      this.d.blocks.push({
        ...kind,
        id,
        x: Math.max(40, snap(x)),
        y: Math.max(40, snap(y)),
        label: "",
        titleDx: 0,
        titleDy: 0,
        labelDx: 0,
        labelDy: 0,
      } as Block);
    });
    this.sel = { t: "blocks", ids: new Set([id]) };
    this.render();
  }

  /** Puts a block in the first free place of the visible area. Sources go on
   *  the left, outputs on the right, so wires run from left to right. */
  addAtFreeSpot(kind: BlockKind): void {
    const g = geometry(kind);
    const left = snap(this.scroller.scrollLeft / this.zoom) + 60;
    const top = snap(this.scroller.scrollTop / this.zoom) + 60;
    const column = g.ins.length === 0 ? 0 : kind.k === "output" ? 2 : 1;
    const free = (x: number, y: number): boolean =>
      !this.d.blocks.some((b) => {
        const o = geometry(b);
        return x < b.x + o.w + 60 && x + g.w + 60 > b.x && y < b.y + o.h + 60 && y + g.h + 60 > b.y;
      });
    for (let c = column; c < column + 4; c++) {
      const x = left + c * 240;
      for (let row = 0; row < 40; row++) {
        const y = top + row * 20;
        if (free(x, y)) {
          this.addBlock(kind, x, y);
          return;
        }
      }
    }
    this.addBlock(kind, left, top);
  }

  /** Places a block where the student dropped it. False if it is not over the editor. */
  dropAt(kind: BlockKind, clientX: number, clientY: number): boolean {
    const r = this.scroller.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return false;
    const p = this.worldPoint(clientX, clientY);
    this.addBlock(kind, p.x, p.y - geometry(kind).h / 2);
    return true;
  }

  /** Applies new settings from the properties dialog. */
  applyEdit(id: number, kind: BlockKind, label: string, resetNames = false): void {
    const i = this.d.blocks.findIndex((b) => b.id === id);
    const old = this.d.blocks[i];
    if (!old) return;
    let removed = 0;
    this.mutate(() => {
      this.d.blocks[i] = {
        ...kind,
        id: old.id,
        x: old.x,
        y: old.y,
        label,
        titleDx: resetNames ? 0 : (old.titleDx ?? 0),
        titleDy: resetNames ? 0 : (old.titleDy ?? 0),
        labelDx: resetNames ? 0 : (old.labelDx ?? 0),
        labelDy: resetNames ? 0 : (old.labelDy ?? 0),
      } as Block;
      removed = this.pruneWires();
    });
    if (removed > 0) {
      this.hooks.status(`${removed} wire${removed === 1 ? "" : "s"} no longer fitted the block and ${removed === 1 ? "was" : "were"} removed.`);
    }
  }

  /** Removes wires that end at pins their block no longer has. */
  private pruneWires(): number {
    const before = this.d.wires.length;
    this.d.wires = this.d.wires.filter((w) => {
      const f = this.block(w.fromBlock);
      const t = this.block(w.toBlock);
      if (!f || !t) return false;
      const out = pinTypes(f).outs[w.fromPin];
      const inp = pinTypes(t).ins[w.toPin];
      return out !== undefined && out === inp;
    });
    return before - this.d.wires.length;
  }

  /** Selects every block (Ctrl+A), so they can be moved together. */
  selectAll(): void {
    if (this.d.blocks.length === 0) return;
    this.sel = { t: "blocks", ids: new Set(this.d.blocks.map((b) => b.id)) };
    this.render();
    this.hooks.status(`${this.d.blocks.length} blocks selected. Drag one of them to move them all.`);
  }

  deleteSelection(): void {
    const sel = this.sel;
    if (!sel) return;
    this.mutate(() => {
      if (sel.t === "blocks") {
        this.d.blocks = this.d.blocks.filter((b) => !sel.ids.has(b.id));
        this.d.wires = this.d.wires.filter((w) => !sel.ids.has(w.fromBlock) && !sel.ids.has(w.toBlock));
      } else {
        this.d.wires = this.d.wires.filter((_, i) => i !== sel.i);
      }
      this.sel = null;
    });
  }

  get hasSelection(): boolean {
    return this.sel !== null;
  }

  // ----- Cut, copy and paste -----

  private selectedIds(): Set<number> {
    return this.sel?.t === "blocks" ? this.sel.ids : new Set();
  }

  get canCopy(): boolean {
    return this.selectedIds().size > 0;
  }

  get canPaste(): boolean {
    return clipboard !== null && clipboard.blocks.length > 0;
  }

  /** Copies the selected blocks and the wires between them. */
  copy(): void {
    const ids = this.selectedIds();
    if (ids.size === 0) return;
    clipboard = {
      blocks: this.d.blocks.filter((b) => ids.has(b.id)).map((b) => structuredClone(b)),
      wires: this.d.wires.filter((w) => ids.has(w.fromBlock) && ids.has(w.toBlock)).map((w) => structuredClone(w)),
    };
    this.hooks.status(`${ids.size} block${ids.size === 1 ? "" : "s"} copied.`);
  }

  cut(): void {
    if (!this.canCopy) return;
    this.copy();
    this.deleteSelection();
  }

  /** Pastes the copied blocks: at `at` (drawing units), or a little below and right of the originals. */
  paste(at?: Point): void {
    const clip = clipboard;
    if (!clip || clip.blocks.length === 0) return;
    const minX = Math.min(...clip.blocks.map((b) => b.x));
    const minY = Math.min(...clip.blocks.map((b) => b.y));
    const dx = at ? snap(at.x) - minX : 40;
    const dy = at ? snap(at.y) - minY : 40;
    const ids = new Map<number, number>();
    this.mutate(() => {
      let next = this.d.blocks.reduce((m, b) => Math.max(m, b.id), 0);
      // Each output Q may be used once: a pasted output gets a free number.
      const usedQ = new Set(this.d.blocks.filter((b) => b.k === "output").map((b) => (b as { n: number }).n));
      for (const b of clip.blocks) {
        const nb = structuredClone(b);
        nb.id = ++next;
        nb.x = Math.max(40, b.x + dx);
        nb.y = Math.max(40, b.y + dy);
        if (nb.k === "output" && usedQ.has(nb.n)) {
          for (let n = 1; n <= LIMITS.outputs; n++) {
            if (!usedQ.has(n)) {
              nb.n = n;
              break;
            }
          }
        }
        if (nb.k === "output") usedQ.add(nb.n);
        ids.set(b.id, nb.id);
        this.d.blocks.push(nb);
      }
      for (const w of clip.wires) {
        const from = ids.get(w.fromBlock);
        const to = ids.get(w.toBlock);
        if (from === undefined || to === undefined) continue;
        this.d.wires.push({ ...structuredClone(w), fromBlock: from, toBlock: to, corners: w.corners.map((p) => ({ x: p.x + dx, y: p.y + dy })) });
      }
    });
    this.sel = { t: "blocks", ids: new Set(ids.values()) };
    this.render();
    this.hooks.status(`${ids.size} block${ids.size === 1 ? "" : "s"} pasted. Drag them where you want them.`);
  }

  // ----- Right-click menus -----

  private readonly onContext = (e: MouseEvent): void => {
    e.preventDefault();
    if (this.drag) return;
    const t = e.target as Element;
    const at = this.worldPoint(e.clientX, e.clientY);
    const blk = t.closest<SVGElement>(".blk, .nm");
    const wire = t.closest<SVGElement>(".wire, .corner, .piece");
    let items: CtxEntry[];
    if (blk?.dataset.id) {
      const id = Number(blk.dataset.id);
      if (!this.selected(id)) this.sel = { t: "blocks", ids: new Set([id]) };
      this.render();
      const many = this.selectedIds().size > 1;
      items = [
        { label: "Settings…", enabled: !many, action: () => this.hooks.edit(id) },
        "-",
        { label: "Cut", shortcut: "Ctrl+X", action: () => this.cut() },
        { label: "Copy", shortcut: "Ctrl+C", action: () => this.copy() },
        { label: "Paste", shortcut: "Ctrl+V", enabled: this.canPaste, action: () => this.paste(at) },
        { label: many ? "Delete the selected blocks" : "Delete", shortcut: "Del", action: () => this.deleteSelection() },
        "-",
        { label: "Select all", shortcut: "Ctrl+A", action: () => this.selectAll() },
      ];
    } else if (wire) {
      const i = Number(wire.dataset.i ?? wire.dataset.wire);
      const w = this.d.wires[i];
      if (!w) return;
      this.sel = { t: "wire", i };
      this.render();
      items = [
        {
          label: "Automatic path",
          enabled: (w.corners?.length ?? 0) > 0,
          action: () =>
            this.mutate(() => {
              w.corners = [];
            }),
        },
        { label: "Delete wire", shortcut: "Del", action: () => this.deleteSelection() },
      ];
    } else {
      items = [
        { label: "Paste here", shortcut: "Ctrl+V", enabled: this.canPaste, action: () => this.paste(at) },
        { label: "Select all", shortcut: "Ctrl+A", enabled: this.d.blocks.length > 0, action: () => this.selectAll() },
        "-",
        { label: "Fit in window", action: () => this.fit() },
        { label: "Zoom 100%", shortcut: "Ctrl+0", action: () => this.setZoom(1) },
      ];
    }
    showContextMenu(e.clientX, e.clientY, items);
  };

  private selected(id: number): boolean {
    return this.sel?.t === "blocks" && this.sel.ids.has(id);
  }

  // ----- Wires -----

  private pinPos(b: Block, dir: "in" | "out", idx: number): Point | null {
    const g = geometry(b);
    const p = (dir === "in" ? g.ins : g.outs)[idx];
    return p ? { x: b.x + p.x, y: b.y + p.y } : null;
  }

  /** Why a wire from `a` cannot end at `b`, or null if it can. */
  private refusal(a: PinRef, b: PinRef): string | null {
    if (a.dir === b.dir) return "Join an output (right side) to an input (left side).";
    const out = a.dir === "out" ? a : b;
    const inp = a.dir === "in" ? a : b;
    const ob = this.block(out.block);
    const ib = this.block(inp.block);
    if (!ob || !ib) return "";
    const ot = pinTypes(ob).outs[out.idx];
    const it = pinTypes(ib).ins[inp.idx];
    if (!ot || !it) return "";
    if (ot !== it) return ot === "bit" ? "A digital output cannot be joined to an analog input." : "An analog output cannot be joined to a digital input.";
    if (this.d.wires.some((w) => w.toBlock === inp.block && w.toPin === inp.idx)) return "This input already has a wire. Delete the old wire first.";
    return null;
  }

  private connect(a: PinRef, b: PinRef): void {
    const why = this.refusal(a, b);
    if (why !== null) {
      if (why) this.hooks.status(why, true);
      return;
    }
    const out = a.dir === "out" ? a : b;
    const inp = a.dir === "in" ? a : b;
    const ob = this.block(out.block);
    const ib = this.block(inp.block);
    if (!ob || !ib) return;
    // The path is found automatically; it can be changed afterwards.
    this.mutate(() => {
      this.d.wires.push({ fromBlock: out.block, fromPin: out.idx, toBlock: inp.block, toPin: inp.idx, points: [], corners: [] });
    });
    this.sel = { t: "wire", i: this.d.wires.length - 1 };
    this.render();
  }

  private wireEnds(w: Wire): [Point, Point] | null {
    const f = this.block(w.fromBlock);
    const t = this.block(w.toBlock);
    const a = f ? this.pinPos(f, "out", w.fromPin) : null;
    const b = t ? this.pinPos(t, "in", w.toPin) : null;
    return a && b ? [a, b] : null;
  }

  /** The space above and below the two blocks a wire joins. */
  private around(w: Wire): Around | undefined {
    const f = this.block(w.fromBlock);
    const t = this.block(w.toBlock);
    if (!f || !t) return undefined;
    const gf = geometry(f);
    const gt = geometry(t);
    // Above the names over the blocks, below the blocks (and the student's names).
    const top = snap(Math.min(f.y, t.y) - 40);
    const bottom = snap(Math.max(f.y + gf.h + (f.label ? 30 : 0), t.y + gt.h + (t.label ? 30 : 0)) + 30);
    return { top, bottom };
  }

  /** Every point of a wire's path, from the output to the input. */
  private wirePath(w: Wire): Point[] | null {
    const ends = this.wireEnds(w);
    return ends ? fullPath(ends[0], w.corners ?? [], ends[1], this.around(w)) : null;
  }

  /** After blocks moved: a wire whose two blocks moved together keeps its
   *  path; a wire to a block that moved alone finds its way again. */
  private rerouteWires(moved: Set<number>): void {
    for (const w of this.d.wires) {
      const both = moved.has(w.fromBlock) && moved.has(w.toBlock);
      if (!both && (moved.has(w.fromBlock) || moved.has(w.toBlock))) w.corners = [];
    }
  }

  /** The nearest pin that can take a wire from `from`, within reach of `p`. */
  private nearestPin(from: PinRef, p: Point): PinRef | null {
    let best: PinRef | null = null;
    let bestD = 22;
    const dir: "in" | "out" = from.dir === "out" ? "in" : "out";
    for (const b of this.d.blocks) {
      const g = geometry(b);
      (dir === "in" ? g.ins : g.outs).forEach((q, idx) => {
        const d = Math.hypot(b.x + q.x - p.x, b.y + q.y - p.y);
        const ref: PinRef = { block: b.id, dir, idx };
        if (d < bestD && this.refusal(from, ref) === null) {
          bestD = d;
          best = ref;
        }
      });
    }
    return best;
  }

  /** The pin a wire being drawn would end at: the pin under the mouse, or the nearest one that fits. */
  private targetPin(from: PinRef, clientX: number, clientY: number): (PinRef & { ok: boolean }) | null {
    const hit = this.pinAt(clientX, clientY);
    const same = hit && hit.block === from.block && hit.dir === from.dir && hit.idx === from.idx;
    if (hit && !same) return { ...hit, ok: this.refusal(from, hit) === null };
    const near = this.nearestPin(from, this.worldPoint(clientX, clientY));
    return near ? { ...near, ok: true } : null;
  }

  private pinAt(clientX: number, clientY: number): PinRef | null {
    const el = document.elementFromPoint(clientX, clientY)?.closest<SVGElement>(".pin");
    if (!el || !this.svg.contains(el)) return null;
    return { block: Number(el.dataset.id), dir: el.dataset.dir === "in" ? "in" : "out", idx: Number(el.dataset.idx) };
  }

  // ----- Zoom -----

  get zoomPercent(): number {
    return Math.round(this.zoom * 100);
  }

  /** Sets the zoom, keeping the point (px, py) of the visible area where it is. */
  setZoom(z: number, px = this.scroller.clientWidth / 2, py = this.scroller.clientHeight / 2): void {
    const nz = clamp(z, MIN_ZOOM, MAX_ZOOM);
    const wx = (this.scroller.scrollLeft + px) / this.zoom;
    const wy = (this.scroller.scrollTop + py) / this.zoom;
    this.zoom = nz;
    this.render();
    this.scroller.scrollLeft = wx * nz - px;
    this.scroller.scrollTop = wy * nz - py;
    this.hooks.zoom(Math.round(nz * 100));
  }

  zoomBy(factor: number): void {
    this.setZoom(this.zoom * factor);
  }

  /** Zooms so that the whole diagram fits in the window. */
  fit(): void {
    if (this.d.blocks.length === 0) {
      this.setZoom(1);
      return;
    }
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const b of this.d.blocks) {
      const g = geometry(b);
      x0 = Math.min(x0, b.x - 20);
      y0 = Math.min(y0, b.y - 30);
      x1 = Math.max(x1, b.x + g.w + 20);
      y1 = Math.max(y1, b.y + g.h + 40);
    }
    const z = clamp(
      Math.min((this.scroller.clientWidth - 40) / (x1 - x0), (this.scroller.clientHeight - 40) / (y1 - y0), 2),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    this.zoom = z;
    this.render();
    this.scroller.scrollLeft = x0 * z - 20;
    this.scroller.scrollTop = y0 * z - 20;
    this.hooks.zoom(Math.round(z * 100));
  }

  private worldPoint(clientX: number, clientY: number): Point {
    const r = this.svg.getBoundingClientRect();
    return { x: (clientX - r.left) / this.zoom, y: (clientY - r.top) / this.zoom };
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

  private startMove(e: PointerEvent, id: number): void {
    // Shift+click adds a block to the selection or takes it out again.
    if (e.shiftKey) {
      const ids = this.sel?.t === "blocks" ? new Set(this.sel.ids) : new Set<number>();
      if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      this.sel = ids.size ? { t: "blocks", ids } : null;
    } else if (!this.selected(id)) {
      this.sel = { t: "blocks", ids: new Set([id]) };
    }
    if (!this.selected(id)) {
      this.render();
      return;
    }
    const ids = this.sel?.t === "blocks" ? [...this.sel.ids] : [id];
    const set = new Set(ids);
    const orig = new Map<number, Point>();
    for (const b of this.d.blocks) if (set.has(b.id)) orig.set(b.id, { x: b.x, y: b.y });
    // Corners of wires between moving blocks move with them.
    const corners = new Map<number, Point[]>();
    this.d.wires.forEach((w, i) => {
      if (set.has(w.fromBlock) && set.has(w.toBlock) && w.corners?.length) corners.set(i, w.corners.map((p) => ({ ...p })));
    });
    this.drag = { t: "move", ids, id, cx: e.clientX, cy: e.clientY, orig, corners, moved: false, before: JSON.stringify(this.d) };
    this.svg.setPointerCapture(e.pointerId);
    this.render();
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.button === 1) {
      this.drag = { t: "pan", cx: e.clientX, cy: e.clientY, sl: this.scroller.scrollLeft, st: this.scroller.scrollTop };
      this.svg.setPointerCapture(e.pointerId);
      this.svg.classList.add("panning");
      return;
    }
    if (e.button !== 0) return;
    // While a wire is drawn, clicks are handled when the button goes up.
    if (this.drag?.t === "wire") return;
    const t = e.target as Element;
    const pin = t.closest<SVGElement>(".pin");
    if (pin) {
      const p = this.worldPoint(e.clientX, e.clientY);
      this.drag = {
        t: "wire",
        from: { block: Number(pin.dataset.id), dir: pin.dataset.dir === "in" ? "in" : "out", idx: Number(pin.dataset.idx) },
        x: p.x,
        y: p.y,
        sx: e.clientX,
        sy: e.clientY,
        moved: false,
      };
      this.sel = null;
      this.hooks.status("Drag to another pin and let go to join them. Esc cancels.");
      return;
    }
    const handle = t.closest<SVGElement>(".corner, .piece");
    if (handle?.dataset.wire) {
      const i = Number(handle.dataset.wire);
      const w = this.d.wires[i];
      const base = w ? this.wirePath(w) : null;
      if (!w || !base) return;
      const isCorner = handle.classList.contains("corner");
      const key = isCorner ? `c:${i}:${handle.dataset.k}` : `p:${i}:${handle.dataset.piece}`;
      if (this.doubleClick(key)) {
        this.mutate(() => {
          w.corners = [];
        });
        this.hooks.status("The wire's path is drawn automatically again.");
        return;
      }
      const before = JSON.stringify(this.d);
      this.drag = isCorner
        ? { t: "corner", i, k: Number(handle.dataset.k), base, cx: e.clientX, cy: e.clientY, moved: false, before }
        : { t: "piece", i, piece: Number(handle.dataset.piece), base, cx: e.clientX, cy: e.clientY, moved: false, before };
      this.svg.setPointerCapture(e.pointerId);
      return;
    }
    const name = t.closest<SVGElement>(".nm");
    if (name) {
      // A block's name: drag it to move it; a click selects the block.
      const id = Number(name.dataset.id);
      const b = this.block(id);
      if (!b) return;
      const which = name.dataset.which === "label" ? "label" : "title";
      const changed = !this.selected(id);
      this.sel = { t: "blocks", ids: new Set([id]) };
      this.drag = {
        t: "name",
        id,
        which,
        cx: e.clientX,
        cy: e.clientY,
        ox: which === "label" ? (b.labelDx ?? 0) : (b.titleDx ?? 0),
        oy: which === "label" ? (b.labelDy ?? 0) : (b.titleDy ?? 0),
        moved: false,
        before: JSON.stringify(this.d),
      };
      this.svg.setPointerCapture(e.pointerId);
      if (changed) this.render();
      return;
    }
    const blk = t.closest<SVGElement>(".blk");
    if (blk) {
      this.startMove(e, Number(blk.dataset.id));
      return;
    }
    const wire = t.closest<SVGElement>(".wire");
    if (wire) {
      // Select the wire; dragging it moves the piece that was grabbed.
      const i = Number(wire.dataset.i);
      const w = this.d.wires[i];
      const base = w ? this.wirePath(w) : null;
      this.sel = { t: "wire", i };
      if (base) {
        const piece = pieceAt(base, this.worldPoint(e.clientX, e.clientY));
        this.drag = { t: "piece", i, piece, base, cx: e.clientX, cy: e.clientY, moved: false, before: JSON.stringify(this.d) };
        this.svg.setPointerCapture(e.pointerId);
      }
      this.render();
      return;
    }
    // An empty spot: draw a frame to select blocks.
    const p = this.worldPoint(e.clientX, e.clientY);
    if (!e.shiftKey) this.sel = null;
    this.drag = { t: "box", x0: p.x, y0: p.y, x: p.x, y: p.y, add: e.shiftKey };
    this.svg.setPointerCapture(e.pointerId);
    this.render();
  };

  private readonly onMove = (e: PointerEvent): void => {
    const dr = this.drag;
    if (!dr) return;
    if (dr.t === "pan") {
      this.scroller.scrollLeft = dr.sl - (e.clientX - dr.cx);
      this.scroller.scrollTop = dr.st - (e.clientY - dr.cy);
      return;
    }
    if (dr.t === "move") {
      const dx = (e.clientX - dr.cx) / this.zoom;
      const dy = (e.clientY - dr.cy) / this.zoom;
      if (!dr.moved && Math.hypot(dx, dy) * this.zoom < 4) return;
      dr.moved = true;
      // The whole group moves by the same whole number of grid steps and stays on the sheet.
      let minX = Infinity;
      let minY = Infinity;
      for (const o of dr.orig.values()) {
        minX = Math.min(minX, o.x);
        minY = Math.min(minY, o.y);
      }
      const sx = Math.max(snap(dx), 40 - minX);
      const sy = Math.max(snap(dy), 40 - minY);
      for (const b of this.d.blocks) {
        const o = dr.orig.get(b.id);
        if (!o) continue;
        b.x = o.x + sx;
        b.y = o.y + sy;
      }
      for (const [i, pts] of dr.corners) {
        const w = this.d.wires[i];
        if (w) w.corners = pts.map((p) => ({ x: p.x + sx, y: p.y + sy }));
      }
    } else if (dr.t === "name") {
      const dx = (e.clientX - dr.cx) / this.zoom;
      const dy = (e.clientY - dr.cy) / this.zoom;
      if (!dr.moved && Math.hypot(dx, dy) * this.zoom < 4) return;
      dr.moved = true;
      const b = this.block(dr.id);
      if (!b) return;
      const nx = Math.round(dr.ox + dx);
      const ny = Math.round(dr.oy + dy);
      if (dr.which === "label") {
        b.labelDx = nx;
        b.labelDy = ny;
      } else {
        b.titleDx = nx;
        b.titleDy = ny;
      }
    } else if (dr.t === "piece" || dr.t === "corner") {
      if (!dr.moved && Math.hypot(e.clientX - dr.cx, e.clientY - dr.cy) < 4) return;
      dr.moved = true;
      const w = this.d.wires[dr.i];
      if (!w) return;
      const p = this.worldPoint(e.clientX, e.clientY);
      const to = { x: snap(p.x), y: snap(p.y) };
      const next = dr.t === "piece" ? movePiece(dr.base, dr.piece, to) : moveCorner(dr.base, dr.k, to);
      if (next.length <= MAX_CORNERS) w.corners = next;
    } else if (dr.t === "box") {
      const p = this.worldPoint(e.clientX, e.clientY);
      dr.x = p.x;
      dr.y = p.y;
    } else {
      const p = this.worldPoint(e.clientX, e.clientY);
      dr.x = p.x;
      dr.y = p.y;
      if (Math.hypot(e.clientX - dr.sx, e.clientY - dr.sy) > 5) dr.moved = true;
      // Show the pin the wire would end at, green if it fits, red if not.
      this.hover = this.targetPin(dr.from, e.clientX, e.clientY);
    }
    this.schedule();
  };

  private readonly onUp = (e: PointerEvent): void => {
    const dr = this.drag;
    if (!dr) return;
    if (dr.t === "wire") {
      // A click on a pin (without dragging): the wire follows the mouse until the next click.
      if (!dr.moved) return;
      const target = this.targetPin(dr.from, e.clientX, e.clientY);
      this.drag = null;
      this.hover = null;
      // A pin that does not fit says why.
      if (target) this.connect(dr.from, target);
      else this.hooks.status("No wire: let go on a pin to join two blocks.");
      this.render();
      return;
    }
    this.drag = null;
    if (this.svg.hasPointerCapture(e.pointerId)) this.svg.releasePointerCapture(e.pointerId);
    if (dr.t === "pan") {
      this.svg.classList.remove("panning");
      return;
    }
    if (dr.t === "move" || dr.t === "name") {
      if (dr.moved) {
        if (dr.t === "move") this.rerouteWires(new Set(dr.ids));
        this.pushUndo(dr.before);
        this.touched();
      } else {
        if (this.doubleClick(`b:${dr.id}`)) this.hooks.edit(dr.id);
        this.render();
      }
    } else if (dr.t === "piece" || dr.t === "corner") {
      const w = this.d.wires[dr.i];
      const ends = w ? this.wireEnds(w) : null;
      if (dr.moved && w && ends) {
        w.corners = simplify(ends[0], w.corners, ends[1]);
        this.pushUndo(dr.before);
        this.touched();
        this.hooks.status("Wire path changed. Double-click a red square or blue dot to let it be drawn automatically again.");
      } else {
        this.render();
      }
    } else if (dr.t === "box") {
      const x0 = Math.min(dr.x0, dr.x);
      const x1 = Math.max(dr.x0, dr.x);
      const y0 = Math.min(dr.y0, dr.y);
      const y1 = Math.max(dr.y0, dr.y);
      const ids = dr.add && this.sel?.t === "blocks" ? new Set(this.sel.ids) : new Set<number>();
      if (x1 - x0 > 4 || y1 - y0 > 4) {
        for (const b of this.d.blocks) {
          const g = geometry(b);
          if (b.x >= x0 && b.y >= y0 && b.x + g.w <= x1 && b.y + g.h <= y1) ids.add(b.id);
        }
      }
      this.sel = ids.size ? { t: "blocks", ids } : null;
      if (ids.size > 1) this.hooks.status(`${ids.size} blocks selected. Drag one of them to move them all.`);
      this.render();
    } else {
      this.render();
    }
  };

  /** Cancels a wire that is being drawn (Esc). */
  cancelDrag(): void {
    if (this.drag?.t === "wire") {
      this.drag = null;
      this.hover = null;
      this.render();
      this.hooks.status("Wire cancelled.");
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

  private worldSize(): { w: number; h: number } {
    let w = Math.max(2400, this.scroller.clientWidth / this.zoom);
    let h = Math.max(1600, this.scroller.clientHeight / this.zoom);
    for (const b of this.d.blocks) {
      const g = geometry(b);
      w = Math.max(w, b.x + g.w + 600);
      h = Math.max(h, b.y + g.h + 400);
    }
    return { w, h };
  }

  /** Colour of a digital signal while simulating (red 1, blue 0), or plain ink. */
  private signalColor(v: boolean | number | undefined): string {
    if (!this.live || typeof v !== "boolean") return INK;
    return v ? LIVE : LIVE_OFF;
  }

  private blockSvg(b: Block, wiredIns: Set<string>, inValues: Map<string, boolean | number>): string {
    const g = geometry(b);
    const sym = symbolOf(b);
    const selected = this.selected(b.id);
    const error = this.errors.get(b.id);
    let s = `<g class="blk" data-id="${b.id}" transform="translate(${b.x} ${b.y})">`;
    // Pin stubs; while simulating they show the signal on them, like the wires.
    const out = this.live?.get(b.id);
    s += `<g stroke-width="2">`;
    g.ins.forEach((p, i) => {
      const c = wiredIns.has(`${b.id}:${i}`) ? this.signalColor(inValues.get(`${b.id}:${i}`)) : INK;
      s += `<line x1="${p.x}" y1="${p.y}" x2="0" y2="${p.y}" stroke="${c}"/>`;
    });
    for (const p of g.outs) s += `<line x1="${g.w}" y1="${p.y}" x2="${p.x}" y2="${p.y}" stroke="${this.signalColor(out)}"/>`;
    s += `</g>`;
    if (error) {
      s += `<rect x="-7" y="-7" width="${g.w + 14}" height="${g.h + 14}" fill="none" stroke="${RED}" stroke-width="2" stroke-dasharray="6 4"><title>${esc(error)}</title></rect>`;
    }
    // The box: #FFDF8C with a 3 unit #111111 border and square corners.
    // While simulating, a block whose output is 1 gets a red frame.
    s += `<rect x="0" y="0" width="${g.w}" height="${g.h}" fill="${FILL}" stroke="${out === true ? LIVE : INK}" stroke-width="3"/>`;
    if (sym.negated) {
      const p = g.outs[0];
      if (p) s += `<circle cx="${g.w + 6}" cy="${p.y}" r="6" fill="#ffffff" stroke="${INK}" stroke-width="2"/>`;
    }
    if (sym.big) {
      s += `<text x="${g.w / 2}" y="${g.h / 2 + 8}" text-anchor="middle" font-family="${TNR}" font-size="24" fill="${INK}">${esc(sym.big)}</text>`;
    }
    const lines = sym.small;
    lines.forEach((line, i) => {
      const y = g.h / 2 + (i - (lines.length - 1) / 2) * 20 + 5;
      s += `<text x="${g.w / 2}" y="${y}" text-anchor="middle" font-family="${TNR}" font-size="${SIZE_DEFAULT_LABEL}" fill="${INK}">${esc(line)}</text>`;
    });
    // An unwired gate input counts as 1 (AND, NAND) or 0 (OR, NOR, XOR): show it.
    const free = freeInputValue(b.k);
    if (free) {
      g.ins.forEach((p, i) => {
        if (!wiredIns.has(`${b.id}:${i}`)) {
          s += `<text x="${p.x + 6}" y="${p.y - 4}" font-family="${CAL}" font-size="12" font-weight="700" fill="#8a94a3" pointer-events="none">${free}<title>A free input counts as ${free}</title></text>`;
        }
      });
    }
    // While running: the value of an analog output beside it.
    const v = this.live?.get(b.id);
    if (typeof v === "number" && g.outs[0]) {
      s += `<text x="${g.w + 4}" y="${(g.outs[0]?.y ?? 0) - 6}" font-family="${CAL}" font-size="13" font-weight="700" fill="${LIVE}" pointer-events="none">${v}</text>`;
    }
    // The default name sits above the block. The student's own name sits below
    // it, centred. Both can be dragged to another place.
    const tx = b.titleDx ?? 0;
    const ty = -9 + (b.titleDy ?? 0);
    s += `<text class="nm" data-id="${b.id}" data-which="title" x="${tx}" y="${ty}" font-family="${TNR}" font-size="${SIZE_DEFAULT_LABEL}" fill="${INK}" pointer-events="bounding-box">${esc(defaultLabel(b))}</text>`;
    if (b.label) {
      const lx = g.w / 2 + (b.labelDx ?? 0);
      const ly = g.h + 20 + (b.labelDy ?? 0);
      s += `<text class="nm" data-id="${b.id}" data-which="label" x="${lx}" y="${ly}" text-anchor="middle" font-family="${CAL}" font-size="${SIZE_USER_LABEL}" fill="${INK}" pointer-events="bounding-box">${esc(b.label)}</text>`;
    }
    // Selected: four red squares on the corners, as in the usual PLC software.
    if (selected) {
      for (const [cx, cy] of [
        [0, 0],
        [g.w, 0],
        [0, g.h],
        [g.w, g.h],
      ] as const) {
        s += `<rect x="${cx - 6}" y="${cy - 6}" width="12" height="12" fill="${SEL}" stroke="#7a0c0c" stroke-width="1" pointer-events="none"/>`;
      }
    }
    // Pins to grab: an invisible round target at the end of each stub.
    const pinCircle = (dir: "in" | "out", idx: number, x: number, y: number, bit: boolean): string =>
      `<circle class="pin" data-id="${b.id}" data-dir="${dir}" data-idx="${idx}" cx="${x}" cy="${y}" r="9" pointer-events="all"><title>${bit ? "Digital" : "Analog"} ${dir === "in" ? "input" : "output"}</title></circle>`;
    g.ins.forEach((p, i) => (s += pinCircle("in", i, p.x, p.y, p.type === "bit")));
    g.outs.forEach((p, i) => (s += pinCircle("out", i, p.x, p.y, p.type === "bit")));
    return s + `</g>`;
  }

  private render(): void {
    const { w, h } = this.worldSize();
    const z = this.zoom;
    this.svg.setAttribute("width", String(Math.round(w * z)));
    this.svg.setAttribute("height", String(Math.round(h * z)));
    this.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    let s = `<defs><pattern id="dots" x="-10" y="-10" width="${GRID}" height="${GRID}" patternUnits="userSpaceOnUse"><circle cx="10" cy="10" r="0.6" fill="#b4bcc8"/></pattern></defs>`;
    s += `<rect width="${w}" height="${h}" fill="#ffffff"/>`;
    if (z >= 0.4) s += `<rect width="${w}" height="${h}" fill="url(#dots)"/>`;
    const wiredIns = new Set(this.d.wires.map((wr) => `${wr.toBlock}:${wr.toPin}`));
    let corners = "";
    this.d.wires.forEach((wr, i) => {
      const ends = this.wireEnds(wr);
      if (!ends) return;
      const [a, b] = ends;
      const full = fullPath(a, wr.corners ?? [], b, this.around(wr));
      const path = pathData(full);
      const sel = this.sel?.t === "wire" && this.sel.i === i;
      const color = sel ? BLUE : this.signalColor(this.live?.get(wr.fromBlock));
      s += `<g class="wire" data-i="${i}"><path d="${path}" fill="none" stroke="transparent" stroke-width="12" pointer-events="stroke"/><path d="${path}" fill="none" stroke="${color}" stroke-width="${sel ? 3 : 2}"/></g>`;
      if (sel) {
        // Blue dots on the pieces, red squares on the corners, as in the usual PLC software.
        for (let k = 0; k < full.length - 1; k++) {
          const p = full[k] as Point;
          const q = full[k + 1] as Point;
          if (Math.hypot(q.x - p.x, q.y - p.y) < 16) continue;
          corners += `<circle class="piece" data-wire="${i}" data-piece="${k}" cx="${(p.x + q.x) / 2}" cy="${(p.y + q.y) / 2}" r="7" fill="${HANDLE_BLUE}" stroke="#0b1d6b" stroke-width="1"><title>Drag to move this piece of the wire. Double-click: automatic path.</title></circle>`;
        }
        for (let k = 1; k < full.length - 1; k++) {
          const p = full[k] as Point;
          corners += `<rect class="corner" data-wire="${i}" data-k="${k}" x="${p.x - 6}" y="${p.y - 6}" width="12" height="12" fill="${SEL}" stroke="#7a0c0c" stroke-width="1"><title>Drag to move this corner. Double-click: automatic path.</title></rect>`;
        }
      }
    });
    const inValues = new Map<string, boolean | number>();
    if (this.live) {
      for (const wr of this.d.wires) {
        const v = this.live.get(wr.fromBlock);
        if (v !== undefined) inValues.set(`${wr.toBlock}:${wr.toPin}`, v);
      }
    }
    for (const b of this.d.blocks) s += this.blockSvg(b, wiredIns, inValues);
    s += corners;
    const dr = this.drag;
    if (dr?.t === "wire") {
      const b = this.block(dr.from.block);
      const a = b ? this.pinPos(b, dr.from.dir, dr.from.idx) : null;
      if (a) {
        const end = { x: dr.x, y: dr.y };
        // A straight line from the pin to the mouse (or to the pin it would join).
        const hb = this.hover ? this.block(this.hover.block) : undefined;
        const hp = this.hover && hb ? this.pinPos(hb, this.hover.dir, this.hover.idx) : null;
        const to = hp ?? end;
        const path = `M${a.x} ${a.y}L${to.x} ${to.y}`;
        s += `<path d="${path}" fill="none" stroke="${BLUE}" stroke-width="2" stroke-dasharray="6 4" pointer-events="none"/>`;
      }
      const hv = this.hover;
      const hb = hv ? this.block(hv.block) : undefined;
      const hp = hv && hb ? this.pinPos(hb, hv.dir, hv.idx) : null;
      if (hv && hp) {
        const c = hv.ok ? OK_PIN : RED;
        s += `<circle cx="${hp.x}" cy="${hp.y}" r="12" fill="${c}" opacity="0.25" pointer-events="none"/><circle cx="${hp.x}" cy="${hp.y}" r="6" fill="${c}" pointer-events="none"/>`;
      }
    }
    if (dr?.t === "box") {
      s += `<rect x="${Math.min(dr.x0, dr.x)}" y="${Math.min(dr.y0, dr.y)}" width="${Math.abs(dr.x - dr.x0)}" height="${Math.abs(dr.y - dr.y0)}" fill="${BLUE}" fill-opacity="0.08" stroke="${BLUE}" stroke-width="1.5" stroke-dasharray="5 4" pointer-events="none"/>`;
    }
    this.svg.innerHTML = s;
  }
}
