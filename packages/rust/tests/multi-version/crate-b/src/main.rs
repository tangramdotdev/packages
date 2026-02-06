use hashbrown::HashMap;

fn main() {
    // Use hashbrown 0.16 directly
    let mut map: HashMap<&str, i32> = HashMap::new();
    map.insert("from_crate_b", 2);
    println!("crate-b map: {:?}", map.get("from_crate_b"));

    // Use crate-a which uses hashbrown 0.14
    let map_a = crate_a::create_map();
    println!("crate-a map: {:?}", map_a.get("from_crate_a"));

    println!("Success!");
}
