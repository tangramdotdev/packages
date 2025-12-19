use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, DeriveInput};

/// A derive macro that implements a `hello` method returning the struct name.
#[proc_macro_derive(Hello)]
pub fn derive_hello(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let name = &input.ident;
    let name_str = name.to_string();

    let expanded = quote! {
        impl #name {
            pub fn hello(&self) -> &'static str {
                concat!("Hello from ", #name_str, "!")
            }
        }
    };

    TokenStream::from(expanded)
}
