import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.ts";

export const metadata = {
	name: "Python",
	version: "3.13.0",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const checksum =
		"sha256:086de5882e3cb310d4dca48457522e2e48018ecd43da9cdf827f6a0759efb07d";
	const base = `https://www.python.org/ftp/python/${version}`;
	return await std
		.download({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

export const build = tg.target(async (arg?: Arg) => {
	const {
		autotools = {},
		build: build_,
		env,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};

	const host = host_ ?? (await std.triple.host());
	const build = build_ ?? host;
	const os = std.triple.os(build);

	const configure = {
		args: [
			"--disable-test-modules",
			"--with-ensurepip=no",
			"--without-c-locale-coercion",
			"--without-readline",
		],
	};

	const phases = { configure };

	const providedCc = await std.env.tryGetKey({ env, key: "CC" });
	if (providedCc) {
		configure.args.push(`CC="$CC"`);
	}

	// Build python.
	const result = std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases,
			sdk,
			setRuntimeLibraryPath: true,
			source: source_ ?? source(),
		},
		autotools,
	);

	return result;
});

export default build;

export const test = tg.target(async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const sdkArg = await bootstrap.sdk.arg(host);
	await std.assert.pkg({ buildFn: build, binaries: ["python3"], metadata });
	return true;
});
