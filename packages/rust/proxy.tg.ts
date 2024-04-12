import * as std from "tg:std" with { path: "../std" };

import { build, rust } from "./tangram.tg.ts";

export let source = tg.target(async () => {
	return tg.directory({
		"Cargo.toml": tg.include("./Cargo.toml"),
		"Cargo.lock": tg.include("./Cargo.lock"),
		src: tg.include("./src"),
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
		{ env: [proxy(), rust()] },
	);
});
