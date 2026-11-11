//! The control panel: the academy's training board with its PLC module, four
//! indicator lamps (Q1 to Q4), four switches (I1 to I4), the output connector
//! (Q1 to Q4) and the input connector (I5 to I8).
//!
//! The board is wired inside, like the real one: the lamps and the output
//! connector follow Q1 to Q4, the switches feed I1 to I4 and the input
//! connector leads to I5 to I8. That wiring is not drawn and cannot be
//! changed. The student adds field devices (push buttons, sensors, lamps, a
//! motor ...) on the board or on the bench around it, and joins their
//! terminals to the connectors with jumper wires.
//!
//! This module holds what is saved in the project (the devices and the wires),
//! the fixed layout of the board, and the checks a wiring must pass.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

pub mod circuit;

/// Size of the board.
pub const BOARD_W: f64 = 1600.0;
pub const BOARD_H: f64 = 780.0;
/// The work area: the board at the top and a bench below it, where devices
/// may also be placed. It is as wide as the board, so there is nothing to
/// scroll to sideways.
pub const WORK_W: f64 = BOARD_W;
pub const WORK_H: f64 = BOARD_H + 380.0;
/// Most devices on a panel.
pub const MAX_DEVICES: usize = 100;
/// Most wires on a panel.
pub const MAX_WIRES: usize = 400;
/// Most bends in one wire.
pub const MAX_BENDS: usize = 64;
/// Devices are drawn this much bigger than their basic drawing, so their
/// lettering can be read without zooming.
pub const DEVICE_SCALE: f64 = 1.4;

// ---------- Saved in the project ----------

/// A device the student added.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacedDevice {
    /// Unique number; its terminals are called "d<id>.<name>".
    pub id: u32,
    /// One of the kinds in the catalogue ("pushNo", "lamp" ...).
    pub kind: String,
    pub x: f64,
    pub y: f64,
    /// The student's name for the device.
    #[serde(default)]
    pub label: String,
    /// Settings such as the colour of a lamp.
    #[serde(default)]
    pub props: BTreeMap<String, String>,
}

/// A jumper wire between two terminals.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelWire {
    pub from: String,
    pub to: String,
    /// Colour of the wire insulation, e.g. "red".
    #[serde(default)]
    pub color: String,
    /// Bends of the wire, from the "from" end to the "to" end.
    #[serde(default)]
    pub points: Vec<Point>,
    /// A smooth curve through the bends instead of straight pieces. Wires
    /// saved by version 0.0.2 and earlier were curved, so that is the default
    /// when the file does not say.
    #[serde(default = "curved_by_default")]
    pub curved: bool,
}

fn curved_by_default() -> bool {
    true
}

/// A point on the panel.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Panel {
    #[serde(default)]
    pub devices: Vec<PlacedDevice>,
    #[serde(default)]
    pub wires: Vec<PanelWire>,
    /// Settings of the board's own devices, by device id (for example the
    /// contact of switch "swI1": "contact" = "no" or "nc", "action" =
    /// "momentary" or "maintained").
    #[serde(default)]
    pub fixed_props: BTreeMap<String, BTreeMap<String, String>>,
}

// ---------- The layout of the board ----------

/// A screw terminal. `id` is unique on the whole panel; `x` and `y` are
/// measured from the top-left corner of the device.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Terminal {
    pub id: String,
    pub name: String,
    pub x: f64,
    pub y: f64,
}

/// A device that is part of the board and cannot be moved or removed.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixedDevice {
    pub id: String,
    pub kind: String,
    /// The name printed on the board (I1, Q1 ...).
    pub label: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub color: String,
    pub terminals: Vec<Terminal>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalDef {
    pub name: String,
    /// What is printed beside the terminal ("+", "−", "WH" ...).
    pub mark: String,
    pub x: f64,
    pub y: f64,
}

/// A kind of device the student can add.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceDef {
    pub kind: String,
    pub name: String,
    /// Short name printed above the device on the panel.
    pub short: String,
    /// Heading it is listed under: "Switches", "Sensors", "Analog", "Loads".
    pub group: String,
    /// Size on the panel (already scaled).
    pub w: f64,
    pub h: f64,
    /// The device's drawing is made at w / scale by h / scale and enlarged.
    pub scale: f64,
    /// Terminal positions on the panel (already scaled).
    pub terminals: Vec<TerminalDef>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    pub width: f64,
    pub height: f64,
    pub work_width: f64,
    pub work_height: f64,
    pub fixed: Vec<FixedDevice>,
    pub catalog: Vec<DeviceDef>,
}

fn term(device: &str, name: &str, x: f64, y: f64) -> Terminal {
    Terminal {
        id: format!("{device}.{name}"),
        name: name.to_string(),
        x,
        y,
    }
}

#[allow(clippy::too_many_arguments)]
fn fixed(
    id: &str,
    kind: &str,
    label: &str,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    color: &str,
    terminals: Vec<Terminal>,
) -> FixedDevice {
    FixedDevice {
        id: id.to_string(),
        kind: kind.to_string(),
        label: label.to_string(),
        x,
        y,
        w,
        h,
        color: color.to_string(),
        terminals,
    }
}

/// A device with its terminals in a row along the bottom edge. `w` and `h`
/// are the size of its basic drawing; on the panel it is DEVICE_SCALE bigger.
fn def(
    kind: &str,
    name: &str,
    short: &str,
    group: &str,
    (w, h): (f64, f64),
    terms: &[(&str, &str)],
) -> DeviceDef {
    // Room between the drawing and the terminal names.
    let h = h + 22.0;
    let n = terms.len() as f64;
    let step = if n > 2.0 {
        (w - 36.0) / (n - 1.0)
    } else {
        w * 0.4
    };
    let first = if n > 2.0 { 18.0 } else { w * 0.3 };
    let s = DEVICE_SCALE;
    DeviceDef {
        kind: kind.to_string(),
        name: name.to_string(),
        short: short.to_string(),
        group: group.to_string(),
        w: w * s,
        h: h * s,
        scale: s,
        terminals: terms
            .iter()
            .enumerate()
            .map(|(i, (name, mark))| TerminalDef {
                name: name.to_string(),
                mark: mark.to_string(),
                x: (first + step * i as f64) * s,
                y: (h - 18.0) * s,
            })
            .collect(),
    }
}

/// Colours of the four indicator lamps, as on the academy board.
pub const LAMP_COLORS: [&str; 4] = ["red", "green", "blue", "yellow"];

/// Size of one section of the output connector (Q1 to Q4).
const QCON_SECTION: f64 = 185.0;
/// Size of one section of the input connector (I8 at the top to I5).
const ICON_SECTION: f64 = 180.0;

/// The board and the catalogue of devices.
pub fn layout() -> Layout {
    let mut f = Vec::new();

    // Indicator lamps Q1 to Q4 and switches I1 to I4.
    for (i, color) in LAMP_COLORS.iter().enumerate() {
        let x = 157.0 + 130.0 * i as f64;
        f.push(fixed(
            &format!("lampQ{}", i + 1),
            "boardLamp",
            &format!("Q{}", i + 1),
            x,
            160.0,
            110.0,
            130.0,
            color,
            vec![],
        ));
        f.push(fixed(
            &format!("swI{}", i + 1),
            "boardSwitch",
            &format!("I{}", i + 1),
            x,
            315.0,
            110.0,
            172.0,
            "grey",
            vec![],
        ));
    }

    // Output connector: for each of Q1 to Q4, "+" (24 V while the output is
    // on), "−" (0 V) and the earth terminal.
    let mut q = Vec::new();
    for i in 0..4 {
        let base = QCON_SECTION * i as f64;
        for (j, s) in ["p", "n", "g"].iter().enumerate() {
            q.push(term(
                "qcon",
                &format!("Q{}{s}", i + 1),
                base + 50.0 + 45.0 * j as f64,
                88.0,
            ));
        }
    }
    f.push(fixed(
        "qcon",
        "qConnector",
        "Q",
        40.0,
        530.0,
        QCON_SECTION * 4.0,
        175.0,
        "grey",
        q,
    ));

    // The PLC module (inside it is wired to everything above).
    f.push(fixed(
        "plc",
        "plc",
        "PLC",
        800.0,
        140.0,
        500.0,
        420.0,
        "grey",
        vec![],
    ));

    // Input connector: I8 at the top down to I5, each with +24 V, 0 V and the
    // signal terminal.
    let mut c = Vec::new();
    for (k, n) in [8, 7, 6, 5].iter().enumerate() {
        let base = ICON_SECTION * k as f64;
        for (j, s) in ["p", "n", "s"].iter().enumerate() {
            c.push(term(
                "icon",
                &format!("I{n}{s}"),
                100.0,
                base + 40.0 + 50.0 * j as f64,
            ));
        }
    }
    f.push(fixed(
        "icon",
        "iConnector",
        "I",
        1330.0,
        40.0,
        230.0,
        ICON_SECTION * 4.0,
        "grey",
        c,
    ));

    let sw = [("a", "1"), ("b", "2")];
    let load = [("p", "+"), ("n", "−")];
    let sensor = [("p", "BN +"), ("n", "BU −"), ("s", "BK")];
    let catalog = vec![
        def(
            "pushNo",
            "Push button, NO",
            "Push button NO",
            "Switches",
            (100.0, 120.0),
            &sw,
        ),
        def(
            "pushNc",
            "Push button, NC",
            "Push button NC",
            "Switches",
            (100.0, 120.0),
            &sw,
        ),
        def(
            "toggle",
            "Toggle switch",
            "Toggle switch",
            "Switches",
            (100.0, 120.0),
            &sw,
        ),
        def(
            "limitNo",
            "Limit switch, NO",
            "Limit switch NO",
            "Switches",
            (120.0, 120.0),
            &sw,
        ),
        def(
            "limitNc",
            "Limit switch, NC",
            "Limit switch NC",
            "Switches",
            (120.0, 120.0),
            &sw,
        ),
        def(
            "proxPnp",
            "Proximity sensor, PNP (3-wire)",
            "Prox. sensor PNP",
            "Sensors",
            (130.0, 130.0),
            &sensor,
        ),
        def(
            "photoPnp",
            "Photo sensor, PNP (3-wire)",
            "Photo sensor PNP",
            "Sensors",
            (130.0, 130.0),
            &sensor,
        ),
        def(
            "prox2w",
            "Proximity sensor, 2-wire",
            "Prox. sensor 2-wire",
            "Sensors",
            (120.0, 130.0),
            &[("a", "BN"), ("b", "BU")],
        ),
        def(
            "pot",
            "Potentiometer, 0–10 V",
            "Potentiometer",
            "Analog",
            (130.0, 140.0),
            &[("p", "+24"), ("n", "0V"), ("out", "OUT")],
        ),
        def(
            "pt100",
            "PT100 sensor (3-wire)",
            "PT100 sensor",
            "Analog",
            (130.0, 150.0),
            &[("r1", "RD"), ("r2", "RD"), ("w", "WH")],
        ),
        def(
            "lamp",
            "Indicator lamp",
            "Lamp",
            "Loads",
            (100.0, 120.0),
            &load,
        ),
        def("buzzer", "Buzzer", "Buzzer", "Loads", (100.0, 120.0), &load),
        def("hooter", "Hooter", "Hooter", "Loads", (120.0, 120.0), &load),
        def(
            "motor",
            "Motor, 24 V DC",
            "Motor 24 V DC",
            "Loads",
            (140.0, 140.0),
            &[("p", "+"), ("n", "−"), ("g", "⏚")],
        ),
        def(
            "contactor",
            "Contactor (coil + NO contact)",
            "Contactor",
            "Loads",
            (150.0, 140.0),
            &[("A1", "A1"), ("A2", "A2"), ("c13", "13"), ("c14", "14")],
        ),
    ];

    Layout {
        width: BOARD_W,
        height: BOARD_H,
        work_width: WORK_W,
        work_height: WORK_H,
        fixed: f,
        catalog,
    }
}

// ---------- Settings of the board switches ----------

/// How a switch behaves.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SwitchSetup {
    /// Normally closed: the contact opens when the switch is operated.
    pub nc: bool,
    /// Momentary (springs back when let go) or maintained (stays where it was put).
    pub momentary: bool,
    /// Frequency mode: the input switches on and off by itself this many
    /// times a second.
    pub hz: Option<f64>,
}

/// Lowest and highest frequency of an input in frequency mode.
pub const MIN_HZ: f64 = 0.1;
pub const MAX_HZ: f64 = 50.0;

/// Settings of input I1 to I4 (n = 1 to 4), shared by the board switch and
/// the I block of the program. The modes are those of the usual PLC
/// software: "switch" (an on/off switch), "make" (momentary push button,
/// NO), "break" (momentary push button, NC) and "frequency". New boards have
/// make push buttons. Projects from version 0.0.2 used "contact" and "action".
pub fn board_switch(panel: &Panel, n: usize) -> SwitchSetup {
    let props = panel.fixed_props.get(&format!("swI{n}"));
    let get = |k: &str| props.and_then(|p| p.get(k)).map(String::as_str);
    match get("mode") {
        Some("switch") => SwitchSetup {
            nc: false,
            momentary: false,
            hz: None,
        },
        Some("break") => SwitchSetup {
            nc: true,
            momentary: true,
            hz: None,
        },
        Some("frequency") => SwitchSetup {
            nc: false,
            momentary: false,
            hz: Some(
                get("hz")
                    .and_then(|h| h.parse::<f64>().ok())
                    .filter(|h| h.is_finite())
                    .unwrap_or(1.0)
                    .clamp(MIN_HZ, MAX_HZ),
            ),
        },
        Some("make") => SwitchSetup {
            nc: false,
            momentary: true,
            hz: None,
        },
        // Version 0.0.2 kept "contact" and "action".
        _ if get("contact").is_some() || get("action").is_some() => SwitchSetup {
            nc: get("contact") == Some("nc"),
            momentary: get("action") != Some("maintained"),
            hz: None,
        },
        // New inputs are on/off switches, as in the usual PLC software.
        _ => SwitchSetup {
            nc: false,
            momentary: false,
            hz: None,
        },
    }
}

// ---------- Checking the wiring ----------

/// A mistake in the wiring, or a warning (something that works but is not
/// good practice).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelError {
    /// Index of the wire concerned, if one wire is to blame.
    pub wire: Option<usize>,
    pub message: String,
    /// True for a gentle warning, false for a mistake.
    #[serde(default)]
    pub warning: bool,
}

fn err(wire: Option<usize>, message: impl Into<String>) -> PanelError {
    PanelError {
        wire,
        message: message.into(),
        warning: false,
    }
}

fn warn(message: impl Into<String>) -> PanelError {
    PanelError {
        wire: None,
        message: message.into(),
        warning: true,
    }
}

/// The catalogue entry of a placed device.
pub fn device_def<'a>(layout: &'a Layout, kind: &str) -> Option<&'a DeviceDef> {
    layout.catalog.iter().find(|c| c.kind == kind)
}

/// Every terminal id that exists with these devices.
pub fn terminal_ids(panel: &Panel, layout: &Layout) -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    for f in &layout.fixed {
        for t in &f.terminals {
            ids.insert(t.id.clone());
        }
    }
    for d in &panel.devices {
        if let Some(def) = device_def(layout, &d.kind) {
            for t in &def.terminals {
                ids.insert(format!("d{}.{}", d.id, t.name));
            }
        }
    }
    ids
}

/// Joins terminals into groups ("nets") that are joined by wires.
pub(crate) struct Joins {
    parent: BTreeMap<String, String>,
}

impl Joins {
    pub(crate) fn new() -> Self {
        Joins {
            parent: BTreeMap::new(),
        }
    }
    pub(crate) fn find(&mut self, a: &str) -> String {
        let p = self.parent.get(a).cloned().unwrap_or_else(|| a.to_string());
        if p == a {
            return p;
        }
        let root = self.find(&p);
        self.parent.insert(a.to_string(), root.clone());
        root
    }
    pub(crate) fn join(&mut self, a: &str, b: &str) {
        let (ra, rb) = (self.find(a), self.find(b));
        if ra != rb {
            self.parent.insert(ra, rb);
        }
    }
}

/// What a board terminal is, for the short-circuit checks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Supply {
    Plus24,
    /// "+" of output Qn: 24 V while Qn is on.
    Output(u8),
    Zero,
    Earth,
    /// Signal terminal of input In.
    Signal(u8),
}

fn supply_of(id: &str) -> Option<Supply> {
    let (dev, name) = id.split_once('.')?;
    let b = name.as_bytes();
    if b.len() != 3 {
        return None;
    }
    let n = b[1].wrapping_sub(b'0');
    match (dev, b[0], b[2]) {
        ("qcon", b'Q', b'p') => Some(Supply::Output(n)),
        ("qcon", b'Q', b'n') | ("icon", b'I', b'n') => Some(Supply::Zero),
        ("qcon", b'Q', b'g') => Some(Supply::Earth),
        ("icon", b'I', b'p') => Some(Supply::Plus24),
        ("icon", b'I', b's') => Some(Supply::Signal(n)),
        _ => None,
    }
}

fn device_name(d: &PlacedDevice, def: &DeviceDef) -> String {
    if d.label.trim().is_empty() {
        format!("{} {}", def.name, d.id)
    } else {
        format!("\"{}\"", d.label.trim())
    }
}

/// Checks the devices and the wires.
pub fn check(panel: &Panel) -> Vec<PanelError> {
    let layout = layout();
    let mut errors = Vec::new();
    if panel.devices.len() > MAX_DEVICES {
        errors.push(err(
            None,
            format!("There are more than {MAX_DEVICES} devices on the panel."),
        ));
    }
    if panel.wires.len() > MAX_WIRES {
        errors.push(err(
            None,
            format!("There are more than {MAX_WIRES} wires on the panel."),
        ));
    }
    let mut seen = BTreeSet::new();
    for d in &panel.devices {
        if !seen.insert(d.id) {
            errors.push(err(None, "Two devices have the same number."));
        }
        if device_def(&layout, &d.kind).is_none() {
            errors.push(err(
                None,
                format!(
                    "A device of an unknown kind (\"{}\") is on the panel.",
                    d.kind
                ),
            ));
        }
    }
    let ids = terminal_ids(panel, &layout);
    let mut pairs = BTreeSet::new();
    let mut joins = Joins::new();
    for (i, w) in panel.wires.iter().enumerate() {
        if w.points.len() > MAX_BENDS
            || w.points
                .iter()
                .any(|p| !p.x.is_finite() || !p.y.is_finite())
        {
            errors.push(err(
                Some(i),
                format!(
                    "A wire has more than {MAX_BENDS} bends, or a bend that is not on the panel."
                ),
            ));
        }
        if !ids.contains(&w.from) || !ids.contains(&w.to) {
            errors.push(err(
                Some(i),
                "A wire is joined to a terminal that does not exist.",
            ));
            continue;
        }
        if w.from == w.to {
            errors.push(err(Some(i), "A wire starts and ends at the same terminal."));
            continue;
        }
        let key = if w.from < w.to {
            (w.from.clone(), w.to.clone())
        } else {
            (w.to.clone(), w.from.clone())
        };
        if !pairs.insert(key) {
            errors.push(err(Some(i), "Two wires join the same two terminals."));
            continue;
        }
        joins.join(&w.from, &w.to);
    }

    // What each group of joined terminals is connected to.
    let mut nets: BTreeMap<String, BTreeSet<Supply>> = BTreeMap::new();
    for id in &ids {
        if let Some(s) = supply_of(id) {
            nets.entry(joins.find(id)).or_default().insert(s);
        }
    }
    let mut reported = BTreeSet::new();
    let mut report = |errors: &mut Vec<PanelError>, e: PanelError| {
        if reported.insert(e.message.clone()) {
            errors.push(e);
        }
    };
    for kinds in nets.values() {
        let plus = kinds.contains(&Supply::Plus24);
        let zero = kinds.contains(&Supply::Zero);
        let earth = kinds.contains(&Supply::Earth);
        let outputs: Vec<u8> = kinds
            .iter()
            .filter_map(|k| {
                if let Supply::Output(n) = k {
                    Some(*n)
                } else {
                    None
                }
            })
            .collect();
        if plus && zero {
            report(
                &mut errors,
                err(None, "A wire joins +24 V to 0 V. That is a short circuit."),
            );
        }
        if plus && earth {
            report(
                &mut errors,
                err(
                    None,
                    "A wire joins +24 V to earth. That is a short circuit.",
                ),
            );
        }
        for &q in &outputs {
            if zero {
                report(
                    &mut errors,
                    err(None, format!("A wire joins Q{q} + to 0 V. That is a short circuit as soon as Q{q} switches on.")),
                );
            }
            if earth {
                report(
                    &mut errors,
                    err(None, format!("A wire joins Q{q} + to earth. That is a short circuit as soon as Q{q} switches on.")),
                );
            }
            if plus {
                report(
                    &mut errors,
                    err(None, format!("A wire joins Q{q} + to the +24 V supply, so Q{q} could never switch its load off.")),
                );
            }
        }
        if outputs.len() > 1 {
            let names: Vec<String> = outputs.iter().map(|q| format!("Q{q}")).collect();
            report(
                &mut errors,
                err(
                    None,
                    format!(
                        "A wire joins the outputs {}. Each output must drive its own load.",
                        names.join(" and ")
                    ),
                ),
            );
        }
        for k in kinds {
            if let Supply::Signal(n) = k {
                if zero {
                    report(
                        &mut errors,
                        warn(format!(
                            "Input I{n} is joined straight to 0 V, so it can never come on."
                        )),
                    );
                }
            }
        }
    }

    // Gentle warnings about the devices.
    for d in &panel.devices {
        let Some(def) = device_def(&layout, &d.kind) else {
            continue;
        };
        if d.kind == "motor" {
            let g = format!("d{}.g", d.id);
            let root = joins.find(&g);
            let earthed = nets.get(&root).is_some_and(|k| k.contains(&Supply::Earth));
            if !earthed {
                report(
                    &mut errors,
                    warn(format!(
                        "{} is not earthed. For safety, join its earth terminal ⏚ to an earth terminal ⏚ of the Q connector.",
                        device_name(d, def)
                    )),
                );
            }
        }
        let analog_pin = match d.kind.as_str() {
            "pot" => Some("out"),
            "pt100" => Some("w"),
            _ => None,
        };
        if let Some(pin) = analog_pin {
            let root = joins.find(&format!("d{}.{pin}", d.id));
            if let Some(kinds) = nets.get(&root) {
                for k in kinds {
                    if let Supply::Signal(n) = k {
                        if *n < 7 {
                            report(
                                &mut errors,
                                warn(format!(
                                    "{} is joined to I{n}. Only I7 and I8 read analog signals; use one of those.",
                                    device_name(d, def)
                                )),
                            );
                        }
                    }
                }
            }
        }
    }
    errors
}

// ---------- Projects from earlier versions ----------

/// Brings a panel saved by version 0.0.1 up to date. That board had its own
/// supply strips, lamps and buttons with terminals; those are gone, so wires
/// to them are dropped. The student's own devices stay and move to the bench
/// below the board. The NO/NC choice of the old buttons moves to switches I1
/// to I4.
pub fn upgrade_from_v1(panel: &mut Panel) {
    let mut props = BTreeMap::new();
    for n in 1..=4 {
        if let Some(old) = panel.fixed_props.get(&format!("btn{n}")) {
            if old.get("nc").map(String::as_str) == Some("true") {
                let mut p = BTreeMap::new();
                p.insert("contact".to_string(), "nc".to_string());
                props.insert(format!("swI{n}"), p);
            }
        }
    }
    panel.fixed_props = props;
    let layout = layout();
    panel
        .devices
        .retain(|d| device_def(&layout, &d.kind).is_some());
    for d in &mut panel.devices {
        d.y += BOARD_H - 500.0;
        d.x = d.x.clamp(0.0, WORK_W - 220.0);
        d.y = d.y.clamp(BOARD_H + 40.0, WORK_H - 220.0);
    }
    let ids = terminal_ids(panel, &layout);
    panel
        .wires
        .retain(|w| ids.contains(&w.from) && ids.contains(&w.to));
}

#[cfg(test)]
mod tests;
