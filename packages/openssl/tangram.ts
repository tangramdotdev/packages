import * as perl from "perl" with { path: "../perl" };
import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://openssl.org/",
	license: "Apache-2.0",
	name: "openssl",
	repository: "https://github.com/openssl/openssl",
	version: "3.3.2",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:2e8a40b01979afe8be0bbfb3de5dc1c6709fedb46d6c89c10da114ab5fc3d281";
	const owner = name;
	const repo = name;
	const tag = `${name}-${version}`;
	return std.download.fromGithub({
		checksum,
		owner,
		repo,
		source: "release",
		tag,
		version,
	});
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		perl?: perl.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: { perl: perlArg = {} } = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);
	const sourceDir = source_ ?? source();

	const { arch: hostArch, os: hostOs } = std.triple.components(host);
	const osCompiler =
		hostOs === "darwin"
			? hostArch === "aarch64"
				? `darwin64-arm64`
				: `darwin64-${hostArch}`
			: `${hostOs}-${hostArch}`;
	const configure = {
		command: tg`perl ./Configure ${osCompiler}`,
		args: ["--libdir=lib"],
	};
	if (build !== host) {
		configure.args.push(`--cross-compile-prefix=${host}-`);
	}
	// NOTE: The full `make install` consists of three steps. The final step installs documentation and take a disproportionately long time. We just build the first two steps to avoid this.
	const install = {
		args: tg.Mutation.set(["install_sw", "install_ssldirs"]),
	};
	const phases = { configure, install };

	const env = [perl.build({ build, host: build }, perlArg), env_];

	if (build !== host) {
		// To ensure the cross-compile prefix picks up the correct cross compilers.
		env.push({
			CC: "cc",
			CXX: "c++",
		});
	}

	const openssl = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			buildInTree: true,
			defaultCrossArgs: false,
			defaultCrossEnv: false,
			env: std.env.arg(env),
			phases,
			sdk,
			source: sourceDir,
		},
		autotools,
	);

	return tg.directory(openssl, {
		["bin/openssl"]: std.wrap(
			tg.File.expect(await openssl.get("bin/openssl")),
			{
				identity: "wrapper",
				libraryPaths: [tg.symlink(tg`${openssl}/lib`)],
				host,
			},
		),
		["share/pkgconfig"]: tg.symlink("../lib/pkgconfig"),
	});
});

export default build;

export const test = tg.target(async () => {
	const source = tg.directory({
		["main.c"]: tg.file(`
			#include <stdio.h>
			int main () {}
		`),
	});

	const sdkArg: std.sdk.Arg = { toolchain: "llvm" };

	return await $`
		 	echo "Checking if we can run openssl"
			openssl --version
			echo "Checking if we can link against libssl."
			cc ${source}/main.c -o $OUTPUT -lssl -lcrypto
		`.env(std.sdk(sdkArg), build({ sdk: sdkArg }));
});
