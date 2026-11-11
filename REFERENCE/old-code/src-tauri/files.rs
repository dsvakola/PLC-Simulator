//! Save and open commands. The file windows are shown from Rust, so the page
//! itself never gets file system access.

use crate::error::{AppError, AppResult};
use crate::recent;
use serde::Serialize;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use vra_core::project::Project;
use vra_core::storage;

const EXT: &str = "vsasim";
/// Projects saved by the first versions, still opened.
const OLD_EXT: &str = "vrasim";

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
                    .add_filter("VSA Simulator project", &[EXT])
                    .set_file_name(format!("My circuit.{EXT}"))
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
            .add_filter("VSA Simulator project", &[EXT, OLD_EXT])
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
/// .vsasim file (or chose "Open with"). Given once, at start-up; None when
/// the program was started without one.
#[tauri::command]
pub async fn startup_project(app: AppHandle) -> AppResult<Option<OpenedProject>> {
    static TAKEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if TAKEN.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return Ok(None);
    }
    let path = std::env::args_os().skip(1).map(PathBuf::from).find(|p| {
        p.is_file()
            && p.extension()
                .is_some_and(|e| e.eq_ignore_ascii_case(EXT) || e.eq_ignore_ascii_case(OLD_EXT))
    });
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedProgram {
    /// File name shown to the student.
    pub name: String,
    /// Where the file is, so a new export from the Arduino IDE can be
    /// picked up automatically.
    pub path: String,
    /// When the file was last changed, in milliseconds since 1970.
    pub modified: f64,
    /// The program text, stored in the project with the board: Intel HEX
    /// for an Arduino, MicroPython source for a Pico, the program image in
    /// base64 for an ESP32 or ESP8266.
    pub hex: String,
    /// Program size in bytes.
    pub bytes: usize,
}

/// Asks for a program and checks it. `format` is "hex" (compiled Arduino
/// program for Uno/Nano), "hex-mega" (for the Mega 2560), "hex-atmega8" to "hex-atmega128" (bare
/// ATmega chips), "hex-8051-4k" / "hex-8051-8k" (8051 chips), "py" (MicroPython for the Pico) or "bin"
/// (ESP32 or ESP8266: a compiled Arduino program, or a MicroPython .py). None if cancelled.
#[tauri::command]
pub async fn load_program(app: AppHandle, format: String) -> AppResult<Option<LoadedProgram>> {
    // The chip a .hex program must be built for.
    let chip = match format.as_str() {
        "hex-mega" => Some(HexChip::Avr(&vra_core::avr::ATMEGA2560)),
        "hex" => Some(HexChip::Avr(&vra_core::avr::ATMEGA328P)),
        "hex-8051-4k" => Some(HexChip::Mcs51(vra_core::mcs51::Variant::At89c51)),
        "hex-8051-8k" => Some(HexChip::Mcs51(vra_core::mcs51::Variant::At89c52)),
        f => f
            .strip_prefix("hex-")
            .and_then(vra_core::avr::chip_mcu)
            .map(HexChip::Avr),
    };
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        let dialog = app.dialog().file();
        let dialog = match format.as_str() {
            "py" => dialog
                .set_title("Load MicroPython program")
                .add_filter("MicroPython program", &["py"]),
            "bin" => dialog
                .set_title("Load ESP32 or ESP8266 program")
                .add_filter(
                    "ESP program (Arduino .bin or MicroPython .py)",
                    &["bin", "py"],
                ),
            "hex-8051-4k" | "hex-8051-8k" => dialog.set_title("Load 8051 program").add_filter(
                "8051 program from Keil or SDCC (.hex, .ihx)",
                &["hex", "ihx"],
            ),
            f if f.starts_with("hex-atmega") => dialog
                .set_title("Load ATmega program")
                .add_filter("Compiled AVR program (.hex)", &["hex"]),
            _ => dialog
                .set_title("Load Arduino program")
                .add_filter("Compiled Arduino program", &["hex"]),
        };
        dialog.blocking_pick_file().and_then(|f| f.into_path().ok())
    })
    .await
    .map_err(|e| AppError::Dialog(e.to_string()))?;
    let Some(path) = chosen else {
        return Ok(None);
    };
    read_program(path, chip).await.map(Some)
}

/// The chip a .hex file is checked against when it is loaded.
#[derive(Clone, Copy)]
enum HexChip {
    Avr(&'static vra_core::avr::Mcu),
    Mcs51(vra_core::mcs51::Variant),
}

fn modified_ms(meta: &std::fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0.0, |d| d.as_millis() as f64)
}

fn is_python(path: &std::path::Path) -> bool {
    path.extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("py"))
}

fn is_bin(path: &std::path::Path) -> bool {
    path.extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("bin"))
}

/// Checks a MicroPython program and returns its text without a byte-order mark.
fn python_text(raw: &[u8]) -> Result<String, String> {
    let text = std::str::from_utf8(raw).map_err(|_| {
        "This file is not plain text. Save it from Thonny as a .py file and try again.".to_string()
    })?;
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    if text.contains('\0') {
        return Err("This file is not a Python program.".into());
    }
    Ok(text.to_string())
}

/// Reads a program file. `chip` checks a .hex file against the board's chip;
/// without it only the file itself is checked (the board checks it on Simulate).
async fn read_program(path: PathBuf, chip: Option<HexChip>) -> AppResult<LoadedProgram> {
    if is_bin(&path) {
        return read_esp_program(path).await;
    }
    let python = is_python(&path);
    let p2 = path.clone();
    let (hex, modified) =
        tauri::async_runtime::spawn_blocking(move || -> Result<(String, f64), String> {
            let meta =
                std::fs::metadata(&p2).map_err(|e| format!("Could not read the file: {e}"))?;
            if python && meta.len() > 200_000 {
                return Err("This file is too big for the Pico's memory (200 KB at most).".into());
            }
            if meta.len() > 1_000_000 {
                return Err("This file is too big to be an Arduino program.".into());
            }
            let raw = std::fs::read(&p2).map_err(|e| format!("Could not read the file: {e}"))?;
            let text = if python {
                python_text(&raw)?
            } else {
                String::from_utf8(raw)
                    .map_err(|_| "This is not an Arduino .hex file.".to_string())?
            };
            Ok((text, modified_ms(&meta)))
        })
        .await
        .map_err(|e| AppError::Project(e.to_string()))?
        .map_err(AppError::Project)?;
    let bytes = match chip {
        _ if python => hex.len(),
        Some(HexChip::Mcs51(v)) => {
            vra_core::mcs51::program_size(&hex, v).map_err(AppError::Project)?
        }
        Some(HexChip::Avr(m)) => {
            vra_core::avr::program_size(&hex, Some(m)).map_err(AppError::Project)?
        }
        None => vra_core::avr::program_size(&hex, None).map_err(AppError::Project)?,
    };
    Ok(LoadedProgram {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        hex,
        bytes,
        modified,
    })
}

/// Reads an ESP32 or ESP8266 program exported by the Arduino IDE (.ino.bin,
/// .ino.merged.bin or .ino.nodemcu.bin) and keeps the image as base64 text.
async fn read_esp_program(path: PathBuf) -> AppResult<LoadedProgram> {
    let p2 = path.clone();
    let (image, modified) =
        tauri::async_runtime::spawn_blocking(move || -> Result<(Vec<u8>, f64), String> {
            let meta =
                std::fs::metadata(&p2).map_err(|e| format!("Could not read the file: {e}"))?;
            if meta.len() > 4 * 1024 * 1024 {
                return Err("This file is too big to be an ESP program.".into());
            }
            let raw = std::fs::read(&p2).map_err(|e| format!("Could not read the file: {e}"))?;
            let image = if vra_core::esp8266::is_image(&raw) {
                vra_core::esp8266::program_image(&raw)?
            } else {
                vra_core::esp32::program_image(&raw)?
            };
            Ok((image, modified_ms(&meta)))
        })
        .await
        .map_err(|e| AppError::Project(e.to_string()))?
        .map_err(AppError::Project)?;
    Ok(LoadedProgram {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        hex: vra_core::esp32::to_base64(&image),
        bytes: image.len(),
        modified,
    })
}

/// Checks whether a board's program file was exported again. Returns the new
/// program when the file changed since `modified`, otherwise None. Only
/// `.hex`, `.py` and `.bin` files are read. A file that is missing or half-written (the IDE
/// may still be writing it) gives None, so the next check tries again.
#[tauri::command]
pub async fn refresh_program(path: String, modified: f64) -> Option<LoadedProgram> {
    let p = PathBuf::from(&path);
    let is_hex = p
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("hex") || e.eq_ignore_ascii_case("ihx"));
    if !(is_hex || is_python(&p) || is_bin(&p)) || !p.is_absolute() {
        return None;
    }
    let now = std::fs::metadata(&p).ok().map(|m| modified_ms(&m))?;
    if now == modified {
        return None;
    }
    read_program(p, None).await.ok()
}

/// Saves an exported picture of the circuit. The window sends the PNG or
/// JPEG bytes as the raw request body, with the format in the `format`
/// header. Asks where to save; returns the saved path, or None if cancelled.
#[tauri::command]
pub async fn export_image(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> AppResult<Option<String>> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::Project("The picture did not arrive.".into()));
    };
    let bytes = bytes.clone();
    let jpg = request
        .headers()
        .get("format")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|f| f == "jpg");
    let name = request
        .headers()
        .get("name")
        .and_then(|v| v.to_str().ok())
        .map(|n| {
            n.chars()
                .filter(|c| c.is_ascii_alphanumeric() || " -_".contains(*c))
                .take(60)
                .collect::<String>()
        })
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| "Circuit".to_string());
    // Check the bytes really are the picture they claim to be.
    let ok = if jpg {
        bytes.starts_with(&[0xFF, 0xD8, 0xFF])
    } else {
        bytes.starts_with(&[0x89, b'P', b'N', b'G'])
    };
    if !ok || bytes.len() > 200_000_000 {
        return Err(AppError::Project(
            "The picture could not be made. Please try a lower resolution.".into(),
        ));
    }
    let (ext, label) = if jpg {
        ("jpg", "JPEG picture")
    } else {
        ("png", "PNG picture")
    };
    let app2 = app.clone();
    let file_name = format!("{name}.{ext}");
    let target = tauri::async_runtime::spawn_blocking(move || {
        app2.dialog()
            .file()
            .set_title("Export picture")
            .add_filter(label, &[ext])
            .set_file_name(file_name)
            .blocking_save_file()
            .and_then(|f| f.into_path().ok())
    })
    .await
    .map_err(|e| AppError::Dialog(e.to_string()))?;
    let Some(mut target) = target else {
        return Ok(None);
    };
    if target.extension().is_none() {
        target.set_extension(ext);
    }
    let t2 = target.clone();
    tauri::async_runtime::spawn_blocking(move || vra_core::storage::write_atomic(&t2, &bytes))
        .await
        .map_err(|e| AppError::Project(e.to_string()))?
        .map_err(|e| AppError::Project(format!("Could not save the picture: {e}")))?;
    Ok(Some(target.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn python_text_drops_the_bom_and_refuses_binary() {
        assert_eq!(
            python_text(b"\xef\xbb\xbfprint(1)\n").as_deref(),
            Ok("print(1)\n")
        );
        assert!(python_text(b"\xff\xfe").is_err());
        assert!(python_text(b"a\0b").is_err());
    }
}
