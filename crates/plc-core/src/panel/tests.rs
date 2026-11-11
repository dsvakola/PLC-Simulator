use super::circuit::{Circuit, DevInput};
use super::*;

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
        x: 100.0,
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

fn mistakes(e: &[PanelError]) -> Vec<&str> {
    e.iter()
        .filter(|x| !x.warning)
        .map(|x| x.message.as_str())
        .collect()
}

fn warnings(e: &[PanelError]) -> Vec<&str> {
    e.iter()
        .filter(|x| x.warning)
        .map(|x| x.message.as_str())
        .collect()
}

#[test]
fn the_board_matches_the_academy_drawing() {
    let l = layout();
    let ids: Vec<&str> = l.fixed.iter().map(|f| f.id.as_str()).collect();
    for id in [
        "lampQ1", "lampQ2", "lampQ3", "lampQ4", "swI1", "swI2", "swI3", "swI4", "qcon", "plc",
        "icon",
    ] {
        assert!(ids.contains(&id), "missing {id}");
    }
    // The lamps, switches and the PLC have no terminals: they are wired inside.
    for f in &l.fixed {
        if f.id != "qcon" && f.id != "icon" {
            assert!(f.terminals.is_empty(), "{} must not have terminals", f.id);
        }
    }
    let lamps: Vec<&str> = l
        .fixed
        .iter()
        .filter(|f| f.kind == "boardLamp")
        .map(|f| f.color.as_str())
        .collect();
    assert_eq!(lamps, ["red", "green", "blue", "yellow"]);
    // Q connector: +, − and earth for Q1 to Q4. I connector: +24 V, 0 V and signal for I5 to I8.
    let q = l.fixed.iter().find(|f| f.id == "qcon").expect("qcon");
    assert_eq!(q.terminals.len(), 12);
    for n in ["Q1p", "Q1n", "Q1g", "Q4p", "Q4n", "Q4g"] {
        assert!(q.terminals.iter().any(|t| t.name == n), "no {n}");
    }
    let i = l.fixed.iter().find(|f| f.id == "icon").expect("icon");
    assert_eq!(i.terminals.len(), 12);
    for n in ["I5p", "I5n", "I5s", "I8p", "I8n", "I8s"] {
        assert!(i.terminals.iter().any(|t| t.name == n), "no {n}");
    }
    assert!(
        !i.terminals.iter().any(|t| t.name.ends_with('g')),
        "sensors have no earth"
    );
    // I8 is at the top of the input connector, I5 at the bottom.
    let y = |n: &str| {
        i.terminals
            .iter()
            .find(|t| t.name == n)
            .map(|t| t.y)
            .unwrap_or(0.0)
    };
    assert!(y("I8p") < y("I7p") && y("I7p") < y("I6p") && y("I6p") < y("I5p"));
}

#[test]
fn every_terminal_is_unique_and_inside_its_device() {
    let l = layout();
    let mut seen = BTreeSet::new();
    for f in &l.fixed {
        assert!(
            f.x >= 0.0 && f.y >= 0.0 && f.x + f.w <= l.width && f.y + f.h <= l.height,
            "{} is off the board",
            f.id
        );
        for t in &f.terminals {
            assert!(seen.insert(t.id.clone()), "terminal {} appears twice", t.id);
            assert!(
                t.x >= 0.0 && t.x <= f.w && t.y >= 0.0 && t.y <= f.h,
                "{} is outside {}",
                t.id,
                f.id
            );
        }
    }
    for c in &l.catalog {
        assert!(c.terminals.len() >= 2, "{} needs two terminals", c.kind);
        assert!(
            circuit::DevKind::from_kind(&c.kind).is_some(),
            "{} cannot be simulated",
            c.kind
        );
        for t in &c.terminals {
            assert!(t.x >= 0.0 && t.x <= c.w && t.y >= 0.0 && t.y <= c.h);
        }
    }
    // A bench below the board, nothing to the side (no sideways scrolling),
    // and every device fits on the bench with room for its name.
    assert_eq!(l.work_width, l.width);
    for c in &l.catalog {
        assert!(
            c.h + 40.0 <= l.work_height - l.height,
            "{} does not fit on the bench",
            c.kind
        );
        assert!(
            c.scale >= 1.0 && !c.short.is_empty() && c.short.len() <= 20,
            "{}",
            c.kind
        );
    }
}

#[test]
fn wires_keep_their_bends_and_old_wires_stay_curved() {
    let mut w = wire("qcon.Q1p", "icon.I5s");
    w.points = vec![Point { x: 10.0, y: 20.0 }, Point { x: 10.0, y: 80.0 }];
    let text = serde_json::to_string(&w).expect("serialise");
    assert_eq!(serde_json::from_str::<PanelWire>(&text).expect("read"), w);
    // A wire saved by version 0.0.2 has no bends and was drawn curved.
    let old: PanelWire =
        serde_json::from_str(r#"{"from":"a.b","to":"c.d","color":"red"}"#).expect("old wire");
    assert!(old.curved && old.points.is_empty());
    // Too many bends is a mistake.
    let mut p = panel(vec![device(1, "lamp")], vec![wire("qcon.Q1p", "d1.p")]);
    p.wires[0].points = vec![Point { x: 1.0, y: 1.0 }; MAX_BENDS + 1];
    assert!(mistakes(&check(&p)).iter().any(|m| m.contains("bends")));
}

#[test]
fn fixed_devices_do_not_overlap() {
    let l = layout();
    for (i, a) in l.fixed.iter().enumerate() {
        for b in &l.fixed[i + 1..] {
            let apart =
                a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
            assert!(apart, "{} overlaps {}", a.id, b.id);
        }
    }
}

#[test]
fn the_catalogue_has_the_field_devices() {
    let l = layout();
    for k in [
        "pushNo",
        "pushNc",
        "toggle",
        "limitNo",
        "limitNc",
        "proxPnp",
        "photoPnp",
        "prox2w",
        "pot",
        "pt100",
        "lamp",
        "buzzer",
        "hooter",
        "motor",
        "contactor",
    ] {
        assert!(device_def(&l, k).is_some(), "no {k}");
    }
    let names = |k: &str| -> Vec<String> {
        device_def(&l, k)
            .map(|d| d.terminals.iter().map(|t| t.name.clone()).collect())
            .unwrap_or_default()
    };
    assert_eq!(names("motor"), ["p", "n", "g"]);
    assert_eq!(names("pt100"), ["r1", "r2", "w"]);
    assert_eq!(names("proxPnp"), ["p", "n", "s"]);
}

#[test]
fn a_good_wiring_has_no_mistakes() {
    // A push button on I5, a lamp on Q1, an earthed motor on Q2, a knob on I7.
    let p = panel(
        vec![
            device(1, "pushNo"),
            device(2, "lamp"),
            device(3, "motor"),
            device(4, "pot"),
        ],
        vec![
            wire("icon.I5p", "d1.a"),
            wire("d1.b", "icon.I5s"),
            wire("qcon.Q1p", "d2.p"),
            wire("d2.n", "qcon.Q1n"),
            wire("qcon.Q2p", "d3.p"),
            wire("d3.n", "qcon.Q2n"),
            wire("d3.g", "qcon.Q2g"),
            wire("icon.I7p", "d4.p"),
            wire("icon.I7n", "d4.n"),
            wire("d4.out", "icon.I7s"),
        ],
    );
    assert_eq!(check(&p), vec![]);
}

#[test]
fn wiring_mistakes_are_reported_in_plain_words() {
    let p = panel(
        vec![device(1, "lamp"), device(1, "lamp"), device(2, "spaceship")],
        vec![
            wire("icon.I5p", "nowhere.x"),
            wire("d1.p", "d1.p"),
            wire("d1.p", "qcon.Q1p"),
            wire("qcon.Q1p", "d1.p"),
            wire("d9.p", "d1.n"),
        ],
    );
    let e = check(&p);
    let text = mistakes(&e);
    assert!(text.iter().any(|m| m.contains("same number")));
    assert!(text.iter().any(|m| m.contains("unknown kind")));
    assert!(text.iter().any(|m| m.contains("does not exist")));
    assert!(text.iter().any(|m| m.contains("same terminal")));
    assert!(text.iter().any(|m| m.contains("same two terminals")));
    assert_eq!(
        e.iter()
            .filter(|x| x.message.contains("does not exist"))
            .count(),
        2
    );
    // The wire that is to blame is named.
    let dup = e
        .iter()
        .find(|x| x.message.contains("same two terminals"))
        .expect("dup");
    assert_eq!(dup.wire, Some(3));
}

#[test]
fn short_circuits_are_found() {
    let one = |a: &str, b: &str| check(&panel(vec![], vec![wire(a, b)]));
    assert!(mistakes(&one("icon.I5p", "icon.I6n"))
        .iter()
        .any(|m| m.contains("+24 V to 0 V")));
    assert!(mistakes(&one("icon.I5p", "qcon.Q3g"))
        .iter()
        .any(|m| m.contains("+24 V to earth")));
    assert!(mistakes(&one("qcon.Q2p", "qcon.Q2n"))
        .iter()
        .any(|m| m.contains("Q2 + to 0 V")));
    assert!(mistakes(&one("qcon.Q1p", "icon.I8p"))
        .iter()
        .any(|m| m.contains("never switch")));
    assert!(mistakes(&one("qcon.Q1p", "qcon.Q4p"))
        .iter()
        .any(|m| m.contains("Q1 and Q4")));
    // Through a chain of wires.
    let chain = check(&panel(
        vec![device(1, "lamp")],
        vec![
            wire("icon.I5p", "d1.p"),
            wire("d1.p", "d1.n"),
            wire("d1.n", "qcon.Q1n"),
        ],
    ));
    assert!(mistakes(&chain).iter().any(|m| m.contains("short circuit")));
    // A lamp between the supplies is fine: devices are not wires.
    let ok = check(&panel(
        vec![device(1, "lamp")],
        vec![wire("icon.I5p", "d1.p"), wire("d1.n", "qcon.Q1n")],
    ));
    assert_eq!(ok, vec![]);
    // Earthing 0 V is allowed.
    assert_eq!(one("qcon.Q1n", "qcon.Q1g"), vec![]);
}

#[test]
fn gentle_warnings() {
    // A motor that is not earthed.
    let m = check(&panel(
        vec![device(3, "motor")],
        vec![wire("qcon.Q1p", "d3.p"), wire("d3.n", "qcon.Q1n")],
    ));
    assert!(mistakes(&m).is_empty());
    assert!(warnings(&m).iter().any(|w| w.contains("not earthed")));
    // An analog signal on I5, which reads only on/off.
    let a = check(&panel(
        vec![device(1, "pot")],
        vec![wire("d1.out", "icon.I5s")],
    ));
    assert!(warnings(&a).iter().any(|w| w.contains("Only I7 and I8")));
    let b = check(&panel(
        vec![device(1, "pt100")],
        vec![wire("d1.w", "icon.I8s"), wire("d1.r1", "icon.I8n")],
    ));
    assert!(warnings(&b).is_empty());
    // An input joined straight to 0 V.
    let z = check(&panel(vec![], vec![wire("icon.I6s", "icon.I6n")]));
    assert!(warnings(&z).iter().any(|w| w.contains("I6")));
}

#[test]
fn device_terminals_exist_only_for_placed_devices() {
    let l = layout();
    let p = panel(vec![device(7, "motor")], vec![]);
    let ids = terminal_ids(&p, &l);
    assert!(ids.contains("d7.p") && ids.contains("d7.n") && ids.contains("d7.g"));
    assert!(!ids.contains("d8.p"));
    assert!(ids.contains("qcon.Q3p") && ids.contains("icon.I6s"));
}

#[test]
fn board_switch_settings() {
    let mut p = Panel::default();
    assert_eq!(
        board_switch(&p, 1),
        SwitchSetup {
            nc: false,
            momentary: false,
            hz: None
        }
    );
    let props: BTreeMap<String, String> = [("contact", "nc"), ("action", "maintained")]
        .iter()
        .map(|(a, b)| (a.to_string(), b.to_string()))
        .collect();
    p.fixed_props.insert("swI3".into(), props);
    assert_eq!(
        board_switch(&p, 3),
        SwitchSetup {
            nc: true,
            momentary: false,
            hz: None
        }
    );
    assert_eq!(
        board_switch(&p, 2),
        SwitchSetup {
            nc: false,
            momentary: false,
            hz: None
        }
    );
}

#[test]
fn panel_saves_as_json() {
    let mut p = panel(vec![device(1, "lamp")], vec![wire("qcon.Q1p", "d1.p")]);
    p.devices[0].label = "Pump lamp".into();
    p.devices[0].props.insert("color".into(), "green".into());
    p.fixed_props
        .entry("swI1".into())
        .or_default()
        .insert("contact".into(), "nc".into());
    let text = serde_json::to_string(&p).expect("serialise");
    assert!(text.contains("\"fixedProps\""));
    let back: Panel = serde_json::from_str(&text).expect("read back");
    assert_eq!(back, p);
    let empty: Panel = serde_json::from_str("{}").expect("empty");
    assert_eq!(empty, Panel::default());
}

#[test]
fn a_panel_from_version_0_0_1_is_brought_up_to_date() {
    let mut old = Panel {
        devices: vec![device(1, "lamp"), device(2, "spaceship")],
        wires: vec![
            wire("v24.p1", "btn1.a"),
            wire("plc.Q1b", "d1.p"),
            wire("d1.n", "v0.n1"),
        ],
        fixed_props: BTreeMap::new(),
    };
    old.devices[0].y = 600.0;
    old.fixed_props
        .entry("btn2".into())
        .or_default()
        .insert("nc".into(), "true".into());
    upgrade_from_v1(&mut old);
    assert_eq!(old.devices.len(), 1, "unknown devices go");
    assert!(
        old.devices[0].y > BOARD_H,
        "the student's devices move to the bench"
    );
    assert!(old.wires.is_empty(), "wires to the old board are dropped");
    assert!(board_switch(&old, 2).nc);
    assert_eq!(check(&old), vec![]);
}

// ---------- The electrics ----------

fn act(on: bool) -> DevInput {
    DevInput {
        act: on,
        value: 0.0,
    }
}

#[test]
fn a_switch_on_i5_and_a_lamp_on_q1() {
    let p = panel(
        vec![device(1, "pushNo"), device(2, "lamp")],
        vec![
            wire("icon.I5p", "d1.a"),
            wire("d1.b", "icon.I5s"),
            wire("qcon.Q1p", "d2.p"),
            wire("d2.n", "qcon.Q1n"),
        ],
    );
    let c = Circuit::new(&p);
    let off = c.solve([false; 4], true, &[act(false), act(false)]);
    assert!(!off.inputs[0] && !off.on[1] && !off.short);
    let pressed = c.solve([false; 4], true, &[act(true), act(false)]);
    assert!(pressed.inputs[0], "pressing the button switches I5 on");
    let q1 = c.solve([true, false, false, false], true, &[act(false), act(false)]);
    assert!(q1.on[1], "Q1 on lights the lamp");
    let dead = c.solve([true, false, false, false], false, &[act(true), act(false)]);
    assert!(
        !dead.on[1] && !dead.inputs[0],
        "nothing works without supply"
    );
}

#[test]
fn a_lamp_must_have_both_ends_wired() {
    let p = panel(vec![device(2, "lamp")], vec![wire("qcon.Q1p", "d2.p")]);
    let s = Circuit::new(&p).solve([true; 4], true, &[act(false)]);
    assert!(!s.on[0], "no return to 0 V: the lamp stays dark");
    // The earth terminal carries no current.
    let p = panel(
        vec![device(2, "lamp")],
        vec![wire("qcon.Q1p", "d2.p"), wire("d2.n", "qcon.Q1g")],
    );
    assert!(!Circuit::new(&p).solve([true; 4], true, &[act(false)]).on[0]);
}

#[test]
fn nc_push_button_and_motor_direction() {
    let p = panel(
        vec![device(1, "pushNc"), device(2, "motor")],
        vec![
            wire("icon.I6p", "d1.a"),
            wire("d1.b", "icon.I6s"),
            // The motor is wired the wrong way round: it turns backwards.
            wire("qcon.Q2p", "d2.n"),
            wire("d2.p", "qcon.Q2n"),
        ],
    );
    let c = Circuit::new(&p);
    let s = c.solve([false, true, false, false], true, &[act(false), act(false)]);
    assert!(s.inputs[1], "NC button not pressed: I6 is on");
    assert_eq!(s.dir[1], -1);
    let s = c.solve([false, true, false, false], true, &[act(true), act(false)]);
    assert!(!s.inputs[1], "pressed: I6 goes off");
}

#[test]
fn three_wire_sensor_needs_its_supply() {
    let wired = vec![
        wire("icon.I5p", "d1.p"),
        wire("icon.I5n", "d1.n"),
        wire("d1.s", "icon.I5s"),
    ];
    let p = panel(vec![device(1, "proxPnp")], wired.clone());
    let c = Circuit::new(&p);
    assert!(!c.solve([false; 4], true, &[act(false)]).inputs[0]);
    assert!(
        c.solve([false; 4], true, &[act(true)]).inputs[0],
        "target present: I5 on"
    );
    // Without 0 V on the blue wire the sensor is dead.
    let p = panel(
        vec![device(1, "proxPnp")],
        vec![wired[0].clone(), wired[2].clone()],
    );
    assert!(
        !Circuit::new(&p)
            .solve([false; 4], true, &[act(true)])
            .inputs[0]
    );
}

#[test]
fn contactor_switches_a_motor() {
    // Q1 drives the contactor coil; its NO contact feeds +24 V to the motor.
    let p = panel(
        vec![device(1, "contactor"), device(2, "motor")],
        vec![
            wire("qcon.Q1p", "d1.A1"),
            wire("d1.A2", "qcon.Q1n"),
            wire("icon.I5p", "d1.c13"),
            wire("d1.c14", "d2.p"),
            wire("d2.n", "icon.I5n"),
        ],
    );
    let c = Circuit::new(&p);
    let s = c.solve([false; 4], true, &[act(false), act(false)]);
    assert!(!s.on[0] && s.dir[1] == 0);
    let s = c.solve([true, false, false, false], true, &[act(false), act(false)]);
    assert!(s.on[0], "the coil pulls in");
    assert_eq!(s.dir[1], 1, "the motor runs through the contact");
}

#[test]
fn analog_inputs_read_the_potentiometer_and_the_pt100() {
    let p = panel(
        vec![device(1, "pot"), device(2, "pt100")],
        vec![
            wire("icon.I7p", "d1.p"),
            wire("icon.I7n", "d1.n"),
            wire("d1.out", "icon.I7s"),
            wire("d2.w", "icon.I8s"),
            wire("d2.r1", "icon.I8n"),
            wire("d2.r2", "icon.I8n"),
        ],
    );
    let c = Circuit::new(&p);
    let ins = [
        DevInput {
            act: false,
            value: 42.0,
        },
        DevInput {
            act: false,
            value: 31.5,
        },
    ];
    let s = c.solve([false; 4], true, &ins);
    assert_eq!(s.analog, [420, 315], "4.2 V and 31.5 °C");
    assert!(
        !s.inputs[2],
        "4.2 V is below the on level of a digital input"
    );
    let ins = [
        DevInput {
            act: false,
            value: 90.0,
        },
        ins[1],
    ];
    assert!(
        c.solve([false; 4], true, &ins).inputs[2],
        "9 V counts as on"
    );
    // A potentiometer without supply gives nothing.
    let p = panel(vec![device(1, "pot")], vec![wire("d1.out", "icon.I7s")]);
    assert_eq!(
        Circuit::new(&p)
            .solve(
                [false; 4],
                true,
                &[DevInput {
                    act: false,
                    value: 80.0
                }]
            )
            .analog,
        [0, 0]
    );
}

#[test]
fn shorts_are_found_while_running() {
    // Q1 + straight to 0 V through a closed switch: short as soon as Q1 is on.
    let p = panel(
        vec![device(1, "toggle")],
        vec![wire("qcon.Q1p", "d1.a"), wire("d1.b", "qcon.Q1n")],
    );
    let c = Circuit::new(&p);
    assert!(
        !c.solve([true, false, false, false], true, &[act(false)])
            .short
    );
    assert!(!c.solve([false; 4], true, &[act(true)]).short);
    assert!(
        c.solve([true, false, false, false], true, &[act(true)])
            .short
    );
}

/// Writes the layout as JSON when PANEL_DUMP names a file (used to look at the
/// panel in a browser without the program).
#[test]
fn dump_layout_for_browser_preview() {
    if let Ok(path) = std::env::var("PANEL_DUMP") {
        let text = serde_json::to_string(&layout()).expect("serialise");
        std::fs::write(path, text).expect("write the layout");
    }
}
