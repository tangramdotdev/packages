fn main() {
    println!("lookup a = {:?}", lib::lookup("a"));
    println!("find b in abc = {:?}", lib::find_byte(b"abc", b'b'));
}
