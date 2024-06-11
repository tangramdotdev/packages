import * as rust from "tg:rust" with { path: "../rust" }
import * as std from "tg:std" with { path: "../std" }
import * as pkgconfig from "tg:pkgconfig" with { path: "../pkgconfig" }
import * as openssl from "tg:openssl" with { path: "../openssl" }
import crateSource from "./hello-openssl" with { path: "./hello-openssl" };

export let metadata = {
	name: "rust_openssl_example",
};

export let build = tg.target(() => {
	return rust.build({
		env: std.env.arg(pkgconfig.build(), openssl.build()),
		source: crateSource
	});
});
