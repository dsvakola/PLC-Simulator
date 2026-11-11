//! Every example project that comes with the program opens, has a program
//! without mistakes, and has a Control Panel wiring without mistakes or
//! warnings.

use std::path::Path;

use plc_core::fbd::{Clock, Fbd, Limits};
use plc_core::sim::Simulator;

#[test]
fn every_example_is_correct() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../examples");
    let mut files = Vec::new();
    for dir in [root.clone(), root.join("instructions"), root.join("scada")] {
        for e in std::fs::read_dir(&dir).expect("examples folder") {
            let p = e.expect("entry").path();
            if p.extension().is_some_and(|x| x == "vsaplc") {
                files.push(p);
            }
        }
    }
    assert!(files.len() >= 20, "the examples are missing");
    for f in files {
        let p =
            plc_core::storage::open_project(&f).unwrap_or_else(|e| panic!("{}: {e}", f.display()));
        assert!(
            Fbd::new(&p.fbd, Limits::default()).is_ok(),
            "{}: the program has mistakes",
            f.display()
        );
        let check = plc_core::panel::check(&p.panel);
        assert!(check.is_empty(), "{}: {:?}", f.display(), check);
        let screen = plc_core::scada::check(&p.scada);
        assert!(screen.is_empty(), "{}: {:?}", f.display(), screen);
        let mut s = Simulator::new(&p.fbd, &p.panel, Clock::default()).expect("runs");
        s.advance(100.0);
        assert!(!s.frame().tripped, "{}: short circuit", f.display());
    }
}
