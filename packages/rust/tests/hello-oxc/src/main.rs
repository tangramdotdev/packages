use oxc_allocator::Allocator;

fn main() {
    let allocator = Allocator::default();
    let boxed = allocator.alloc(42u32);
    println!("Allocator works! Value: {}", *boxed);
}
