// Right-click menus. One menu is open at a time; it closes on a click
// outside it, on Esc, or when an item is chosen.

export interface CtxItem {
  label: string;
  shortcut?: string;
  enabled?: boolean;
  checked?: boolean;
  action: () => void;
}

export type CtxEntry = CtxItem | "-";

let open: HTMLElement | null = null;
let cleanup: (() => void) | null = null;

export function closeContextMenu(): void {
  cleanup?.();
  cleanup = null;
  open?.remove();
  open = null;
}

/** Shows a menu at the mouse position (client coordinates). */
export function showContextMenu(x: number, y: number, entries: CtxEntry[]): void {
  closeContextMenu();
  if (entries.length === 0) return;
  const m = document.createElement("div");
  m.className = "ctx-menu";
  m.setAttribute("role", "menu");
  for (const e of entries) {
    if (e === "-") {
      const sep = document.createElement("div");
      sep.className = "ctx-sep";
      m.appendChild(sep);
      continue;
    }
    const b = document.createElement("button");
    b.className = "ctx-item";
    b.setAttribute("role", "menuitem");
    b.disabled = e.enabled === false;
    const label = document.createElement("span");
    label.textContent = `${e.checked ? "✓ " : ""}${e.label}`;
    b.appendChild(label);
    if (e.shortcut) {
      const k = document.createElement("kbd");
      k.textContent = e.shortcut;
      b.appendChild(k);
    }
    b.addEventListener("click", () => {
      closeContextMenu();
      e.action();
    });
    m.appendChild(b);
  }
  document.body.appendChild(m);
  m.style.left = `${Math.min(x, window.innerWidth - m.offsetWidth - 4)}px`;
  m.style.top = `${Math.min(y, window.innerHeight - m.offsetHeight - 4)}px`;
  open = m;
  const outside = (ev: Event): void => {
    if (ev instanceof KeyboardEvent ? ev.key === "Escape" : !m.contains(ev.target as Node)) closeContextMenu();
  };
  const t = setTimeout(() => {
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", outside, true);
    window.addEventListener("blur", closeContextMenu);
  }, 0);
  cleanup = (): void => {
    clearTimeout(t);
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", outside, true);
    window.removeEventListener("blur", closeContextMenu);
  };
  (m.querySelector("button:not(:disabled)") as HTMLButtonElement | null)?.focus();
}

/** True while a right-click menu is open. */
export const contextMenuOpen = (): boolean => open !== null;
