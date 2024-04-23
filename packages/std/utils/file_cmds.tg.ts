import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.tg.ts";

export let metadata = {
	name: "file_cmds",
	version: "430.100.5",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:035272979817edb250e3527b95a028e59b5bff546a13346c4a4e0e83c4d7ac20";
	let owner = "apple-oss-distributions";
	let repo = "file_cmds";
	let tag = std.download.packageName({ name, version });
	return std.download.fromGithub({
		checksum,
		source: "tag",
		owner,
		repo,
		tag,
	});
});

type Arg = std.sdk.BuildEnvArg;

/** Produce an `install` executable that preserves xattrs on macOS, alongside the `xattr` command, to include with the coreutils. */
export let macOsXattrCmds = tg.target(async (arg?: Arg) => {
	let build = arg?.build ?? (await std.triple.host());
	let os = std.triple.os(build);

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
	let build = arg.build ?? (await std.triple.host());
	let host = build;

	// Grab args.
	let { destDir, fileName, utilName, utilSource } = arg;

	// Grab prerequisites.
	let dashArtifact = await bootstrap.shell(host);
	let toolchainArtifact = await bootstrap.toolchain(host);
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
