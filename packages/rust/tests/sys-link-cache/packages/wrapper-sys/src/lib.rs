extern "C" {
    pub fn wrapper_add(a: i32, b: i32) -> i32;
}

pub fn add(a: i32, b: i32) -> i32 {
    unsafe { wrapper_add(a, b) }
}
