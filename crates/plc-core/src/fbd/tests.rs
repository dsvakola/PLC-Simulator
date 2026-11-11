use super::*;

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

fn wire(from_block: u32, from_pin: u8, to_block: u32, to_pin: u8) -> Wire {
    Wire {
        from_block,
        from_pin,
        to_block,
        to_pin,
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

fn fbd(blocks: Vec<Block>, wires: Vec<Wire>) -> Fbd {
    Fbd::new(&diagram(blocks, wires), Limits::default()).expect("the diagram is valid")
}

fn scans(f: &mut Fbd, n: usize) {
    for _ in 0..n {
        f.scan(10.0);
    }
}

fn errors_of(blocks: Vec<Block>, wires: Vec<Wire>) -> Vec<DiagramError> {
    match Fbd::new(&diagram(blocks, wires), Limits::default()) {
        Ok(_) => panic!("the diagram should have been refused"),
        Err(e) => e,
    }
}

/// I1 and I2 into a two-input block, its result on Q1.
fn gate(kind: BlockKind) -> Fbd {
    fbd(
        vec![
            blk(1, BlockKind::Input { n: 1 }),
            blk(2, BlockKind::Input { n: 2 }),
            blk(3, kind),
            blk(4, BlockKind::Output { n: 1 }),
        ],
        vec![wire(1, 0, 3, 0), wire(2, 0, 3, 1), wire(3, 0, 4, 0)],
    )
}

fn truth(kind: BlockKind, expected: [bool; 4]) {
    let mut f = gate(kind.clone());
    for (row, want) in expected.iter().enumerate() {
        f.set_input(1, row & 2 != 0);
        f.set_input(2, row & 1 != 0);
        f.scan(10.0);
        assert_eq!(f.output(1), *want, "{kind:?} with inputs row {row}");
    }
}

#[test]
fn logic_blocks_follow_their_truth_tables() {
    // Rows: I1 I2 = 00, 01, 10, 11.
    truth(BlockKind::And { inputs: 2 }, [false, false, false, true]);
    truth(BlockKind::Or { inputs: 2 }, [false, true, true, true]);
    truth(BlockKind::Nand { inputs: 2 }, [true, true, true, false]);
    truth(BlockKind::Nor { inputs: 2 }, [true, false, false, false]);
    truth(BlockKind::Xor, [false, true, true, false]);
    truth(BlockKind::Xnor, [true, false, false, true]);
}

#[test]
fn not_inverts_and_unused_inputs_behave() {
    let mut f = fbd(
        vec![
            blk(1, BlockKind::Input { n: 1 }),
            blk(2, BlockKind::Not),
            blk(3, BlockKind::Output { n: 1 }),
        ],
        vec![wire(1, 0, 2, 0), wire(2, 0, 3, 0)],
    );
    f.scan(10.0);
    assert!(f.output(1));
    f.set_input(1, true);
    f.scan(10.0);
    assert!(!f.output(1));

    // An unused AND input counts as on, an unused OR input as off.
    let mut and = fbd(
        vec![
            blk(1, BlockKind::Input { n: 1 }),
            blk(2, BlockKind::And { inputs: 3 }),
            blk(3, BlockKind::Output { n: 1 }),
        ],
        vec![wire(1, 0, 2, 0), wire(2, 0, 3, 0)],
    );
    and.set_input(1, true);
    and.scan(10.0);
    assert!(and.output(1));
    let mut or = fbd(
        vec![
            blk(1, BlockKind::Input { n: 1 }),
            blk(2, BlockKind::Or { inputs: 3 }),
            blk(3, BlockKind::Output { n: 1 }),
        ],
        vec![wire(1, 0, 2, 0), wire(2, 0, 3, 0)],
    );
    or.scan(10.0);
    assert!(!or.output(1));
    or.set_input(1, true);
    or.scan(10.0);
    assert!(or.output(1));
}

#[test]
fn a_scada_marker_works_like_a_second_push_button() {
    // Q1 = I1 OR M1, the exercise from the workbook.
    let mut f = fbd(
        vec![
            blk(1, BlockKind::Input { n: 1 }),
            blk(2, BlockKind::Flag { n: 1 }),
            blk(3, BlockKind::Or { inputs: 2 }),
            blk(4, BlockKind::Output { n: 1 }),
        ],
        vec![wire(1, 0, 3, 0), wire(2, 0, 3, 1), wire(3, 0, 4, 0)],
    );
    f.scan(10.0);
    assert!(!f.output(1));
    f.set_marker(1, true);
    f.scan(10.0);
    assert!(f.output(1));
    f.set_marker(1, false);
    f.set_input(1, true);
    f.scan(10.0);
    assert!(f.output(1));
    f.set_input(1, false);
    f.scan(10.0);
    assert!(!f.output(1));
}

#[test]
fn a_wired_marker_is_written_by_the_program() {
    // I1 sets M1 inside the program; M1 drives Q1.
    let mut f = fbd(
        vec![
            blk(1, BlockKind::Input { n: 1 }),
            blk(2, BlockKind::Flag { n: 3 }),
            blk(3, BlockKind::Output { n: 1 }),
        ],
        vec![wire(1, 0, 2, 0), wire(2, 0, 3, 0)],
    );
    f.set_input(1, true);
    f.scan(10.0);
    assert!(f.marker(3) && f.output(1));
    // The program keeps control, so a SCADA write is overruled at the next scan.
    f.set_marker(3, false);
    f.scan(10.0);
    assert!(f.marker(3));
}

fn timer_diagram(kind: BlockKind) -> Fbd {
    fbd(
        vec![
            blk(1, BlockKind::Input { n: 1 }),
            blk(2, BlockKind::Input { n: 2 }),
            blk(3, kind.clone()),
            blk(4, BlockKind::Output { n: 1 }),
        ],
        // I2 goes to the reset pin of an off-delay only.
        if matches!(kind, BlockKind::OffDelay { .. }) {
            vec![wire(1, 0, 3, 0), wire(2, 0, 3, 1), wire(3, 0, 4, 0)]
        } else {
            vec![wire(1, 0, 3, 0), wire(3, 0, 4, 0)]
        },
    )
}

#[test]
fn on_delay_switches_on_after_its_time() {
    let mut f = timer_diagram(BlockKind::OnDelay { ms: 100 });
    f.set_input(1, true);
    scans(&mut f, 9);
    assert!(!f.output(1), "90 ms is not enough");
    scans(&mut f, 1);
    assert!(f.output(1), "100 ms is");
    f.set_input(1, false);
    f.scan(10.0);
    assert!(!f.output(1), "the output follows the input off at once");
    // A short pulse never gets through.
    f.set_input(1, true);
    scans(&mut f, 5);
    f.set_input(1, false);
    scans(&mut f, 1);
    f.set_input(1, true);
    scans(&mut f, 9);
    assert!(!f.output(1), "the time started again");
}

#[test]
fn off_delay_stays_on_after_the_input_goes_off() {
    let mut f = timer_diagram(BlockKind::OffDelay { ms: 50 });
    f.set_input(1, true);
    f.scan(10.0);
    assert!(f.output(1), "on at once");
    f.set_input(1, false);
    scans(&mut f, 4);
    assert!(f.output(1), "40 ms after the input went off");
    scans(&mut f, 1);
    assert!(!f.output(1), "50 ms");

    // Pressing the input again during the delay starts the time again.
    f.set_input(1, true);
    f.scan(10.0);
    f.set_input(1, false);
    scans(&mut f, 3);
    f.set_input(1, true);
    scans(&mut f, 1);
    f.set_input(1, false);
    scans(&mut f, 4);
    assert!(f.output(1));

    // The reset input switches it off at once.
    f.set_input(2, true);
    f.scan(10.0);
    assert!(!f.output(1));
}

#[test]
fn on_off_delay_delays_both_edges() {
    let mut f = timer_diagram(BlockKind::OnOffDelay {
        on_ms: 30,
        off_ms: 20,
    });
    f.set_input(1, true);
    scans(&mut f, 2);
    assert!(!f.output(1));
    scans(&mut f, 1);
    assert!(f.output(1), "on after 30 ms");
    f.set_input(1, false);
    scans(&mut f, 1);
    assert!(f.output(1), "10 ms after the input went off");
    scans(&mut f, 1);
    assert!(!f.output(1), "off after 20 ms");

    // An input that is on for less than the on-delay does nothing.
    f.set_input(1, true);
    scans(&mut f, 2);
    f.set_input(1, false);
    scans(&mut f, 5);
    assert!(!f.output(1));
}

fn timer_output(kind: BlockKind) -> Fbd {
    fbd(
        vec![blk(1, kind), blk(2, BlockKind::Output { n: 1 })],
        vec![wire(1, 0, 2, 0)],
    )
}

#[test]
fn clock_knows_the_weekday() {
    // 1 January 2024 was a Monday, 8 November 2026 is a Sunday.
    assert_eq!(Clock::from_ymd_hm(2024, 1, 1, 0, 0).weekday, 0);
    assert_eq!(Clock::from_ymd_hm(2026, 11, 8, 0, 0).weekday, 6);
    assert_eq!(Clock::from_ymd_hm(2026, 11, 9, 13, 30).weekday, 0);
    assert_eq!(Clock::from_ymd_hm(2026, 11, 9, 13, 30).minute, 13 * 60 + 30);
    // A leap day.
    assert_eq!(Clock::from_ymd_hm(2024, 2, 29, 0, 0).weekday, 3);
}

#[test]
fn weekly_timer_follows_days_and_times() {
    // Monday to Friday, 08:00 to 17:00.
    let mut f = timer_output(BlockKind::WeeklyTimer {
        cams: vec![WeeklyCam {
            days: 0b0011111,
            on_minute: 8 * 60,
            off_minute: 17 * 60,
        }],
    });
    let at = |f: &mut Fbd, y, m, d, h, mi| {
        f.set_clock(Clock::from_ymd_hm(y, m, d, h, mi));
        f.scan(10.0);
        f.output(1)
    };
    assert!(at(&mut f, 2026, 11, 9, 12, 0), "Monday noon");
    assert!(!at(&mut f, 2026, 11, 9, 7, 59), "Monday before 08:00");
    assert!(at(&mut f, 2026, 11, 9, 8, 0), "Monday 08:00");
    assert!(!at(&mut f, 2026, 11, 9, 17, 0), "Monday 17:00 is off again");
    assert!(!at(&mut f, 2026, 11, 8, 12, 0), "Sunday noon");
    assert!(at(&mut f, 2026, 11, 13, 9, 0), "Friday morning");
    assert!(!at(&mut f, 2026, 11, 14, 9, 0), "Saturday morning");
}

#[test]
fn weekly_timer_can_run_past_midnight() {
    // Friday 22:00 to 06:00, which ends on Saturday morning.
    let mut f = timer_output(BlockKind::WeeklyTimer {
        cams: vec![WeeklyCam {
            days: 0b0010000,
            on_minute: 22 * 60,
            off_minute: 6 * 60,
        }],
    });
    let at = |f: &mut Fbd, d, h| {
        f.set_clock(Clock::from_ymd_hm(2026, 11, d, h, 0));
        f.scan(10.0);
        f.output(1)
    };
    assert!(at(&mut f, 13, 23), "Friday 23:00");
    assert!(at(&mut f, 14, 5), "Saturday 05:00");
    assert!(!at(&mut f, 14, 6), "Saturday 06:00");
    assert!(!at(&mut f, 14, 23), "Saturday 23:00");
    assert!(!at(&mut f, 13, 5), "Friday 05:00");
}

#[test]
fn yearly_timer_follows_dates_and_new_year() {
    let mut summer = timer_output(BlockKind::YearlyTimer {
        cams: vec![YearlyCam {
            on_month: 6,
            on_day: 1,
            off_month: 9,
            off_day: 1,
        }],
    });
    let on = |f: &mut Fbd, m, d| {
        f.set_clock(Clock::from_ymd_hm(2026, m, d, 12, 0));
        f.scan(10.0);
        f.output(1)
    };
    assert!(on(&mut summer, 6, 1));
    assert!(on(&mut summer, 8, 31));
    assert!(!on(&mut summer, 9, 1));
    assert!(!on(&mut summer, 5, 31));

    // From 20 December to 10 January.
    let mut festival = timer_output(BlockKind::YearlyTimer {
        cams: vec![YearlyCam {
            on_month: 12,
            on_day: 20,
            off_month: 1,
            off_day: 10,
        }],
    });
    assert!(on(&mut festival, 12, 25));
    assert!(on(&mut festival, 1, 5));
    assert!(!on(&mut festival, 1, 10));
    assert!(!on(&mut festival, 12, 19));
    assert!(!on(&mut festival, 6, 1));
}

#[test]
fn analog_amplifier_scales_the_value() {
    let mut f = fbd(
        vec![
            blk(1, BlockKind::AnalogInput { n: 1 }),
            blk(
                2,
                BlockKind::AnalogAmplifier {
                    gain: 2.0,
                    offset: 10,
                },
            ),
            blk(3, BlockKind::AnalogFlag { n: 2 }),
        ],
        vec![wire(1, 0, 2, 0), wire(2, 0, 3, 0)],
    );
    f.set_analog_input(1, 100);
    f.scan(10.0);
    assert_eq!(f.analog_flag(2), 210);
    // The result stays inside the analog range.
    f.set_analog_input(1, 30000);
    f.scan(10.0);
    assert_eq!(f.analog_flag(2), 32767);
}

#[test]
fn pt100_furnace_chain_has_hysteresis() {
    // PT100 on I8 (AI2) in tenths of a degree -> amplifier -> AM3 (shown on the
    // SCADA screen) and threshold trigger 30.1 on / 29.9 off -> NOT -> Q3.
    let mut f = fbd(
        vec![
            blk(1, BlockKind::AnalogInput { n: 2 }),
            blk(
                2,
                BlockKind::AnalogAmplifier {
                    gain: 1.0,
                    offset: 0,
                },
            ),
            blk(3, BlockKind::AnalogFlag { n: 3 }),
            blk(4, BlockKind::AnalogThreshold { on: 301, off: 299 }),
            blk(5, BlockKind::Not),
            blk(6, BlockKind::Output { n: 3 }),
        ],
        vec![
            wire(1, 0, 2, 0),
            wire(2, 0, 3, 0),
            wire(2, 0, 4, 0),
            wire(4, 0, 5, 0),
            wire(5, 0, 6, 0),
        ],
    );
    f.set_analog_input(2, 250);
    f.scan(10.0);
    assert!(f.output(3), "25.0 C: the heater is on");
    assert_eq!(f.analog_flag(3), 250);
    f.set_analog_input(2, 305);
    f.scan(10.0);
    assert!(!f.output(3), "30.5 C: the heater goes off");
    assert_eq!(f.analog_flag(3), 305);
    f.set_analog_input(2, 300);
    f.scan(10.0);
    assert!(!f.output(3), "30.0 C is between the thresholds: unchanged");
    f.set_analog_input(2, 298);
    f.scan(10.0);
    assert!(f.output(3), "29.8 C: the heater is on again");
}

#[test]
fn slider_and_comparator_control_q2() {
    // AM2 (the SCADA slider) against nothing, on at 7 and off at 3.
    let mut f = fbd(
        vec![
            blk(1, BlockKind::AnalogFlag { n: 2 }),
            blk(
                2,
                BlockKind::AnalogComparator {
                    gain: 1.0,
                    offset: 0,
                    on: 7,
                    off: 3,
                },
            ),
            blk(3, BlockKind::Output { n: 2 }),
        ],
        vec![wire(1, 0, 2, 0), wire(2, 0, 3, 0)],
    );
    for (value, want) in [(8, true), (5, true), (2, false), (5, false), (7, true)] {
        f.set_analog_flag(2, value);
        f.scan(10.0);
        assert_eq!(f.output(2), want, "slider at {value}");
    }
}

#[test]
fn comparator_compares_two_values() {
    // AI1 against AI2: on when AI1 is at least 10 above AI2.
    let mut f = fbd(
        vec![
            blk(1, BlockKind::AnalogInput { n: 1 }),
            blk(2, BlockKind::AnalogInput { n: 2 }),
            blk(
                3,
                BlockKind::AnalogComparator {
                    gain: 1.0,
                    offset: 0,
                    on: 10,
                    off: 5,
                },
            ),
            blk(4, BlockKind::Output { n: 1 }),
        ],
        vec![wire(1, 0, 3, 0), wire(2, 0, 3, 1), wire(3, 0, 4, 0)],
    );
    f.set_analog_input(2, 100);
    f.set_analog_input(1, 109);
    f.scan(10.0);
    assert!(!f.output(1));
    f.set_analog_input(1, 110);
    f.scan(10.0);
    assert!(f.output(1));
}

#[test]
fn a_nor_latch_with_feedback_holds_its_state() {
    // Q = NOR(R, Qbar), Qbar = NOR(S, Q). Feedback uses the previous scan.
    let mut f = fbd(
        vec![
            blk(1, BlockKind::Input { n: 1 }), // set
            blk(2, BlockKind::Input { n: 2 }), // reset
            blk(3, BlockKind::Nor { inputs: 2 }),
            blk(4, BlockKind::Nor { inputs: 2 }),
            blk(5, BlockKind::Output { n: 1 }),
        ],
        vec![
            wire(2, 0, 3, 0),
            wire(4, 0, 3, 1),
            wire(1, 0, 4, 0),
            wire(3, 0, 4, 1),
            wire(3, 0, 5, 0),
        ],
    );
    f.set_input(2, true);
    scans(&mut f, 3);
    assert!(!f.output(1), "reset");
    f.set_input(2, false);
    scans(&mut f, 3);
    assert!(!f.output(1), "stays reset");
    f.set_input(1, true);
    scans(&mut f, 3);
    assert!(f.output(1), "set");
    f.set_input(1, false);
    scans(&mut f, 3);
    assert!(f.output(1), "stays set");
    f.set_input(2, true);
    scans(&mut f, 3);
    assert!(!f.output(1), "reset again");
}

#[test]
fn run_works_in_whole_scans_and_stop_switches_outputs_off() {
    let mut f = timer_diagram(BlockKind::OnDelay { ms: 100 });
    f.set_input(1, true);
    f.run(95.0);
    assert!(!f.output(1));
    f.run(5.0);
    assert!(f.output(1));
    f.running = false;
    f.run(10.0);
    assert!(!f.output(1), "STOP");
    f.running = true;
    f.reset();
    f.run(10.0);
    assert!(!f.output(1), "after a reset the timer starts again");
}

#[test]
fn block_values_show_what_is_on_the_wires() {
    let mut f = gate(BlockKind::And { inputs: 2 });
    f.set_input(1, true);
    f.set_input(2, true);
    f.scan(10.0);
    assert_eq!(f.block_values(1), Some(&[Value::Bit(true)][..]));
    assert_eq!(f.block_values(3), Some(&[Value::Bit(true)][..]));
    assert_eq!(f.block_values(99), None);
}

#[test]
fn mistakes_are_reported_in_plain_words() {
    // Digital to analog.
    let e = errors_of(
        vec![
            blk(1, BlockKind::Input { n: 1 }),
            blk(2, BlockKind::AnalogFlag { n: 1 }),
        ],
        vec![wire(1, 0, 2, 0)],
    );
    assert_eq!(e[0].block, Some(2));
    assert!(e[0]
        .message
        .contains("digital output cannot be joined to an analog input"));

    // Analog to digital.
    let e = errors_of(
        vec![
            blk(1, BlockKind::AnalogInput { n: 1 }),
            blk(2, BlockKind::Not),
        ],
        vec![wire(1, 0, 2, 0)],
    );
    assert!(e[0]
        .message
        .contains("analog output cannot be joined to a digital input"));

    // Two wires into one input.
    let e = errors_of(
        vec![
            blk(1, BlockKind::Input { n: 1 }),
            blk(2, BlockKind::Input { n: 2 }),
            blk(3, BlockKind::Not),
        ],
        vec![wire(1, 0, 3, 0), wire(2, 0, 3, 0)],
    );
    assert!(e[0].message.contains("Two wires"));

    // The same output twice.
    let e = errors_of(
        vec![
            blk(1, BlockKind::Output { n: 1 }),
            blk(2, BlockKind::Output { n: 1 }),
        ],
        vec![],
    );
    assert!(e[0].message.contains("Q1"));

    // Points this CPU does not have.
    let e = errors_of(
        vec![
            blk(1, BlockKind::Output { n: 9 }),
            blk(2, BlockKind::Input { n: 0 }),
            blk(3, BlockKind::Flag { n: 28 }),
        ],
        vec![],
    );
    assert_eq!(e.len(), 3);
    assert!(e[0].message.contains("Q9"));
    assert!(e[1].message.contains("I0"));
    assert!(e[2].message.contains("M28"));

    // Wires to nothing, pins that do not exist, blocks that do not exist.
    let e = errors_of(
        vec![blk(1, BlockKind::Input { n: 1 }), blk(2, BlockKind::Not)],
        vec![wire(1, 3, 2, 0), wire(1, 0, 2, 5), wire(7, 0, 2, 0)],
    );
    assert_eq!(e.len(), 3);

    // Same number twice, a logic block with the wrong number of inputs, a long time.
    let e = errors_of(
        vec![
            blk(1, BlockKind::Not),
            blk(1, BlockKind::And { inputs: 5 }),
            blk(
                2,
                BlockKind::OnDelay {
                    ms: MAX_TIME_MS + 1,
                },
            ),
        ],
        vec![],
    );
    assert_eq!(e.len(), 3);

    // Dates and times that do not exist.
    let e = errors_of(
        vec![
            blk(
                1,
                BlockKind::WeeklyTimer {
                    cams: vec![WeeklyCam {
                        days: 1,
                        on_minute: 1440,
                        off_minute: 0,
                    }],
                },
            ),
            blk(
                2,
                BlockKind::YearlyTimer {
                    cams: vec![YearlyCam {
                        on_month: 2,
                        on_day: 30,
                        off_month: 3,
                        off_day: 1,
                    }],
                },
            ),
        ],
        vec![],
    );
    assert_eq!(e.len(), 2);
}

#[test]
fn diagram_saves_as_json() {
    let mut d = diagram(
        vec![
            blk(1, BlockKind::Input { n: 1 }),
            blk(
                2,
                BlockKind::OnOffDelay {
                    on_ms: 500,
                    off_ms: 1000,
                },
            ),
            blk(3, BlockKind::Output { n: 1 }),
            blk(
                4,
                BlockKind::WeeklyTimer {
                    cams: vec![WeeklyCam {
                        days: 31,
                        on_minute: 480,
                        off_minute: 1020,
                    }],
                },
            ),
        ],
        vec![wire(1, 0, 2, 0), wire(2, 0, 3, 0)],
    );
    d.blocks[2].label = "Motor lamp".into();
    d.blocks[2].x = 320.5;
    d.blocks[2].label_dx = 12.0;
    d.blocks[2].title_dy = -6.0;
    let text = serde_json::to_string(&d).expect("serialise");
    assert!(text.contains("\"k\":\"onOffDelay\""));
    assert!(text.contains("\"onMs\":500"));
    assert!(text.contains("\"label\":\"Motor lamp\""));
    assert!(text.contains("\"labelDx\":12.0"));
    let back: Diagram = serde_json::from_str(&text).expect("read back");
    assert_eq!(back, d);
    // The same diagram still runs after a round trip.
    assert!(Fbd::new(&back, Limits::default()).is_ok());
}
