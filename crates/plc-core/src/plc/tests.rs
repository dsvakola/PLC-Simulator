use super::*;

fn no(a: &str) -> Cell {
    Cell::No { a: a.into() }
}
fn nc(a: &str) -> Cell {
    Cell::Nc { a: a.into() }
}
fn coil(a: &str) -> Cell {
    Cell::Coil { a: a.into() }
}

/// A row: the given cells, wires up to the last column, and an optional coil there.
fn row(cells: Vec<Cell>, end: Option<Cell>) -> Vec<Cell> {
    let mut r = cells;
    while r.len() < COLUMNS - 1 {
        r.push(Cell::Wire);
    }
    r.push(end.unwrap_or(Cell::Empty));
    r
}

fn plc(nets: Vec<Network>) -> Plc {
    Plc::new(&Ladder {
        networks: nets,
        scan_ms: 10,
        symbols: Default::default(),
    })
    .unwrap()
}

#[test]
fn start_stop_with_seal_in() {
    // Start I0.0 (NO), Stop I0.1 (NC button wired, so 1 = not pressed), motor Q0.0.
    let net = Network {
        comment: "Motor start/stop".into(),
        rows: vec![
            row(vec![no("I0.0"), no("I0.1")], Some(coil("Q0.0"))),
            vec![no("Q0.0")],
        ],
        links: vec![(0, 0)],
    };
    let mut p = plc(vec![net]);
    p.inputs[1] = true; // stop button not pressed (NC contact closed)
    p.run(20.0);
    assert!(!p.output(0));
    p.inputs[0] = true;
    p.run(20.0);
    assert!(p.output(0), "start");
    p.inputs[0] = false;
    p.run(50.0);
    assert!(p.output(0), "held by its own contact");
    p.inputs[1] = false;
    p.run(20.0);
    assert!(!p.output(0), "stop");
    p.inputs[1] = true;
    p.run(20.0);
    assert!(!p.output(0), "stays off");
    // Power flow: the row with the start contact is unpowered after stop.
    assert!(!p.flow.powered[0][0][7]);
}

#[test]
fn on_delay_timer_and_counter() {
    let nets = vec![
        Network {
            rows: vec![row(
                vec![
                    no("I0.0"),
                    Cell::Ton {
                        t: "T1".into(),
                        pt: "T#2S".into(),
                    },
                ],
                Some(coil("Q0.1")),
            )],
            ..Default::default()
        },
        Network {
            rows: vec![row(
                vec![
                    no("I0.2"),
                    Cell::Ctu {
                        c: "C0".into(),
                        pv: "3".into(),
                        r: "I0.3".into(),
                    },
                ],
                Some(coil("Q0.2")),
            )],
            ..Default::default()
        },
    ];
    let mut p = plc(nets);
    p.inputs[0] = true;
    p.run(1990.0);
    assert!(!p.output(1));
    p.run(20.0);
    assert!(p.output(1), "after 2 s");
    p.inputs[0] = false;
    p.run(10.0);
    assert!(!p.output(1));
    assert_eq!(p.timer_ms(1), 0);
    for _ in 0..3 {
        p.inputs[2] = true;
        p.run(30.0);
        p.inputs[2] = false;
        p.run(30.0);
    }
    assert_eq!(p.counter(0), 3);
    assert!(p.output(2));
    p.inputs[3] = true;
    p.run(10.0);
    assert_eq!(p.counter(0), 0);
    assert!(!p.output(2));
}

#[test]
fn off_delay_pulse_set_reset() {
    let nets = vec![
        Network {
            rows: vec![row(
                vec![
                    no("I0.0"),
                    Cell::Tof {
                        t: "T2".into(),
                        pt: "500".into(),
                    },
                ],
                Some(coil("Q0.0")),
            )],
            ..Default::default()
        },
        Network {
            rows: vec![row(
                vec![
                    no("I0.1"),
                    Cell::Tp {
                        t: "T3".into(),
                        pt: "T#300MS".into(),
                    },
                ],
                Some(coil("Q0.1")),
            )],
            ..Default::default()
        },
        Network {
            rows: vec![
                row(
                    vec![Cell::Pos { a: "I0.2".into() }],
                    Some(Cell::Set { a: "M0.0".into() }),
                ),
                row(vec![no("I0.3")], Some(Cell::Reset { a: "M0.0".into() })),
                row(vec![no("M0.0")], Some(coil("Q0.2"))),
            ],
            ..Default::default()
        },
    ];
    let mut p = plc(nets);
    p.inputs[0] = true;
    p.inputs[1] = true;
    p.run(50.0);
    assert!(p.output(0) && p.output(1));
    p.inputs[0] = false;
    p.run(400.0);
    assert!(p.output(0), "off delay still on");
    assert!(
        !p.output(1),
        "pulse ended after 300 ms even though I0.1 is still on"
    );
    p.run(200.0);
    assert!(!p.output(0));
    p.inputs[2] = true;
    p.run(20.0);
    assert!(p.output(2));
    p.inputs[2] = false;
    p.run(20.0);
    assert!(p.output(2), "set stays");
    p.inputs[3] = true;
    p.run(20.0);
    assert!(!p.output(2));
}

#[test]
fn compare_move_and_math() {
    let nets = vec![
        Network {
            rows: vec![row(
                vec![
                    Cell::Pos { a: "I0.0".into() },
                    Cell::Math {
                        op: "ADD".into(),
                        a: "MW0".into(),
                        b: "5".into(),
                        dst: "MW0".into(),
                    },
                ],
                None,
            )],
            ..Default::default()
        },
        Network {
            rows: vec![row(
                vec![Cell::Cmp {
                    op: ">=".into(),
                    a: "MW0".into(),
                    b: "15".into(),
                }],
                Some(coil("Q0.0")),
            )],
            ..Default::default()
        },
        Network {
            rows: vec![row(
                vec![
                    no("I0.1"),
                    Cell::Move {
                        a: "0".into(),
                        dst: "MW0".into(),
                    },
                ],
                None,
            )],
            ..Default::default()
        },
    ];
    let mut p = plc(nets);
    for _ in 0..3 {
        p.inputs[0] = true;
        p.run(20.0);
        p.inputs[0] = false;
        p.run(20.0);
    }
    assert_eq!(p.marker_word(0), 15);
    assert!(p.output(0));
    p.inputs[1] = true;
    p.run(20.0);
    assert_eq!(p.marker_word(0), 0);
    assert!(!p.output(0));
}

#[test]
fn mistakes_are_reported_with_their_place() {
    let l = Ladder {
        networks: vec![
            Network {
                rows: vec![row(vec![no("I0.0")], Some(coil("Q0.0")))],
                ..Default::default()
            },
            Network {
                rows: vec![
                    row(vec![no("X1.0")], Some(coil("Q0.0"))),
                    row(vec![no("I0.9")], Some(coil("I0.1"))),
                ],
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    let errs = Plc::new(&l).err().unwrap();
    let places: Vec<_> = errs.iter().map(|e| (e.network, e.row, e.col)).collect();
    assert_eq!(
        places,
        vec![(1, 0, 0), (1, 0, 7), (1, 1, 0), (1, 1, 7)],
        "{errs:?}"
    );
    assert!(errs[1].message.contains("network 1"));
}

#[test]
fn addresses_and_times() {
    assert_eq!(parse_bit("i0.3"), Ok(Bit::I(0, 3)));
    assert_eq!(parse_bit("M63.7"), Ok(Bit::M(63, 7)));
    assert!(parse_bit("M64.0").is_err());
    assert_eq!(parse_bit("T5"), Ok(Bit::T(5)));
    assert_eq!(parse_time("T#1M30S"), Ok(90_000));
    assert_eq!(parse_time("t#250ms"), Ok(250));
    assert_eq!(parse_time("S5T#2S"), Ok(2000));
    assert!(parse_time("T#5").is_err());
    assert_eq!(parse_word("MW10"), Ok(Word::Mw(10)));
    assert_eq!(parse_word("-7"), Ok(Word::Const(-7)));
    assert_eq!(compile_cell(&nc("Q1.7")), Ok(Op::Nc(Bit::Q(1, 7))));
}

#[test]
fn ladder_saves_as_json() {
    let l = Ladder {
        networks: vec![Network {
            rows: vec![row(vec![no("I0.0")], Some(coil("Q0.0")))],
            links: vec![(0, 0)],
            comment: "x".into(),
        }],
        scan_ms: 10,
        symbols: [("I0.0".to_string(), "Start".to_string())].into(),
    };
    let s = serde_json::to_string(&l).unwrap();
    assert!(s.contains("\"k\":\"no\""), "{s}");
    let back: Ladder = serde_json::from_str(&s).unwrap();
    assert_eq!(back, l);
}
