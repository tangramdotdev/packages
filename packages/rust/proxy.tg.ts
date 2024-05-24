import * as std from "tg:std" with { path: "../std" };

import { build, rust } from "./tangram.tg.ts";

import cargoToml from "./Cargo.toml" with { type: "file" };
import cargoLock from "./Cargo.lock" with { type: "file" };
import src from "./src" with { type: "directory" };

export let source = tg.target(async () => {
	return tg.directory({
		"Cargo.toml": cargoToml,
		"Cargo.lock": cargoLock,
		src,
	});
});

export let proxy = tg.target(async () => {
	return build({
		source: source(),
		proxy: false,
		useCargoVendor: true,
	});
});

export let test = tg.target(async () => {
	return std.build(
		tg`
		touch $OUTPUT
		tangram_rustc rustc - --version
	`,
		{ env: std.env.arg(proxy(), rust()) },
	);
});
