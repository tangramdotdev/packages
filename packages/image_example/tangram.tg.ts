import * as std from "tg:std" with { path: "../std" };
import * as jqCustom from "tg:jq_custom" with { path: "../jq_custom" };
import * as rustOpenSsl from "tg:rust_openssl_example" with { path: "../rust_openssl_example" };

export let env = tg.target(() => std.env(jqCustom.build(), rustOpenSsl.build(), { COOL_VAR: "cool value"}));

export let image = tg.target(() => std.image(env(), { cmd: ["bash"] }));
