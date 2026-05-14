import * as std from "std" with { source: "../std" };
import { $ } from "std" with { source: "../std" };

import { cargo } from "./tangram.ts";

import cargoToml from "./tgrustc-next/Cargo.toml" with { type: "file" };
import cargoLock from "./tgrustc-next/Cargo.lock" with { type: "file" };
import src from "./tgrustc-next/src" with { type: "directory" };

import probeFixture from "./tgrustc-next/tests/probe" with { type: "directory" };

/** Same layout trick as proxy.tg.ts: `../../std` from tgrustc-next's Cargo.toml resolves to the std Rust workspace. */
export const source = async () =>
	tg.directory({
		"rust/tgrustc-next": {
			"Cargo.toml": cargoToml,
			"Cargo.lock": cargoLock,
			src,
		},
		std: std.rustSource,
	});

export const proxyNext = async (...args: std.Args<cargo.Arg>) =>
	cargo.build(
		{
			source: source(),
			manifestSubdir: "rust/tgrustc-next",
			proxy: false,
			useCargoVendor: true,
		},
		...args,
	);

/** Phase-1 probe: build a tiny single-bin cargo project with tgrustc-next as RUSTC_WRAPPER. */
export const testProbe = async () => {
	const wrapper = await proxyNext();

	const result = await cargo.build({
		source: probeFixture,
		proxy: false,
		env: {
			RUSTC_WRAPPER: tg`${wrapper}/bin/tgrustc-next`,
		},
	});
	console.log("testProbe result", result.id);

	const out = await $`probe | tee ${tg.output}`.env(result).then(tg.File.expect);
	const text = await out.text;
	tg.assert(
		text.trim() === "hi from tgrustc-next",
		`unexpected output: ${text}`,
	);
	return result;
};
