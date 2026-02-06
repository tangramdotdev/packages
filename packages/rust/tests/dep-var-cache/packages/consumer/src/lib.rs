// consumer: Depends on lib-sys and thus receives DEP_MYLIB_ROOT env var.
// This crate should cache correctly when only 'app' is modified.
pub fn consume() -> &'static str {
    lib_sys::get_version()
}
