use openssl::ssl::{SslConnector, SslMethod};

fn main() {
    let mut ctx = SslConnector::builder(SslMethod::tls()).unwrap();

    // set_ciphersuites was added in OpenSSL 1.1.1, so we can only call it when linking against that version
    if cfg!(openssl111) {
        ctx.set_ciphersuites("TLS_AES_256_GCM_SHA384:TLS_AES_128_GCM_SHA256").unwrap();
    } else {
        panic!("Expected OpenSSL > 1.1.1");
    }

    println!("Hello, from a crate that links against libssl!!");
}
