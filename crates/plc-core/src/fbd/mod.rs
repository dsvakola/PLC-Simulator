//! Function block diagram (FBD) engine.
//!
//! A diagram is a set of blocks joined by wires. Every block has numbered
//! input pins and output pins; a wire carries either a digital signal (on or
//! off) or an analog value (a whole number). The CPU works in scan cycles,
//! like a real one: all blocks are worked out once per scan, in an order
//! that follows the wires from the inputs to the outputs.
//!
//! A wire that runs "backwards" (a feedback loop, for example a latch made of
//! two NOR gates) uses the value from the previous scan, as on a real PLC.
//!
//! Numbering follows the usual PLC habit and starts at 1: I1, Q1, M1, AI1, AM1.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Most blocks one diagram may have.
pub const MAX_BLOCKS: usize = 500;
/// Longest timer time: 99 hours, in milliseconds.
pub const MAX_TIME_MS: u32 = 99 * 3_600_000;
/// Most on/off settings ("cams") on one weekly or yearly timer.
pub const MAX_CAMS: usize = 3;

// ---------- The diagram, as saved in the project file ----------

/// Kind of signal a pin carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PinType {
    /// On or off.
    Bit,
    /// A whole number (analog value).
    Num,
}

/// One on/off setting of a weekly timer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyCam {
    /// Days it works: bit 0 = Monday, bit 1 = Tuesday ... bit 6 = Sunday.
    pub days: u8,
    /// Switch-on time, in minutes after midnight (0 to 1439).
    pub on_minute: u16,
    /// Switch-off time, in minutes after midnight (0 to 1439).
    pub off_minute: u16,
}

/// One on/off setting of a yearly timer (it repeats every year).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YearlyCam {
    pub on_month: u8,
    pub on_day: u8,
    /// The output is off again on this date.
    pub off_month: u8,
    pub off_day: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "k", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum BlockKind {
    /// Digital input I1, I2 ...
    Input {
        n: u8,
    },
    /// Digital output Q1, Q2 ...
    Output {
        n: u8,
    },
    /// Marker (flag) M1, M2 ... A marker keeps its value between blocks; when
    /// its input is wired the program writes it, otherwise a SCADA screen may.
    Flag {
        n: u8,
    },
    /// Constant: always on (`high`) or always off.
    Const {
        high: bool,
    },
    /// Analog input AI1, AI2 ...
    AnalogInput {
        n: u8,
    },
    /// Analog marker AM1, AM2 ...
    AnalogFlag {
        n: u8,
    },
    And {
        inputs: u8,
    },
    Or {
        inputs: u8,
    },
    Nand {
        inputs: u8,
    },
    Nor {
        inputs: u8,
    },
    Not,
    Xor,
    Xnor,
    /// On-delay: the output comes on after the input has been on for `ms`.
    OnDelay {
        ms: u32,
    },
    /// Off-delay: the output stays on for `ms` after the input goes off.
    /// Pin 2 is the reset.
    OffDelay {
        ms: u32,
    },
    /// On/off-delay: delays both the switch-on and the switch-off.
    OnOffDelay {
        on_ms: u32,
        off_ms: u32,
    },
    WeeklyTimer {
        cams: Vec<WeeklyCam>,
    },
    YearlyTimer {
        cams: Vec<YearlyCam>,
    },
    /// Result = value x gain + offset.
    AnalogAmplifier {
        gain: f64,
        offset: i32,
    },
    /// Compares Ax with Ay (after gain and offset). On when the difference
    /// reaches `on`, off when it falls below `off`.
    AnalogComparator {
        gain: f64,
        offset: i32,
        on: i32,
        off: i32,
    },
    /// On when the value reaches `on`, off when it falls below `off`.
    AnalogThreshold {
        on: i32,
        off: i32,
    },
}

impl BlockKind {
    /// Input pin types and output pin types of this kind of block.
    pub fn pins(&self) -> (Vec<PinType>, Vec<PinType>) {
        use PinType::{Bit, Num};
        match self {
            BlockKind::Input { .. } | BlockKind::Const { .. } => (vec![], vec![Bit]),
            // An output also gives its state on, so it can be wired back
            // into the program (a latch: Q1 = (I1 OR Q1) AND NOT I2).
            BlockKind::Output { .. } => (vec![Bit], vec![Bit]),
            BlockKind::Flag { .. } => (vec![Bit], vec![Bit]),
            BlockKind::AnalogInput { .. } => (vec![], vec![Num]),
            BlockKind::AnalogFlag { .. } => (vec![Num], vec![Num]),
            BlockKind::And { inputs }
            | BlockKind::Or { inputs }
            | BlockKind::Nand { inputs }
            | BlockKind::Nor { inputs } => (vec![Bit; *inputs as usize], vec![Bit]),
            BlockKind::Not => (vec![Bit], vec![Bit]),
            BlockKind::Xor | BlockKind::Xnor => (vec![Bit, Bit], vec![Bit]),
            BlockKind::OnDelay { .. } | BlockKind::OnOffDelay { .. } => (vec![Bit], vec![Bit]),
            BlockKind::OffDelay { .. } => (vec![Bit, Bit], vec![Bit]),
            BlockKind::WeeklyTimer { .. } | BlockKind::YearlyTimer { .. } => (vec![], vec![Bit]),
            BlockKind::AnalogAmplifier { .. } => (vec![Num], vec![Num]),
            BlockKind::AnalogComparator { .. } => (vec![Num, Num], vec![Bit]),
            BlockKind::AnalogThreshold { .. } => (vec![Num], vec![Bit]),
        }
    }

    /// Value an unwired digital input pin has: an unused AND input counts as
    /// on so it does not block the others; every other pin counts as off.
    fn default_bit(&self) -> bool {
        matches!(self, BlockKind::And { .. } | BlockKind::Nand { .. })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    /// Unique number of the block within the diagram.
    pub id: u32,
    #[serde(flatten)]
    pub kind: BlockKind,
    /// Position on the drawing area.
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    /// A name the student gave the block (optional).
    #[serde(default)]
    pub label: String,
    /// The default name (I1, Q1, B03 ...) and the student's name can be moved.
    /// These are shifts from their usual places, in drawing units: the default
    /// name sits above the block, the student's name below it, centred.
    #[serde(default)]
    pub title_dx: f64,
    #[serde(default)]
    pub title_dy: f64,
    #[serde(default)]
    pub label_dx: f64,
    #[serde(default)]
    pub label_dy: f64,
}

/// A wire from an output pin to an input pin (pins count from 0).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Wire {
    pub from_block: u32,
    pub from_pin: u8,
    pub to_block: u32,
    pub to_pin: u8,
    /// Corners placed by version 0.0.4, from the output to the input (the
    /// wire went across, then up or down, to each one). Newer versions turn
    /// them into `corners` when the project is opened.
    #[serde(default)]
    pub points: Vec<WirePoint>,
    /// The exact path of the wire: every corner between the output and the
    /// input, at right angles. Empty means the path is drawn automatically.
    #[serde(default)]
    pub corners: Vec<WirePoint>,
}

/// A corner of a wire on the drawing.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WirePoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Diagram {
    #[serde(default)]
    pub blocks: Vec<Block>,
    #[serde(default)]
    pub wires: Vec<Wire>,
    /// Scan cycle time in milliseconds (0 means the default, 10).
    #[serde(default)]
    pub scan_ms: u32,
}

// ---------- Clock for the weekly and yearly timers ----------

/// Date and time of day the timers work with. The window supplies it: the PC
/// clock, or a simulated clock the teacher can set and speed up.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clock {
    pub year: i32,
    pub month: u8,
    pub day: u8,
    /// 0 = Monday ... 6 = Sunday.
    pub weekday: u8,
    /// Minutes after midnight (0 to 1439).
    pub minute: u16,
}

impl Clock {
    /// Builds a clock for a date and time; the weekday is worked out.
    pub fn from_ymd_hm(year: i32, month: u8, day: u8, hour: u8, minute: u8) -> Clock {
        // Sakamoto's method: 0 = Sunday.
        const T: [i32; 12] = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
        let m = month.clamp(1, 12) as usize;
        let y = if m < 3 { year - 1 } else { year };
        let sunday_first = (y + y / 4 - y / 100 + y / 400 + T[m - 1] + day as i32).rem_euclid(7);
        Clock {
            year,
            month,
            day,
            weekday: ((sunday_first + 6) % 7) as u8,
            minute: hour as u16 * 60 + minute as u16,
        }
    }
}

impl Default for Clock {
    fn default() -> Self {
        // Monday 5 January 2026, midnight.
        Clock::from_ymd_hm(2026, 1, 5, 0, 0)
    }
}

impl WeeklyCam {
    fn active(&self, c: &Clock) -> bool {
        let today = self.days >> c.weekday & 1 != 0;
        let yesterday = self.days >> ((c.weekday + 6) % 7) & 1 != 0;
        match self.on_minute.cmp(&self.off_minute) {
            std::cmp::Ordering::Less => {
                today && c.minute >= self.on_minute && c.minute < self.off_minute
            }
            // Runs past midnight: the part after midnight belongs to the day before.
            std::cmp::Ordering::Greater => {
                (today && c.minute >= self.on_minute) || (yesterday && c.minute < self.off_minute)
            }
            std::cmp::Ordering::Equal => false,
        }
    }
}

impl YearlyCam {
    fn active(&self, c: &Clock) -> bool {
        let now = c.month as u16 * 100 + c.day as u16;
        let on = self.on_month as u16 * 100 + self.on_day as u16;
        let off = self.off_month as u16 * 100 + self.off_day as u16;
        match on.cmp(&off) {
            std::cmp::Ordering::Less => now >= on && now < off,
            // Runs over New Year.
            std::cmp::Ordering::Greater => now >= on || now < off,
            std::cmp::Ordering::Equal => false,
        }
    }
}

// ---------- Checking the diagram ----------

/// Numbers of the real points the CPU has.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub inputs: u8,
    pub outputs: u8,
    pub markers: u8,
    pub analog_inputs: u8,
    pub analog_flags: u8,
}

impl Default for Limits {
    /// The academy control panel: I1 to I8, Q1 to Q4. Only I7 and I8 read
    /// analog signals: they are AI1 and AI2 (a 0-10 V signal, or a PT100
    /// through the RTD module inside the panel).
    fn default() -> Self {
        Limits {
            inputs: 8,
            outputs: 4,
            markers: 27,
            analog_inputs: 2,
            analog_flags: 16,
        }
    }
}

/// A mistake in the diagram, with the block it belongs to.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagramError {
    pub block: Option<u32>,
    pub message: String,
}

fn err(block: Option<u32>, message: impl Into<String>) -> DiagramError {
    DiagramError {
        block,
        message: message.into(),
    }
}

fn days_in_month(m: u8) -> u8 {
    match m {
        2 => 29,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

fn check_number(
    errors: &mut Vec<DiagramError>,
    id: u32,
    n: u8,
    max: u8,
    what: &str,
    letters: &str,
) {
    if n == 0 || n > max {
        errors.push(err(
            Some(id),
            format!(
                "{what} {letters}{n} does not exist. This CPU has {letters}1 to {letters}{max}."
            ),
        ));
    }
}

fn check_time(errors: &mut Vec<DiagramError>, id: u32, ms: u32) {
    if ms > MAX_TIME_MS {
        errors.push(err(
            Some(id),
            "The time is too long. The longest time is 99 hours.",
        ));
    }
}

fn check_block(b: &Block, limits: &Limits, errors: &mut Vec<DiagramError>) {
    let id = b.id;
    match &b.kind {
        BlockKind::Input { n } => check_number(errors, id, *n, limits.inputs, "Input", "I"),
        BlockKind::Output { n } => check_number(errors, id, *n, limits.outputs, "Output", "Q"),
        BlockKind::Flag { n } => check_number(errors, id, *n, limits.markers, "Marker", "M"),
        BlockKind::AnalogInput { n } => {
            check_number(errors, id, *n, limits.analog_inputs, "Analog input", "AI")
        }
        BlockKind::AnalogFlag { n } => {
            check_number(errors, id, *n, limits.analog_flags, "Analog marker", "AM")
        }
        BlockKind::And { inputs }
        | BlockKind::Or { inputs }
        | BlockKind::Nand { inputs }
        | BlockKind::Nor { inputs } => {
            if !(2..=4).contains(inputs) {
                errors.push(err(Some(id), "A logic block has 2 to 4 inputs."));
            }
        }
        BlockKind::OnDelay { ms } | BlockKind::OffDelay { ms } => check_time(errors, id, *ms),
        BlockKind::OnOffDelay { on_ms, off_ms } => {
            check_time(errors, id, *on_ms);
            check_time(errors, id, *off_ms);
        }
        BlockKind::WeeklyTimer { cams } => {
            if cams.len() > MAX_CAMS {
                errors.push(err(
                    Some(id),
                    format!("A weekly timer has at most {MAX_CAMS} on/off settings."),
                ));
            }
            for c in cams {
                if c.days > 0x7F || c.on_minute > 1439 || c.off_minute > 1439 {
                    errors.push(err(
                        Some(id),
                        "A weekly timer setting has a day or time that does not exist.",
                    ));
                }
            }
        }
        BlockKind::YearlyTimer { cams } => {
            if cams.len() > MAX_CAMS {
                errors.push(err(
                    Some(id),
                    format!("A yearly timer has at most {MAX_CAMS} on/off settings."),
                ));
            }
            for c in cams {
                let ok = |m: u8, d: u8| (1..=12).contains(&m) && d >= 1 && d <= days_in_month(m);
                if !ok(c.on_month, c.on_day) || !ok(c.off_month, c.off_day) {
                    errors.push(err(
                        Some(id),
                        "A yearly timer setting has a date that does not exist.",
                    ));
                }
            }
        }
        BlockKind::AnalogAmplifier { gain, .. } | BlockKind::AnalogComparator { gain, .. } => {
            if !gain.is_finite() {
                errors.push(err(Some(id), "The gain is not a number."));
            }
        }
        BlockKind::Const { .. }
        | BlockKind::Not
        | BlockKind::Xor
        | BlockKind::Xnor
        | BlockKind::AnalogThreshold { .. } => {}
    }
}

// ---------- Running ----------

/// Value on a wire: for drawing the diagram live.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(untagged)]
pub enum Value {
    Bit(bool),
    Num(i32),
}

impl Value {
    fn bit(self) -> bool {
        match self {
            Value::Bit(b) => b,
            Value::Num(n) => n != 0,
        }
    }
    fn num(self) -> i32 {
        match self {
            Value::Bit(b) => b as i32,
            Value::Num(n) => n,
        }
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct BlockState {
    elapsed: i32,
    off_elapsed: i32,
    running: bool,
    q: bool,
}

/// Inputs of one block, gathered before it is worked out.
struct Ins {
    bits: [bool; 4],
    nums: [i32; 2],
    /// Is input pin 0 wired?
    linked: bool,
}

/// Result = value x gain + offset, limited to the analog range -32768 to 32767.
fn scale(v: i32, gain: f64, offset: i32) -> i32 {
    let r = (v as f64 * gain).round() + offset as f64;
    r.clamp(-32768.0, 32767.0) as i32
}

/// On at or above `on`, off below `off`, otherwise unchanged. If `on` is
/// lower than `off` the direction is turned round (on at or below `on`).
fn hysteresis(v: i32, on: i32, off: i32, was_on: bool) -> bool {
    if on >= off {
        if v >= on {
            true
        } else if v < off {
            false
        } else {
            was_on
        }
    } else if v <= on {
        true
    } else if v > off {
        false
    } else {
        was_on
    }
}

pub struct Fbd {
    blocks: Vec<Block>,
    /// Order the blocks are worked out in.
    order: Vec<usize>,
    /// For each block and input pin: the (block, output pin) wired to it.
    src: Vec<Vec<Option<(usize, usize)>>>,
    /// Latest value of every output pin of every block.
    vals: Vec<Vec<Value>>,
    state: Vec<BlockState>,
    scan_ms: f64,
    pending_ms: f64,
    // These are indexed by the point number, so index 0 is not used.
    inputs: Vec<bool>,
    analog_in: Vec<i32>,
    markers: Vec<bool>,
    analog_flags: Vec<i32>,
    q: Vec<bool>,
    clock: Clock,
    pub running: bool,
    pub scans: u64,
}

impl Fbd {
    /// Checks the diagram and makes a CPU ready to run it.
    pub fn new(d: &Diagram, limits: Limits) -> Result<Self, Vec<DiagramError>> {
        let mut errors = Vec::new();
        if d.blocks.len() > MAX_BLOCKS {
            return Err(vec![err(
                None,
                format!("This diagram has more than {MAX_BLOCKS} blocks, which is too many."),
            )]);
        }
        let mut index: BTreeMap<u32, usize> = BTreeMap::new();
        for (i, b) in d.blocks.iter().enumerate() {
            if index.insert(b.id, i).is_some() {
                errors.push(err(Some(b.id), "Two blocks have the same number."));
            }
            check_block(b, &limits, &mut errors);
        }
        // An output Q may be driven by one block only.
        let mut used: BTreeMap<u8, u32> = BTreeMap::new();
        for b in &d.blocks {
            if let BlockKind::Output { n } = b.kind {
                if used.insert(n, b.id).is_some() {
                    errors.push(err(
                        Some(b.id),
                        format!("Output Q{n} is already used by another block."),
                    ));
                }
            }
        }

        let pins: Vec<(Vec<PinType>, Vec<PinType>)> =
            d.blocks.iter().map(|b| b.kind.pins()).collect();
        let mut src: Vec<Vec<Option<(usize, usize)>>> =
            pins.iter().map(|(ins, _)| vec![None; ins.len()]).collect();
        for w in &d.wires {
            let (Some(&f), Some(&t)) = (index.get(&w.from_block), index.get(&w.to_block)) else {
                errors.push(err(
                    None,
                    "A wire is joined to a block that does not exist.",
                ));
                continue;
            };
            let (fp, tp) = (w.from_pin as usize, w.to_pin as usize);
            let Some(&from_type) = pins[f].1.get(fp) else {
                errors.push(err(
                    Some(w.from_block),
                    "A wire starts at an output that this block does not have.",
                ));
                continue;
            };
            let Some(&to_type) = pins[t].0.get(tp) else {
                errors.push(err(
                    Some(w.to_block),
                    "A wire ends at an input that this block does not have.",
                ));
                continue;
            };
            if from_type != to_type {
                let message = if from_type == PinType::Bit {
                    "A digital output cannot be joined to an analog input."
                } else {
                    "An analog output cannot be joined to a digital input."
                };
                errors.push(err(Some(w.to_block), message));
                continue;
            }
            if src[t][tp].replace((f, fp)).is_some() {
                errors.push(err(Some(w.to_block), "Two wires end at the same input."));
            }
        }
        if !errors.is_empty() {
            return Err(errors);
        }

        // Work out the order: a block after the blocks that feed it. In a
        // feedback loop one block has to come first and uses the old value.
        let n = d.blocks.len();
        let mut indegree = vec![0usize; n];
        let mut successors: Vec<Vec<usize>> = vec![Vec::new(); n];
        for (t, ins) in src.iter().enumerate() {
            for s in ins.iter().flatten() {
                successors[s.0].push(t);
                indegree[t] += 1;
            }
        }
        let mut done = vec![false; n];
        let mut order = Vec::with_capacity(n);
        while order.len() < n {
            let next = (0..n)
                .find(|&i| !done[i] && indegree[i] == 0)
                .or_else(|| (0..n).find(|&i| !done[i]))
                .unwrap_or(0);
            done[next] = true;
            order.push(next);
            for &t in &successors[next] {
                indegree[t] = indegree[t].saturating_sub(1);
            }
        }

        let vals = pins
            .iter()
            .map(|(_, outs)| {
                outs.iter()
                    .map(|t| match t {
                        PinType::Bit => Value::Bit(false),
                        PinType::Num => Value::Num(0),
                    })
                    .collect()
            })
            .collect();
        Ok(Fbd {
            blocks: d.blocks.clone(),
            order,
            src,
            vals,
            state: vec![BlockState::default(); n],
            scan_ms: if d.scan_ms == 0 {
                10.0
            } else {
                d.scan_ms as f64
            },
            pending_ms: 0.0,
            inputs: vec![false; limits.inputs as usize + 1],
            analog_in: vec![0; limits.analog_inputs as usize + 1],
            markers: vec![false; limits.markers as usize + 1],
            analog_flags: vec![0; limits.analog_flags as usize + 1],
            q: vec![false; limits.outputs as usize + 1],
            clock: Clock::default(),
            running: true,
            scans: 0,
        })
    }

    // ----- The outside world: terminals, SCADA, clock -----

    /// Switches digital input In on or off (what the panel wiring decides).
    pub fn set_input(&mut self, n: usize, on: bool) {
        if let Some(x) = self.inputs.get_mut(n).filter(|_| n > 0) {
            *x = on;
        }
    }

    /// Sets analog input AIn. A voltage input counts 0 to 1000 for 0 to 10 V;
    /// a PT100 input counts in tenths of a degree Celsius.
    pub fn set_analog_input(&mut self, n: usize, v: i32) {
        if let Some(x) = self.analog_in.get_mut(n).filter(|_| n > 0) {
            *x = v.clamp(-32768, 32767);
        }
    }

    /// Writes marker Mn, as a SCADA screen does.
    pub fn set_marker(&mut self, n: usize, on: bool) {
        if let Some(x) = self.markers.get_mut(n).filter(|_| n > 0) {
            *x = on;
        }
    }

    /// Writes analog marker AMn, as a SCADA slider does.
    pub fn set_analog_flag(&mut self, n: usize, v: i32) {
        if let Some(x) = self.analog_flags.get_mut(n).filter(|_| n > 0) {
            *x = v.clamp(-32768, 32767);
        }
    }

    pub fn set_clock(&mut self, clock: Clock) {
        self.clock = clock;
    }

    /// State of output Qn.
    pub fn output(&self, n: usize) -> bool {
        n > 0 && self.q.get(n).copied().unwrap_or(false)
    }

    pub fn marker(&self, n: usize) -> bool {
        n > 0 && self.markers.get(n).copied().unwrap_or(false)
    }

    pub fn analog_flag(&self, n: usize) -> i32 {
        if n > 0 {
            self.analog_flags.get(n).copied().unwrap_or(0)
        } else {
            0
        }
    }

    /// Values on the output pins of a block, for drawing the diagram live.
    pub fn block_values(&self, id: u32) -> Option<&[Value]> {
        let i = self.blocks.iter().position(|b| b.id == id)?;
        Some(&self.vals[i])
    }

    /// Values on output pin 1 of every block that has outputs, for drawing
    /// the diagram live.
    pub fn live_values(&self) -> Vec<(u32, Value)> {
        self.blocks
            .iter()
            .zip(&self.vals)
            .filter_map(|(b, v)| v.first().map(|x| (b.id, *x)))
            .collect()
    }

    /// Length of one scan cycle in milliseconds.
    pub fn scan_time(&self) -> f64 {
        self.scan_ms
    }

    /// Power-on state: every block, marker and output starts again.
    pub fn reset(&mut self) {
        for (v, b) in self.vals.iter_mut().zip(&self.blocks) {
            let (_, outs) = b.kind.pins();
            for (x, t) in v.iter_mut().zip(outs) {
                *x = match t {
                    PinType::Bit => Value::Bit(false),
                    PinType::Num => Value::Num(0),
                };
            }
        }
        self.state
            .iter_mut()
            .for_each(|s| *s = BlockState::default());
        self.markers.iter_mut().for_each(|m| *m = false);
        self.analog_flags.iter_mut().for_each(|m| *m = 0);
        self.q.iter_mut().for_each(|q| *q = false);
        self.pending_ms = 0.0;
        self.scans = 0;
    }

    // ----- Scan cycle -----

    /// Runs the CPU for `ms` milliseconds (whole scans).
    pub fn run(&mut self, ms: f64) {
        if !self.running {
            // In STOP the outputs are off.
            self.q.iter_mut().for_each(|q| *q = false);
            return;
        }
        self.pending_ms += ms;
        while self.pending_ms >= self.scan_ms {
            self.pending_ms -= self.scan_ms;
            self.scan(self.scan_ms);
        }
    }

    /// One scan cycle of `dt` milliseconds.
    pub fn scan(&mut self, dt: f64) {
        let dt = dt.round() as i32;
        for k in 0..self.order.len() {
            let bi = self.order[k];
            self.eval(bi, dt);
        }
        self.scans += 1;
    }

    fn gather(&self, bi: usize) -> Ins {
        let kind = &self.blocks[bi].kind;
        let mut ins = Ins {
            bits: [kind.default_bit(); 4],
            nums: [0; 2],
            linked: false,
        };
        for (p, s) in self.src[bi].iter().enumerate() {
            if let Some((b, o)) = *s {
                let v = self.vals[b][o];
                if p < 4 {
                    ins.bits[p] = v.bit();
                }
                if p < 2 {
                    ins.nums[p] = v.num();
                }
                if p == 0 {
                    ins.linked = true;
                }
            }
        }
        ins
    }

    fn eval(&mut self, bi: usize, dt: i32) {
        let ins = self.gather(bi);
        let clock = self.clock;
        let bits = ins.bits;
        let kind = &self.blocks[bi].kind;
        let st = &mut self.state[bi];
        let out: Option<Value> = match kind {
            BlockKind::Input { n } => Some(Value::Bit(self.inputs[*n as usize])),
            BlockKind::Const { high } => Some(Value::Bit(*high)),
            BlockKind::Output { n } => {
                self.q[*n as usize] = bits[0];
                Some(Value::Bit(bits[0]))
            }
            BlockKind::Flag { n } => {
                let m = &mut self.markers[*n as usize];
                if ins.linked {
                    *m = bits[0];
                }
                Some(Value::Bit(*m))
            }
            BlockKind::AnalogInput { n } => Some(Value::Num(self.analog_in[*n as usize])),
            BlockKind::AnalogFlag { n } => {
                let m = &mut self.analog_flags[*n as usize];
                if ins.linked {
                    *m = ins.nums[0];
                }
                Some(Value::Num(*m))
            }
            BlockKind::And { inputs } => {
                Some(Value::Bit(bits[..*inputs as usize].iter().all(|b| *b)))
            }
            BlockKind::Or { inputs } => {
                Some(Value::Bit(bits[..*inputs as usize].iter().any(|b| *b)))
            }
            BlockKind::Nand { inputs } => {
                Some(Value::Bit(!bits[..*inputs as usize].iter().all(|b| *b)))
            }
            BlockKind::Nor { inputs } => {
                Some(Value::Bit(!bits[..*inputs as usize].iter().any(|b| *b)))
            }
            BlockKind::Not => Some(Value::Bit(!bits[0])),
            BlockKind::Xor => Some(Value::Bit(bits[0] ^ bits[1])),
            BlockKind::Xnor => Some(Value::Bit(!(bits[0] ^ bits[1]))),
            BlockKind::OnDelay { ms } => {
                let preset = *ms as i32;
                if bits[0] {
                    st.elapsed = (st.elapsed + dt).min(preset);
                    st.q = st.elapsed >= preset;
                } else {
                    st.elapsed = 0;
                    st.q = false;
                }
                Some(Value::Bit(st.q))
            }
            BlockKind::OffDelay { ms } => {
                let preset = *ms as i32;
                if bits[1] {
                    // Reset wins over the trigger.
                    st.q = false;
                    st.running = false;
                    st.elapsed = 0;
                } else if bits[0] {
                    st.q = true;
                    st.running = true;
                    st.elapsed = 0;
                } else if st.running {
                    st.elapsed = (st.elapsed + dt).min(preset);
                    if st.elapsed >= preset {
                        st.q = false;
                        st.running = false;
                    }
                }
                Some(Value::Bit(st.q))
            }
            BlockKind::OnOffDelay { on_ms, off_ms } => {
                if bits[0] {
                    st.off_elapsed = 0;
                    if !st.q {
                        st.elapsed = (st.elapsed + dt).min(*on_ms as i32);
                        if st.elapsed >= *on_ms as i32 {
                            st.q = true;
                        }
                    }
                } else {
                    st.elapsed = 0;
                    if st.q {
                        st.off_elapsed = (st.off_elapsed + dt).min(*off_ms as i32);
                        if st.off_elapsed >= *off_ms as i32 {
                            st.q = false;
                            st.off_elapsed = 0;
                        }
                    }
                }
                Some(Value::Bit(st.q))
            }
            BlockKind::WeeklyTimer { cams } => {
                Some(Value::Bit(cams.iter().any(|c| c.active(&clock))))
            }
            BlockKind::YearlyTimer { cams } => {
                Some(Value::Bit(cams.iter().any(|c| c.active(&clock))))
            }
            BlockKind::AnalogAmplifier { gain, offset } => {
                Some(Value::Num(scale(ins.nums[0], *gain, *offset)))
            }
            BlockKind::AnalogComparator {
                gain,
                offset,
                on,
                off,
            } => {
                let diff = scale(ins.nums[0], *gain, *offset) - scale(ins.nums[1], *gain, *offset);
                st.q = hysteresis(diff, *on, *off, st.q);
                Some(Value::Bit(st.q))
            }
            BlockKind::AnalogThreshold { on, off } => {
                st.q = hysteresis(ins.nums[0], *on, *off, st.q);
                Some(Value::Bit(st.q))
            }
        };
        if let Some(v) = out {
            self.vals[bi][0] = v;
        }
    }
}

#[cfg(test)]
mod tests;
