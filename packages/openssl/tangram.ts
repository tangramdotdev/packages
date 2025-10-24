import * as std from "std" with { local: "../std" };

export const metadata = {
	homepage: "https://openssl.org/",
	license: "Apache-2.0",
	name: "openssl",
	repository: "https://github.com/openssl/openssl",
	version: "3.5.4",
	tag: "openssl/3.5.4",
	provides: {
		binaries: ["openssl"],
		libraries: ["crypto", "ssl"],
	},
};

export const source = async () => {
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
	} else if (sdk && sdk.toolchain === "llvm") {
		env.unshift({ CC: "clang", CXX: "clang++" });
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
		["share/pkgconfig"]: tg.symlink("../lib/pkgconfig"),
	});
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
