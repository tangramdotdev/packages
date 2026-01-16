fn main() {
    let out_dir = std::env::var("OUT_DIR").unwrap();
    let dest = std::path::Path::new(&out_dir).join("generated.rs");
    std::fs::write(
        &dest,
        r#"
pub fn generated_fn() -> &'static str {
    "generated at build time"
}
"#,
    )
    .unwrap();
}
