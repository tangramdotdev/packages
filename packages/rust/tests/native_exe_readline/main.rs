use std::ffi::CStr;
use std::os::raw::c_char;

#[link(name = "readline")]
extern "C" {
    static rl_library_version: *const c_char;
}

fn main() {
    let version = unsafe { CStr::from_ptr(rl_library_version) };
    let string = version.to_str().unwrap();
    println!("readline version: {}", string);
}
