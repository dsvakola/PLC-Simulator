// Small question boxes and settings forms.
import { icons } from "./icons";

export interface Choice {
  id: string;
  label: string;
  primary?: boolean;
}

/** A small question box with up to three buttons. Resolves to the chosen
 *  button's id, or "cancel" if the box is closed. */
export function ask(title: string, message: string, choices: Choice[]): Promise<string> {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = "ask";
    d.innerHTML = `<button class="icon-btn about-close" aria-label="Close">${icons.close}</button><h2></h2><p></p><div class="ask-buttons"></div>`;
    const h = d.querySelector("h2");
    const p = d.querySelector("p");
    if (h) h.textContent = title;
    if (p) p.textContent = message;
    const row = d.querySelector(".ask-buttons");
    let answer = "cancel";
    for (const c of choices) {
      const b = document.createElement("button");
      b.className = c.primary ? "btn primary" : "btn";
      b.textContent = c.label;
      b.addEventListener("click", () => {
        answer = c.id;
        d.close();
      });
      row?.appendChild(b);
    }
    d.querySelector(".about-close")?.addEventListener("click", () => d.close());
    d.addEventListener("close", () => {
      d.remove();
      resolve(answer);
    });
    document.body.appendChild(d);
    d.showModal();
  });
}

/** Asks for a number, such as an angle. Resolves to null if cancelled. */
export function askNumber(title: string, label: string, value: number, unit: string): Promise<number | null> {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = "ask";
    d.innerHTML = `<button class="icon-btn about-close" aria-label="Close" type="button">${icons.close}</button><h2></h2>
      <form method="dialog"><label class="ask-field"><span></span><input type="number" step="any" required /><em></em></label>
      <div class="ask-buttons"><button class="btn" value="cancel" type="button">Cancel</button><button class="btn primary" value="ok">OK</button></div></form>`;
    const h = d.querySelector("h2");
    if (h) h.textContent = title;
    const span = d.querySelector(".ask-field span");
    if (span) span.textContent = label;
    const em = d.querySelector(".ask-field em");
    if (em) em.textContent = unit;
    const input = d.querySelector("input") as HTMLInputElement;
    input.value = String(value);
    let result: number | null = null;
    d.querySelector("form")?.addEventListener("submit", () => {
      const n = Number(input.value);
      result = Number.isFinite(n) ? n : null;
    });
    d.querySelector(".btn:not(.primary)")?.addEventListener("click", () => d.close());
    d.querySelector(".about-close")?.addEventListener("click", () => d.close());
    d.addEventListener("close", () => {
      d.remove();
      resolve(result);
    });
    document.body.appendChild(d);
    d.showModal();
    input.select();
  });
}

export type FormField =
  | { id: string; label: string; type: "heading" }
  | { id: string; label: string; type: "check"; value: boolean; hint?: string }
  | { id: string; label: string; type: "text"; value: string; maxLength?: number; hint?: string }
  | { id: string; label: string; type: "time"; value: string; hint?: string }
  /** A date as YYYY-MM-DD. */
  | { id: string; label: string; type: "date"; value: string; hint?: string }
  /** Seven day boxes, Monday first; the value is a number with one bit per day. */
  | { id: string; label: string; type: "days"; value: number; hint?: string }
  | { id: string; label: string; type: "select"; value: string; options: Array<[string, string]>; hint?: string }
  | {
      id: string;
      label: string;
      type: "number";
      value: string;
      min: number;
      max: number;
      step: number | "any";
      unit: string;
      hint?: string;
    };

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A settings form. Resolves to the chosen values (days come back as the
 *  number written as text), or null if cancelled. */
export function askForm(
  title: string,
  fields: FormField[],
  okLabel = "OK",
): Promise<Record<string, string | boolean> | null> {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = "ask form";
    d.innerHTML = `<button class="icon-btn about-close" aria-label="Close" type="button">${icons.close}</button><h2></h2>
      <form method="dialog"><div class="form-rows"></div>
      <div class="ask-buttons"><button class="btn" value="cancel" type="button">Cancel</button><button class="btn primary" value="ok"></button></div></form>`;
    const h = d.querySelector("h2");
    if (h) h.textContent = title;
    const ok = d.querySelector(".btn.primary");
    if (ok) ok.textContent = okLabel;
    const rows = d.querySelector(".form-rows");
    const collect: Array<[string, () => string | boolean]> = [];
    for (const f of fields) {
      if (f.type === "heading") {
        const head = document.createElement("div");
        head.className = "form-heading";
        head.textContent = f.label;
        rows?.appendChild(head);
        continue;
      }
      const row = document.createElement("label");
      row.className = `form-row ${f.type}`;
      const name = document.createElement("span");
      name.textContent = f.label;
      if (f.type === "check") {
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = f.value;
        row.append(input, name);
        collect.push([f.id, () => input.checked]);
      } else if (f.type === "number") {
        const input = document.createElement("input");
        input.type = "number";
        input.min = String(f.min);
        input.max = String(f.max);
        input.step = String(f.step);
        input.value = f.value;
        input.required = true;
        const box = document.createElement("span");
        box.className = "form-number";
        const unit = document.createElement("span");
        unit.textContent = f.unit;
        box.append(input, unit);
        row.append(name, box);
        collect.push([f.id, () => input.value]);
      } else if (f.type === "text" || f.type === "time" || f.type === "date") {
        const input = document.createElement("input");
        input.type = f.type;
        input.value = f.value;
        if (f.type === "text") input.maxLength = f.maxLength ?? 60;
        row.append(name, input);
        collect.push([f.id, () => input.value]);
      } else if (f.type === "days") {
        const box = document.createElement("span");
        box.className = "form-days";
        const boxes: HTMLInputElement[] = [];
        DAY_NAMES.forEach((dn, i) => {
          const cell = document.createElement("span");
          const input = document.createElement("input");
          input.type = "checkbox";
          input.checked = (f.value >> i) & 1 ? true : false;
          boxes.push(input);
          const lab = document.createElement("small");
          lab.textContent = dn;
          cell.append(input, lab);
          box.appendChild(cell);
        });
        row.append(name, box);
        collect.push([f.id, () => String(boxes.reduce((m, b, i) => m | ((b.checked ? 1 : 0) << i), 0))]);
      } else {
        const sel = document.createElement("select");
        for (const [v, l] of f.options) {
          const o = document.createElement("option");
          o.value = v;
          o.textContent = l;
          sel.appendChild(o);
        }
        sel.value = f.value;
        row.append(name, sel);
        collect.push([f.id, () => sel.value]);
      }
      if (f.hint) {
        const em = document.createElement("em");
        em.textContent = f.hint;
        row.appendChild(em);
      }
      rows?.appendChild(row);
    }
    let result: Record<string, string | boolean> | null = null;
    d.querySelector("form")?.addEventListener("submit", () => {
      result = {};
      for (const [id, get] of collect) result[id] = get();
    });
    d.querySelector(".btn:not(.primary)")?.addEventListener("click", () => d.close());
    d.querySelector(".about-close")?.addEventListener("click", () => d.close());
    d.addEventListener("close", () => {
      d.remove();
      resolve(result);
    });
    document.body.appendChild(d);
    d.showModal();
  });
}
