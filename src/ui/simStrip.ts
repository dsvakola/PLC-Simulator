// The strip under the diagram while the simulation runs, in the manner of the
// usual PLC software: one control for each input the program uses (a switch,
// a push button or a pulse generator, as set for that input), a lamp for
// each output, the analog values, and RUN / PAUSE / STOP with the clock.
// Everything is drawn here as SVG in our own style.
import type { Diagram, SimFrame } from "../api";
import type { ModeSetting } from "../panel/inputMode";

export interface StripHooks {
  /** The mouse went down or up on input switch "swI1" ... "swI4". */
  press(target: string, down: boolean): void;
  pause(paused: boolean): void;
  stop(): void;
  /** Opens the simulated clock settings. */
  clock(): void;
}

const svg = (body: string, w = 40, h = 34): string =>
  `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${body}</svg>`;

/** An on/off switch: "0 1" above a slide; the knob moves right and turns green when on. */
function switchIcon(on: boolean): string {
  return svg(
    `<text x="10" y="9" font-size="9" font-weight="700" font-family="Segoe UI, sans-serif" fill="#5a6270" text-anchor="middle">0</text>` +
      `<text x="30" y="9" font-size="9" font-weight="700" font-family="Segoe UI, sans-serif" fill="#5a6270" text-anchor="middle">1</text>` +
      `<rect x="3" y="13" width="34" height="16" rx="8" fill="${on ? "#bfe8c9" : "#e1e5ea"}" stroke="#4b525c" stroke-width="1.5"/>` +
      `<circle cx="${on ? 29 : 11}" cy="21" r="6.5" fill="${on ? "#1f9d47" : "#8d96a3"}" stroke="#2b2f36" stroke-width="1.2"/>`,
  );
}

/** A push button: pressed, the cap sinks and lights up. */
function buttonIcon(pressed: boolean, nc: boolean): string {
  return svg(
    `<rect x="5" y="3" width="30" height="28" rx="5" fill="#e1e5ea" stroke="#4b525c" stroke-width="1.5"/>` +
      `<circle cx="20" cy="${pressed ? 18 : 16}" r="${pressed ? 8 : 9}" fill="${pressed ? "#1f6fc4" : "#c9d0d8"}" stroke="#2b2f36" stroke-width="1.2"/>` +
      `<text x="20" y="${pressed ? 21 : 19}" font-size="7" font-weight="800" font-family="Segoe UI, sans-serif" fill="${pressed ? "#ffffff" : "#3b4350"}" text-anchor="middle">${nc ? "NC" : "NO"}</text>`,
  );
}

/** A pulse generator: a square wave with a light. */
function pulseIcon(on: boolean): string {
  return svg(
    `<rect x="3" y="3" width="34" height="28" rx="5" fill="#e1e5ea" stroke="#4b525c" stroke-width="1.5"/>` +
      `<path d="M7 24H12V10H19V24H26V10H33" fill="none" stroke="#2b2f36" stroke-width="2"/>` +
      `<circle cx="33" cy="6" r="3.5" fill="${on ? "#3bdc6c" : "#8d96a3"}"/>`,
  );
}

/** An input set by the wiring on the Control Panel: a terminal with a light. */
function wiredIcon(on: boolean): string {
  return svg(
    `<rect x="8" y="5" width="24" height="24" rx="4" fill="#b9bcc0" stroke="#3b3f46" stroke-width="1.5"/>` +
      `<circle cx="20" cy="17" r="6" fill="#f4f5f6" stroke="#2b2f36" stroke-width="1.5"/><path d="M16 21l8-8" stroke="#2b2f36" stroke-width="1.6"/>` +
      `<circle cx="33" cy="6" r="4" fill="${on ? "#3bdc6c" : "#8d96a3"}" stroke="#2b2f36" stroke-width="0.8"/>`,
  );
}

/** A lamp for an output: amber with rays when on. */
function lampIcon(on: boolean): string {
  const rays = on
    ? `<g stroke="#e0a100" stroke-width="2" stroke-linecap="round"><path d="M20 1v3M6 6l2.5 2.5M34 6l-2.5 2.5M2 16h3M38 16h-3"/></g>`
    : "";
  return svg(
    rays +
      `<path d="M13 22c-3-2.5-4.5-5-4.5-8a11.5 11.5 0 0 1 23 0c0 3-1.5 5.5-4.5 8z" fill="${on ? "#ffd84a" : "#d7dbe0"}" stroke="#4b525c" stroke-width="1.5"/>` +
      `<rect x="14" y="22" width="12" height="7" rx="1.5" fill="#8d96a3" stroke="#4b525c" stroke-width="1.2"/><path d="M14 25.5h12" stroke="#4b525c"/>`,
  );
}

/** A meter for an analog value (0 to 1000 = 0 to 10 V). */
function meterIcon(v: number): string {
  const f = Math.max(0, Math.min(1, v / 1000));
  return svg(
    `<rect x="3" y="11" width="34" height="12" rx="3" fill="#e1e5ea" stroke="#4b525c" stroke-width="1.5"/>` +
      `<rect x="4.5" y="12.5" width="${31 * f}" height="9" rx="2" fill="#1f6fc4"/>`,
  );
}

const CONTROLS = {
  run: svg(`<path d="M12 7l17 10-17 10z" fill="#1f9d47"/>`, 34, 34),
  pause: svg(`<rect x="10" y="8" width="5" height="18" rx="1" fill="#e08a00"/><rect x="19" y="8" width="5" height="18" rx="1" fill="#e08a00"/>`, 34, 34),
  stop: svg(`<rect x="9" y="9" width="16" height="16" rx="2" fill="#d33a32"/>`, 34, 34),
  clock: svg(`<circle cx="17" cy="17" r="11" fill="#ffffff" stroke="#1f6fc4" stroke-width="2.5"/><path d="M17 10v7l5 3" stroke="#1f6fc4" stroke-width="2.5" fill="none" stroke-linecap="round"/>`, 34, 34),
};

interface InputItem {
  n: number;
  el: HTMLElement;
  icon: HTMLElement;
  mode: ModeSetting | null;
}

export class SimStrip {
  private inputs: InputItem[] = [];
  private outputs: Array<{ n: number; icon: HTMLElement }> = [];
  private analog: Array<{ n: number; icon: HTMLElement; text: HTMLElement }> = [];
  private paused = false;
  private last = "";

  constructor(
    private readonly host: HTMLElement,
    private readonly hooks: StripHooks,
  ) {}

  /** Shows the strip for this program. `mode` gives the mode of inputs I1 to I4. */
  start(d: Diagram, mode: (n: number) => ModeSetting): void {
    const used = (k: string): number[] =>
      [...new Set(d.blocks.filter((b) => b.k === k).map((b) => (b as { n: number }).n))].sort((a, b) => a - b);
    const ins = used("input");
    const outs = used("output");
    const ais = used("analogInput");
    this.paused = false;
    this.last = "";
    this.host.innerHTML = "";
    this.inputs = [];
    this.outputs = [];
    this.analog = [];

    const group = (title: string): HTMLElement => {
      const g = document.createElement("div");
      g.className = "strip-group";
      g.setAttribute("aria-label", title);
      this.host.appendChild(g);
      return g;
    };
    const item = (g: HTMLElement, label: string, tip: string, button: boolean): { el: HTMLElement; icon: HTMLElement } => {
      const el = document.createElement(button ? "button" : "div");
      el.className = `strip-item${button ? " strip-btn" : ""}`;
      el.title = tip;
      const icon = document.createElement("span");
      icon.className = "strip-icon";
      const name = document.createElement("span");
      name.className = "strip-name";
      name.textContent = label;
      el.append(icon, name);
      g.appendChild(el);
      return { el, icon };
    };

    const gi = group("Inputs");
    for (const n of ins) {
      const m = n <= 4 ? mode(n) : null;
      const tip =
        m === null
          ? `I${n} is set by the devices wired on the Control Panel.`
          : m.mode === "switch"
            ? `I${n}: switch. Click to switch it on or off. Double-click an input block to change it.`
            : m.mode === "frequency"
              ? `I${n}: frequency, ${m.hz} Hz. It switches by itself. Double-click an input block to change it.`
              : `I${n}: momentary push button (${m.mode}). Hold the mouse button down to press it. Double-click an input block to change it.`;
      const it = item(gi, `I${n}`, tip, m !== null && m.mode !== "frequency");
      this.inputs.push({ n, el: it.el, icon: it.icon, mode: m });
      if (m && m.mode === "switch") {
        it.el.addEventListener("click", () => {
          this.hooks.press(`swI${n}`, true);
          this.hooks.press(`swI${n}`, false);
        });
      } else if (m && (m.mode === "make" || m.mode === "break")) {
        let down = false;
        const release = (): void => {
          if (!down) return;
          down = false;
          it.el.classList.remove("held");
          this.hooks.press(`swI${n}`, false);
        };
        it.el.addEventListener("pointerdown", (e) => {
          if (e.button !== 0) return;
          down = true;
          it.el.classList.add("held");
          this.hooks.press(`swI${n}`, true);
        });
        it.el.addEventListener("pointerup", release);
        it.el.addEventListener("pointerleave", release);
        it.el.addEventListener("pointercancel", release);
        it.el.addEventListener("blur", release);
      }
    }
    for (const n of ais) {
      const it = item(gi, `AI${n}`, `AI${n} (terminal I${n + 6}), set by the device wired on the Control Panel.`, false);
      const text = document.createElement("span");
      text.className = "strip-value";
      it.el.insertBefore(text, it.el.lastChild);
      this.analog.push({ n, icon: it.icon, text });
    }
    if (ins.length === 0 && ais.length === 0) {
      const none = document.createElement("span");
      none.className = "strip-none";
      none.textContent = "No inputs in the program";
      gi.appendChild(none);
    }

    const go = group("Outputs");
    for (const n of outs) {
      const it = item(go, `Q${n}`, `Output Q${n}`, false);
      this.outputs.push({ n, icon: it.icon });
    }
    if (outs.length === 0) {
      const none = document.createElement("span");
      none.className = "strip-none";
      none.textContent = "No outputs in the program";
      go.appendChild(none);
    }

    // RUN (already running), PAUSE, STOP and the clock.
    const gc = group("Simulation");
    gc.classList.add("strip-controls");
    const ctl = (name: keyof typeof CONTROLS, tip: string, act: () => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.className = `strip-ctl ${name}`;
      b.title = tip;
      b.setAttribute("aria-label", tip);
      b.innerHTML = CONTROLS[name];
      b.addEventListener("click", act);
      gc.appendChild(b);
      return b;
    };
    const run = ctl("run", "Running", () => undefined);
    run.disabled = true;
    const pause = ctl("pause", "Pause (time stands still)", () => {
      this.paused = !this.paused;
      pause.classList.toggle("on", this.paused);
      run.disabled = !this.paused;
      this.hooks.pause(this.paused);
    });
    run.addEventListener("click", () => {
      if (!this.paused) return;
      this.paused = false;
      pause.classList.remove("on");
      run.disabled = true;
      this.hooks.pause(false);
    });
    ctl("stop", "Stop the simulation (Esc)", () => this.hooks.stop());
    const time = document.createElement("span");
    time.className = "strip-time";
    gc.appendChild(time);
    ctl("clock", "Simulated clock: date, time and speed", () => this.hooks.clock());
    this.host.hidden = false;
    this.paused = false;
  }

  hide(): void {
    this.host.hidden = true;
    this.host.innerHTML = "";
    this.inputs = [];
    this.outputs = [];
    this.analog = [];
  }

  update(f: SimFrame): void {
    const key = JSON.stringify([f.inputs, f.outputs, f.analog, f.switches, f.clock, f.tripped]);
    if (key === this.last) return;
    this.last = key;
    for (const it of this.inputs) {
      const on = f.inputs[it.n - 1] ?? false;
      const m = it.mode;
      it.icon.innerHTML =
        m === null
          ? wiredIcon(on)
          : m.mode === "switch"
            ? switchIcon(on)
            : m.mode === "frequency"
              ? pulseIcon(on)
              : buttonIcon(f.switches[it.n - 1] ?? false, m.mode === "break");
      it.el.classList.toggle("on", on);
    }
    for (const o of this.outputs) o.icon.innerHTML = lampIcon(!f.tripped && (f.outputs[o.n - 1] ?? false));
    for (const a of this.analog) {
      const v = f.analog[a.n - 1] ?? 0;
      a.icon.innerHTML = meterIcon(v);
      a.text.textContent = String(v);
    }
    const t = this.host.querySelector(".strip-time");
    if (t) {
      const c = f.clock;
      const two = (n: number): string => String(n).padStart(2, "0");
      t.textContent = f.tripped ? "Supply off" : `${two(Math.floor(c.minute / 60))}:${two(c.minute % 60)}`;
      t.classList.toggle("bad", f.tripped);
      (t as HTMLElement).title = `${c.year}-${two(c.month)}-${two(c.day)}`;
    }
  }
}
