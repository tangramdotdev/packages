extern "C" {
    fn add_numbers(a: i32, b: i32) -> i32;
}

fn main() {
    let result = unsafe { add_numbers(10, 32) };
    println!("10 + 32 = {}", result);
}
