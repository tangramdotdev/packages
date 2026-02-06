// Re-export the inner crate with an alias, mirroring async-compression's pattern:
// pub use compression_codecs as codecs;
pub use inner as alias;

/// A function that uses the re-exported crate.
pub fn get_combined() -> String {
    format!("{} (value: {})", alias::get_message(), alias::VALUE)
}
