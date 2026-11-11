// The About box. Name and version come from Rust, which reads tauri.conf.json.
import { errorText, getAppInfo, openLink, type AppInfo } from "../api";
import { icons } from "./icons";
import logoUrl from "../assets/vsa-logo.png";
import appIconUrl from "../assets/app-icon.svg";

let dialog: HTMLDialogElement | null = null;

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function build(info: AppInfo, onError: (msg: string) => void): HTMLDialogElement {
  const d = document.createElement("dialog");
  d.className = "about";
  d.setAttribute("aria-labelledby", "about-title");
  d.innerHTML = `
    <button class="icon-btn dialog-close" aria-label="Close" title="Close">${icons.close}</button>
    <div class="about-banner">
      <img src="${appIconUrl}" width="64" height="64" alt="" />
      <div>
        <h2 id="about-title">${escape(info.name)}</h2>
        <p class="about-version">Version ${escape(info.version)}</p>
      </div>
    </div>
    <div class="about-body">
      <p>Learn PLC programming: draw the program as a function block diagram, wire field devices to the PLC training panel, build a SCADA operator screen, and simulate it all in real time. Made for students, teachers and hobbyists, and it works fully offline.</p>
      <div class="about-dev">
        <img class="about-logo" src="${logoUrl}" width="88" height="88" alt="Vidyasagar Academy logo" />
        <div>
          <p class="muted small">Developed by</p>
          ${info.developers.map((n) => `<p class="strong">${escape(n)}</p>`).join("")}
          <p class="muted small">for</p>
          <p class="strong">${escape(info.organisation)}</p>
        </div>
      </div>
      <div class="about-links">
        <button class="link-btn" data-link="website">${icons.globe}<span>${escape(info.website)}</span></button>
        <button class="link-btn" data-link="email">${icons.mail}<span>${escape(info.email)}</span></button>
        <button class="link-btn" data-link="source">${icons.globe}<span>github.com/dsvakola/PLC-Simulator</span></button>
        <button class="link-btn" data-link="software">${icons.globe}<span>More software: github.com/dsvakola/software</span></button>
        <button class="link-btn" data-link="privacy">${icons.globe}<span>Privacy policy</span></button>
      </div>
      <p class="muted small">Free software, released under the ${escape(info.licence)}. You may use, share and change it under that licence.</p>
    </div>`;
  d.querySelector(".dialog-close")?.addEventListener("click", () => d.close());
  d.addEventListener("click", (e) => {
    if (e.target === d) d.close();
  });
  for (const b of d.querySelectorAll<HTMLButtonElement>(".link-btn")) {
    b.addEventListener("click", () => {
      const l = b.dataset.link;
      openLink(l === "email" || l === "source" || l === "software" || l === "privacy" ? l : "website").catch((e: unknown) => onError(errorText(e)));
    });
  }
  document.body.appendChild(d);
  return d;
}

export async function showAbout(onError: (msg: string) => void): Promise<void> {
  if (!dialog) {
    try {
      dialog = build(await getAppInfo(), onError);
    } catch (e) {
      onError(errorText(e));
      return;
    }
  }
  dialog.showModal();
}
