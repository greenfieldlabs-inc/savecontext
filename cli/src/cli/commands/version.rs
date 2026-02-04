//! Version command implementation.

use crate::error::Result;
use serde::Serialize;

#[derive(Serialize)]
struct VersionOutput<'a> {
    version: &'a str,
    build: &'a str,
}

/// Execute the version command.
///
/// # Errors
///
/// Returns an error if JSON serialization fails.
pub fn execute(json: bool) -> Result<()> {
    let version = env!("CARGO_PKG_VERSION");
    let build = if cfg!(debug_assertions) {
        "dev"
    } else {
        "release"
    };

    if json {
        let output = VersionOutput { version, build };
        let payload = serde_json::to_string(&output)?;
        println!("{payload}");
        return Ok(());
    }

    println!("sc version {version} ({build})");
    Ok(())
}
