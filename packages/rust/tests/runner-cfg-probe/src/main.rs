#[cfg(probe_passed)]
fn probe_result() -> &'static str {
    "probe passed"
}

fn main() {
    println!("{}", probe_result());
}
