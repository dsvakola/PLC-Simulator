//! The project file: which CPU the student picked and the program for it.

use serde::{Deserialize, Serialize};

use crate::fbd::{self, Diagram};
use crate::panel::{self, Panel};
use crate::plc::Ladder;
use crate::scada::{self, Scada};

/// Version of the project file format written by this program.
/// 1: version 0.0.1 (the first control panel, with supply strips).
/// 2: version 0.0.2 (the academy board, wired inside).
pub const FORMAT: u32 = 2;

/// The student draws the program as a function block diagram or as a ladder.
pub const LANGUAGES: [&str; 2] = ["fbd", "lad"];

/// Most networks a program may have.
pub const MAX_NETWORKS: usize = 999;
/// Most rows (parallel branches) in one network.
pub const MAX_ROWS: usize = 32;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub format: u32,
    /// The CPU model, e.g. "c14" (compact CPU, 14 inputs and 10 outputs).
    #[serde(default = "default_cpu")]
    pub cpu: String,
    /// A note about the whole project.
    #[serde(default)]
    pub comment: String,
    /// Which language the program is written in: "fbd" or "lad".
    #[serde(default = "default_language")]
    pub language: String,
    /// The program as a ladder (used when the language is "lad").
    #[serde(default)]
    pub ladder: Ladder,
    /// The program as a function block diagram (used when the language is "fbd").
    #[serde(default)]
    pub fbd: Diagram,
    /// The control panel: extra devices and the wires between terminals.
    #[serde(default)]
    pub panel: Panel,
    /// The SCADA screen: operator items linked to PLC points.
    #[serde(default)]
    pub scada: Scada,
}

fn default_cpu() -> String {
    "c14".to_string()
}

fn default_language() -> String {
    "fbd".to_string()
}

impl Default for Project {
    fn default() -> Self {
        Project {
            format: FORMAT,
            cpu: default_cpu(),
            comment: String::new(),
            language: default_language(),
            ladder: Ladder::default(),
            fbd: Diagram::default(),
            panel: Panel::default(),
            scada: Scada::default(),
        }
    }
}

/// Checks that an opened project makes sense before it is used.
pub fn validate(p: &Project) -> Result<(), String> {
    if p.format == 0 {
        return Err("This file is not a PLC Simulator project, or it is damaged.".into());
    }
    if p.format > FORMAT {
        return Err(
            "This project was saved by a newer version of PLC Simulator. Please update the program to open it."
                .into(),
        );
    }
    if p.ladder.networks.len() > MAX_NETWORKS {
        return Err(format!(
            "This project has more than {MAX_NETWORKS} networks, which is too many."
        ));
    }
    if p.ladder.networks.iter().any(|n| n.rows.len() > MAX_ROWS) {
        return Err(format!(
            "A network in this project has more than {MAX_ROWS} rows, which is too many."
        ));
    }
    if p.fbd.blocks.len() > fbd::MAX_BLOCKS {
        return Err(format!(
            "This project has more than {} blocks, which is too many.",
            fbd::MAX_BLOCKS
        ));
    }
    if p.scada.items.len() > scada::MAX_ITEMS {
        return Err("The SCADA screen of this project has too many items.".into());
    }
    if p.panel.devices.len() > panel::MAX_DEVICES || p.panel.wires.len() > panel::MAX_WIRES {
        return Err("The control panel of this project has too many devices or wires.".into());
    }
    Ok(())
}

/// Brings a project from an older file format up to date.
pub fn upgrade(mut p: Project) -> Project {
    if p.format < 2 {
        panel::upgrade_from_v1(&mut p.panel);
    }
    p.format = FORMAT;
    if !LANGUAGES.contains(&p.language.as_str()) {
        p.language = default_language();
    }
    p
}
