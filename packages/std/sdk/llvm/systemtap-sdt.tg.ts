import * as std from "../../tangram.ts";

export const source = tg.command(async () => {
	const url = `https://github.com/guillemj/libbsd/archive/refs/tags/0.12.2.tar.gz`;
	const checksum = "sha256:a";
	return await std
		.download({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export const build = tg.command(async () => {
	const sourceDir = await source();

	return await std.autotools.build({
		sdk: { toolchain: "llvm" },
		source: sourceDir,
	});
});
