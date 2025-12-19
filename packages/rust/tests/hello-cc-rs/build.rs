fn main() {
    println!("cargo:rerun-if-changed=csrc/helper.c");
    cc::Build::new().file("csrc/helper.c").compile("helper");
}
