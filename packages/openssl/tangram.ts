import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://openssl.org/",
	license: "Apache-2.0",
	name: "openssl",
	repository: "https://github.com/openssl/openssl",
	version: "3.5.0",
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:344d0a79f1a9b08029b0744e2cc401a43f9c90acd1044d09a530b4885a8e9fc0";
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
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);
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

	const env = [env_];

	if (build !== host) {
		// To ensure the cross-compile prefix picks up the correct cross compilers.
		env.unshift({
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
			env: std.env.arg(...env),
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
};

export default build;

export const test = async () => {
	// FIXME spec
	const source = tg.directory({
		["main.c"]: tg.file`
			#include <stdio.h>
			int main () {}
		`,
	});

	const output = await $`
		 	echo "Checking if we can run openssl"
		 	mkdir -p $OUTPUT
			openssl --version | tee -a $OUTPUT/version.txt
			echo "Checking if we can link against libssl."
			cc ${source}/main.c -o $OUTPUT/prog -lssl -lcrypto
		`
		.pipefail(false)
		.env(std.sdk())
		.env(build())
		.then(tg.Directory.expect);

	const text = await output
		.get("version.txt")
		.then(tg.File.expect)
		.then((f) => f.text());
	tg.assert(text.includes(metadata.version));

	return true;
};
