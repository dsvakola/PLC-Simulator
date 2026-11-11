//! Saving and opening project files. Writes are atomic: the new file is
//! written beside the old one and then renamed over it, so a crash never
//! leaves a half-written project. The previous version is kept as `.bak`.

use crate::project::{self, Project};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Writes `bytes` to `path` safely: temporary file, flush to disk, rename.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_string());
    let tmp = dir.join(format!(".{name}.tmp"));
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

fn backup_path(path: &Path) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(".bak");
    PathBuf::from(s)
}

/// Saves a project. If a file is already there, it is first copied to
/// `<name>.bak` so the student can get the old version back.
pub fn save_project(path: &Path, p: &Project) -> Result<(), String> {
    let text = serde_json::to_string_pretty(p)
        .map_err(|e| format!("The project could not be prepared for saving: {e}"))?;
    if path.exists() {
        fs::copy(path, backup_path(path))
            .map_err(|e| format!("Could not keep a backup of the old file: {e}"))?;
    }
    write_atomic(path, text.as_bytes())
        .map_err(|e| format!("Could not save to {}: {e}", path.display()))
}

/// Opens a project and checks that it makes sense.
pub fn open_project(path: &Path) -> Result<Project, String> {
    let text =
        fs::read_to_string(path).map_err(|e| format!("Could not open {}: {e}", path.display()))?;
    let p: Project = serde_json::from_str(&text).map_err(|_| {
        "This file is not a PLC & SCADA Simulator project, or it is damaged.".to_string()
    })?;
    project::validate(&p)?;
    Ok(project::upgrade(p))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plc::{Cell, Network};

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let d = std::env::temp_dir().join(format!("plc-test-{tag}-{nanos}"));
            fs::create_dir_all(&d).expect("temp dir");
            TempDir(d)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn sample() -> Project {
        let mut p = Project::default();
        p.ladder.networks.push(Network {
            comment: "Lamp follows the switch".into(),
            rows: vec![vec![
                Cell::No { a: "I0.0".into() },
                Cell::Coil { a: "Q0.0".into() },
            ]],
            links: vec![],
        });
        p
    }

    #[test]
    fn save_then_open_gives_same_project() {
        let d = TempDir::new("roundtrip");
        let f = d.0.join("lamp.vsaplc");
        save_project(&f, &sample()).expect("save");
        assert_eq!(open_project(&f).expect("open"), sample());
        assert!(!d.0.join(".lamp.vsaplc.tmp").exists());
    }

    #[test]
    fn saving_over_a_file_keeps_a_backup() {
        let d = TempDir::new("backup");
        let f = d.0.join("p.vsaplc");
        save_project(&f, &Project::default()).expect("first save");
        save_project(&f, &sample()).expect("second save");
        let old = open_project(&d.0.join("p.vsaplc.bak")).expect("backup");
        assert_eq!(old, Project::default());
        assert_eq!(open_project(&f).expect("new"), sample());
    }

    #[test]
    fn opening_a_wrong_file_explains_the_problem() {
        let d = TempDir::new("bad");
        let f = d.0.join("notes.vsaplc");
        fs::write(&f, "hello").expect("write");
        let e = open_project(&f).expect_err("should fail");
        assert!(e.contains("not a PLC & SCADA Simulator project"));
        let missing = open_project(&d.0.join("missing.vsaplc")).expect_err("missing");
        assert!(missing.starts_with("Could not open"));
    }

    #[test]
    fn a_newer_file_is_refused_politely() {
        let d = TempDir::new("newer");
        let f = d.0.join("future.vsaplc");
        fs::write(&f, r#"{"format": 99}"#).expect("write");
        let e = open_project(&f).expect_err("should fail");
        assert!(e.contains("newer version"));
    }

    #[test]
    fn a_project_from_version_0_0_1_still_opens() {
        let d = TempDir::new("v1");
        let f = d.0.join("old.vsaplc");
        let old = r#"{"format":1,"cpu":"c14","language":"fbd",
            "fbd":{"blocks":[{"id":1,"k":"input","n":1,"x":10,"y":10},{"id":2,"k":"output","n":1,"x":90,"y":10}],
                   "wires":[{"fromBlock":1,"fromPin":0,"toBlock":2,"toPin":0}],"scanMs":10},
            "panel":{"devices":[{"id":1,"kind":"lamp","x":100,"y":600,"label":"Pump","props":{"color":"red"}}],
                     "wires":[{"from":"v24.p1","to":"btn1.a","color":"red"},{"from":"plc.Q1b","to":"d1.p","color":"green"}],
                     "fixedProps":{"btn1":{"nc":"true"}}}}"#;
        fs::write(&f, old).expect("write");
        let p = open_project(&f).expect("an old project opens");
        assert_eq!(p.format, project::FORMAT);
        assert_eq!(p.fbd.blocks.len(), 2, "the program is kept");
        assert_eq!(p.panel.devices.len(), 1, "the student's lamp is kept");
        assert_eq!(p.panel.devices[0].label, "Pump");
        assert!(p.panel.wires.is_empty(), "wires to the old board are gone");
        assert!(
            crate::panel::board_switch(&p.panel, 1).nc,
            "the NC choice moved to switch I1"
        );
    }
}
