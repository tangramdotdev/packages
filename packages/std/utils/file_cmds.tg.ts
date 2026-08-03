import * as std from "../tangram.ts";

export const metadata = {
	name: "file_cmds",
	version: "479",
	tag: "file_cmds/479",
};

export async function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:999c5e6f24b26587aaec996b7ebcca5d6e668f9319667331ebcaf2ac1a5ac7bb";
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
}

export type Arg = {
	build?: string | null;
	env?: std.env.Arg | null;
	host?: string | null;
	sdk?: std.sdk.Arg | boolean | null;
	source?: tg.Directory | null;
};

/** Produce `cp`, `install`, and `xattr` executables that preserve xattrs on macOS, to include with the coreutils. */
export async function macOsXattrCmds(arg?: tg.Unresolved<Arg>) {
	const resolved = arg !== undefined ? await tg.resolve(arg) : undefined;
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
}

export default macOsXattrCmds;

type UtilArg = Arg & {
	destDir: tg.Directory;
	extraArgs?: Array<tg.Template.Arg>;
	fileName: string;
	utilSource: tg.Directory;
	utilName: string;
};

export async function compileUtil(arg: tg.Unresolved<UtilArg>) {
	const resolved = await tg.resolve(arg);
	tg.assert(resolved.env);
	const { destDir, extraArgs = [], fileName, utilName, utilSource } = resolved;
	const build = resolved.build ?? std.triple.host();
	const host = build;

	// Compile the util using std.build with bootstrap mode.
	const util = await std
		.build(std.shBootstrap`
			cc -Oz ${tg.Template.join(" ", ...extraArgs)} -o ${tg.output} ${utilSource}/${fileName}`)
		.env(resolved.env)
		.host(host)
		.then(tg.File.expect);

	// Combine with destination.
	return tg.directory(destDir, {
		[`bin/${utilName}`]: util,
	});
}
