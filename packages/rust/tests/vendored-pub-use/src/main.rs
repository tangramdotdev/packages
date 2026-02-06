// Stress test for tgrustc proxy with many vendored dependencies.
// This test reproduces issues seen when building tangram with proxy=true:
// - async_compression fails: can't find crate for `compression_codecs`
// - xattr fails: can't find crate for `rustix`
//
// These failures only occur with heavy parallel compilation, suggesting a race condition.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct Config {
    name: String,
}

fn main() {
    // Test async_compression compiles (uses pub use compression_codecs as codecs).
    let _ = async_compression::tokio::bufread::GzipEncoder::<&[u8]>::new(&[][..]);

    // Test xattr compiles (uses rustix).
    let _ = xattr::list("/tmp");

    // Test regex compiles.
    let re = regex::Regex::new(r"test").unwrap();
    let _ = re.is_match("test");

    // Test serde_json compiles.
    let config = Config { name: "test".to_string() };
    let json = serde_json::to_string(&config).unwrap();
    let _: Config = serde_json::from_str(&json).unwrap();

    println!("vendored-pub-use: all crates compiled successfully!");
}
