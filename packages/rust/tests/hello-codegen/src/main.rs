include!(concat!(env!("OUT_DIR"), "/generated.rs"));

fn main() {
    println!("{}", generated_fn());
}
