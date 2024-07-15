import * as std from "../../tangram.tg.ts";

export let source = tg.target(async () => {
	let url = `https://github.com/guillemj/libbsd/archive/refs/tags/0.12.2.tar.gz`;
	let checksum = "sha256:a";
	return await std
		.download({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export let build = tg.target(async () => {
	let sourceDir = await source();

	return await std.autotools.build({
		sdk: { toolchain: "llvm" },
		source: sourceDir,
	});
});
