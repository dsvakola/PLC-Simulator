// The left pane's instruction tree. Blocks are placed by dragging them onto
// the drawing area, or by double-clicking them.
import { icons } from "../ui/icons";
import { PALETTE, findPaletteItem, type PaletteItem } from "./model";

export interface PaletteHooks {
  /** Double-click: put the block in a free place of the drawing area. */
  add(item: PaletteItem): void;
  /** Dropped at a screen position. */
  drop(item: PaletteItem, clientX: number, clientY: number): void;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function buildPalette(host: HTMLElement, hooks: PaletteHooks): void {
  host.innerHTML = PALETTE.map(
    (g) => `<div class="tree-group" data-open="true">
      <button class="tree-folder" type="button"><span class="chev">${icons.chevron}</span>${icons.folder}<span>${esc(g.title)}</span></button>
      <div class="tree-items">${g.items
        .map(
          (i) =>
            `<div class="pal-item" data-id="${i.id}" title="${esc(i.hint)}"><span class="chip">${esc(i.chip)}</span><span class="pal-name">${esc(i.name)}</span></div>`,
        )
        .join("")}</div>
    </div>`,
  ).join("");

  host.addEventListener("click", (e) => {
    const folder = (e.target as Element).closest<HTMLElement>(".tree-folder");
    const group = folder?.parentElement;
    if (group) group.dataset.open = group.dataset.open === "true" ? "false" : "true";
  });

  host.addEventListener("dblclick", (e) => {
    const el = (e.target as Element).closest<HTMLElement>(".pal-item");
    const item = el?.dataset.id ? findPaletteItem(el.dataset.id) : undefined;
    if (item) hooks.add(item);
  });

  host.addEventListener("pointerdown", (e) => {
    const el = (e.target as Element).closest<HTMLElement>(".pal-item");
    const item = el?.dataset.id ? findPaletteItem(el.dataset.id) : undefined;
    if (!el || !item || e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let ghost: HTMLElement | null = null;
    const move = (ev: PointerEvent): void => {
      if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) {
        ghost = document.createElement("div");
        ghost.className = "drag-ghost";
        ghost.innerHTML = `<span class="chip">${esc(item.chip)}</span><span>${esc(item.name)}</span>`;
        document.body.appendChild(ghost);
      }
      if (ghost) {
        ghost.style.left = `${ev.clientX + 12}px`;
        ghost.style.top = `${ev.clientY + 8}px`;
      }
    };
    const end = (ev: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (ghost) {
        ghost.remove();
        if (ev.type === "pointerup") hooks.drop(item, ev.clientX, ev.clientY);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  });
}
