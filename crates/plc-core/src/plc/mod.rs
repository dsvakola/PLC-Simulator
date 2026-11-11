//! A compact PLC programmed in ladder logic, in the style students meet in
//! industrial training ("S7-style" addresses: I0.0, Q0.0, M0.0, MW10, T1, C1).
//!
//! The PLC works like a real one, in scan cycles:
//! 1. copy the input terminals into the input image (I),
//! 2. work through the ladder networks from top to bottom, each one column by
//!    column from the left power rail to the right,
//! 3. copy the output image (Q) to the output relays.
//!
//! A network is a grid of cells. Power flows from the left rail along each
//! row; a vertical link between two rows at the right edge of a column joins
//! them there (a parallel branch), so the rows on both sides get the OR of
//! their power.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Number of input and output terminals (I0.0..I1.7 and Q0.0..Q1.7).
pub const IO_POINTS: usize = 16;
/// Bytes of marker memory (M0.0..M63.7, MW0..MW62).
pub const M_BYTES: usize = 64;
/// Timers T0..T63 and counters C0..C63.
pub const TIMERS: usize = 64;
pub const COUNTERS: usize = 64;
/// Columns in a network, the last one meant for coils.
pub const COLUMNS: usize = 8;

/// One cell of a ladder network, as saved in the project file. Operands are
/// kept as the student typed them and checked when the program is loaded.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(tag = "k", rename_all = "camelCase")]
pub enum Cell {
    #[default]
    Empty,
    /// A horizontal wire.
    Wire,
    /// Normally open contact: passes power when the bit is 1.
    No { a: String },
    /// Normally closed contact: passes power when the bit is 0.
    Nc { a: String },
    /// Passes power for one scan when the bit changes from 0 to 1.
    Pos { a: String },
    /// Passes power for one scan when the bit changes from 1 to 0.
    Neg { a: String },
    /// Inverts the power flow.
    Not,
    /// Output coil: the bit follows the power.
    Coil { a: String },
    /// Negated coil: the bit is the opposite of the power.
    NCoil { a: String },
    /// Set coil: power sets the bit to 1 (it stays 1).
    Set { a: String },
    /// Reset coil: power sets the bit to 0. On a timer or counter it resets that.
    Reset { a: String },
    /// On-delay timer.
    Ton { t: String, pt: String },
    /// Off-delay timer.
    Tof { t: String, pt: String },
    /// Pulse timer.
    Tp { t: String, pt: String },
    /// Up counter with preset; `r` is an optional reset bit.
    Ctu { c: String, pv: String, r: String },
    /// Down counter; `ld` is an optional bit that loads the preset.
    Ctd { c: String, pv: String, ld: String },
    /// Comparison of two whole numbers.
    Cmp { op: String, a: String, b: String },
    /// Copies a whole number.
    Move { a: String, dst: String },
    /// Arithmetic: ADD, SUB, MUL, DIV.
    Math {
        op: String,
        a: String,
        b: String,
        dst: String,
    },
}

/// One ladder network (rung), as saved in the project file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Network {
    #[serde(default)]
    pub comment: String,
    /// Rows of cells, each `COLUMNS` long (shorter rows are padded with Empty).
    pub rows: Vec<Vec<Cell>>,
    /// Vertical links: (row, col) joins row and row + 1 at the right edge of column col.
    #[serde(default)]
    pub links: Vec<(usize, usize)>,
}

/// The whole ladder program, as saved in the project file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Ladder {
    pub networks: Vec<Network>,
    /// Scan cycle time in milliseconds (default 10).
    #[serde(default)]
    pub scan_ms: u32,
    /// Names for addresses, e.g. "I0.0" -> "Start button".
    #[serde(default)]
    pub symbols: BTreeMap<String, String>,
}

// ---------- Operands ----------

/// A bit the program can read or write.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Bit {
    I(u8, u8),
    Q(u8, u8),
    M(u8, u8),
    /// Timer output (read only).
    T(u8),
    /// Counter output (read only).
    C(u8),
}

/// A whole number the program can read (and some of them write).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Word {
    Const(i32),
    /// Marker word: bytes n and n+1, high byte first.
    Mw(u8),
    /// Timer elapsed time in ms.
    T(u8),
    /// Counter value.
    C(u8),
}

fn parse_index(s: &str, max: usize, what: &str) -> Result<u8, String> {
    let n: usize = s
        .parse()
        .map_err(|_| format!("\"{s}\" is not a valid {what} number."))?;
    if n >= max {
        return Err(format!("{what} {n} does not exist (0 to {}).", max - 1));
    }
    Ok(n as u8)
}

/// Reads a bit address such as I0.3, Q1.0, M10.7, T2, C5 (case does not matter).
pub fn parse_bit(text: &str) -> Result<Bit, String> {
    let t = text.trim().to_ascii_uppercase();
    if t.is_empty() {
        return Err("An address is missing.".to_string());
    }
    let (area, rest) = t.split_at(1);
    if area == "T" || area == "C" {
        let n = parse_index(rest, TIMERS, if area == "T" { "Timer" } else { "Counter" })?;
        return Ok(if area == "T" { Bit::T(n) } else { Bit::C(n) });
    }
    let (byte, bit) = rest.split_once('.').ok_or_else(|| {
        format!("\"{text}\" is not a bit address. Write it like I0.0, Q0.1 or M2.3.")
    })?;
    let bit: u8 = bit
        .parse()
        .ok()
        .filter(|b| *b < 8)
        .ok_or_else(|| format!("In \"{text}\" the bit number after the dot must be 0 to 7."))?;
    match area {
        "I" => Ok(Bit::I(parse_index(byte, IO_POINTS / 8, "Input byte")?, bit)),
        "Q" => Ok(Bit::Q(parse_index(byte, IO_POINTS / 8, "Output byte")?, bit)),
        "M" => Ok(Bit::M(parse_index(byte, M_BYTES, "Marker byte")?, bit)),
        _ => Err(format!(
            "\"{text}\" is not a bit address. Use I (input), Q (output), M (marker), T (timer) or C (counter)."
        )),
    }
}

/// Reads a timer preset: T#5S, T#500MS, T#1M30S, or a plain number of ms.
pub fn parse_time(text: &str) -> Result<i32, String> {
    let t = text.trim().to_ascii_uppercase();
    if let Ok(n) = t.parse::<i32>() {
        return Ok(n.max(0));
    }
    let body = t
        .strip_prefix("T#")
        .or_else(|| t.strip_prefix("S5T#"))
        .ok_or_else(|| format!("\"{text}\" is not a time. Write it like T#5S or T#500MS."))?;
    let mut ms: i64 = 0;
    let mut num = String::new();
    let mut chars = body.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch.is_ascii_digit() {
            num.push(ch);
            continue;
        }
        let n: i64 = num
            .parse()
            .map_err(|_| format!("\"{text}\" is not a valid time."))?;
        num.clear();
        let unit = match ch {
            'H' => 3_600_000,
            'M' if chars.peek() == Some(&'S') => {
                chars.next();
                1
            }
            'M' => 60_000,
            'S' => 1000,
            '_' => continue,
            _ => return Err(format!("\"{text}\" is not a valid time.")),
        };
        ms += n * unit;
    }
    if !num.is_empty() {
        return Err(format!("\"{text}\" needs a unit (H, M, S or MS)."));
    }
    i32::try_from(ms).map_err(|_| format!("\"{text}\" is too long."))
}

/// Reads a number operand: 25, -3, MW10, T2, C1.
pub fn parse_word(text: &str) -> Result<Word, String> {
    let t = text.trim().to_ascii_uppercase();
    if let Ok(n) = t.parse::<i32>() {
        if !(-32768..=32767).contains(&n) {
            return Err(format!("{n} is outside -32768 to 32767."));
        }
        return Ok(Word::Const(n));
    }
    if t.starts_with("T#") {
        return parse_time(&t).map(Word::Const);
    }
    if let Some(n) = t.strip_prefix("MW") {
        let n = parse_index(n, M_BYTES - 1, "Marker word")?;
        return Ok(Word::Mw(n));
    }
    if let Some(n) = t.strip_prefix('T') {
        return Ok(Word::T(parse_index(n, TIMERS, "Timer")?));
    }
    if let Some(n) = t.strip_prefix('C') {
        return Ok(Word::C(parse_index(n, COUNTERS, "Counter")?));
    }
    Err(format!(
        "\"{text}\" is not a number. Use a value like 25, or MW10, T1 or C1."
    ))
}

// ---------- Checked program ----------

#[derive(Debug, Clone, Copy, PartialEq)]
enum Cmp {
    Eq,
    Ne,
    Gt,
    Lt,
    Ge,
    Le,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum MathOp {
    Add,
    Sub,
    Mul,
    Div,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum TimerKind {
    On,
    Off,
    Pulse,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Op {
    Empty,
    Wire,
    No(Bit),
    Nc(Bit),
    Pos(Bit),
    Neg(Bit),
    Not,
    Coil(Bit),
    NCoil(Bit),
    Set(Bit),
    Reset(Bit),
    Timer(TimerKind, u8, Word),
    Ctu(u8, Word, Option<Bit>),
    Ctd(u8, Word, Option<Bit>),
    Cmp(Cmp, Word, Word),
    Move(Word, Word),
    Math(MathOp, Word, Word, Word),
}

/// A mistake in the ladder program, with where it is.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LadderError {
    pub network: usize,
    pub row: usize,
    pub col: usize,
    pub message: String,
}

fn writable(b: Bit) -> Result<Bit, String> {
    match b {
        Bit::I(..) => Err("An input (I) cannot be written by the program. Use Q or M.".to_string()),
        Bit::T(_) | Bit::C(_) => {
            Err("A timer or counter output cannot be a coil. Use Q or M.".to_string())
        }
        _ => Ok(b),
    }
}

fn writable_word(w: Word) -> Result<Word, String> {
    match w {
        Word::Mw(_) => Ok(w),
        _ => Err("The result must go into a marker word such as MW10.".to_string()),
    }
}

fn optional_bit(s: &str) -> Result<Option<Bit>, String> {
    if s.trim().is_empty() {
        Ok(None)
    } else {
        parse_bit(s).map(Some)
    }
}

fn compile_cell(cell: &Cell) -> Result<Op, String> {
    Ok(match cell {
        Cell::Empty => Op::Empty,
        Cell::Wire => Op::Wire,
        Cell::No { a } => Op::No(parse_bit(a)?),
        Cell::Nc { a } => Op::Nc(parse_bit(a)?),
        Cell::Pos { a } => Op::Pos(parse_bit(a)?),
        Cell::Neg { a } => Op::Neg(parse_bit(a)?),
        Cell::Not => Op::Not,
        Cell::Coil { a } => Op::Coil(writable(parse_bit(a)?)?),
        Cell::NCoil { a } => Op::NCoil(writable(parse_bit(a)?)?),
        Cell::Set { a } => Op::Set(writable(parse_bit(a)?)?),
        Cell::Reset { a } => {
            let b = parse_bit(a)?;
            if matches!(b, Bit::I(..)) {
                return Err("An input (I) cannot be reset by the program.".to_string());
            }
            Op::Reset(b)
        }
        Cell::Ton { t, pt } | Cell::Tof { t, pt } | Cell::Tp { t, pt } => {
            let kind = match cell {
                Cell::Ton { .. } => TimerKind::On,
                Cell::Tof { .. } => TimerKind::Off,
                _ => TimerKind::Pulse,
            };
            let n = match parse_bit(t)? {
                Bit::T(n) => n,
                _ => return Err("A timer needs a timer number such as T1.".to_string()),
            };
            Op::Timer(
                kind,
                n,
                parse_word(pt).or_else(|_| parse_time(pt).map(Word::Const))?,
            )
        }
        Cell::Ctu { c, pv, r } | Cell::Ctd { c, pv, ld: r } => {
            let n = match parse_bit(c)? {
                Bit::C(n) => n,
                _ => return Err("A counter needs a counter number such as C1.".to_string()),
            };
            let pv = parse_word(pv)?;
            let r = optional_bit(r)?;
            if matches!(cell, Cell::Ctu { .. }) {
                Op::Ctu(n, pv, r)
            } else {
                Op::Ctd(n, pv, r)
            }
        }
        Cell::Cmp { op, a, b } => {
            let c = match op.trim() {
                "==" | "=" => Cmp::Eq,
                "<>" | "!=" => Cmp::Ne,
                ">" => Cmp::Gt,
                "<" => Cmp::Lt,
                ">=" => Cmp::Ge,
                "<=" => Cmp::Le,
                _ => {
                    return Err(format!(
                        "\"{op}\" is not a comparison. Use ==, <>, >, <, >= or <=."
                    ))
                }
            };
            Op::Cmp(c, parse_word(a)?, parse_word(b)?)
        }
        Cell::Move { a, dst } => Op::Move(parse_word(a)?, writable_word(parse_word(dst)?)?),
        Cell::Math { op, a, b, dst } => {
            let m = match op.trim().to_ascii_uppercase().as_str() {
                "ADD" | "+" => MathOp::Add,
                "SUB" | "-" => MathOp::Sub,
                "MUL" | "*" => MathOp::Mul,
                "DIV" | "/" => MathOp::Div,
                _ => return Err(format!("\"{op}\" is not ADD, SUB, MUL or DIV.")),
            };
            Op::Math(
                m,
                parse_word(a)?,
                parse_word(b)?,
                writable_word(parse_word(dst)?)?,
            )
        }
    })
}

struct CNet {
    rows: Vec<Vec<Op>>,
    /// links[col][row]: rows `row` and `row + 1` are joined after column `col`.
    links: Vec<Vec<bool>>,
}

/// Checks a ladder program. Returns every mistake found.
fn compile(l: &Ladder) -> Result<Vec<CNet>, Vec<LadderError>> {
    let mut errors = Vec::new();
    let mut nets = Vec::new();
    let mut coils: BTreeMap<Bit, (usize, usize, usize)> = BTreeMap::new();
    for (ni, n) in l.networks.iter().enumerate() {
        let mut rows = Vec::new();
        for (ri, row) in n.rows.iter().enumerate() {
            let mut ops = vec![Op::Empty; COLUMNS];
            for (ci, cell) in row.iter().enumerate().take(COLUMNS) {
                match compile_cell(cell) {
                    Ok(op) => {
                        if let Op::Coil(b) | Op::NCoil(b) = op {
                            if let Some(&(pn, _, _)) = coils.get(&b) {
                                errors.push(LadderError {
                                    network: ni,
                                    row: ri,
                                    col: ci,
                                    message: format!(
                                        "This output is already a coil in network {}. Use it as a coil only once (or use Set/Reset).",
                                        pn + 1
                                    ),
                                });
                            } else {
                                coils.insert(b, (ni, ri, ci));
                            }
                        }
                        ops[ci] = op;
                    }
                    Err(message) => errors.push(LadderError {
                        network: ni,
                        row: ri,
                        col: ci,
                        message,
                    }),
                }
            }
            rows.push(ops);
        }
        let mut links = vec![vec![false; rows.len()]; COLUMNS];
        for &(r, c) in &n.links {
            if c < COLUMNS && r + 1 < rows.len() {
                links[c][r] = true;
            }
        }
        nets.push(CNet { rows, links });
    }
    if errors.is_empty() {
        Ok(nets)
    } else {
        Err(errors)
    }
}

// ---------- Running ----------

#[derive(Debug, Clone, Copy, Default)]
struct TimerState {
    elapsed: i32,
    q: bool,
    last_in: bool,
    running: bool,
}

#[derive(Debug, Clone, Copy, Default)]
struct CounterState {
    value: i32,
    q: bool,
    last_in: bool,
}

/// Power flow seen in the last scan, for drawing the ladder live.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Flow {
    /// powered[network][row][col]: power leaves this cell on its right side.
    pub powered: Vec<Vec<Vec<bool>>>,
}

pub struct Plc {
    nets: Vec<CNet>,
    scan_ms: f64,
    /// Input terminals as wired (set by the circuit).
    pub inputs: [bool; IO_POINTS],
    i: [u8; IO_POINTS / 8],
    q: [u8; IO_POINTS / 8],
    m: [u8; M_BYTES],
    timers: [TimerState; TIMERS],
    counters: [CounterState; COUNTERS],
    /// Last operand level of each edge contact, by (network, row, col).
    edges: BTreeMap<(usize, usize, usize), bool>,
    /// Time not yet used for a scan.
    pending_ms: f64,
    pub running: bool,
    pub scans: u64,
    pub flow: Flow,
}

impl Plc {
    /// Checks the program and makes a PLC ready to run it.
    pub fn new(l: &Ladder) -> Result<Self, Vec<LadderError>> {
        let nets = compile(l)?;
        Ok(Plc {
            nets,
            scan_ms: if l.scan_ms == 0 {
                10.0
            } else {
                l.scan_ms as f64
            },
            inputs: [false; IO_POINTS],
            i: [0; IO_POINTS / 8],
            q: [0; IO_POINTS / 8],
            m: [0; M_BYTES],
            timers: [TimerState::default(); TIMERS],
            counters: [CounterState::default(); COUNTERS],
            edges: BTreeMap::new(),
            pending_ms: 0.0,
            running: true,
            scans: 0,
            flow: Flow::default(),
        })
    }

    /// The output relay state of Q0.0..Q1.7 (index 0..15).
    pub fn output(&self, n: usize) -> bool {
        n < IO_POINTS && self.q[n / 8] >> (n % 8) & 1 != 0
    }

    /// Marker word value (for the watch table).
    pub fn marker_word(&self, n: usize) -> i16 {
        i16::from_be_bytes([self.m[n % M_BYTES], self.m[(n + 1) % M_BYTES]])
    }

    pub fn timer_ms(&self, n: usize) -> i32 {
        self.timers[n].elapsed
    }

    pub fn counter(&self, n: usize) -> i32 {
        self.counters[n].value
    }

    /// Runs the PLC for `ms` milliseconds (whole scans).
    pub fn run(&mut self, ms: f64) {
        if !self.running {
            // In STOP the outputs are off.
            self.q = [0; IO_POINTS / 8];
            return;
        }
        self.pending_ms += ms;
        while self.pending_ms >= self.scan_ms {
            self.pending_ms -= self.scan_ms;
            self.scan(self.scan_ms);
        }
    }

    /// One scan cycle.
    pub fn scan(&mut self, dt: f64) {
        for (n, on) in self.inputs.iter().enumerate() {
            let m = 1 << (n % 8);
            if *on {
                self.i[n / 8] |= m;
            } else {
                self.i[n / 8] &= !m;
            }
        }
        let dt = dt.round() as i32;
        let mut flow = Vec::with_capacity(self.nets.len());
        for ni in 0..self.nets.len() {
            flow.push(self.scan_network(ni, dt));
        }
        self.flow = Flow { powered: flow };
        self.scans += 1;
    }

    fn scan_network(&mut self, ni: usize, dt: i32) -> Vec<Vec<bool>> {
        let rows = self.nets[ni].rows.len();
        let mut power = vec![true; rows];
        let mut seen = vec![vec![false; COLUMNS]; rows];
        for col in 0..COLUMNS {
            for (r, p) in power.iter_mut().enumerate() {
                let op = self.nets[ni].rows[r][col];
                *p = self.eval(op, *p, (ni, r, col), dt);
            }
            // Join rows linked at the right edge of this column.
            let mut r = 0;
            while r < rows {
                let mut end = r;
                while end + 1 < rows && self.nets[ni].links[col][end] {
                    end += 1;
                }
                if end > r {
                    let any = power[r..=end].iter().any(|p| *p);
                    power[r..=end].iter_mut().for_each(|p| *p = any);
                }
                r = end + 1;
            }
            for (s, p) in seen.iter_mut().zip(&power) {
                s[col] = *p;
            }
        }
        seen
    }

    fn get_bit(&self, b: Bit) -> bool {
        match b {
            Bit::I(n, x) => self.i[n as usize] >> x & 1 != 0,
            Bit::Q(n, x) => self.q[n as usize] >> x & 1 != 0,
            Bit::M(n, x) => self.m[n as usize] >> x & 1 != 0,
            Bit::T(n) => self.timers[n as usize].q,
            Bit::C(n) => self.counters[n as usize].q,
        }
    }

    fn set_bit(&mut self, b: Bit, on: bool) {
        let (byte, x) = match b {
            Bit::Q(n, x) => (&mut self.q[n as usize], x),
            Bit::M(n, x) => (&mut self.m[n as usize], x),
            _ => return,
        };
        if on {
            *byte |= 1 << x;
        } else {
            *byte &= !(1 << x);
        }
    }

    fn get_word(&self, w: Word) -> i32 {
        match w {
            Word::Const(v) => v,
            Word::Mw(n) => self.marker_word(n as usize) as i32,
            Word::T(n) => self.timers[n as usize].elapsed,
            Word::C(n) => self.counters[n as usize].value,
        }
    }

    fn set_word(&mut self, w: Word, v: i32) {
        if let Word::Mw(n) = w {
            let b = (v as i16).to_be_bytes();
            self.m[n as usize] = b[0];
            self.m[n as usize + 1] = b[1];
        }
    }

    fn edge(&mut self, key: (usize, usize, usize), now: bool) -> (bool, bool) {
        // The edge memory starts at 0, as in a real PLC after power-on.
        let before = self.edges.insert(key, now).unwrap_or(false);
        (!before && now, before && !now)
    }

    /// Power leaving a cell, given the power coming in.
    fn eval(&mut self, op: Op, p: bool, key: (usize, usize, usize), dt: i32) -> bool {
        match op {
            Op::Empty => false,
            Op::Wire => p,
            Op::No(b) => p && self.get_bit(b),
            Op::Nc(b) => p && !self.get_bit(b),
            Op::Pos(b) => {
                let v = self.get_bit(b);
                let (rise, _) = self.edge(key, v);
                p && rise
            }
            Op::Neg(b) => {
                let v = self.get_bit(b);
                let (_, fall) = self.edge(key, v);
                p && fall
            }
            Op::Not => !p,
            Op::Coil(b) => {
                self.set_bit(b, p);
                p
            }
            Op::NCoil(b) => {
                self.set_bit(b, !p);
                p
            }
            Op::Set(b) => {
                if p {
                    self.set_bit(b, true);
                }
                p
            }
            Op::Reset(b) => {
                if p {
                    match b {
                        Bit::T(n) => self.timers[n as usize] = TimerState::default(),
                        Bit::C(n) => {
                            let c = &mut self.counters[n as usize];
                            c.value = 0;
                            c.q = false;
                        }
                        _ => self.set_bit(b, false),
                    }
                }
                p
            }
            Op::Timer(kind, n, pt) => {
                let preset = self.get_word(pt).max(0);
                let t = &mut self.timers[n as usize];
                let rise = p && !t.last_in;
                t.last_in = p;
                match kind {
                    TimerKind::On => {
                        if p {
                            t.elapsed = (t.elapsed + dt).min(preset);
                            t.q = t.elapsed >= preset;
                        } else {
                            t.elapsed = 0;
                            t.q = false;
                        }
                    }
                    TimerKind::Off => {
                        if p {
                            t.elapsed = 0;
                            t.q = true;
                            t.running = true;
                        } else if t.running {
                            t.elapsed = (t.elapsed + dt).min(preset);
                            if t.elapsed >= preset {
                                t.q = false;
                                t.running = false;
                            }
                        }
                    }
                    TimerKind::Pulse => {
                        if rise && !t.running {
                            t.running = true;
                            t.elapsed = 0;
                        }
                        if t.running {
                            t.elapsed = (t.elapsed + dt).min(preset);
                            t.q = t.elapsed < preset;
                            if !t.q {
                                t.running = false;
                            }
                        } else {
                            t.q = false;
                            if !p {
                                t.elapsed = 0;
                            }
                        }
                    }
                }
                t.q
            }
            Op::Ctu(n, pv, r) => {
                let preset = self.get_word(pv);
                let reset = r.is_some_and(|b| self.get_bit(b));
                let c = &mut self.counters[n as usize];
                if reset {
                    c.value = 0;
                } else if p && !c.last_in && c.value < 32767 {
                    c.value += 1;
                }
                c.last_in = p;
                c.q = c.value >= preset;
                c.q
            }
            Op::Ctd(n, pv, ld) => {
                let preset = self.get_word(pv);
                let load = ld.is_some_and(|b| self.get_bit(b));
                let c = &mut self.counters[n as usize];
                if load {
                    c.value = preset;
                } else if p && !c.last_in && c.value > -32768 {
                    c.value -= 1;
                }
                c.last_in = p;
                c.q = c.value <= 0;
                c.q
            }
            Op::Cmp(c, a, b) => {
                let (a, b) = (self.get_word(a), self.get_word(b));
                p && match c {
                    Cmp::Eq => a == b,
                    Cmp::Ne => a != b,
                    Cmp::Gt => a > b,
                    Cmp::Lt => a < b,
                    Cmp::Ge => a >= b,
                    Cmp::Le => a <= b,
                }
            }
            Op::Move(a, dst) => {
                if p {
                    let v = self.get_word(a);
                    self.set_word(dst, v);
                }
                p
            }
            Op::Math(m, a, b, dst) => {
                if !p {
                    return false;
                }
                let (a, b) = (self.get_word(a), self.get_word(b));
                let v = match m {
                    MathOp::Add => a.checked_add(b),
                    MathOp::Sub => a.checked_sub(b),
                    MathOp::Mul => a.checked_mul(b),
                    MathOp::Div => a.checked_div(b),
                };
                match v.filter(|v| (-32768..=32767).contains(v)) {
                    Some(v) => {
                        self.set_word(dst, v);
                        true
                    }
                    // Overflow or division by zero: the result is not stored
                    // and no power leaves the box.
                    None => false,
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
