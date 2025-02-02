import * as bootstrap from "../../bootstrap.tg.ts";
import * as std from "../../tangram.ts";

export const metadata = {
	name: "Python",
	version: "3.13.1",
};

export const source = tg.command(async () => {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const checksum =
		"sha256:9cf9427bee9e2242e3877dd0f6b641c1853ca461f39d6503ce260a59c80bf0d9";
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

export const build = tg.command(async (arg?: Arg) => {
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

export const test = tg.command(async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const sdkArg = await bootstrap.sdk.arg(host);
	// FIXME
	// await std.assert.pkg({ buildFn: build, binaries: ["python3"], metadata });
	return true;
});
