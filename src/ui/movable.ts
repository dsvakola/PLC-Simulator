// Every dialog window can be moved by its title, so the student can look at
// the diagram or the panel behind it while changing settings.

/** The parts of a dialog that can be grabbed to move it. */
const HANDLES = "dialog > h2, .help-bar, .about-banner";
/** Parts that keep their own use even inside a title. */
const CONTROLS = "button, input, select, textarea, a, label";

export function makeDialogsMovable(): void {
  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const t = e.target as Element;
    const handle = t.closest<HTMLElement>(HANDLES);
    const d = handle?.closest<HTMLDialogElement>("dialog[open]");
    if (!handle || !d || t.closest(CONTROLS)) return;
    e.preventDefault();
    const r = d.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    // From now on the dialog sits where it is put, not in the middle.
    d.style.margin = "0";
    d.style.left = `${r.left}px`;
    d.style.top = `${r.top}px`;
    d.style.right = "auto";
    d.style.bottom = "auto";
    const move = (ev: PointerEvent): void => {
      // Keep the title on the screen, so the dialog can always be grabbed again.
      const x = Math.min(window.innerWidth - 60, Math.max(60 - r.width, ev.clientX - dx));
      const y = Math.min(window.innerHeight - 30, Math.max(0, ev.clientY - dy));
      d.style.left = `${x}px`;
      d.style.top = `${y}px`;
    };
    const end = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      document.body.classList.remove("moving-dialog");
    };
    document.body.classList.add("moving-dialog");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  });
}
