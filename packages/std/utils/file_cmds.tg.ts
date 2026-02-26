import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";

export const metadata = {
	name: "file_cmds",
	version: "457.120.3",
	tag: "file_cmds/457.120.3",
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:0a3f9b5bbf4dcd3d7a2f76f3fb4f0671eadaa0603341ef6be34796f847c9a5fa";
	const owner = "apple-oss-distributions";
	const repo = "file_cmds";
	const tag = std.download.packageName({ name, version });
	return std.download.fromGithub({
		checksum,
		source: "tag",
		owner,
		repo,
		tag,
	});
};

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

/** Produce `cp`, `install`, and `xattr` executables that preserve xattrs on macOS, to include with the coreutils. */
export const macOsXattrCmds = async (arg?: tg.Unresolved<Arg>) => {
	const resolved = await tg.resolve(arg);
	const build = resolved?.build ?? std.triple.host();
	const os = std.triple.os(build);

	// Assert that the system is macOS.
	if (os !== "darwin") {
		throw new Error(`fileCmds is only supported on macOS, detected ${os}.`);
	}

	const sourceDir = await source();

	let result = await tg.directory({
		bin: tg.directory(),
	});

	// cp (cp.c + utils.c, needs include path for pathnames.h)
	const cpSource = tg.Directory.expect(await sourceDir.get("cp"));
	result = await compileUtil({
		...resolved,
		destDir: result,
		extraArgs: [tg`-I${cpSource}`, tg`${cpSource}/utils.c`],
		fileName: "cp.c",
		utilSource: cpSource,
		utilName: "cp",
	});

	// install
	result = await compileUtil({
		...resolved,
		destDir: result,
		extraArgs: ["-UTARGET_OS_OSX"],
		fileName: "xinstall.c",
		utilSource: tg.Directory.expect(await sourceDir.get("install")),
		utilName: "install",
	});

	// xattr
	result = await compileUtil({
		...resolved,
		destDir: result,
		fileName: "xattr.c",
		utilSource: tg.Directory.expect(await sourceDir.get("xattr")),
		utilName: "xattr",
	});

	return result;
};

export default macOsXattrCmds;

type UtilArg = Arg & {
	destDir: tg.Directory;
	extraArgs?: Array<tg.Template.Arg>;
	fileName: string;
	utilSource: tg.Directory;
	utilName: string;
};

export const compileUtil = async (arg: tg.Unresolved<UtilArg>) => {
	const resolved = await tg.resolve(arg);
	tg.assert(resolved.env);
	const { destDir, extraArgs = [], fileName, utilName, utilSource } = resolved;
	const build = resolved.build ?? std.triple.host();
	const host = build;

	// Get the shell from the bootstrap directly.
	const shell = await bootstrap.shell(build);
	const shellExecutable = await shell.get("bin/dash").then(tg.File.expect);

	// Compile the util using std.build with bootstrap mode.
	const util = await std.build`
			cc -Oz ${tg.Template.join(" ", ...extraArgs)} -o ${tg.output} ${utilSource}/${fileName}`
		.bootstrap(true)
		.executable(shellExecutable)
		.env(resolved.env)
		.host(host)
		.then(tg.File.expect);

	// Combine with destination.
	return tg.directory(destDir, {
		[`bin/${utilName}`]: util,
	});
};
