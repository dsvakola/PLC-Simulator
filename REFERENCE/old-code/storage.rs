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
    let p: Project = serde_json::from_str(&text)
        .map_err(|_| "This file is not a VSA Simulator project, or it is damaged.".to_string())?;
    project::validate(&p)?;
    Ok(project::upgrade(p))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::PlacedPart;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let d = std::env::temp_dir().join(format!("vra-test-{tag}-{nanos}"));
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
        p.parts.push(PlacedPart {
            id: "led1".into(),
            kind: "led".into(),
            x: 10.0,
            y: 20.0,
            rotation: 0.0,
            flip_h: false,
            flip_v: false,
            props: Default::default(),
            legs: Default::default(),
        });
        p
    }

    #[test]
    fn save_then_open_gives_same_project() {
        let d = TempDir::new("roundtrip");
        let f = d.0.join("blink.vrasim");
        save_project(&f, &sample()).expect("save");
        assert_eq!(open_project(&f).expect("open"), sample());
        assert!(!d.0.join(".blink.vrasim.tmp").exists());
    }

    #[test]
    fn saving_over_a_file_keeps_a_backup() {
        let d = TempDir::new("backup");
        let f = d.0.join("p.vrasim");
        save_project(&f, &Project::default()).expect("first save");
        save_project(&f, &sample()).expect("second save");
        let old = open_project(&d.0.join("p.vrasim.bak")).expect("backup");
        assert_eq!(old, Project::default());
        assert_eq!(open_project(&f).expect("new"), sample());
    }

    #[test]
    fn opening_a_wrong_file_explains_the_problem() {
        let d = TempDir::new("bad");
        let f = d.0.join("notes.vrasim");
        fs::write(&f, "hello").expect("write");
        let e = open_project(&f).expect_err("should fail");
        assert!(e.contains("not a VSA Simulator project"));
        let missing = open_project(&d.0.join("missing.vrasim")).expect_err("missing");
        assert!(missing.starts_with("Could not open"));
    }
}
