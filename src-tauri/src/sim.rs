//! Runs the simulation on its own thread. The PLC scans in real time; about
//! 60 times a second (and whenever something changes) a picture of the panel
//! is sent to the window through a channel. The window only shows it and
//! passes on what the student does with the mouse.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use plc_core::fbd::{Clock, Diagram, DiagramError};
use plc_core::panel::Panel;
use plc_core::sim::{Frame, Simulator};
use tauri::ipc::Channel;
use tauri::State;

/// Time between two steps of the scan thread.
const STEP: Duration = Duration::from_millis(4);
/// Shortest time between two pictures sent to the window.
const MIN_FRAME: Duration = Duration::from_millis(16);
/// A picture is sent at least this often, so the running time stays current.
const MAX_FRAME: Duration = Duration::from_millis(200);

struct Running {
    sim: Arc<Mutex<Simulator>>,
    stop: Arc<AtomicBool>,
    /// Paused: time stands still; the picture is still sent.
    paused: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Running {
    fn halt(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// The simulation that is running, if any.
#[derive(Default)]
pub struct SimState(Mutex<Option<Running>>);

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn message(text: String) -> Vec<DiagramError> {
    vec![DiagramError {
        block: None,
        message: text,
    }]
}

/// RUN: starts the program on the panel. Fails with the diagram's mistakes.
#[tauri::command]
pub fn sim_start(
    state: State<'_, SimState>,
    diagram: Diagram,
    panel: Panel,
    clock: Clock,
    clock_speed: f64,
    on_frame: Channel<Frame>,
) -> Result<(), Vec<DiagramError>> {
    let mut sim = Simulator::new(&diagram, &panel, clock)?;
    sim.set_clock(clock, clock_speed);
    let mut slot = lock(&state.0);
    if let Some(old) = slot.take() {
        old.halt();
    }
    let sim = Arc::new(Mutex::new(sim));
    let stop = Arc::new(AtomicBool::new(false));
    let paused = Arc::new(AtomicBool::new(false));
    let (sim2, stop2, paused2) = (Arc::clone(&sim), Arc::clone(&stop), Arc::clone(&paused));
    let thread = std::thread::Builder::new()
        .name("plc-scan".into())
        .spawn(move || {
            let mut last = Instant::now();
            let mut sent: Option<(Frame, Instant)> = None;
            while !stop2.load(Ordering::Relaxed) {
                std::thread::sleep(STEP);
                let now = Instant::now();
                let ms = now.duration_since(last).as_secs_f64() * 1000.0;
                last = now;
                let frame = {
                    let mut s = lock(&sim2);
                    if !paused2.load(Ordering::Relaxed) {
                        s.advance(ms);
                    }
                    s.frame()
                };
                let due = match &sent {
                    None => true,
                    Some((f, at)) => {
                        let age = now.duration_since(*at);
                        age >= MAX_FRAME || (age >= MIN_FRAME && !f.looks_like(&frame))
                    }
                };
                if due {
                    if on_frame.send(frame.clone()).is_err() {
                        break;
                    }
                    sent = Some((frame, now));
                }
            }
        })
        .map_err(|e| message(format!("The simulation could not start: {e}")))?;
    *slot = Some(Running {
        sim,
        stop,
        paused,
        thread: Some(thread),
    });
    Ok(())
}

/// STOP: ends the simulation.
#[tauri::command]
pub fn sim_stop(state: State<'_, SimState>) {
    if let Some(r) = lock(&state.0).take() {
        r.halt();
    }
}

fn with_sim(state: &State<'_, SimState>, f: impl FnOnce(&mut Simulator)) {
    let sim = lock(&state.0).as_ref().map(|r| Arc::clone(&r.sim));
    if let Some(sim) = sim {
        f(&mut lock(&sim));
    }
}

/// The mouse button goes down or up on a switch, push button or sensor.
#[tauri::command]
pub fn sim_press(state: State<'_, SimState>, target: String, down: bool) {
    with_sim(&state, |s| s.press(&target, down));
}

/// A slider moves: potentiometer (%) or PT100 (°C).
#[tauri::command]
pub fn sim_value(state: State<'_, SimState>, target: String, value: f64) {
    with_sim(&state, |s| s.set_value(&target, value));
}

/// Pause: the program and its timers stand still until it is set going again.
#[tauri::command]
pub fn sim_pause(state: State<'_, SimState>, paused: bool) {
    if let Some(r) = lock(&state.0).as_ref() {
        r.paused.store(paused, Ordering::Relaxed);
    }
}

/// Sets the simulated clock of the weekly and yearly timers while running.
#[tauri::command]
pub fn sim_clock(state: State<'_, SimState>, clock: Clock, clock_speed: f64) {
    with_sim(&state, |s| s.set_clock(clock, clock_speed));
}

/// The SCADA screen switches marker Mn.
#[tauri::command]
pub fn sim_marker(state: State<'_, SimState>, n: usize, on: bool) {
    with_sim(&state, |s| s.set_marker(n, on));
}

/// The SCADA screen sets analog marker AMn.
#[tauri::command]
pub fn sim_analog_marker(state: State<'_, SimState>, n: usize, value: i32) {
    with_sim(&state, |s| s.set_analog_marker(n, value));
}
