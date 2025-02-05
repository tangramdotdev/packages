use std::ffi::CStr;
use std::os::raw::{c_char, c_int};

#[link(name = "external")]
extern "C" {
    fn external_function(arg: c_int) -> *const c_char;
}

pub fn get_message(value: i32) -> String {
    unsafe {
        let c_str = CStr::from_ptr(external_function(value));
        c_str.to_string_lossy().into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_message() {
        let msg = get_message(1);
        println!("Message: {}", msg);
    }
}
