import * as bootstrap from "../bootstrap.tg.ts";
import * as std from "../tangram.ts";

export const metadata = {
	name: "file_cmds",
	version: "430.100.5",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:035272979817edb250e3527b95a028e59b5bff546a13346c4a4e0e83c4d7ac20";
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
});

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

/** Produce an `install` executable that preserves xattrs on macOS, alongside the `xattr` command, to include with the coreutils. */
export const macOsXattrCmds = tg.target(async (arg?: Arg) => {
	const build = arg?.build ?? (await std.triple.host());
	const os = std.triple.os(build);

	// Assert that the system is macOS.
	if (os !== "darwin") {
		throw new Error(`fileCmds is only supported on macOS, detected ${os}.`);
	}

	const sourceDir = await source();

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

type UtilArg = Arg & {
	destDir: tg.Directory;
	fileName: string;
	utilSource: tg.Directory;
	utilName: string;
	script?: tg.Template.Arg;
};

export const compileUtil = async (arg: UtilArg) => {
	const build = arg.build ?? (await std.triple.host());
	const host = build;

	// Grab args.
	const { destDir, fileName, utilName, utilSource } = arg;

	// Grab prerequisites.
	const dashArtifact = await bootstrap.shell(host);
	const toolchainArtifact = await bootstrap.toolchain(host);
	const macOsSdk = await bootstrap.macOsSdk();

	// Compile the util.
	const script =
		arg.script ??
		(await tg`
			cc -Oz -o $OUTPUT ${utilSource}/${fileName}
		`);

	const dependencies = [toolchainArtifact, dashArtifact];

	const util = tg.File.expect(
		await (
			await tg.target(await tg.template(script), {
				host: std.triple.archAndOs(build),
				env: std.env.arg(
					arg.env ?? {},
					{
						SDKROOT: macOsSdk,
					},
					...dependencies,
				),
			})
		).output(),
	);

	// Combine with destination.
	return tg.directory(destDir, {
		[`bin/${utilName}`]: util,
	});
};
