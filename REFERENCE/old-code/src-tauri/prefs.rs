//! The student's preferences (File > Preferences), kept as a small JSON file
//! in the app data folder and written atomically.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use vra_core::storage::write_atomic;

use crate::error::{AppError, AppResult};

const FILE: &str = "preferences.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    /// Parts snap to the 0.1 inch grid and into breadboard holes.
    pub align_to_grid: bool,
    /// New wires are drawn as smooth curves.
    pub curvy_wires: bool,
    pub show_grid: bool,
    pub buzzer_sound: bool,
    /// Load a program again when the file changes on disk.
    pub auto_reload: bool,
    /// Breadboard for new projects: full, half or mini.
    pub breadboard: String,
    /// Export resolution in dots per inch.
    pub export_dpi: u32,
    /// Export format: png or jpg.
    pub export_format: String,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs {
            align_to_grid: true,
            curvy_wires: false,
            show_grid: true,
            buzzer_sound: true,
            auto_reload: true,
            breadboard: "half".into(),
            export_dpi: 300,
            export_format: "png".into(),
        }
    }
}

impl Prefs {
    /// Keeps every value in its allowed range.
    fn checked(mut self) -> Self {
        if !matches!(
            self.breadboard.as_str(),
            "full" | "half" | "mini" | "double"
        ) {
            self.breadboard = "half".into();
        }
        self.export_dpi = self.export_dpi.clamp(300, 600);
        if !matches!(self.export_format.as_str(), "png" | "jpg") {
            self.export_format = "png".into();
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
