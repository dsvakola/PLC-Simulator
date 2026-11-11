// The source code of an example program, shown to read and copy.
import { icons } from "./icons";
import { errorText, openUrl, type ExampleSource } from "../api";

/** Web addresses and the academy e-mail in the code; trailing punctuation is left out. */
const LINK = /https?:\/\/[^\s<>"'`)\]]+|softinquiry@vsa\.edu\.in/g;

/** Fills `pre` with the code as text, with each link as a clickable element. */
function fillCode(pre: HTMLElement, code: string, onStatus: (msg: string) => void): void {
  let at = 0;
  for (const m of code.matchAll(LINK)) {
    let found = m[0];
    const trail = /[.,;:!?]+$/.exec(found);
    if (trail) found = found.slice(0, -trail[0].length);
    const start = m.index ?? 0;
    pre.appendChild(document.createTextNode(code.slice(at, start)));
    const url = found.includes("://") ? found : `mailto:${found}`;
    const a = document.createElement("a");
    a.className = "source-link";
    a.href = "#";
    a.textContent = found;
    a.title = url.startsWith("mailto:") ? `Write to ${found}` : `Open ${found}`;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      openUrl(url).catch((err: unknown) => onStatus(errorText(err)));
    });
    pre.appendChild(a);
    at = start + found.length;
  }
  pre.appendChild(document.createTextNode(code.slice(at)));
}

export function showSource(s: ExampleSource, onStatus: (msg: string) => void): void {
  const d = document.createElement("dialog");
  d.className = "source";
  d.setAttribute("aria-label", "Source code");
  d.innerHTML = `
    <div class="help-bar">
      <strong class="source-title"></strong>
      <span class="source-actions">
        <span class="source-copy-wrap">
          <button class="source-copy" type="button">Copy</button>
          <span class="source-toast" role="status" aria-live="polite"></span>
        </span>
        <button class="icon-btn source-close" aria-label="Close" title="Close (Esc)">${icons.close}</button>
      </span>
    </div>
    <pre class="source-text"></pre>`;
  const title = d.querySelector<HTMLElement>(".source-title");
  const text = d.querySelector<HTMLElement>(".source-text");
  if (title) title.textContent = s.name ? `${s.title} · ${s.name}` : s.title;
  if (text) fillCode(text, s.text, onStatus);
  const close = (): void => {
    d.close();
    d.remove();
  };
  d.querySelector(".source-close")?.addEventListener("click", close);
  d.addEventListener("cancel", () => d.remove());
  d.addEventListener("click", (e) => {
    if (e.target === d) close();
  });

  const copy = d.querySelector<HTMLButtonElement>(".source-copy");
  const toast = d.querySelector<HTMLElement>(".source-toast");
  let timer = 0;
  const notice = (msg: string, ok: boolean): void => {
    if (!copy || !toast) return;
    toast.textContent = msg;
    toast.classList.toggle("error", !ok);
    toast.classList.add("show");
    copy.textContent = ok ? "Copied" : "Copy";
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      toast.classList.remove("show");
      copy.textContent = "Copy";
    }, 1500);
  };
  copy?.addEventListener("click", () => {
    navigator.clipboard
      .writeText(s.text)
      .then(() => {
        notice("Copied to clipboard", true);
        onStatus("Source code copied. Paste it into the Arduino IDE, Keil or Thonny.");
      })
      .catch(() => {
        // Clipboard not available: select the text so Ctrl+C works.
        if (text) {
          const r = document.createRange();
          r.selectNodeContents(text);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(r);
        }
        notice("Could not copy", false);
        onStatus("Could not copy. The code is selected: press Ctrl+C to copy it.");
      });
  });
  document.body.appendChild(d);
  d.showModal();
}
