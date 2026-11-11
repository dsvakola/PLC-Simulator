// Menu bar (File, Edit, View, ...) and right-click menus.
// Menus are rebuilt each time they open, so ticks and greyed items are current.

export type MenuItem =
  | "-"
  | {
      label: string;
      shortcut?: string;
      action?: () => void;
      enabled?: () => boolean;
      checked?: () => boolean;
      /** Colour dot shown before the label. */
      color?: string;
      submenu?: () => MenuItem[];
    };

export interface MenuDef {
  label: string;
  items: () => MenuItem[];
}

let openPopup: HTMLElement | null = null;
let onClosed: (() => void) | null = null;

export function closeMenus(): void {
  openPopup?.remove();
  openPopup = null;
  const cb = onClosed;
  onClosed = null;
  cb?.();
}

function buildList(items: MenuItem[], close: () => void): HTMLElement {
  const list = document.createElement("div");
  list.className = "menu-popup";
  list.setAttribute("role", "menu");
  for (const item of items) {
    if (item === "-") {
      const sep = document.createElement("div");
      sep.className = "menu-sep";
      list.appendChild(sep);
      continue;
    }
    const b = document.createElement("button");
    b.className = "menu-item";
    b.setAttribute("role", "menuitem");
    const enabled = item.enabled ? item.enabled() : true;
    b.disabled = !enabled;
    const tick = item.checked?.() ? "✓" : "";
    const dot = item.color ? `<i class="menu-dot" style="--c:${item.color}"></i>` : "";
    b.innerHTML = `<span class="menu-tick">${tick}</span>${dot}<span class="menu-label"></span><span class="menu-key"></span>${item.submenu ? '<span class="menu-more">›</span>' : ""}`;
    const label = b.querySelector(".menu-label");
    if (label) label.textContent = item.label;
    const keyNode = b.querySelector(".menu-key");
    if (keyNode) keyNode.textContent = item.shortcut ?? "";
    if (item.submenu) {
      const sub = item.submenu;
      let child: HTMLElement | null = null;
      const show = (): void => {
        if (child || !enabled) return;
        for (const other of list.querySelectorAll(":scope > .menu-item > .menu-popup")) other.remove();
        child = buildList(sub(), close);
        child.classList.add("sub");
        b.appendChild(child);
        keepOnScreen(child);
      };
      b.addEventListener("pointerenter", show);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        show();
      });
      b.addEventListener("pointerleave", (e) => {
        if (child && !child.contains(e.relatedTarget as Node)) {
          child.remove();
          child = null;
        }
      });
    } else {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        close();
        item.action?.();
      });
    }
    list.appendChild(b);
  }
  // A list with no submenus may scroll when it is taller than the window
  // (File > Examples). Lists holding submenus must not, or they clip them.
  if (!items.some((i) => i !== "-" && i.submenu)) list.classList.add("leaf");
  return list;
}

/** Moves a popup back inside the window if it would stick out. */
function keepOnScreen(node: HTMLElement): void {
  const r = node.getBoundingClientRect();
  if (r.right > window.innerWidth - 4) {
    if (node.classList.contains("sub")) node.classList.add("left");
    else node.style.left = `${Math.max(4, window.innerWidth - r.width - 4)}px`;
  }
  if (r.bottom > window.innerHeight - 4) {
    const top = Math.max(4, window.innerHeight - r.height - 4);
    if (node.classList.contains("sub")) node.style.top = `${top - r.top}px`;
    else node.style.top = `${top}px`;
  }
}

/** Shows a menu at a screen position (right-click). */
export function showContextMenu(items: MenuItem[], x: number, y: number): void {
  closeMenus();
  const list = buildList(items, closeMenus);
  list.classList.add("context");
  list.style.left = `${x}px`;
  list.style.top = `${y}px`;
  document.body.appendChild(list);
  openPopup = list;
  keepOnScreen(list);
}

/** Builds the menu bar into `host`. */
export function buildMenuBar(host: HTMLElement, menus: MenuDef[]): void {
  host.setAttribute("role", "menubar");
  const buttons: HTMLButtonElement[] = [];
  const open = (i: number): void => {
    closeMenus();
    const b = buttons[i];
    const m = menus[i];
    if (!b || !m) return;
    b.classList.add("open");
    const list = buildList(m.items(), closeMenus);
    const r = b.getBoundingClientRect();
    list.style.left = `${r.left}px`;
    list.style.top = `${r.bottom}px`;
    document.body.appendChild(list);
    openPopup = list;
    keepOnScreen(list);
    onClosed = () => b.classList.remove("open");
  };
  menus.forEach((m, i) => {
    const b = document.createElement("button");
    b.className = "menubar-item";
    b.textContent = m.label;
    b.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (b.classList.contains("open")) closeMenus();
      else open(i);
    });
    b.addEventListener("pointerenter", () => {
      if (openPopup && !b.classList.contains("open") && buttons.some((o) => o.classList.contains("open"))) open(i);
    });
    buttons.push(b);
    host.appendChild(b);
  });
}

// Close on any click outside, on Esc, and when the window loses focus.
// Capture phase, so a right-click can close the old menu before opening a new one.
document.addEventListener(
  "pointerdown",
  (e) => {
    const t = e.target as Element;
    if (openPopup && !openPopup.contains(t) && !t.closest?.(".menubar-item")) closeMenus();
  },
  true,
);
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Escape" && openPopup) {
      closeMenus();
      e.stopPropagation();
      e.preventDefault();
    }
  },
  true,
);
window.addEventListener("blur", () => closeMenus());
window.addEventListener("resize", () => closeMenus());

/** True while a menu is open (keyboard shortcuts wait). */
export const menuOpen = (): boolean => openPopup !== null;
