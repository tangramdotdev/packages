use std::ffi::CStr;
use std::os::raw::c_char;

#[link(name = "curl")]
extern "C" {
    fn curl_version() -> *mut c_char;
}

fn main() {
    let version = unsafe { CStr::from_ptr(curl_version()) };
    let string = String::from_utf8_lossy(version.to_bytes()).to_string();
    println!("libcurl version: {}", string);
}
