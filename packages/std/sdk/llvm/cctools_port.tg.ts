import * as std from "../../tangram.ts";
import libDispatch from "./apple_libdispatch.tg.ts";
import libTapi from "./apple_libtapi.tg.ts";

export const source = tg.command(async () => {
	const url = `https://github.com/tpoechtrager/cctools-port/archive/856d7d1bfcc890357bfe79b3f4aa206a0487b416.zip`;
	const checksum =
		"sha256:d3a912976e9467c5df3bed4f6e2f44cf62b20a5ecaffa074acd26484e4444f51";
	let directory = await std.download
		.extractArchive({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap)
		.then((dir) => dir.get("cctools"))
		.then(tg.Directory.expect);

	// Replace broken symlinks with working relative links.
	directory = await tg.directory(directory, {
		["include/foreign/arm"]: tg.symlink("./i386"),
		["include/foreign/mach/arm"]: tg.symlink("./i386"),
	});

	return directory;
});

export const build = tg.command(async (targetArch?: string) => {
	const host = await std.triple.host();
	const targetArch_ = targetArch ?? std.triple.arch(host);
	const target = `${targetArch_}-apple-darwin`;
	const build = host;

	const configure = {
		args: [`--target=${target}`],
	};
	const phases = { configure };

	return await std.autotools.build({
		...(await std.triple.rotate({ build, host })),
		env: std.env.arg(libDispatch(), libTapi()),
		phases,
		sdk: { toolchain: "llvm" },
		source: source(),
	});
});

export default build;
