/// Return the build timestamp set by the build script.
pub fn build_timestamp() -> &'static str {
    env!("LIB_BUILD_TIMESTAMP")
}
