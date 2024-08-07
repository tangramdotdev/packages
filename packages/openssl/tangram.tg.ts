import * as perl from "tg:perl" with { path: "../perl" };
import * as std from "tg:std" with { path: "../std" };
import { $ } from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://openssl.org/",
	license: "Apache-2.0",
	name: "openssl",
	repository: "https://github.com/openssl/openssl",
	version: "3.3.1",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:777cd596284c883375a2a7a11bf5d2786fc5413255efab20c50d6ffe6d020b7e";
	let owner = name;
	let repo = name;
	let tag = `${name}-${version}`;
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

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		dependencies: { perl: perlArg = {} } = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);
	let sourceDir = source_ ?? source();

	let { arch: hostArch, os: hostOs } = std.triple.components(host);
	let osCompiler =
		hostOs === "darwin"
			? hostArch === "aarch64"
				? `darwin64-arm64`
				: `darwin64-${hostArch}`
			: `${hostOs}-${hostArch}`;
	let configure = {
		command: tg`perl ./Configure ${osCompiler}`,
		args: ["--libdir=lib"],
	};
	if (build !== host) {
		configure.args.push(`--cross-compile-prefix=${host}-`);
	}
	// NOTE: The full `make install` consists of three steps. The final step installs documentation and take a disproportionately long time. We just build the first two steps to avoid this.
	let install = {
		args: tg.Mutation.set(["install_sw", "install_ssldirs"]),
	};
	let phases = { configure, install };

	let env = [perl.build({ build, host: build }, perlArg), env_];

	if (build !== host) {
		// To ensure the cross-compile prefix picks up the correct cross compilers.
		env.push({
			CC: "cc",
			CXX: "c++",
		});
	}

	let openssl = await std.autotools.build(
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
	console.log("openssl", await openssl.id());

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

export let test = tg.target(async () => {
	let source = tg.directory({
		["main.c"]: tg.file(`
			#include <stdio.h>
			int main () {}
		`),
	});

	let sdkArg: std.sdk.Arg = { toolchain: "llvm" };

	return await $`
		 	echo "Checking if we can run openssl"
			openssl --version
			echo "Checking if we can link against libssl."
			cc ${source}/main.c -o $OUTPUT -lssl -lcrypto
		`.env(std.sdk(sdkArg), build({ sdk: sdkArg }));
});
