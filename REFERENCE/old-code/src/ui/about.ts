// The About box. Name and version come from Rust, which reads tauri.conf.json.
import { errorText, getAppInfo, openLink, type AppInfo } from "../api";
import { icons } from "./icons";
import logoUrl from "../assets/vra-logo.png";
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
    <button class="icon-btn about-close" aria-label="Close" title="Close">${icons.close}</button>
    <div class="about-head">
      <img src="${appIconUrl}" width="56" height="56" alt="" />
      <div>
        <h2 id="about-title">${escape(info.name)}</h2>
        <p class="muted">Version ${escape(info.version)}</p>
      </div>
    </div>
    <p>A circuit simulator for school and college students, researchers and hobbyists. Build circuits on a breadboard with Arduino Uno, Nano and Mega 2560, ESP32, ESP8266, Raspberry Pi Pico W, 8051 and ATmega chips, then load your program and watch it run.</p>
    <div class="about-dev">
      <img class="about-logo" src="${logoUrl}" width="96" height="96" alt="Vidyasagar Academy logo" />
      <div>
        <p class="muted small">Developed by</p>
        ${info.developers.map((n) => `<p class="strong">${escape(n)}</p>`).join("")}
        <p class="muted small">for</p>
        <p class="strong">${escape(info.organisation)}</p>
      </div>
    </div>
    <div class="about-links">
      <button class="link-btn" data-link="website">${icons.globe}<span>${escape(info.website)}</span></button>
      <button class="link-btn" data-link="github">${icons.globe}<span>${escape(info.github)}</span></button>
      <button class="link-btn" data-link="email">${icons.mail}<span>${escape(info.email)}</span></button>
    </div>
    <p class="muted small">Free software, released under the ${escape(info.licence)}. You may use, share and change it under that licence.</p>`;
  d.querySelector(".about-close")?.addEventListener("click", () => d.close());
  d.addEventListener("click", (e) => {
    if (e.target === d) d.close();
  });
  for (const b of d.querySelectorAll<HTMLButtonElement>(".link-btn")) {
    b.addEventListener("click", () => {
      const link = b.dataset.link === "email" ? "email" : b.dataset.link === "github" ? "github" : "website";
      openLink(link).catch((e: unknown) => onError(errorText(e)));
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
