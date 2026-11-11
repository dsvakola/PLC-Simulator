//! Save and open commands. The file windows are shown from Rust, so the page
//! itself never gets file system access.

use crate::error::{AppError, AppResult};
use crate::recent;
use plc_core::project::Project;
use plc_core::storage;
use serde::Serialize;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// File extension of a PLC Simulator project.
const EXT: &str = "vsaplc";
const FILTER: &str = "PLC Simulator project";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedProject {
    pub path: String,
    pub name: String,
    pub project: Project,
}

fn display_name(path: &std::path::Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Project".to_string())
}

/// An empty project for the default CPU, so the window and the engine
/// always agree on what "new" means.
#[tauri::command]
pub fn new_project() -> Project {
    Project::default()
}

/// Saves the project. With no path (a new project, or "Save as"), asks the
/// student where to save it. Returns the saved file's path and name, or None
/// if the student cancelled.
#[tauri::command]
pub async fn save_project(
    app: AppHandle,
    project: Project,
    path: Option<String>,
) -> AppResult<Option<(String, String)>> {
    let target: Option<PathBuf> = match path {
        Some(p) => Some(PathBuf::from(p)),
        None => {
            let app2 = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                app2.dialog()
                    .file()
                    .set_title("Save project")
                    .add_filter(FILTER, &[EXT])
                    .set_file_name(format!("My PLC project.{EXT}"))
                    .blocking_save_file()
                    .and_then(|f| f.into_path().ok())
            })
            .await
            .map_err(|e| AppError::Dialog(e.to_string()))?
        }
    };
    let Some(mut target) = target else {
        return Ok(None);
    };
    if target.extension().is_none() {
        target.set_extension(EXT);
    }
    let t2 = target.clone();
    tauri::async_runtime::spawn_blocking(move || storage::save_project(&t2, &project))
        .await
        .map_err(|e| AppError::Project(e.to_string()))?
        .map_err(AppError::Project)?;
    recent::add(&app, &target);
    Ok(Some((
        target.to_string_lossy().into_owned(),
        display_name(&target),
    )))
}

/// Asks the student for a project file and opens it. None if cancelled.
#[tauri::command]
pub async fn open_project(app: AppHandle) -> AppResult<Option<OpenedProject>> {
    let app2 = app.clone();
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        app2.dialog()
            .file()
            .set_title("Open project")
            .add_filter(FILTER, &[EXT])
            .blocking_pick_file()
            .and_then(|f| f.into_path().ok())
    })
    .await
    .map_err(|e| AppError::Dialog(e.to_string()))?;
    let Some(path) = chosen else {
        return Ok(None);
    };
    read_project(&app, path).await.map(Some)
}

async fn read_project(app: &AppHandle, path: PathBuf) -> AppResult<OpenedProject> {
    let p2 = path.clone();
    let project = tauri::async_runtime::spawn_blocking(move || storage::open_project(&p2))
        .await
        .map_err(|e| AppError::Project(e.to_string()))?
        .map_err(AppError::Project)?;
    recent::add(app, &path);
    Ok(OpenedProject {
        name: display_name(&path),
        path: path.to_string_lossy().into_owned(),
        project,
    })
}

/// The project file Windows passed when the student double-clicked a
/// project file (or chose "Open with"). Given once, at start-up; None when
/// the program was started without one.
#[tauri::command]
pub async fn startup_project(app: AppHandle) -> AppResult<Option<OpenedProject>> {
    static TAKEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if TAKEN.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return Ok(None);
    }
    let path = std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .find(|p| p.is_file() && p.extension().is_some_and(|e| e.eq_ignore_ascii_case(EXT)));
    match path {
        Some(p) => read_project(&app, p).await.map(Some),
        None => Ok(None),
    }
}

/// Opens a project from File > Recent. Only paths already in that list are
/// accepted. A file that has gone is taken off the list.
#[tauri::command]
pub async fn open_recent(app: AppHandle, path: String) -> AppResult<OpenedProject> {
    if !recent::contains(&app, &path) {
        return Err(AppError::Project(
            "This project is not in the recent list.".into(),
        ));
    }
    if !std::path::Path::new(&path).is_file() {
        recent::remove(&app, &path);
        return Err(AppError::Project(format!(
            "{path} was moved or deleted, so it has been taken off the recent list."
        )));
    }
    read_project(&app, PathBuf::from(path)).await
}
