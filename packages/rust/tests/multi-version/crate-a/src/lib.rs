use hashbrown::HashMap;

pub fn create_map() -> HashMap<String, i32> {
    let mut map = HashMap::new();
    map.insert("from_crate_a".to_string(), 1);
    map
}
