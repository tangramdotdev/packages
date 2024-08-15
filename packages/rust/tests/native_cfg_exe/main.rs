fn main() {
    if cfg!(optional) {
        println!("optional feature enabled");
    } else {
        println!("optional feature disabled");
    }
}
