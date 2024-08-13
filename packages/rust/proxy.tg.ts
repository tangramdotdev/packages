import { $ } from "tg:std" with { path: "../std" };

import { cargo, toolchain } from "./tangram.tg.ts";

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
	return cargo.build({
		source: source(),
		features: ["tracing"],
		proxy: false,
		useCargoVendor: true,
	});
});

export let test = tg.target(async () => {
	return await $`
		touch $OUTPUT
		tangram_rustc rustc - --version
	`.env(proxy(), toolchain());
});
