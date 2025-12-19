const ENV_VALUE: &str = include_str!(concat!(env!("OUT_DIR"), "/env_value.txt"));

fn main() {
    println!("Build var was: {}", ENV_VALUE);
}
