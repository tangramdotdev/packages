import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://zlib.net",
	license: "https://zlib.net/zlib_license.html",
	name: "zlib",
	version: "1.3.1",
	tag: "zlib/1.3.1",
	provides: {
		docs: ["man/man3/zlib.3"],
		libraries: [{ name: "z", pkgConfigName: "zlib" }],
	},
};

export const source = async () => {
	const { homepage, name, version } = metadata;
	const checksum =
		"sha256:38ef96b8dfe510d42707d9c781877914792541133e1870841463bfa73f883e32";
	const extension = ".tar.xz";
	return std.download
		.extractArchive({ checksum, base: homepage, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = std.autotools.Arg;

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg(
		{ source: source(), defaultCrossArgs: false, defaultCrossEnv: false },
		...args,
	);

	const os = std.triple.os(arg.host);

	// Build package-specific env defaults (lower precedence than user env).
	const packageEnv: std.env.Arg = {};

	// On Linux with LLVM, we need to add -Wl,-undefined-version to CFLAGS to build the shared library.
	// https://github.com/zlib-ng/zlib-ng/issues/1427
	if (os === "linux" && arg.sdk?.toolchain === "llvm") {
		packageEnv.CFLAGS = await tg.Mutation.prefix("-Wl,-undefined-version", " ");
	}

	// Zlib does not pick up the cross toolchain automatically, set CC.
	if (os === "linux" && arg.build !== arg.host) {
		packageEnv.CC = `${arg.host}-cc`;
	}

	return std.autotools.build({
		...arg,
		env: std.env.arg(packageEnv, arg.env),
	});
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
