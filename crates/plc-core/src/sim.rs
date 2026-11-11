//! Simulation of the control panel: the PLC runs the student's function block
//! diagram scan by scan, in real time, and the panel's electrics decide what
//! the inputs see and what the outputs drive.
//!
//! Every scan, like a real PLC: read the inputs (from the switches and the
//! wiring), work out the program, then write the outputs Q1 to Q4.

use serde::Serialize;

use crate::fbd::{Clock, Diagram, DiagramError, Fbd, Limits, Value};
use crate::panel::circuit::{Circuit, DevInput, DevKind, Solution};
use crate::panel::{board_switch, Panel, SwitchSetup};

/// Most scans worked out in one go; if the PC falls further behind than
/// this, the simulation slows down instead of freezing.
const MAX_SCANS_PER_STEP: usize = 2000;

/// State of one device the student added.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceState {
    pub id: u32,
    /// Lamp lit, buzzer or hooter sounding, coil pulled in, sensor output on,
    /// potentiometer powered, PT100 connected.
    pub on: bool,
    /// Motor: 1 forwards, -1 backwards, 0 standing.
    pub dir: i8,
    /// Pressed, switched or with a target in front of it.
    pub act: bool,
    /// Slider value: potentiometer 0 to 100 %, PT100 in °C.
    pub value: f64,
}

/// Everything the window shows while the simulation runs.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub scans: u64,
    /// Simulated time since RUN, in milliseconds.
    pub time_ms: u64,
    /// I1 to I8 as the PLC sees them.
    pub inputs: [bool; 8],
    /// Q1 to Q4.
    pub outputs: [bool; 4],
    /// AI1 (I7) and AI2 (I8).
    pub analog: [i32; 2],
    /// Board switches I1 to I4 operated.
    pub switches: [bool; 4],
    /// A short circuit has switched the supply off.
    pub tripped: bool,
    pub devices: Vec<DeviceState>,
    /// Output value of every block, for drawing the diagram live.
    pub blocks: Vec<(u32, Value)>,
    pub clock: Clock,
    /// Markers M1 to M27, for the SCADA screen.
    pub markers: Vec<bool>,
    /// Analog markers AM1 to AM16, for the SCADA screen.
    pub analog_markers: Vec<i32>,
}

impl Frame {
    /// Same picture on the screen (the scan count and the time aside).
    pub fn looks_like(&self, o: &Frame) -> bool {
        self.inputs == o.inputs
            && self.outputs == o.outputs
            && self.analog == o.analog
            && self.switches == o.switches
            && self.tripped == o.tripped
            && self.devices == o.devices
            && self.blocks == o.blocks
            && self.markers == o.markers
            && self.analog_markers == o.analog_markers
    }
}

pub struct Simulator {
    fbd: Fbd,
    circuit: Circuit,
    board: [SwitchSetup; 4],
    board_act: [bool; 4],
    ins: Vec<DevInput>,
    q: [bool; 4],
    tripped: bool,
    sol: Solution,
    pending_ms: f64,
    time_ms: f64,
    /// PLC time: scans worked out x scan time, for frequency inputs.
    scan_ms_total: f64,
    clock: Clock,
    clock_ms: f64,
    /** How much faster than real time the clock of the weekly and yearly timers runs. */
    clock_speed: f64,
}

fn days_in_month(year: i32, month: u8) -> u8 {
    match month {
        2 if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

impl Simulator {
    /// Gets the program ready to run on the panel. Fails if the diagram has
    /// mistakes.
    pub fn new(
        diagram: &Diagram,
        panel: &Panel,
        clock: Clock,
    ) -> Result<Simulator, Vec<DiagramError>> {
        let fbd = Fbd::new(diagram, Limits::default())?;
        let circuit = Circuit::new(panel);
        let ins = circuit
            .devs
            .iter()
            .map(|d| DevInput {
                act: false,
                value: d.kind.value_range().2,
            })
            .collect();
        let mut s = Simulator {
            fbd,
            circuit,
            board: std::array::from_fn(|k| board_switch(panel, k + 1)),
            board_act: [false; 4],
            ins,
            q: [false; 4],
            tripped: false,
            sol: Solution::default(),
            pending_ms: 0.0,
            time_ms: 0.0,
            scan_ms_total: 0.0,
            clock,
            clock_ms: 0.0,
            clock_speed: 1.0,
        };
        s.fbd.set_clock(clock);
        s.refresh();
        Ok(s)
    }

    fn device_index(&self, target: &str) -> Option<usize> {
        let id: u32 = target.strip_prefix('d')?.parse().ok()?;
        self.circuit.devs.iter().position(|d| d.id == id)
    }

    fn board_index(target: &str) -> Option<usize> {
        match target {
            "swI1" => Some(0),
            "swI2" => Some(1),
            "swI3" => Some(2),
            "swI4" => Some(3),
            _ => None,
        }
    }

    /// The mouse button goes down (`down`) or up on a switch: board switch
    /// "swI1" to "swI4" or device "d<number>". A momentary switch is operated
    /// while held; a maintained one changes over on each press.
    pub fn press(&mut self, target: &str, down: bool) {
        if let Some(k) = Self::board_index(target) {
            if self.board[k].hz.is_some() {
                // Frequency mode: the input runs by itself.
            } else if self.board[k].momentary {
                self.board_act[k] = down;
            } else if down {
                self.board_act[k] = !self.board_act[k];
            }
        } else if let Some(i) = self.device_index(target) {
            let kind = self.circuit.devs[i].kind;
            if !kind.operable() {
                return;
            }
            if kind.momentary() {
                self.ins[i].act = down;
            } else if down {
                self.ins[i].act = !self.ins[i].act;
            }
        }
        self.refresh();
    }

    /// The SCADA screen switches marker Mn (a marker whose input is not wired
    /// in the program keeps what the screen writes).
    pub fn set_marker(&mut self, n: usize, on: bool) {
        self.fbd.set_marker(n, on);
    }

    /// The SCADA screen sets analog marker AMn (a slider).
    pub fn set_analog_marker(&mut self, n: usize, value: i32) {
        self.fbd.set_analog_flag(n, value);
    }

    /// Sets the slider of a potentiometer (%) or a PT100 (°C).
    pub fn set_value(&mut self, target: &str, value: f64) {
        let Some(i) = self.device_index(target) else {
            return;
        };
        let kind = self.circuit.devs[i].kind;
        if !kind.has_value() || !value.is_finite() {
            return;
        }
        let (lo, hi, _) = kind.value_range();
        self.ins[i].value = value.clamp(lo, hi);
        self.refresh();
    }

    /// Works out the electrics again. A short circuit switches the supply
    /// off until the simulation is started again, like an electronic fuse.
    fn refresh(&mut self) {
        self.sol = self.circuit.solve(self.q, !self.tripped, &self.ins);
        if self.sol.short && !self.tripped {
            self.tripped = true;
            self.sol = self.circuit.solve(self.q, false, &self.ins);
        }
    }

    /// Board switch k operated: by the mouse, or by the clock in frequency mode.
    fn board_on(&self, k: usize) -> bool {
        match self.board[k].hz {
            Some(hz) => (self.scan_ms_total * hz / 1000.0).fract() < 0.5,
            None => self.board_act[k] != self.board[k].nc,
        }
    }

    fn plc_inputs(&self) -> [bool; 8] {
        let mut i = [false; 8];
        for k in 0..4 {
            // The board switches are fed from the same 24 V supply.
            i[k] = !self.tripped && self.board_on(k);
            i[k + 4] = self.sol.inputs[k];
        }
        i
    }

    /// One scan cycle: read the inputs, work out the program, write the outputs.
    fn scan(&mut self) {
        self.refresh();
        for (k, on) in self.plc_inputs().iter().enumerate() {
            self.fbd.set_input(k + 1, *on);
        }
        self.fbd.set_analog_input(1, self.sol.analog[0]);
        self.fbd.set_analog_input(2, self.sol.analog[1]);
        self.fbd.set_clock(self.clock);
        self.fbd.scan(self.fbd.scan_time());
        self.scan_ms_total += self.fbd.scan_time();
        self.q = std::array::from_fn(|k| self.fbd.output(k + 1));
    }

    /// Most the simulated clock may run ahead of real time: one hour a second.
    pub const MAX_CLOCK_SPEED: f64 = 3600.0;

    /// Sets the date and time of the weekly and yearly timers, and how fast
    /// that clock runs (1 = real time, 60 = a minute every second ...).
    pub fn set_clock(&mut self, clock: Clock, speed: f64) {
        self.clock = clock;
        self.clock_ms = 0.0;
        self.clock_speed = if speed.is_finite() {
            speed.clamp(1.0, Self::MAX_CLOCK_SPEED)
        } else {
            1.0
        };
        self.fbd.set_clock(clock);
    }

    fn tick_clock(&mut self, ms: f64) {
        self.clock_ms += ms * self.clock_speed;
        while self.clock_ms >= 60_000.0 {
            self.clock_ms -= 60_000.0;
            let c = &mut self.clock;
            c.minute += 1;
            if c.minute >= 1440 {
                c.minute = 0;
                c.weekday = (c.weekday + 1) % 7;
                c.day += 1;
                if c.day > days_in_month(c.year, c.month) {
                    c.day = 1;
                    c.month += 1;
                    if c.month > 12 {
                        c.month = 1;
                        c.year += 1;
                    }
                }
            }
        }
    }

    /// Lets `ms` milliseconds of real time pass.
    pub fn advance(&mut self, ms: f64) {
        let ms = if ms.is_finite() {
            ms.clamp(0.0, 1000.0)
        } else {
            0.0
        };
        self.time_ms += ms;
        self.tick_clock(ms);
        self.pending_ms += ms;
        let step = self.fbd.scan_time().max(1.0);
        let mut n = 0;
        while self.pending_ms >= step {
            self.pending_ms -= step;
            self.scan();
            n += 1;
            if n >= MAX_SCANS_PER_STEP {
                self.pending_ms = 0.0;
                break;
            }
        }
        self.refresh();
    }

    pub fn frame(&self) -> Frame {
        let devices = self
            .circuit
            .devs
            .iter()
            .enumerate()
            .map(|(i, d)| DeviceState {
                id: d.id,
                on: self.sol.on.get(i).copied().unwrap_or(false),
                dir: self.sol.dir.get(i).copied().unwrap_or(0),
                act: self.ins[i].act,
                value: if d.kind.has_value() {
                    self.ins[i].value
                } else {
                    0.0
                },
            })
            .collect();
        Frame {
            scans: self.fbd.scans,
            time_ms: self.time_ms as u64,
            inputs: self.plc_inputs(),
            outputs: self.q,
            analog: self.sol.analog,
            switches: std::array::from_fn(|k| self.board_on(k) != self.board[k].nc),
            tripped: self.tripped,
            devices,
            blocks: self.fbd.live_values(),
            clock: self.clock,
            markers: (1..=Limits::default().markers as usize)
                .map(|n| self.fbd.marker(n))
                .collect(),
            analog_markers: (1..=Limits::default().analog_flags as usize)
                .map(|n| self.fbd.analog_flag(n))
                .collect(),
        }
    }

    /// Kind of a device, for tests and the window.
    pub fn device_kind(&self, id: u32) -> Option<DevKind> {
        self.circuit
            .devs
            .iter()
            .find(|d| d.id == id)
            .map(|d| d.kind)
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod scada_tests {
    use super::*;
    use crate::fbd::{Block, BlockKind, Wire};
    use crate::panel::Panel;

    fn blk(id: u32, kind: BlockKind) -> Block {
        Block {
            id,
            kind,
            x: 0.0,
            y: 0.0,
            label: String::new(),
            title_dx: 0.0,
            title_dy: 0.0,
            label_dx: 0.0,
            label_dy: 0.0,
        }
    }

    #[test]
    fn the_screen_writes_markers_and_analog_markers() {
        // M1 -> Q1, and AM1 -> threshold 500 -> Q2.
        let d = Diagram {
            blocks: vec![
                blk(1, BlockKind::Flag { n: 1 }),
                blk(2, BlockKind::Output { n: 1 }),
                blk(3, BlockKind::AnalogFlag { n: 1 }),
                blk(4, BlockKind::AnalogThreshold { on: 500, off: 400 }),
                blk(5, BlockKind::Output { n: 2 }),
            ],
            wires: vec![
                Wire {
                    from_block: 1,
                    from_pin: 0,
                    to_block: 2,
                    to_pin: 0,
                    points: vec![],
                    corners: vec![],
                },
                Wire {
                    from_block: 3,
                    from_pin: 0,
                    to_block: 4,
                    to_pin: 0,
                    points: vec![],
                    corners: vec![],
                },
                Wire {
                    from_block: 4,
                    from_pin: 0,
                    to_block: 5,
                    to_pin: 0,
                    points: vec![],
                    corners: vec![],
                },
            ],
            scan_ms: 10,
        };
        let mut s = Simulator::new(&d, &Panel::default(), Clock::default()).expect("valid");
        s.set_marker(1, true);
        s.set_analog_marker(1, 600);
        s.advance(30.0);
        let f = s.frame();
        assert!(f.outputs[0] && f.outputs[1]);
        assert!(f.markers[0]);
        assert_eq!(f.analog_markers[0], 600);
        assert_eq!(f.markers.len(), 27);
        assert_eq!(f.analog_markers.len(), 16);
    }
}
