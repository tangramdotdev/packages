use hashbrown::HashMap;
use indexmap::IndexMap;

fn main() {
    let mut map: HashMap<&str, i32> = HashMap::new();
    map.insert("hello", 42);
    println!("HashMap value: {:?}", map.get("hello"));

    let mut imap: IndexMap<&str, i32> = IndexMap::new();
    imap.insert("world", 100);
    println!("IndexMap value: {:?}", imap.get("world"));

    println!("Success!");
}
