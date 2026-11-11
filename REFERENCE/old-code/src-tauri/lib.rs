mod error;
mod files;
mod firmware;
mod prefs;
mod recent;
mod runner;

use error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use vra_core::breadboard::{BreadboardKind, BreadboardLayout};
use vra_core::catalogue::{self, PartDef};
use vra_core::examples;
use vra_core::project::{self, Connections, Project};
use vra_core::sim::{self, SimInput, SimResult};

const WEBSITE: &str = "https://vsa.edu.in/software/";
const EMAIL: &str = "mailto:softinquiry@vsa.edu.in";
const GITHUB: &str = "https://github.com/dsvakola/VSA-Simulator";
const ESP8266_FIRMWARE: &str = "https://micropython.org/download/ESP8266_GENERIC/";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    name: String,
    version: String,
    developers: Vec<&'static str>,
    organisation: &'static str,
    website: &'static str,
    email: &'static str,
    github: &'static str,
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
        organisation: "Vidyasagar Academy",
        website: "vsa.edu.in/software",
        email: "softinquiry@vsa.edu.in",
        github: "github.com/dsvakola/VSA-Simulator",
        licence: "GNU General Public License v3.0 (GPL 3.0)",
    }
}

#[tauri::command]
fn get_breadboard_layout(kind: BreadboardKind) -> BreadboardLayout {
    BreadboardLayout::new(kind)
}

#[tauri::command]
fn get_catalogue() -> Vec<PartDef> {
    catalogue::catalogue()
}

/// Works out which pins and holes are joined in the current circuit.
#[tauri::command]
fn get_connections(project: Project) -> Connections {
    project::connections(&project)
}

/// Solves the circuit: LED brightness, currents, voltages and warnings.
/// Async, so it runs off the window's thread.
#[tauri::command]
async fn simulate(project: Project, input: SimInput) -> SimResult {
    sim::simulate(&project, &input)
}

/// The list of ready-made examples for File > Examples.
#[tauri::command]
fn example_catalog() -> AppResult<Vec<examples::ExampleBoard>> {
    examples::catalogue().map_err(AppError::Project)
}

/// A ready-made example, opened as a new project that is not saved yet.
#[tauri::command]
fn example_open(board: String, id: String) -> AppResult<files::OpenedProject> {
    let (name, project) = examples::open(&board, &id).map_err(AppError::Project)?;
    Ok(files::OpenedProject {
        path: String::new(),
        name,
        project,
    })
}

/// The source code of an example's program.
#[tauri::command]
fn example_source(board: String, id: String) -> AppResult<examples::ExampleSource> {
    examples::source(&board, &id).map_err(AppError::Project)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum Link {
    Website,
    Email,
    Github,
    Esp8266Firmware,
}

/// Only the academy website, e-mail, GitHub page and the ESP8266 MicroPython
/// download page can be opened; the window never
/// passes a free-form address.
#[tauri::command]
fn open_link(app: AppHandle, link: Link) -> AppResult<()> {
    let url = match link {
        Link::Website => WEBSITE,
        Link::Email => EMAIL,
        Link::Github => GITHUB,
        Link::Esp8266Firmware => ESP8266_FIRMWARE,
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| AppError::Open(e.to_string()))
}

/// True for the addresses an example's source code may open: the academy
/// website, the GitHub pages of dsvakola, and the academy e-mail.
fn allowed_url(url: &str) -> bool {
    if url == "mailto:softinquiry@vsa.edu.in" {
        return true;
    }
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    if rest.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let path = &rest[host.len()..];
    match host {
        "vsa.edu.in" | "www.vsa.edu.in" => true,
        "github.com" => path == "/dsvakola" || path.starts_with("/dsvakola/"),
        _ => false,
    }
}

/// Opens a link shown in an example's source code, if it is one of ours.
#[tauri::command]
fn open_url(app: AppHandle, url: String) -> AppResult<()> {
    if !allowed_url(&url) {
        return Err(AppError::Open(
            "only the academy's own links can be opened".into(),
        ));
    }
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| AppError::Open(e.to_string()))
}

pub fn run() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(runner::Runner::default())
        .setup(|app| {
            firmware::load_saved(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            get_breadboard_layout,
            get_catalogue,
            get_connections,
            simulate,
            files::save_project,
            files::open_project,
            files::load_program,
            files::refresh_program,
            files::open_recent,
            files::startup_project,
            files::export_image,
            example_catalog,
            example_open,
            example_source,
            firmware::esp8266_firmware_status,
            firmware::esp8266_firmware_choose,
            prefs::get_prefs,
            prefs::set_prefs,
            recent::recent_files,
            recent::clear_recent,
            runner::run_start,
            runner::run_update,
            runner::run_input,
            runner::run_serial,
            runner::run_pause,
            runner::run_stop,
            open_link,
            open_url
        ])
        .run(tauri::generate_context!());
    if let Err(e) = result {
        eprintln!("VSA Simulator could not start: {e}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::allowed_url;

    #[test]
    fn only_our_links_open() {
        for ok in [
            "https://github.com/dsvakola/VSA-Simulator",
            "https://github.com/dsvakola/software",
            "https://vsa.edu.in/",
            "https://vsa.edu.in/software/",
            "mailto:softinquiry@vsa.edu.in",
        ] {
            assert!(allowed_url(ok), "{ok}");
        }
        for bad in [
            "http://vsa.edu.in/",
            "https://github.com/someone/else",
            "https://github.com/dsvakolaX/repo",
            "https://vsa.edu.in.evil.com/",
            "https://evil.com/?https://vsa.edu.in/",
            "file:///C:/Windows",
            "mailto:someone@example.com",
            "https://vsa.edu.in/a b",
        ] {
            assert!(!allowed_url(bad), "{bad}");
        }
    }
}
