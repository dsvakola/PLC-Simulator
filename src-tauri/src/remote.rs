//! "Allow SCADA connection from another PC": a small web server on the local
//! network. Another PC opens http://<this PC>:8090 in its web browser, types
//! the 4-digit code, and sees the SCADA screen live; it can also press its
//! buttons, switches and sliders. Nothing is installed on the other PC.
//!
//! The window draws the screen and hands the picture to this server; what the
//! other PC does is passed back to the window as an event. The server only
//! answers three requests, needs the code for every one of them, and stops
//! when the student switches the connection off or closes the program.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::error::{AppError, AppResult};

pub const PORT: u16 = 8090;
/// Largest request body accepted (an action is a few dozen bytes).
const MAX_BODY: usize = 4096;
/// Largest picture of the screen kept for the other PC.
const MAX_SCREEN: usize = 2_000_000;

struct Server {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

#[derive(Default)]
pub struct RemoteState {
    server: Mutex<Option<Server>>,
    /// The latest picture of the screen (JSON from the window).
    screen: Arc<Mutex<String>>,
    code: Arc<Mutex<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub address: String,
    pub code: String,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// The PC's address on the local network (no data is sent anywhere).
fn local_ip() -> String {
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|s| {
            s.connect("192.168.0.1:9")?;
            s.local_addr()
        })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

fn new_code() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64 ^ d.as_secs())
        .unwrap_or(4711);
    format!("{:04}", (nanos.wrapping_mul(2_654_435_761) >> 7) % 10_000)
}

const PAGE: &str = include_str!("remote.html");

fn respond(s: &mut TcpStream, status: &str, kind: &str, body: &[u8]) {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = s.write_all(head.as_bytes());
    let _ = s.write_all(body);
}

fn query_code(path: &str) -> Option<&str> {
    path.split_once('?')?
        .1
        .split('&')
        .find_map(|kv| kv.strip_prefix("code="))
}

fn handle(mut s: TcpStream, app: &AppHandle, screen: &Mutex<String>, code: &Mutex<String>) {
    let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = s.set_write_timeout(Some(Duration::from_secs(5)));
    let mut r = BufReader::new(match s.try_clone() {
        Ok(c) => c,
        Err(_) => return,
    });
    let mut line = String::new();
    if r.read_line(&mut line).is_err() || line.len() > 2048 {
        return;
    }
    let mut parts = line.split_whitespace();
    let (method, path) = (parts.next().unwrap_or(""), parts.next().unwrap_or("/"));
    let mut length = 0usize;
    loop {
        let mut h = String::new();
        if r.read_line(&mut h).is_err() || h.len() > 4096 {
            return;
        }
        let h = h.trim();
        if h.is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            if k.eq_ignore_ascii_case("content-length") {
                length = v.trim().parse().unwrap_or(0);
            }
        }
    }
    let route = path.split('?').next().unwrap_or("/");
    if method == "GET" && route == "/" {
        respond(
            &mut s,
            "200 OK",
            "text/html; charset=utf-8",
            PAGE.as_bytes(),
        );
        return;
    }
    let ok_code = { query_code(path) == Some(lock(code).as_str()) };
    if !ok_code {
        respond(&mut s, "403 Forbidden", "text/plain", b"Wrong code");
        return;
    }
    match (method, route) {
        ("GET", "/screen") => {
            let body = lock(screen).clone();
            respond(&mut s, "200 OK", "application/json", body.as_bytes());
        }
        ("POST", "/act") if length <= MAX_BODY => {
            let mut body = vec![0u8; length];
            if r.read_exact(&mut body).is_err() {
                return;
            }
            // Only well-formed actions reach the window.
            if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&body) {
                let id = v.get("id").and_then(|x| x.as_u64());
                let action = v.get("action").and_then(|x| x.as_str());
                if let (Some(id), Some(action)) = (id, action) {
                    if ["down", "up", "toggle", "value"].contains(&action) {
                        let value = v.get("value").and_then(|x| x.as_f64()).unwrap_or(0.0);
                        let _ = app.emit(
                            "remote-act",
                            serde_json::json!({ "id": id, "action": action, "value": value }),
                        );
                    }
                }
            }
            respond(&mut s, "204 No Content", "text/plain", b"");
        }
        _ => respond(&mut s, "404 Not Found", "text/plain", b"Not found"),
    }
}

/// Switches the connection on. Returns the address and code to type on the other PC.
#[tauri::command]
pub fn remote_start(app: AppHandle, state: State<'_, RemoteState>) -> AppResult<RemoteInfo> {
    let mut slot = lock(&state.server);
    if slot.is_none() {
        let listener = TcpListener::bind(("0.0.0.0", PORT)).map_err(|e| {
            AppError::Project(format!(
                "The SCADA connection could not start on port {PORT}: {e}"
            ))
        })?;
        listener
            .set_nonblocking(true)
            .map_err(|e| AppError::Project(e.to_string()))?;
        *lock(&state.code) = new_code();
        let stop = Arc::new(AtomicBool::new(false));
        let (stop2, screen, code) = (
            Arc::clone(&stop),
            Arc::clone(&state.screen),
            Arc::clone(&state.code),
        );
        let thread = std::thread::Builder::new()
            .name("scada-remote".into())
            .spawn(move || {
                while !stop2.load(Ordering::Relaxed) {
                    match listener.accept() {
                        Ok((s, _)) => {
                            let _ = s.set_nonblocking(false);
                            handle(s, &app, &screen, &code);
                        }
                        Err(_) => std::thread::sleep(Duration::from_millis(30)),
                    }
                }
            })
            .map_err(|e| AppError::Project(e.to_string()))?;
        *slot = Some(Server {
            stop,
            thread: Some(thread),
        });
    }
    Ok(RemoteInfo {
        address: format!("http://{}:{PORT}", local_ip()),
        code: lock(&state.code).clone(),
    })
}

/// Switches the connection off.
#[tauri::command]
pub fn remote_stop(state: State<'_, RemoteState>) {
    if let Some(mut s) = lock(&state.server).take() {
        s.stop.store(true, Ordering::Relaxed);
        if let Some(t) = s.thread.take() {
            let _ = t.join();
        }
    }
}

/// The window hands over the latest picture of the SCADA screen.
#[tauri::command]
pub fn remote_screen(state: State<'_, RemoteState>, screen: String) {
    if screen.len() <= MAX_SCREEN {
        *lock(&state.screen) = screen;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_code_is_read_from_the_address() {
        assert_eq!(query_code("/screen?code=1234"), Some("1234"));
        assert_eq!(query_code("/act?x=1&code=0042"), Some("0042"));
        assert_eq!(query_code("/screen"), None);
        assert_eq!(new_code().len(), 4);
    }
}
