use std::io::Write;
use std::process::{Command, Stdio};

/// Probe whether the compiler can compile a trivial program via stdin.
/// This mirrors the `can_compile` pattern used by rustix and other crates
/// to detect compiler capabilities via RUSTC_WRAPPER.
fn can_compile(code: &str) -> bool {
    let rustc = std::env::var("RUSTC").unwrap_or_else(|_| "rustc".into());
    let wrapper = std::env::var("RUSTC_WRAPPER").ok();
    let target = std::env::var("TARGET").ok();

    let (program, initial_args) = match &wrapper {
        Some(w) => (w.as_str(), vec![rustc.as_str()]),
        None => (rustc.as_str(), vec![]),
    };

    let mut cmd = Command::new(program);
    cmd.args(&initial_args);
    cmd.arg("-");
    cmd.arg("--crate-type=lib");
    cmd.arg("--emit=metadata");
    cmd.arg("--out-dir").arg(std::env::var("OUT_DIR").unwrap());
    if let Some(t) = &target {
        cmd.arg("--target").arg(t);
    }
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(_) => return false,
    };

    if let Some(ref mut stdin) = child.stdin {
        let _ = stdin.write_all(code.as_bytes());
    }

    child.wait().map(|s| s.success()).unwrap_or(false)
}

fn main() {
    // Probe a trivial program — this should always succeed with a working compiler.
    if can_compile("pub fn probe() {}") {
        println!("cargo:rustc-cfg=probe_passed");
    }
}
