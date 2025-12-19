const CONFIG: &str = include_str!(concat!(env!("OUT_DIR"), "/config_embedded.txt"));

fn main() {
    println!("Config: {}", CONFIG);
}
