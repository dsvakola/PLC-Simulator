mod error;
mod files;
mod prefs;
mod recent;
mod remote;
mod sim;

use error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

const WEBSITE: &str = "https://vsa.edu.in/software/";
const EMAIL: &str = "mailto:softinquiry@vsa.edu.in";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    name: String,
    version: String,
    developers: Vec<&'static str>,
    organisation: &'static str,
    website: &'static str,
    email: &'static str,
    licence: &'static str,
}

/// Name and version come from tauri.conf.json, the single source of truth.
#[tauri::command]
fn get_app_info(app: AppHandle) -> AppInfo {
    let info = app.package_info();
    AppInfo {
        name: info.name.clone(),
        version: info.version.to_string(),
        developers: vec!["Prof. Dattaraj S. Vidyasagar", "Prof. Yash D. Vidyasagar"],
        organisation: "Vidyasagar Robotics Academy",
        website: "vsa.edu.in/software",
        email: "softinquiry@vsa.edu.in",
        licence: "GNU General Public License v3.0 (GPL 3.0)",
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum Link {
    Website,
    Email,
}

/// Only the academy website and e-mail can be opened; the window never
/// passes a free-form address.
#[tauri::command]
fn open_link(app: AppHandle, link: Link) -> AppResult<()> {
    let url = match link {
        Link::Website => WEBSITE,
        Link::Email => EMAIL,
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| AppError::Open(e.to_string()))
}

/// Checks a function block diagram the way the CPU does before it runs.
/// An empty list means the diagram has no mistakes.
#[tauri::command]
fn check_fbd(diagram: plc_core::fbd::Diagram) -> Vec<plc_core::fbd::DiagramError> {
    match plc_core::fbd::Fbd::new(&diagram, plc_core::fbd::Limits::default()) {
        Ok(_) => Vec::new(),
        Err(errors) => errors,
    }
}

/// The fixed layout of the control panel and the list of devices that can be added.
#[tauri::command]
fn get_panel_layout() -> plc_core::panel::Layout {
    plc_core::panel::layout()
}

/// Checks the wiring of the control panel.
#[tauri::command]
fn check_panel(panel: plc_core::panel::Panel) -> Vec<plc_core::panel::PanelError> {
    plc_core::panel::check(&panel)
}

/// Checks the SCADA screen.
#[tauri::command]
fn check_scada(scada: plc_core::scada::Scada) -> Vec<plc_core::scada::ScadaError> {
    plc_core::scada::check(&scada)
}

pub fn run() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(sim::SimState::default())
        .manage(remote::RemoteState::default())
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            check_fbd,
            get_panel_layout,
            check_panel,
            sim::sim_start,
            sim::sim_stop,
            sim::sim_press,
            sim::sim_value,
            sim::sim_pause,
            sim::sim_clock,
            sim::sim_marker,
            sim::sim_analog_marker,
            check_scada,
            remote::remote_start,
            remote::remote_stop,
            remote::remote_screen,
            files::new_project,
            files::save_project,
            files::open_project,
            files::open_recent,
            files::startup_project,
            prefs::get_prefs,
            prefs::set_prefs,
            recent::recent_files,
            recent::clear_recent,
            open_link
        ])
        .run(tauri::generate_context!());
    if let Err(e) = result {
        eprintln!("PLC Simulator could not start: {e}");
        std::process::exit(1);
    }
}
