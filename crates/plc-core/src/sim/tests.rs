use std::collections::BTreeMap;

use super::*;
use crate::fbd::{Block, BlockKind, Wire};
use crate::panel::{PanelWire, PlacedDevice};

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

fn link(from: u32, to: u32, pin: u8) -> Wire {
    Wire {
        from_block: from,
        from_pin: 0,
        to_block: to,
        to_pin: pin,
        points: vec![],
        corners: vec![],
    }
}

fn diagram(blocks: Vec<Block>, wires: Vec<Wire>) -> Diagram {
    Diagram {
        blocks,
        wires,
        scan_ms: 10,
    }
}

fn wire(from: &str, to: &str) -> PanelWire {
    PanelWire {
        from: from.into(),
        to: to.into(),
        color: "red".into(),
        points: vec![],
        curved: false,
    }
}

fn device(id: u32, kind: &str) -> PlacedDevice {
    PlacedDevice {
        id,
        kind: kind.into(),
        x: 0.0,
        y: 900.0,
        label: String::new(),
        props: BTreeMap::new(),
    }
}

fn panel(devices: Vec<PlacedDevice>, wires: Vec<PanelWire>) -> Panel {
    Panel {
        devices,
        wires,
        fixed_props: BTreeMap::new(),
    }
}

/// I1 -> Q1 directly.
fn follow(input: u8, output: u8) -> Diagram {
    diagram(
        vec![
            blk(1, BlockKind::Input { n: input }),
            blk(2, BlockKind::Output { n: output }),
        ],
        vec![link(1, 2, 0)],
    )
}

#[test]
fn board_switch_lights_board_lamp() {
    let mut s = Simulator::new(&follow(1, 1), &Panel::default(), Clock::default()).expect("valid");
    s.advance(50.0);
    assert!(!s.frame().outputs[0]);
    s.press("swI1", true);
    s.advance(20.0);
    let f = s.frame();
    assert!(
        f.inputs[0] && f.switches[0] && f.outputs[0],
        "I1 pressed: Q1 and its lamp on"
    );
    // A new input is a switch: it stays on after letting go, and the next
    // click switches it off.
    s.press("swI1", false);
    s.advance(20.0);
    assert!(s.frame().outputs[0]);
    s.press("swI1", true);
    s.press("swI1", false);
    s.advance(20.0);
    assert!(!s.frame().outputs[0]);
}

#[test]
fn board_switch_settings_are_honoured() {
    let mut p = Panel::default();
    let props: BTreeMap<String, String> = [("contact", "nc"), ("action", "maintained")]
        .iter()
        .map(|(a, b)| (a.to_string(), b.to_string()))
        .collect();
    p.fixed_props.insert("swI2".into(), props);
    let mut s = Simulator::new(&follow(2, 2), &p, Clock::default()).expect("valid");
    s.advance(20.0);
    assert!(
        s.frame().outputs[1],
        "NC: I2 is on while the switch is not operated"
    );
    s.press("swI2", true);
    s.press("swI2", false);
    s.advance(20.0);
    assert!(
        !s.frame().outputs[1],
        "maintained: it stays operated after letting go"
    );
    s.press("swI2", true);
    s.press("swI2", false);
    s.advance(20.0);
    assert!(s.frame().outputs[1], "pressed again: back to normal");
}

#[test]
fn wired_push_button_drives_wired_motor_through_the_program() {
    // Push button on I5, motor (earthed) on Q2. Program: I5 -> Q2.
    let p = panel(
        vec![device(1, "pushNo"), device(2, "motor")],
        vec![
            wire("icon.I5p", "d1.a"),
            wire("d1.b", "icon.I5s"),
            wire("qcon.Q2p", "d2.p"),
            wire("d2.n", "qcon.Q2n"),
            wire("d2.g", "qcon.Q2g"),
        ],
    );
    let mut s = Simulator::new(&follow(5, 2), &p, Clock::default()).expect("valid");
    s.advance(30.0);
    assert_eq!(s.frame().devices[1].dir, 0);
    s.press("d1", true);
    s.advance(30.0);
    let f = s.frame();
    assert!(f.inputs[4] && f.outputs[1]);
    assert_eq!(f.devices[1].dir, 1, "the motor turns");
    assert!(f.devices[0].act);
    s.press("d1", false);
    s.advance(30.0);
    assert_eq!(s.frame().devices[1].dir, 0);
}

#[test]
fn a_device_not_wired_does_nothing() {
    // The button is on the bench but not wired to I5.
    let p = panel(vec![device(1, "pushNo")], vec![]);
    let mut s = Simulator::new(&follow(5, 1), &p, Clock::default()).expect("valid");
    s.press("d1", true);
    s.advance(30.0);
    assert!(!s.frame().outputs[0]);
}

#[test]
fn on_delay_timer_runs_in_real_time() {
    // I1 -> on-delay 2 s -> Q1.
    let d = diagram(
        vec![
            blk(1, BlockKind::Input { n: 1 }),
            blk(2, BlockKind::OnDelay { ms: 2000 }),
            blk(3, BlockKind::Output { n: 1 }),
        ],
        vec![link(1, 2, 0), link(2, 3, 0)],
    );
    let mut s = Simulator::new(&d, &Panel::default(), Clock::default()).expect("valid");
    s.press("swI1", true);
    for _ in 0..19 {
        s.advance(100.0);
    }
    assert!(!s.frame().outputs[0], "1.9 s: not yet");
    s.advance(150.0);
    assert!(s.frame().outputs[0], "after 2 s: on");
    assert!(s.frame().time_ms >= 2000);
}

#[test]
fn potentiometer_feeds_an_analog_threshold() {
    // Pot on I7 (AI1) -> threshold on at 6 V -> Q3.
    let p = panel(
        vec![device(1, "pot")],
        vec![
            wire("icon.I7p", "d1.p"),
            wire("icon.I7n", "d1.n"),
            wire("d1.out", "icon.I7s"),
        ],
    );
    let d = diagram(
        vec![
            blk(1, BlockKind::AnalogInput { n: 1 }),
            blk(2, BlockKind::AnalogThreshold { on: 600, off: 500 }),
            blk(3, BlockKind::Output { n: 3 }),
        ],
        vec![link(1, 2, 0), link(2, 3, 0)],
    );
    let mut s = Simulator::new(&d, &p, Clock::default()).expect("valid");
    s.advance(30.0);
    assert_eq!(s.frame().analog[0], 500, "the knob starts in the middle");
    assert!(!s.frame().outputs[2]);
    s.set_value("d1", 70.0);
    s.advance(30.0);
    assert_eq!(s.frame().analog[0], 700);
    assert!(s.frame().outputs[2]);
    s.set_value("d1", 1e9);
    assert_eq!(
        s.frame().devices[0].value,
        100.0,
        "the slider stops at its end"
    );
}

#[test]
fn pt100_reads_temperature_on_i8() {
    let p = panel(
        vec![device(4, "pt100")],
        vec![
            wire("d4.w", "icon.I8s"),
            wire("d4.r1", "icon.I8n"),
            wire("d4.r2", "icon.I8n"),
        ],
    );
    let mut s = Simulator::new(&follow(1, 1), &p, Clock::default()).expect("valid");
    s.set_value("d4", 72.4);
    s.advance(20.0);
    assert_eq!(s.frame().analog[1], 724);
}

#[test]
fn a_short_circuit_switches_the_supply_off() {
    // Q1 + wired straight to 0 V: when Q1 comes on, the supply trips.
    let p = panel(vec![], vec![wire("qcon.Q1p", "qcon.Q1n")]);
    let mut s = Simulator::new(&follow(1, 1), &p, Clock::default()).expect("valid");
    s.advance(20.0);
    assert!(!s.frame().tripped);
    s.press("swI1", true);
    s.advance(20.0);
    s.advance(20.0);
    let f = s.frame();
    assert!(f.tripped, "short circuit");
    assert!(!f.inputs[0], "without supply the switches give no signal");
    // It stays off even when the cause goes away.
    s.press("swI1", false);
    s.advance(50.0);
    assert!(s.frame().tripped);
}

#[test]
fn a_diagram_with_mistakes_does_not_run() {
    let d = diagram(vec![blk(1, BlockKind::Output { n: 9 })], vec![]);
    let e = Simulator::new(&d, &Panel::default(), Clock::default())
        .err()
        .expect("refused");
    assert!(e.iter().any(|x| x.message.contains("Q9")));
    // AI3 does not exist: only I7 and I8 are analog.
    let d = diagram(vec![blk(1, BlockKind::AnalogInput { n: 3 })], vec![]);
    assert!(Simulator::new(&d, &Panel::default(), Clock::default()).is_err());
}

#[test]
fn the_clock_moves_on() {
    let start = Clock::from_ymd_hm(2026, 12, 31, 23, 59);
    let mut s = Simulator::new(&follow(1, 1), &Panel::default(), start).expect("valid");
    for _ in 0..61 {
        s.advance(1000.0);
    }
    let c = s.frame().clock;
    assert_eq!((c.year, c.month, c.day, c.minute), (2027, 1, 1, 0));
    assert_eq!(c.weekday, Clock::from_ymd_hm(2027, 1, 1, 0, 0).weekday);
}

#[test]
fn frames_serialise_for_the_window() {
    let s = Simulator::new(&follow(1, 1), &Panel::default(), Clock::default()).expect("valid");
    let text = serde_json::to_string(&s.frame()).expect("serialise");
    for key in [
        "\"inputs\"",
        "\"outputs\"",
        "\"analog\"",
        "\"tripped\"",
        "\"devices\"",
        "\"timeMs\"",
    ] {
        assert!(text.contains(key), "{key}");
    }
}

#[test]
fn output_fed_back_makes_a_latch() {
    // Q1 = (I1 OR Q1) AND NOT I2: start with I1, stop with I2.
    let d = diagram(
        vec![
            blk(1, BlockKind::Input { n: 1 }),
            blk(2, BlockKind::Input { n: 2 }),
            blk(3, BlockKind::Or { inputs: 2 }),
            blk(4, BlockKind::Not),
            blk(5, BlockKind::And { inputs: 2 }),
            blk(6, BlockKind::Output { n: 1 }),
        ],
        vec![
            link(1, 3, 0),
            link(6, 3, 1),
            link(2, 4, 0),
            link(3, 5, 0),
            link(4, 5, 1),
            link(5, 6, 0),
        ],
    );
    let mut s = Simulator::new(&d, &Panel::default(), Clock::default()).expect("valid");
    s.advance(30.0);
    assert!(!s.frame().outputs[0]);
    s.press("swI1", true);
    s.advance(30.0);
    s.press("swI1", false);
    s.advance(30.0);
    assert!(
        s.frame().outputs[0],
        "the latch holds Q1 after the start button is let go"
    );
    s.press("swI2", true);
    s.advance(30.0);
    s.press("swI2", false);
    s.advance(30.0);
    assert!(!s.frame().outputs[0], "stop releases it");
}

#[test]
fn input_modes_like_the_usual_plc_software() {
    let mode = |m: &str, hz: &str| {
        let mut p = Panel::default();
        let props: BTreeMap<String, String> = [("mode", m), ("hz", hz)]
            .iter()
            .map(|(a, b)| (a.to_string(), b.to_string()))
            .collect();
        p.fixed_props.insert("swI1".into(), props);
        Simulator::new(&follow(1, 1), &p, Clock::default()).expect("valid")
    };
    // Switch: stays on after a click.
    let mut s = mode("switch", "");
    s.press("swI1", true);
    s.press("swI1", false);
    s.advance(30.0);
    assert!(s.frame().outputs[0]);
    // Break: on until pressed.
    let mut s = mode("break", "");
    s.advance(30.0);
    assert!(s.frame().outputs[0]);
    s.press("swI1", true);
    s.advance(30.0);
    assert!(!s.frame().outputs[0]);
    // Frequency 2 Hz: on for 250 ms, off for 250 ms, by itself.
    let mut s = mode("frequency", "2");
    let mut changes = 0;
    let mut last = false;
    for _ in 0..100 {
        s.advance(10.0);
        let on = s.frame().outputs[0];
        if on != last {
            changes += 1;
            last = on;
        }
    }
    assert!(
        (3..=5).contains(&changes),
        "1 s at 2 Hz switches about 4 times, got {changes}"
    );
}

#[test]
fn the_simulated_clock_can_run_faster() {
    let mut s = Simulator::new(&follow(1, 1), &Panel::default(), Clock::default()).expect("valid");
    s.set_clock(Clock::from_ymd_hm(2026, 3, 2, 7, 0), 60.0);
    for _ in 0..10 {
        s.advance(1000.0);
    }
    // 10 s at 60 times real time: 10 minutes later.
    assert_eq!(s.frame().clock.minute, 7 * 60 + 10);
    s.set_clock(Clock::default(), 1e9);
    s.advance(1000.0);
    assert_eq!(s.frame().clock.minute, 60, "at most one hour a second");
}
