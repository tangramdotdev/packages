const NODE_PATH: &str = include_str!(concat!(env!("OUT_DIR"), "/node_path.txt"));

fn main() {
    println!("NODE_PATH was: {NODE_PATH}");
}
