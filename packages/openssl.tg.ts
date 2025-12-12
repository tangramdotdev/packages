import * as perl from "perl" with { local: "./perl" };
import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://openssl.org/",
	license: "Apache-2.0",
	name: "openssl",
	repository: "https://github.com/openssl/openssl",
	version: "3.5.4",
	tag: "openssl/3.5.4",
	provides: {
		binaries: ["c_rehash", "openssl"],
		libraries: ["crypto", "ssl"],
	},
};

const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:967311f84955316969bdb1d8d4b983718ef42338639c621ec4c34fddef355e99";
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

export type Arg = std.autotools.Arg;

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg(
		{
			source: source(),
			buildInTree: true,
			defaultCrossArgs: false,
			defaultCrossEnv: false,
		},
		...args,
	);

	// Build the OS/arch-specific configure command.
	const { arch: hostArch, os: hostOs } = std.triple.components(arg.host);
	const osCompiler =
		hostOs === "darwin"
			? hostArch === "aarch64"
				? "darwin64-arm64"
				: `darwin64-${hostArch}`
			: `${hostOs}-${hostArch}`;

	const configureArgs = ["--libdir=lib"];
	if (arg.build !== arg.host) {
		configureArgs.push(`--cross-compile-prefix=${arg.host}-`);
	}

	let phases = std.phases.mergePhases(arg.phases, {
		configure: {
			command: tg`perl ./Configure ${osCompiler}`,
			args: configureArgs,
		},
		// NOTE: The full `make install` consists of three steps. The final step installs documentation and takes a disproportionately long time. We just build the first two steps to avoid this.
		install: `make install_sw install_ssldirs`,
	});

	// Build package-specific env defaults (lower precedence than user env).
	const packageEnv: std.env.Arg = {};
	if (arg.build !== arg.host) {
		// To ensure the cross-compile prefix picks up the correct cross compilers.
		packageEnv.CC = "cc";
		packageEnv.CXX = "c++";
	} else if (arg.sdk?.toolchain === "llvm") {
		packageEnv.CC = "clang";
		packageEnv.CXX = "clang++";
	}

	const output = await std.autotools.build({
		...arg,
		phases,
		env: std.env.arg(packageEnv, arg.env),
	});

	// Wrap the `c_rehash` perl script.
	const perlArtifact = await perl.build({
		build: arg.build,
		host: arg.host,
		sdk: arg.sdk,
	});
	const perlInterpreter = await tg.symlink({
		artifact: perlArtifact,
		path: "bin/perl",
	});
	const origCRehash = output.get("bin/c_rehash").then(tg.File.expect);

	return tg.directory(output, {
		["bin/c_rehash"]: std.wrap(origCRehash, { interpreter: perlInterpreter }),
		["share/pkgconfig"]: tg.symlink("../lib/pkgconfig"),
	});
};

export default build;

export const test = async () => {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.binaries(metadata.provides.binaries, {
			c_rehash: { testArgs: ["-h"], snapshot: "Usage: c_rehash" },
		}),
	};
	return await std.assert.pkg(build, spec);
};
