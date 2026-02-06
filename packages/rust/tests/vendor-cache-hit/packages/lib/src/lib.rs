use indexmap::IndexMap;
use once_cell::sync::Lazy;

static MAP: Lazy<IndexMap<&'static str, i32>> = Lazy::new(|| {
    let mut map = IndexMap::new();
    map.insert("a", 1);
    map.insert("b", 2);
    map
});

pub fn lookup(key: &str) -> Option<i32> {
    MAP.get(key).copied()
}

pub fn find_byte(haystack: &[u8], needle: u8) -> Option<usize> {
    memchr::memchr(needle, haystack)
}
