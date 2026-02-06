/// A simple value to re-export.
pub const VALUE: i32 = 42;

/// A function to re-export.
pub fn get_message() -> &'static str {
    "Hello from inner crate!"
}
