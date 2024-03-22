import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";

export let metadata = {
	name: "file_cmds",
	version: "493.100.6",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:ac636da85aaa15ba03affc2bed43821d53d745e077845d85cb2964409eb61a99";
	let owner = "apple-oss-distributions";
	let repo = "file_cmds";
	let tag = `${name}-${version}`;
	let url = `https://github.com/apple-oss-distributions/file_cmds/archive/refs/tags/file_cmds-403.100.6.tar.gz`;
	let dload = tg.Directory.expect(
		await std.download({
			checksum,
			url,
			unpackFormat: ".tar.gz",
		}),
	);
	// FIXME - the non-release URL is broken.
	// let dload = tg.Directory.expect(
	// 	await std.download.fromGithub({
	// 		checksum,
	// 		owner,
	// 		repo,
	// 		tag,
	// 		version,
	// 	}),
	// );
	return std.directory.unwrap(dload);
});

type Arg = std.sdk.BuildEnvArg;

/** Produce an `install` executable that preserves xattrs on macOS, alongside the `xattr` command, to include with the coreutils. */
export let macOsXattrCmds = tg.target(async (arg?: Arg) => {
	let build = arg?.build ? tg.triple(arg.build) : await std.triple.host(arg);
	let os = build.os;

	// Assert that the system is macOS.
	if (os !== "darwin") {
		throw new Error(`fileCmds is only supported on macOS, detected ${os}.`);
	}

	let sourceDir = await source();

	let result = await tg.directory({
		bin: tg.directory(),
	});

	// install
	result = await compileUtil({
		...arg,
		destDir: result,
		fileName: "xinstall.c",
		utilSource: tg.Directory.expect(await sourceDir.get("install")),
		utilName: "install",
	});

	// xattr
	result = await compileUtil({
		...arg,
		destDir: result,
		fileName: "xattr.c",
		utilSource: tg.Directory.expect(await sourceDir.get("xattr")),
		utilName: "xattr",
	});

	return result;
});

export default macOsXattrCmds;

type UtilArg = std.sdk.BuildEnvArg & {
	destDir: tg.Directory;
	fileName: string;
	utilSource: tg.Directory;
	utilName: string;
	script?: tg.Template.Arg;
};

export let compileUtil = async (arg: UtilArg) => {
	let build = arg.build ? tg.triple(arg.build) : await std.triple.host(arg);
	let host = build;

	// Grab args.
	let { destDir, fileName, utilName, utilSource } = arg;

	// Grab prerequisites.
	let dashArtifact = await bootstrap.shell({ host });
	let toolchainArtifact = await bootstrap.toolchain({ host });
	let macOsSdk = await bootstrap.macOsSdk();

	// Compile the util.
	let script =
		arg.script ??
		(await tg`
			cc -Oz -o $OUTPUT ${utilSource}/${fileName}
		`);

	let dependencies = [toolchainArtifact, dashArtifact];

	let util = tg.File.expect(
		await tg.build(await tg.template(script), {
			host: std.triple.archAndOs(build),
			env: std.env.object([
				arg.env ?? {},
				{
					SDKROOT: macOsSdk,
				},
				...dependencies,
			]),
		}),
	);

	// Combine with destination.
	return tg.directory(destDir, {
		[`bin/${utilName}`]: util,
	});
};
