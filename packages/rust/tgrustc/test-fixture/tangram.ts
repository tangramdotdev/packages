import { cargo } from "../../" with { source: "../../" };

import source from "../../tests/hello-proc-macro-deps" with { type: "directory" };

export const run = async () => {
	const sourceWithToolchain = await tg.directory(source, {
		"rust-toolchain.toml": tg.file(
			'[toolchain]\nchannel = "nightly-2026-05-13"\n',
		),
	});
	return cargo.run({
		env: { RUSTUP_TOOLCHAIN: "nightly-2026-05-13" },
		source: sourceWithToolchain,
		proxy: true,
	});
};

export default run;
