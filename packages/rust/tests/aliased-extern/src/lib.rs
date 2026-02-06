//! Test for aliased extern crates in transitive dependency computation.
//!
//! signal-hook-mio uses `mio_1_0` as an alias for `mio` version 1.0.
//! This tests that tgrustc correctly handles the alias by extracting the
//! actual crate name from the file path rather than using the alias name.

// Re-export to verify the crates are available.
pub use mio;
pub use signal_hook_mio;

/// Verify mio can be used.
pub fn test_mio() -> mio::Poll {
    mio::Poll::new().expect("Failed to create Poll")
}
