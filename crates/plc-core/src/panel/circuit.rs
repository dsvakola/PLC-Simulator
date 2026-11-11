//! The electrics of the panel while the simulation runs. The wires and the
//! closed contacts join terminals into nets; a net is at +24 V when a live
//! supply terminal is on it and at 0 V when a 0 V terminal is on it. A load
//! works when one of its terminals is at +24 V and the other at 0 V, so the
//! simulation follows exactly what the student wired.
//!
//! Board terminals: the input connector gives +24 V and 0 V for every input
//! and leads its signal terminals to I5 to I8. The "+" terminal of output Qn
//! is at +24 V only while Qn is on; its "âˆ’" is 0 V; its earth terminal is
//! only earth (it carries no current).

use std::collections::BTreeMap;

use super::{device_def, layout, Panel};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DevKind {
    PushNo,
    PushNc,
    Toggle,
    LimitNo,
    LimitNc,
    /// 3-wire PNP sensor (proximity or photo): BN +, BU âˆ’, BK signal.
    Sensor3,
    /// 2-wire sensor: works like a switch.
    Sensor2,
    Pot,
    Pt100,
    Lamp,
    Buzzer,
    Hooter,
    Motor,
    Contactor,
}

impl DevKind {
    pub fn from_kind(kind: &str) -> Option<DevKind> {
        Some(match kind {
            "pushNo" => DevKind::PushNo,
            "pushNc" => DevKind::PushNc,
            "toggle" => DevKind::Toggle,
            "limitNo" => DevKind::LimitNo,
            "limitNc" => DevKind::LimitNc,
            "proxPnp" | "photoPnp" => DevKind::Sensor3,
            "prox2w" => DevKind::Sensor2,
            "pot" => DevKind::Pot,
            "pt100" => DevKind::Pt100,
            "lamp" => DevKind::Lamp,
            "buzzer" => DevKind::Buzzer,
            "hooter" => DevKind::Hooter,
            "motor" => DevKind::Motor,
            "contactor" => DevKind::Contactor,
            _ => return None,
        })
    }

    /// Springs back when let go (push buttons). The others stay where they were put.
    pub fn momentary(self) -> bool {
        matches!(self, DevKind::PushNo | DevKind::PushNc)
    }

    /// Can be operated with the mouse (pressed, switched, or a target put in front).
    pub fn operable(self) -> bool {
        matches!(
            self,
            DevKind::PushNo
                | DevKind::PushNc
                | DevKind::Toggle
                | DevKind::LimitNo
                | DevKind::LimitNc
                | DevKind::Sensor3
                | DevKind::Sensor2
        )
    }

    /// Has a value set with a slider: potentiometer (0 to 100 %) or PT100 (Â°C).
    pub fn has_value(self) -> bool {
        matches!(self, DevKind::Pot | DevKind::Pt100)
    }

    /// Lowest and highest slider value, and where it starts.
    pub fn value_range(self) -> (f64, f64, f64) {
        match self {
            DevKind::Pt100 => (-50.0, 400.0, 25.0),
            _ => (0.0, 100.0, 50.0),
        }
    }
}

/// What the student does to a device: operated (pressed, switched on, target
/// present) and the slider value.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct DevInput {
    pub act: bool,
    pub value: f64,
}

#[derive(Debug, Clone)]
pub struct Dev {
    pub id: u32,
    pub kind: DevKind,
    /// Terminal numbers, in the order of the catalogue.
    t: Vec<usize>,
}

/// The result of working out the electrics.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Solution {
    /// +24 V is joined to 0 V somewhere.
    pub short: bool,
    /// For each device: lamp lit, buzzer sounding, coil pulled in, sensor
    /// output on, potentiometer powered, PT100 connected.
    pub on: Vec<bool>,
    /// For each motor: 1 turning forwards, -1 backwards, 0 standing.
    pub dir: Vec<i8>,
    /// Digital inputs I5 to I8.
    pub inputs: [bool; 4],
    /// Analog inputs I7 and I8 (AI1, AI2): 0 to 1000 for 0 to 10 V, or for a
    /// PT100 the temperature in tenths of a degree.
    pub analog: [i32; 2],
}

/// The panel turned into numbered terminals, ready to be solved many times.
#[derive(Debug, Clone)]
pub struct Circuit {
    terminals: usize,
    wires: Vec<(usize, usize)>,
    pub devs: Vec<Dev>,
    // Board terminals; index 0 is I5 or Q1.
    in_p: [usize; 4],
    in_n: [usize; 4],
    in_s: [usize; 4],
    q_p: [usize; 4],
    q_n: [usize; 4],
}

struct Uf(Vec<usize>);

impl Uf {
    fn find(&mut self, mut a: usize) -> usize {
        while self.0[a] != a {
            self.0[a] = self.0[self.0[a]];
            a = self.0[a];
        }
        a
    }
    fn join(&mut self, a: usize, b: usize) {
        let (ra, rb) = (self.find(a), self.find(b));
        if ra != rb {
            self.0[ra] = rb;
        }
    }
}

impl Circuit {
    pub fn new(panel: &Panel) -> Circuit {
        let layout = layout();
        let mut index: BTreeMap<String, usize> = BTreeMap::new();
        let mut add = |id: String| -> usize {
            let n = index.len();
            *index.entry(id).or_insert(n)
        };
        for f in &layout.fixed {
            for t in &f.terminals {
                add(t.id.clone());
            }
        }
        let mut devs = Vec::new();
        for d in &panel.devices {
            let (Some(kind), Some(def)) =
                (DevKind::from_kind(&d.kind), device_def(&layout, &d.kind))
            else {
                continue;
            };
            let t = def
                .terminals
                .iter()
                .map(|t| add(format!("d{}.{}", d.id, t.name)))
                .collect();
            devs.push(Dev { id: d.id, kind, t });
        }
        let at = |id: String| index.get(&id).copied().unwrap_or(0);
        let wires = panel
            .wires
            .iter()
            .filter_map(|w| Some((*index.get(&w.from)?, *index.get(&w.to)?)))
            .collect();
        Circuit {
            terminals: index.len(),
            wires,
            in_p: std::array::from_fn(|k| at(format!("icon.I{}p", k + 5))),
            in_n: std::array::from_fn(|k| at(format!("icon.I{}n", k + 5))),
            in_s: std::array::from_fn(|k| at(format!("icon.I{}s", k + 5))),
            q_p: std::array::from_fn(|k| at(format!("qcon.Q{}p", k + 1))),
            q_n: std::array::from_fn(|k| at(format!("qcon.Q{}n", k + 1))),
            devs,
        }
    }

    /// Works out the electrics for outputs `q` (Q1 to Q4). `powered` is false
    /// when the supply has switched off. `ins` has one entry per device.
    pub fn solve(&self, q: [bool; 4], powered: bool, ins: &[DevInput]) -> Solution {
        let nd = self.devs.len();
        let input = |i: usize| ins.get(i).copied().unwrap_or_default();
        // Coils pulled in and sensor outputs on; these change the circuit, so
        // it is worked out again until nothing changes.
        let mut coil = vec![false; nd];
        let mut sens = vec![false; nd];
        let mut sol = Solution::default();
        for _ in 0..12 {
            let mut uf = Uf((0..self.terminals).collect());
            for &(a, b) in &self.wires {
                uf.join(a, b);
            }
            for (i, d) in self.devs.iter().enumerate() {
                let operated = input(i).act;
                let closed = match d.kind {
                    DevKind::PushNo | DevKind::Toggle | DevKind::LimitNo | DevKind::Sensor2 => {
                        operated
                    }
                    DevKind::PushNc | DevKind::LimitNc => !operated,
                    _ => false,
                };
                if closed {
                    uf.join(d.t[0], d.t[1]);
                }
                if d.kind == DevKind::Contactor && coil[i] {
                    uf.join(d.t[2], d.t[3]);
                }
            }
            let mut plus = vec![false; self.terminals];
            let mut zero = vec![false; self.terminals];
            if powered {
                for k in 0..4 {
                    plus[uf.find(self.in_p[k])] = true;
                    zero[uf.find(self.in_n[k])] = true;
                    zero[uf.find(self.q_n[k])] = true;
                    if q[k] {
                        plus[uf.find(self.q_p[k])] = true;
                    }
                }
                for (i, d) in self.devs.iter().enumerate() {
                    if d.kind == DevKind::Sensor3 && sens[i] {
                        plus[uf.find(d.t[2])] = true;
                    }
                }
            }
            let short = (0..self.terminals).any(|r| plus[r] && zero[r]);
            // The net of every terminal, and whether it is at +24 V or 0 V.
            let root: Vec<usize> = (0..self.terminals).map(|t| uf.find(t)).collect();
            let pos = |t: usize| plus[root[t]] && !zero[root[t]];
            let gnd = |t: usize| zero[root[t]] && !plus[root[t]];
            // Current flows from a to b, and from b to a.
            let across = |a: usize, b: usize| (pos(a) && gnd(b), pos(b) && gnd(a));
            let mut new_coil = vec![false; nd];
            let mut new_sens = vec![false; nd];
            let mut on = vec![false; nd];
            let mut dir = vec![0i8; nd];
            for (i, d) in self.devs.iter().enumerate() {
                let t = &d.t;
                match d.kind {
                    DevKind::Lamp | DevKind::Buzzer | DevKind::Hooter => {
                        let (ab, ba) = across(t[0], t[1]);
                        on[i] = ab || ba;
                    }
                    DevKind::Motor => {
                        let (ab, ba) = across(t[0], t[1]);
                        dir[i] = if ab {
                            1
                        } else if ba {
                            -1
                        } else {
                            0
                        };
                        on[i] = ab || ba;
                    }
                    DevKind::Contactor => {
                        let (ab, ba) = across(t[0], t[1]);
                        new_coil[i] = ab || ba;
                        on[i] = new_coil[i];
                    }
                    DevKind::Sensor3 => {
                        // A PNP sensor needs + on brown and 0 V on blue.
                        new_sens[i] = across(t[0], t[1]).0 && input(i).act;
                        on[i] = new_sens[i];
                    }
                    DevKind::Pot => on[i] = across(t[0], t[1]).0,
                    DevKind::Pt100 => on[i] = gnd(t[0]) || gnd(t[1]),
                    _ => {}
                }
            }
            // The inputs I5 to I8.
            let mut inputs = [false; 4];
            let mut analog = [0i32; 2];
            for k in 0..4 {
                let s = self.in_s[k];
                if k < 2 {
                    inputs[k] = pos(s);
                    continue;
                }
                let on_input = |kind: DevKind, pin: usize| {
                    self.devs
                        .iter()
                        .enumerate()
                        .find(|(i, d)| d.kind == kind && on[*i] && root[d.t[pin]] == root[s])
                        .map(|(i, _)| input(i).value)
                };
                let (value, digital) = if pos(s) {
                    // 24 V on an analog input: the reading is at the top of the range.
                    (1000, true)
                } else if let Some(v) = on_input(DevKind::Pot, 2) {
                    let v = (v.clamp(0.0, 100.0) * 10.0).round() as i32;
                    (v, v >= 800)
                } else if let Some(t) = on_input(DevKind::Pt100, 2) {
                    ((t.clamp(-50.0, 400.0) * 10.0).round() as i32, false)
                } else {
                    (0, false)
                };
                inputs[k] = digital;
                analog[k - 2] = value;
            }
            let stable = new_coil == coil && new_sens == sens;
            sol = Solution {
                short,
                on,
                dir,
                inputs,
                analog,
            };
            if stable {
                break;
            }
            coil = new_coil;
            sens = new_sens;
        }
        sol
    }
}
