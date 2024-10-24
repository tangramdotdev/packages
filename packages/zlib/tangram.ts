import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://zlib.net",
	license: "https://zlib.net/zlib_license.html",
	name: "zlib",
	version: "1.3.1",
};

export const source = tg.target(async () => {
	const { homepage, name, version } = metadata;
	const checksum =
		"sha256:38ef96b8dfe510d42707d9c781877914792541133e1870841463bfa73f883e32";
	const extension = ".tar.xz";
	return std
		.download({ checksum, base: homepage, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	const os = std.triple.os(host);

	const env: Array<tg.Unresolved<std.env.Arg>> = [];

	// On Linux with LLVM, we need to add -Wl,-undefined-version to CFLAGS to build the shared library.
	// https://github.com/zlib-ng/zlib-ng/issues/1427
	if (
		os === "linux" &&
		((await std.env.tryWhich({ env: env_, name: "clang" })) !== undefined ||
			std.flatten(sdk).filter((sdk) => sdk?.toolchain === "llvm").length > 0)
	) {
		env.push({
			CFLAGS: tg.Mutation.prefix("-Wl,-undefined-version", " "),
		});
	}
	env.push(env_);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			defaultCrossArgs: false,
			defaultCrossEnv: false,
			env: std.env.arg(env),
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default default_;

export const test = tg.target(async () => {
	await std.assert.pkg({
		packageDir: default_(),
		docs: ["man/man3/zlib.3"],
		pkgConfigName: "zlib",
		libraries: ["z"],
	});
	return true;
});
