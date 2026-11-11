// Toolbar, tree and dialog icons, drawn as SVG so they stay sharp at any
// screen scaling. All use currentColor, so they follow the theme.

const wrap = (body: string, size = 18): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  newFile: wrap('<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5M12 11.5v6M9 14.5h6"/>'),
  open: wrap('<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>'),
  save: wrap('<path d="M5 3h11l3 3v13.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5z"/><path d="M8 3v5h7V3M8 21v-6h8v6"/>'),
  undo: wrap('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: wrap('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  check: wrap('<path d="M4 12.5 9 17.5 20 6.5"/>'),
  run: wrap('<path d="M7 4.8v14.4L19 12z" fill="currentColor" stroke="none"/>', 16),
  stop: wrap('<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/>', 16),
  close: wrap('<path d="M6 6l12 12M18 6 6 18"/>', 16),
  globe: wrap('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.5 3.9 5.5 3.9 9s-1.3 6.5-3.9 9c-2.6-2.5-3.9-5.5-3.9-9S9.4 5.5 12 3z"/>', 16),
  mail: wrap('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>', 16),
  chevron: wrap('<path d="m9 6 6 6-6 6"/>', 14),
  project: wrap('<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h4l2 2h7A1.5 1.5 0 0 1 20 7.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z"/>', 16),
  cpu: wrap('<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M4 9h16M7.5 12.5h.01M10.5 12.5h.01M13.5 12.5h.01M7 16h10"/>', 16),
  program: wrap('<path d="M5 4v16M19 4v16M5 9h3M16 9h3M8 6.5v5M11 6.5v5M11 9h2.5M5 15h14"/><circle cx="14.8" cy="9" r="1.3"/>', 16),
  table: wrap('<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M4 10h16M4 14.5h16M10 5v14"/>', 16),
  watch: wrap('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>', 16),
  plant: wrap('<path d="M3 20V10l5 3V10l5 3V6h3l1 4h4v10z"/><path d="M7 16.5h2M12 16.5h2M17 16.5h1"/>', 16),
  search: wrap('<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>', 16),
  network: wrap('<path d="M4 4v16M20 4v16M4 12h16"/>', 16),
  folder: wrap('<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" fill="#f2c14e" stroke="#9a6b00"/>', 16),
  zoomIn: wrap('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.4-4.4M11 8v6M8 11h6"/>'),
  zoomOut: wrap('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.4-4.4M8 11h6"/>'),
  fit: wrap('<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/>'),
  actual: wrap('<path d="M7 7 12 4v16M5 20h14"/>'),
  trash: wrap('<path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>'),
  pointer: wrap('<path d="M6 4l12 8-5 1.5L11 19z" fill="currentColor" stroke="none"/>'),  info: wrap('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>', 16),
};

// ---- Ladder instruction symbols for the Instructions pane ----

const lad = (body: string): string =>
  `<svg viewBox="0 0 40 20" width="40" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">${body}</svg>`;
const contact = (inner = ""): string => lad(`<path d="M2 10h12M26 10h12M14 3v14M26 3v14"/>${inner}`);
const coil = (letter = ""): string =>
  lad(
    `<path d="M2 10h10M28 10h10M15 3.5c-3.5 3.5-3.5 9.5 0 13M25 3.5c3.5 3.5 3.5 9.5 0 13"/>${
      letter ? `<text x="20" y="14" font-size="10" font-family="Segoe UI, sans-serif" fill="currentColor" stroke="none" text-anchor="middle" font-weight="600">${letter}</text>` : ""
    }`,
  );
const box = (name: string): string =>
  lad(
    `<rect x="7" y="2" width="26" height="16" rx="2"/><path d="M2 10h5M33 10h5"/><text x="20" y="13.6" font-size="8.5" font-family="Segoe UI, sans-serif" fill="currentColor" stroke="none" text-anchor="middle" font-weight="600">${name}</text>`,
  );

export const ladderSymbols: Record<string, string> = {
  no: contact(),
  nc: contact('<path d="M16 16 24 4"/>'),
  pos: contact('<text x="20" y="13.6" font-size="9" font-family="Segoe UI, sans-serif" fill="currentColor" stroke="none" text-anchor="middle" font-weight="600">P</text>'),
  neg: contact('<text x="20" y="13.6" font-size="9" font-family="Segoe UI, sans-serif" fill="currentColor" stroke="none" text-anchor="middle" font-weight="600">N</text>'),
  not: contact('<text x="20" y="13.2" font-size="7" font-family="Segoe UI, sans-serif" fill="currentColor" stroke="none" text-anchor="middle" font-weight="600">NOT</text>'),
  coil: coil(),
  nCoil: coil("/"),
  set: coil("S"),
  reset: coil("R"),
  ton: box("TON"),
  tof: box("TOF"),
  tp: box("TP"),
  ctu: box("CTU"),
  ctd: box("CTD"),
  cmp: box("CMP"),
  move: box("MOVE"),
  math: box("MATH"),
};

