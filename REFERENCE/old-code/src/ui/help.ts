// Help > User Guide: the whole guide is part of the program, so it works offline.
import { errorText, openLink, type Link } from "../api";
import { icons } from "./icons";
import guide from "./help-body.html?raw";

let dialog: HTMLDialogElement | null = null;

function build(onError: (msg: string) => void): HTMLDialogElement {
  const d = document.createElement("dialog");
  d.className = "help";
  d.setAttribute("aria-label", "User Guide");
  d.innerHTML = `
    <div class="help-bar">
      <strong>User Guide</strong>
      <button class="icon-btn help-close" aria-label="Close" title="Close (Esc)">${icons.close}</button>
    </div>
    <div class="help-body">
      <nav class="help-nav" aria-label="Contents"></nav>
      <article class="help-text">${guide}</article>
    </div>`;
  const text = d.querySelector<HTMLElement>(".help-text");
  const nav = d.querySelector<HTMLElement>(".help-nav");
  if (text && nav) {
    // Contents list on the left, built from the section headings.
    for (const [i, h] of [...text.querySelectorAll<HTMLElement>("h2")].entries()) {
      h.id = `help-s${i}`;
      const a = document.createElement("a");
      a.href = `#help-s${i}`;
      a.textContent = h.textContent ?? "";
      a.addEventListener("click", (e) => {
        e.preventDefault();
        h.scrollIntoView({ block: "start" });
      });
      nav.appendChild(a);
    }
    // The only links that open outside the program: website, e-mail, GitHub.
    for (const a of text.querySelectorAll<HTMLAnchorElement>("a[data-link]")) {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        openLink((a.dataset.link ?? "website") as Link).catch((err: unknown) => onError(errorText(err)));
      });
    }
  }
  d.querySelector(".help-close")?.addEventListener("click", () => d.close());
  d.addEventListener("click", (e) => {
    if (e.target === d) d.close();
  });
  document.body.appendChild(d);
  return d;
}

export function showHelp(onError: (msg: string) => void): void {
  dialog ??= build(onError);
  if (!dialog.open) dialog.showModal();
}
