use aho_corasick::AhoCorasick;
use regex_syntax::Parser;

fn main() {
    // Simple test using aho-corasick
    let patterns = &["apple", "maple"];
    let haystack = "Nobody likes maple in their apple flavored tea.";
    let ac = AhoCorasick::new(patterns).unwrap();
    let matches: Vec<_> = ac.find_iter(haystack).collect();
    println!("Found {} matches", matches.len());

    // Simple test using regex-syntax
    let hir = Parser::new().parse("a{2}").unwrap();
    println!("Parsed regex: {:?}", hir.kind());
}
