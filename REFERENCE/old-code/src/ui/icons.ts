// Toolbar and palette icons, drawn as SVG so they stay sharp at any scaling.

const wrap = (body: string, size = 20): string =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  newFile: wrap('<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>'),
  open: wrap('<path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>'),
  save: wrap('<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M8 3v5h7V3M8 21v-6h8v6"/>'),
  upload: wrap('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>'),
  run: wrap('<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>', 22),
  pause: wrap('<path d="M8 5v14M16 5v14" stroke-width="3"/>', 22),
  stop: wrap('<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/>', 22),
  zoomIn: wrap('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.4-4.4M11 8v6M8 11h6"/>'),
  zoomOut: wrap('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.4-4.4M8 11h6"/>'),
  fit: wrap('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  info: wrap('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
  search: wrap('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.4-4.4"/>', 16),
  serial: wrap('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10l3 2-3 2M12 15h5"/>', 16),
  chevron: wrap('<path d="M6 9l6 6 6-6"/>', 14),
  globe: wrap('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>', 16),
  mail: wrap('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>', 16),
  undo: wrap('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  redo: wrap('<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>'),
  rotate: wrap('<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>'),
  rotateLeft: wrap('<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v5h5"/>'),
  flipH: wrap('<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 7L4 17h5zM15 7l5 10h-5z"/>'),
  flipV: wrap('<path d="M3 12h18" stroke-dasharray="2 2"/><path d="M7 9L17 4v5zM7 15l10 5v-5z"/>'),
  breadboard: wrap('<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 12h18" stroke-dasharray="1 1.6"/><path d="M6 8.5h.01M9 8.5h.01M12 8.5h.01M15 8.5h.01M18 8.5h.01M6 15.5h.01M9 15.5h.01M12 15.5h.01M15 15.5h.01M18 15.5h.01" stroke-width="2.2"/>', 18),
  code: wrap('<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>', 18),
  actual: wrap('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9v6M14 9v6M11.5 10.5v.01M11.5 13.5v.01"/>'),
  simulate: wrap('<path d="M13 2L5 13h6l-1 9 8-11h-6z" fill="currentColor" stroke="none"/>', 22),
  trash: wrap('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  close: wrap('<path d="M6 6l12 12M18 6L6 18"/>', 18),
};
