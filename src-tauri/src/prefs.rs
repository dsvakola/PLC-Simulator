//! The student's preferences (Tools > Options), kept as a small JSON file
//! in the app data folder and written atomically.

use plc_core::storage::write_atomic;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

const FILE: &str = "preferences.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    /// Colour theme of the window: "dark" or "light".
    pub theme: String,
    /// Show the address under each I/O LED on the CPU panel.
    pub show_addresses: bool,
    /// Show the symbol names next to addresses in the program.
    pub show_symbols: bool,
    /// New wires on the control panel are smooth curves instead of straight.
    pub curvy_wires: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            theme: "light".into(),
            show_addresses: true,
            show_symbols: true,
            curvy_wires: false,
        }
    }
}

impl Prefs {
    /// Keeps every value in its allowed range.
    fn checked(mut self) -> Self {
        if !matches!(self.theme.as_str(), "dark" | "light") {
            self.theme = "light".into();
        }
        self
    }
}

fn path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(FILE))
}

/// The saved preferences; defaults if none were saved or the file is damaged.
#[tauri::command]
pub fn get_prefs(app: AppHandle) -> Prefs {
    path(&app)
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|t| serde_json::from_str::<Prefs>(&t).ok())
        .unwrap_or_default()
        .checked()
}

#[tauri::command]
pub fn set_prefs(app: AppHandle, prefs: Prefs) -> AppResult<Prefs> {
    let prefs = prefs.checked();
    let f = path(&app).ok_or_else(|| AppError::Project("No folder for settings.".into()))?;
    if let Some(dir) = f.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| AppError::Project(format!("Could not save the preferences: {e}")))?;
    }
    let text = serde_json::to_string_pretty(&prefs)
        .map_err(|e| AppError::Project(format!("Could not save the preferences: {e}")))?;
    write_atomic(&f, text.as_bytes())
        .map_err(|e| AppError::Project(format!("Could not save the preferences: {e}")))?;
    Ok(prefs)
}
