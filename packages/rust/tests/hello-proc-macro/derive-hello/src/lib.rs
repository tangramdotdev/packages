use proc_macro::TokenStream;

/// A simple derive macro that implements a `hello` method returning a greeting.
#[proc_macro_derive(Hello)]
pub fn derive_hello(input: TokenStream) -> TokenStream {
    // Parse the input to get the struct name
    let input_str = input.to_string();

    // Extract the struct name (simple parsing for this test)
    let struct_name = input_str
        .split_whitespace()
        .skip_while(|s| *s != "struct")
        .nth(1)
        .unwrap_or("Unknown")
        .trim_end_matches(|c| c == '{' || c == ';' || c == '(');

    // Generate the implementation
    let output = format!(
        r#"
        impl {struct_name} {{
            pub fn hello(&self) -> &'static str {{
                "Hello from {struct_name}!"
            }}
        }}
        "#,
        struct_name = struct_name
    );

    output.parse().unwrap()
}
