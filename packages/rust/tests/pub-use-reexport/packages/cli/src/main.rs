fn main() {
    // Access the re-exported crate through outer.
    println!("{}", outer::get_combined());

    // Also access the alias directly.
    println!("Direct alias access: {}", outer::alias::VALUE);
}
