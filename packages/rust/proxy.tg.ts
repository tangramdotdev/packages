import * as std from "tg:std" with { path: "../std" };
import * as tangram from "tg:tangram" with { path: "../../../tangram" };

import { build, rust } from "./tangram.tg.ts";

export let source = tg.target(async () => {
	return tg.directory({
		"tangram": tangram.source(),
		"packages/packages/rust": {
			"Cargo.toml": tg.include("./Cargo.toml"),
			"Cargo.lock": tg.include("./Cargo.lock"),
			"src": tg.include("./src"),
		},
	});
});

export let proxy = tg.target(async () => {
	return build({
		source: tg.symlink(source(), "packages/packages/rust"),
		proxy: false,
	});
});

export let test = tg.target(async () => {
	let env = std.env(proxy(), rust());
	return std.build(tg`
		tangram_rustc rustc - --version
	`, env);
});
