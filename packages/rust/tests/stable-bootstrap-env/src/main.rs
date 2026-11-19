// The proxy's sandbox does not receive Cargo's home, so its presence shows that this crate compiles directly.
const _: () = assert!(
	option_env!("CARGO_HOME").is_some(),
	"expected the crate to compile directly"
);
const _: () = assert!(
	option_env!("RUSTC_BOOTSTRAP").is_none(),
	"expected RUSTC_BOOTSTRAP to be removed from the compilation"
);

fn main() {
	println!("Hello from a stable toolchain!");
}
