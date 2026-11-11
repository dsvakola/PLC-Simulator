use serde::{Serialize, Serializer};

/// Errors returned to the window. Each one carries a message a student or
/// teacher can read and act on.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Could not open the link: {0}")]
    Open(String),
    #[error("{0}")]
    Project(String),
    #[error("The file window could not be shown: {0}")]
    Dialog(String),
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
