include!(concat!(env!("OUT_DIR"), "/config.rs"));

pub fn config() -> &'static str {
    SHARED_CONFIG
}
