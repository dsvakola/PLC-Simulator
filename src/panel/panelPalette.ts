// The right pane of the Control Panel tab: field devices to put on the board
// or on the bench. Drag a device to where you want it, or double-click it.
import type { DeviceDef } from "../api";

export interface DevicePaletteHooks {
  add(kind: string): void;
  drop(kind: string, clientX: number, clientY: number): void;
  /** False while the simulation runs: nothing can be added then. */
  allowed(): boolean;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A small picture of a device for the list. */
function thumb(kind: string): string {
  const cyl = '<rect x="3" y="10" width="17" height="8" rx="1.5" fill="#b5bcc5" stroke="#5a626d"/><rect x="20" y="11" width="3" height="6" fill="#e05a2a"/>';
  const body: Record<string, string> = {
    pushNo: '<circle cx="14" cy="13" r="9" fill="#1d1d1d"/><circle cx="14" cy="13" r="6.5" fill="#2fa34a"/>',
    pushNc: '<circle cx="14" cy="13" r="9" fill="#1d1d1d"/><circle cx="14" cy="13" r="6.5" fill="#d9342b"/>',
    toggle: '<rect x="8" y="6" width="12" height="16" rx="2" fill="#2f363f"/><line x1="14" y1="17" x2="19" y2="7" stroke="#c9d0d8" stroke-width="3" stroke-linecap="round"/>',
    limitNo: '<rect x="4" y="11" width="14" height="10" rx="2" fill="#d4a017" stroke="#6b5420"/><line x1="17" y1="13" x2="23" y2="6" stroke="#444c56" stroke-width="2.5" stroke-linecap="round"/><circle cx="23" cy="6" r="2.5" fill="#e3e7ec" stroke="#444c56"/>',
    limitNc: '<rect x="4" y="11" width="14" height="10" rx="2" fill="#d4a017" stroke="#6b5420"/><line x1="17" y1="13" x2="23" y2="6" stroke="#444c56" stroke-width="2.5" stroke-linecap="round"/><circle cx="23" cy="6" r="2.5" fill="#e3e7ec" stroke="#444c56"/>',
    proxPnp: `${cyl}<circle cx="6" cy="7" r="2.5" fill="#ffd21f"/>`,
    prox2w: cyl,
    photoPnp: '<rect x="4" y="8" width="13" height="12" rx="2" fill="#3b4350"/><circle cx="17" cy="14" r="3" fill="#9fd3ff"/><line x1="20" y1="14" x2="26" y2="14" stroke="#ff4a3d" stroke-dasharray="2 1.5"/>',
    pot: '<circle cx="14" cy="15" r="8" fill="#3b4350"/><line x1="14" y1="15" x2="19" y2="10" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
    pt100: '<rect x="8" y="3" width="12" height="7" rx="2" fill="#3b4350"/><rect x="12" y="10" width="4" height="15" rx="2" fill="#c3c9d1" stroke="#6b737d"/>',
    lamp: '<circle cx="14" cy="14" r="9" fill="#1d1d1d"/><circle cx="14" cy="14" r="7" fill="#2fa34a"/>',
    buzzer: '<circle cx="14" cy="14" r="9" fill="#1d1d1d"/><circle cx="14" cy="14" r="6" fill="#2f363f"/><circle cx="14" cy="14" r="2" fill="#000"/>',
    hooter: '<path d="M4 11h5l8-5v16l-8-5H4z" fill="#c44a1e" stroke="#6a2a10" stroke-linejoin="round"/>',
    motor: '<rect x="3" y="7" width="17" height="14" rx="3" fill="#2c6fb5"/><text x="11.5" y="18" text-anchor="middle" font-family="Segoe UI, sans-serif" font-weight="800" font-size="10" fill="#fff">M</text><circle cx="23" cy="14" r="3.5" fill="#e3e7ec" stroke="#4b525c"/>',
    contactor: '<rect x="5" y="4" width="18" height="20" rx="2" fill="#e9ecef" stroke="#5a626d"/><rect x="10" y="8" width="8" height="5" fill="#8d96a3"/><text x="14" y="22" text-anchor="middle" font-family="Segoe UI, sans-serif" font-weight="800" font-size="7" fill="#1d2430">K</text>',
  };
  return `<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">${body[kind] ?? ""}</svg>`;
}

const GROUPS = ["Switches", "Sensors", "Analog", "Loads"];

export function buildDevicePalette(host: HTMLElement, catalog: DeviceDef[], hooks: DevicePaletteHooks): void {
  const groups = [...GROUPS, ...new Set(catalog.map((c) => c.group).filter((g) => !GROUPS.includes(g)))];
  host.innerHTML = groups
    .map((g) => {
      const items = catalog.filter((c) => c.group === g);
      if (items.length === 0) return "";
      return (
        `<div class="dev-group">${esc(g)}</div>` +
        items
          .map((c) => `<div class="dev-item" data-kind="${esc(c.kind)}" title="Drag onto the board or the bench, or double-click">${thumb(c.kind)}<span>${esc(c.name)}</span></div>`)
          .join("")
      );
    })
    .join("");

  host.addEventListener("dblclick", (e) => {
    const kind = (e.target as Element).closest<HTMLElement>(".dev-item")?.dataset.kind;
    if (kind && hooks.allowed()) hooks.add(kind);
  });

  host.addEventListener("pointerdown", (e) => {
    const el = (e.target as Element).closest<HTMLElement>(".dev-item");
    const kind = el?.dataset.kind;
    if (!el || !kind || e.button !== 0 || !hooks.allowed()) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let ghost: HTMLElement | null = null;
    const move = (ev: PointerEvent): void => {
      if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) {
        ghost = document.createElement("div");
        ghost.className = "drag-ghost";
        ghost.innerHTML = el.innerHTML;
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
        if (ev.type === "pointerup") hooks.drop(kind, ev.clientX, ev.clientY);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  });
}
