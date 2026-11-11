//! The SCADA screen: an operator screen the student builds from buttons,
//! switches, lamps, number displays, bar graphs, sliders, text and simple
//! plant symbols. Each item is linked to a point of the PLC (a "tag" such as
//! "I1", "Q2", "M3", "AM1" or "AI2"). While the simulation runs, the screen
//! shows the values and its buttons, switches and sliders write to the PLC.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::fbd::Limits;

/// Most items on one SCADA screen.
pub const MAX_ITEMS: usize = 200;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScadaItem {
    pub id: u32,
    /// "button", "switch", "lamp", "number", "bar", "slider", "text",
    /// "tank", "motor", "valve" or "conveyor".
    pub kind: String,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub w: f64,
    #[serde(default)]
    pub h: f64,
    /// Text shown with the item.
    #[serde(default)]
    pub label: String,
    /// The PLC point the item shows or writes: "I1", "Q2", "M3", "AM1", "AI2".
    #[serde(default)]
    pub tag: String,
    /// Settings such as colour, range and unit.
    #[serde(default)]
    pub props: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Scada {
    #[serde(default)]
    pub items: Vec<ScadaItem>,
}

/// What a tag points at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tag {
    Input(u8),
    Output(u8),
    Marker(u8),
    AnalogInput(u8),
    AnalogMarker(u8),
}

impl Tag {
    /// Reads "I1", "Q4", "M27", "AI2", "AM16"; None if it is not a point of this PLC.
    pub fn parse(s: &str) -> Option<Tag> {
        let s = s.trim().to_ascii_uppercase();
        let limits = Limits::default();
        let (kind, num): (fn(u8) -> Tag, &str) = if let Some(n) = s.strip_prefix("AM") {
            (Tag::AnalogMarker, n)
        } else if let Some(n) = s.strip_prefix("AI") {
            (Tag::AnalogInput, n)
        } else if let Some(n) = s.strip_prefix('I') {
            (Tag::Input, n)
        } else if let Some(n) = s.strip_prefix('Q') {
            (Tag::Output, n)
        } else {
            (Tag::Marker, s.strip_prefix('M')?)
        };
        let n: u8 = num.parse().ok()?;
        let t = kind(n);
        let max = match t {
            Tag::Input(_) => limits.inputs,
            Tag::Output(_) => limits.outputs,
            Tag::Marker(_) => limits.markers,
            Tag::AnalogInput(_) => limits.analog_inputs,
            Tag::AnalogMarker(_) => limits.analog_flags,
        };
        (n >= 1 && n <= max).then_some(t)
    }

    /// An on/off point (I, Q, M), as opposed to an analog one (AI, AM).
    pub fn is_bit(self) -> bool {
        matches!(self, Tag::Input(_) | Tag::Output(_) | Tag::Marker(_))
    }
}

/// A mistake on the SCADA screen.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScadaError {
    pub item: Option<u32>,
    pub message: String,
}

/// What kind of tag each item needs, and whether it writes to the PLC.
fn needs(kind: &str) -> Option<(bool, bool)> {
    // (on/off tag, writes)
    Some(match kind {
        "button" | "switch" => (true, true),
        "lamp" | "motor" | "valve" | "conveyor" => (true, false),
        "number" | "bar" | "tank" => (false, false),
        "slider" => (false, true),
        "text" => return None,
        _ => return None,
    })
}

/// Checks the screen: every item has a tag of the right kind, and items that
/// write only write where the PLC can be written: I1 to I4 (the board
/// switches), markers M, and analog markers AM.
pub fn check(s: &Scada) -> Vec<ScadaError> {
    let mut errors = Vec::new();
    let e = |item: Option<u32>, m: String| ScadaError { item, message: m };
    if s.items.len() > MAX_ITEMS {
        errors.push(e(
            None,
            format!("The SCADA screen has more than {MAX_ITEMS} items."),
        ));
    }
    for it in &s.items {
        if !it.x.is_finite() || !it.y.is_finite() {
            errors.push(e(Some(it.id), "An item is not on the screen.".into()));
        }
        let known = [
            "button", "switch", "lamp", "number", "bar", "slider", "text", "tank", "motor",
            "valve", "conveyor",
        ];
        if !known.contains(&it.kind.as_str()) {
            errors.push(e(
                Some(it.id),
                format!("An item of an unknown kind (\"{}\").", it.kind),
            ));
            continue;
        }
        let Some((bit, writes)) = needs(&it.kind) else {
            continue;
        };
        let name = if it.label.is_empty() {
            it.kind.clone()
        } else {
            format!("\"{}\"", it.label)
        };
        let Some(tag) = Tag::parse(&it.tag) else {
            errors.push(e(
                Some(it.id),
                format!("{name} is not linked to a PLC point (such as I1, Q1, M1 or AM1)."),
            ));
            continue;
        };
        if tag.is_bit() != bit {
            let want = if bit {
                "an on/off point (I, Q or M)"
            } else {
                "an analog point (AI or AM)"
            };
            errors.push(e(
                Some(it.id),
                format!("{name} needs {want}, not {}.", it.tag),
            ));
            continue;
        }
        if writes {
            let ok = match tag {
                Tag::Input(n) => n <= 4,
                Tag::Marker(_) | Tag::AnalogMarker(_) => true,
                _ => false,
            };
            if !ok {
                errors.push(e(
                    Some(it.id),
                    format!("{name} cannot change {}. Buttons and switches work on I1 to I4 or a marker M; sliders on an analog marker AM.", it.tag),
                ));
            }
        }
    }
    errors
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: u32, kind: &str, tag: &str) -> ScadaItem {
        ScadaItem {
            id,
            kind: kind.into(),
            x: 10.0,
            y: 10.0,
            w: 80.0,
            h: 60.0,
            label: String::new(),
            tag: tag.into(),
            props: BTreeMap::new(),
        }
    }

    #[test]
    fn tags_are_read() {
        assert_eq!(Tag::parse("i1"), Some(Tag::Input(1)));
        assert_eq!(Tag::parse("AM16"), Some(Tag::AnalogMarker(16)));
        assert_eq!(Tag::parse("AI2"), Some(Tag::AnalogInput(2)));
        assert_eq!(Tag::parse("Q5"), None, "this PLC has Q1 to Q4");
        assert_eq!(Tag::parse("AI3"), None, "only I7 and I8 are analog");
        assert_eq!(Tag::parse("X1"), None);
    }

    #[test]
    fn a_good_screen_has_no_mistakes() {
        let s = Scada {
            items: vec![
                item(1, "button", "I1"),
                item(2, "switch", "M3"),
                item(3, "lamp", "Q1"),
                item(4, "number", "AI1"),
                item(5, "slider", "AM2"),
                item(6, "text", ""),
                item(7, "tank", "AM1"),
            ],
        };
        assert_eq!(check(&s), vec![]);
    }

    #[test]
    fn mistakes_are_explained() {
        let s = Scada {
            items: vec![
                item(1, "button", "Q1"),
                item(2, "lamp", "AM1"),
                item(3, "slider", "AI1"),
                item(4, "number", ""),
                item(5, "button", "I6"),
            ],
        };
        let m: Vec<String> = check(&s).into_iter().map(|e| e.message).collect();
        assert_eq!(m.len(), 5);
        assert!(m[0].contains("cannot change Q1"));
        assert!(m[1].contains("on/off point"));
        assert!(m[2].contains("cannot change AI1"));
        assert!(m[3].contains("not linked"));
        assert!(m[4].contains("I1 to I4"));
    }

    #[test]
    fn old_projects_have_an_empty_screen() {
        let s: Scada = serde_json::from_str("{}").expect("empty");
        assert!(s.items.is_empty());
    }
}
