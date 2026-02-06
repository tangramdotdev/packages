//! Test crate that uses liblzma to trigger the native library path issue.
//!
//! When xz is provided in the environment, liblzma-sys finds the native
//! library and emits -L native=/path/to/lib. This path is from the xz
//! Tangram build, which won't exist in the inner process sandbox.

pub use liblzma;

pub fn compress(data: &[u8]) -> std::io::Result<Vec<u8>> {
    // Use encode_all which wraps data in a cursor and returns compressed bytes.
    liblzma::encode_all(std::io::Cursor::new(data), 6)
}
