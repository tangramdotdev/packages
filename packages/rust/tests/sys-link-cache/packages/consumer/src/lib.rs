/// Use the wrapper-sys crate.
/// When this crate is compiled, rustc receives -L native=<wrapper-sys OUT_DIR>
/// because wrapper-sys sets cargo:rustc-link-search=native=<OUT_DIR>.
pub fn compute(a: i32, b: i32) -> i32 {
    wrapper_sys::add(a, b)
}
