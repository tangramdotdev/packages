use derive_hello::Hello;

#[derive(Hello)]
struct Greeter;

fn main() {
    let g = Greeter;
    println!("{}", g.hello());
}
