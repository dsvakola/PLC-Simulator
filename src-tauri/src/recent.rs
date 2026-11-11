//! The list of recently opened or saved projects, shown under File > Recent.
//! Kept as a small JSON file in the app data folder, written atomically.

use plc_core::storage::write_atomic;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// How many projects File > Recent shows.
const KEEP: usize = 8;
const FILE: &str = "recent.json";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFile {
    pub path: String,
    pub name: String,
}

fn store(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(FILE))
}

/// The saved list, newest first. A missing or damaged file gives an empty list.
pub fn load(app: &AppHandle) -> Vec<String> {
    store(app)
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|t| serde_json::from_str::<Vec<String>>(&t).ok())
        .unwrap_or_default()
}

fn save(app: &AppHandle, list: &[String]) {
    let Some(f) = store(app) else { return };
    if let Some(dir) = f.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(text) = serde_json::to_string_pretty(list) {
        // The list is only a convenience: a failed write is not an error.
        let _ = write_atomic(&f, text.as_bytes());
    }
}

/// Puts `path` at the top of the list.
pub fn add(app: &AppHandle, path: &Path) {
    let p = path.to_string_lossy().into_owned();
    let mut list = load(app);
    list.retain(|q| !q.eq_ignore_ascii_case(&p));
    list.insert(0, p);
    list.truncate(KEEP);
    save(app, &list);
}

/// True when `path` is in the list, so the window can only reopen files the
/// student opened or saved before.
pub fn contains(app: &AppHandle, path: &str) -> bool {
    load(app).iter().any(|q| q.eq_ignore_ascii_case(path))
}

pub fn remove(app: &AppHandle, path: &str) {
    let mut list = load(app);
    list.retain(|q| !q.eq_ignore_ascii_case(path));
    save(app, &list);
}

/// Recent projects that still exist, newest first.
#[tauri::command]
pub fn recent_files(app: AppHandle) -> Vec<RecentFile> {
    load(&app)
        .into_iter()
        .filter(|p| Path::new(p).is_file())
        .map(|p| RecentFile {
            name: Path::new(&p)
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| p.clone()),
            path: p,
        })
        .collect()
}

#[tauri::command]
pub fn clear_recent(app: AppHandle) {
    save(&app, &[]);
}
