use proc_macro::TokenStream;

// Expand to the contents of the file at the relative path in the named environment variable, resolved against the manifest directory, as `rust-embed` resolves its folder under its `compression` feature.
#[proc_macro]
pub fn embed(input: TokenStream) -> TokenStream {
	let name = input.to_string();
	let name = name.trim_matches('"');
	let manifest_directory = std::env::var("CARGO_MANIFEST_DIR").unwrap();
	let value = std::env::var(name).unwrap();
	assert!(
		std::path::Path::new(&value).is_relative(),
		"expected a relative path, got {value}"
	);
	let path = std::path::Path::new(&manifest_directory).join(value);
	let contents = std::fs::read_to_string(&path)
		.unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display()));
	format!("{contents:?}").parse().unwrap()
}
