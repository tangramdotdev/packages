import * as std from "../../tangram.ts";
import libDispatch from "./apple_libdispatch.tg.ts";
import libTapi from "./apple_libtapi.tg.ts";

export async function source() {
	const url = `https://github.com/tpoechtrager/cctools-port/archive/904de2a71d4da6a9b30d2efaf912a10ddc7d9ddb.zip`;
	const checksum =
		"sha256:04abaeb59d68a562f50a772ad9791d09adc7fa937b2780bb5d62b99aab30f87e";
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
}

export async function build(targetArch?: string) {
	const host = std.triple.host();
	const targetArch_ = targetArch ?? std.triple.arch(host);
	const target = `${targetArch_}-apple-darwin`;
	const build = host;

	const configure = {
		args: [`--target=${target}`],
	};
	const phases = { configure };

	return await std.autotools.build({
		build,
		host,
		env: std.env.arg(libDispatch(), libTapi()),
		phases,
		sdk: { toolchain: "llvm" },
		source: source(),
	});
}

export default build;
