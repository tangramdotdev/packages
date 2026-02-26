import * as std from "std" with { local: "../std" };
import { $ } from "std" with { local: "../std" };

import * as libffi from "libffi" with { local: "../libffi.tg.ts" };
import * as gmp from "gmp" with { local: "../gmp" };
import * as libyaml from "libyaml" with { local: "../libyaml.tg.ts" };
import * as ncurses from "ncurses" with { local: "../ncurses.tg.ts" };
import * as openssl from "openssl" with { local: "../openssl.tg.ts" };
import * as readline from "readline" with { local: "../readline.tg.ts" };
import * as rust from "rust" with { local: "../rust" };
import * as zlib from "zlib-ng" with { local: "../zlib-ng.tg.ts" };

import * as bootstrap from "./bootstrap.tg.ts";

import skipUpdateGems from "./0001-skip-update-gems.patch" with { type: "file" };

export const metadata = {
	homepage: "https://www.ruby-lang.org/",
	name: "ruby",
	license: "BSD-2-Clause",
	repository: "https://git.ruby-lang.org/ruby.git",
	version: "4.0.1",
	tag: "ruby/4.0.1",
	provides: {
		binaries: [
			"bundle",
			"bundler",
			"erb",
			"gem",
			"irb",
			"racc",
			"rdoc",
			"ruby",
			"ri",
		],
	},
};

export const source = async () => {
	const { version } = metadata;
	const checksum =
		"sha256:3924be2d05db30f4e35f859bf028be85f4b7dd01714142fd823e4af5de2faf9d";
	const extension = ".tar.gz";
	const majorMinor = version.split(".").slice(0, 2).join(".");
	const url = `https://cache.ruby-lang.org/pub/ruby/${majorMinor}/ruby-${version}${extension}`;
	return std.download
		.extractArchive({ url, checksum })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = std.autotools.Arg & {
	dependencies?: {
		gmp?: gmp.Arg;
		libffi?: libffi.Arg;
		libyaml?: libyaml.Arg;
		ncurses?: ncurses.Arg;
		openssl?: openssl.Arg;
		readline?: readline.Arg;
		zlib?: zlib.Arg;
	};
};

export const self = async (...args: std.Args<Arg>) => {
	// Extract custom dependency options.
	const {
		dependencies: {
			gmp: gmpArg = {},
			libffi: libffiArg = {},
			libyaml: libyamlArg = {},
			ncurses: ncursesArg = {},
			openssl: opensslArg = {},
			readline: readlineArg = {},
			zlib: zlibArg = {},
		} = {},
	} = await std.args.apply<Arg, Arg>({
		args,
		map: async (arg) => arg,
		reduce: {},
	});

	// Resolve autotools args to get build/host.
	const arg = await std.autotools.arg(
		{
			source: source(),
		},
		...args,
	);

	const { build, host } = arg;

	// We need to skip the makefile step that attempts to update any .gem files in the bundle and replace them with the .gems we download ourself.
	const sourceDir = await std.patch(arg.source, skipUpdateGems);

	// Build dependencies.
	const gmpArtifact = gmp.build({ build, host }, gmpArg);
	const libYamlArtifact = libyaml.build({ build, host }, libyamlArg);
	const depsEnv = [
		gmpArtifact,
		libffi.build({ build, host }, libffiArg),
		libYamlArtifact,
		ncurses.build({ build, host }, ncursesArg),
		openssl.build({ build, host }, opensslArg),
		readline.build({ build, host }, readlineArg),
		rust.self({ host: build, target: build }),
		zlib.build({ build, host }, zlibArg),
		// Ruby requires an existing Ruby to build, so we pull in an older version.
		bootstrap.ruby(build),
	];

	// Build ruby.
	const ruby = await std.autotools.build({
		...arg,
		source: sourceDir,
		env: std.env.arg(arg.env, ...depsEnv),
		phases: {
			configure: {
				args: [
					// Skip documentation.
					"--disable-install-doc",
					// Enable optimized bignum.
					tg`--with-gmp-dir=${gmpArtifact}`,
					// Required for `psych` to work with rdoc.
					tg`--with-opt-dir=${libYamlArtifact}`,
					// Work around glibc 2.43 qsort_r incompatibility.
					"ac_cv_func_qsort_r=no",
				],
			},
		},
	});

	// Create the RUBYLIB environment variable.
	let { arch: hostArch, os: hostOs } = std.triple.components(host);
	const os = std.triple.os(host);
	if (os === "darwin") {
		if (hostArch === "aarch64") {
			hostArch = "arm64";
		}
		hostOs = "darwin24.5.0";
	}
	const version = libraryVersion(metadata.version);
	const libs = [
		tg`${ruby}/lib/ruby/site_ruby/${version}`,
		tg`${ruby}/lib/ruby/site_ruby/${version}/${hostArch}-${hostOs}`,
		tg`${ruby}/lib/ruby/site_ruby`,
		tg`${ruby}/lib/ruby/vendor_ruby/${version}`,
		tg`${ruby}/lib/ruby/vendor_ruby/${version}/${hostArch}-${hostOs}`,
		tg`${ruby}/lib/ruby/vendor_ruby`,
		tg`${ruby}/lib/ruby/${version}`,
		tg`${ruby}/lib/ruby/${version}/${hostArch}-${hostOs}`,
	];
	const rubylib = tg.Template.join(":", ...(await Promise.all(libs)));

	// Create the GEM_PATH, GEM_HOME environment variable.
	const gems = [tg`${ruby}/lib/ruby/gems/${version}`];
	const gemPath = tg.Template.join(":", ...(await Promise.all(gems)));

	// Create the env used for wrapping ruby bins.
	const env = std.env.arg({
		RUBYLIB: rubylib,
		GEM_PATH: gemPath,
		GEM_HOME: gemPath,
	});

	// Wrap Ruby itself.
	const unwrapped = ruby.get("bin/ruby").then(tg.File.expect);
	const rubyBin = std.wrap({
		executable: unwrapped,
		env,
	});

	// Wrap the other binaries provided by ruby.
	const binNames = [
		"bundle",
		"bundler",
		"erb",
		"gem",
		"irb",
		"racc",
		"rdoc",
		"ri",
	];
	let bin = tg.directory();
	for (const name of binNames) {
		bin = tg.directory(bin, {
			[name]: std.wrap({
				env: std.env.arg(libYamlArtifact),
				executable: tg.symlink(tg`${ruby}/bin/${name}`),
				interpreter: rubyBin,
			}),
		});
	}

	// Return an artifact containing the Ruby bin and symlinks to include/lib dirs.
	return tg.directory({
		bin: tg.directory(bin, { ["ruby"]: rubyBin }),
		include: tg.symlink(tg`${ruby}/include`),
		lib: tg.symlink(tg`${ruby}/lib`),
	});
};

export default self;

export type DownloadGemArg = {
	/** The name of the gem. */
	name: string;

	/** The version of the gem. */
	version: string;

	/** The checksum of the .gem file itself. */
	checksum: tg.Checksum;
};

/** Download and extract a .gem file from rubygems.org. */
export const downloadGem = (arg: DownloadGemArg) => {
	const gemFile = std
		.download({
			url: `https://rubygems.org/downloads/${arg.name}-${arg.version}.gem`,
			checksum: arg.checksum,
		})
		.then((b) => tg.file(b as tg.Blob));

	return tg.directory({
		[`${arg.name}-${arg.version}.gem`]: gemFile,
	});
};

/** Libraries are installed under `x.y.0`. */
const libraryVersion = (version: string) => {
	const [major, minor] = version.split(".");
	return `${major}.${minor}.0`;
};

/** These are the gems required by the ruby build itself and installed by default. See `https://stdgems.org`. */
const bundledGems = (): Promise<tg.Directory> => {
	const args: Array<{ name: string; version: string; checksum: tg.Checksum }> =
		[
			{
				name: "minitest",
				version: "5.27.0",
				checksum:
					"sha256:2d3b17f8a36fe7801c1adcffdbc38233b938eb0b4966e97a6739055a45fa77d5",
			},
			{
				name: "power_assert",
				version: "3.0.1",
				checksum:
					"sha256:8ce9876716cc74e863fcd4cdcdc52d792bd983598d1af3447083a3a9a4d34103",
			},
			{
				name: "rake",
				version: "13.3.1",
				checksum:
					"sha256:8c9e89d09f66a26a01264e7e3480ec0607f0c497a861ef16063604b1b08eb19c",
			},
			{
				name: "test-unit",
				version: "3.7.3",
				checksum:
					"sha256:242e22c6df990f11fb6abc2507a238f80810a903291f90d8573261554488175e",
			},
			{
				name: "rexml",
				version: "3.4.4",
				checksum:
					"sha256:19e0a2c3425dfbf2d4fc1189747bdb2f849b6c5e74180401b15734bc97b5d142",
			},
			{
				name: "rss",
				version: "0.3.1",
				checksum:
					"sha256:b46234c04551b925180f8bedfc6f6045bf2d9998417feda72f300e7980226737",
			},
			{
				name: "net-ftp",
				version: "0.3.9",
				checksum:
					"sha256:307817ccf7f428f79d083f7e36dbb46a9d1d375e0d23027824de1866f0b13b65",
			},
			{
				name: "net-imap",
				version: "0.6.1",
				checksum:
					"sha256:f99e94075bc760a6aca0d8ca636fd34422127203b4d19e801f0e0ff08b3a285a",
			},
			{
				name: "net-pop",
				version: "0.1.2",
				checksum:
					"sha256:848b4e982013c15b2f0382792268763b748cce91c9e91e36b0f27ed26420dff3",
			},
			{
				name: "net-smtp",
				version: "0.5.1",
				checksum:
					"sha256:ed96a0af63c524fceb4b29b0d352195c30d82dd916a42f03c62a3a70e5b70736",
			},
			{
				name: "matrix",
				version: "0.4.3",
				checksum:
					"sha256:a0d5ab7ddcc1973ff690ab361b67f359acbb16958d1dc072b8b956a286564c5b",
			},
			{
				name: "prime",
				version: "0.1.4",
				checksum:
					"sha256:4d755ebf7c2994a6f3a3fee0d072063be3fff2d4042ebff6cd5eebd4747a225e",
			},
		];

	return tg.directory(...args.map(downloadGem));
};

export const test = async () => {
	const hasVersion = (name: string, version: string) =>
		std.assert.binary(name, { snapshot: version });

	const binaries = [
		hasVersion("bundle", "4.0.3"),
		hasVersion("bundler", "4.0.3"),
		hasVersion("erb", "6.0.1"),
		hasVersion("gem", "4.0.3"),
		hasVersion("irb", "1.16.0"),
		hasVersion("racc", "1.8.1"),
		hasVersion("rdoc", "7.0.3"),
		hasVersion("ruby", metadata.version),
		hasVersion("ri", "7.0.3"),
	];
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries,
	};
	await std.assert.pkg(self, spec);

	const output = await $`ruby -e 'puts "Hello, tangram!"' > ${tg.output}`
		.env(self())
		.then(tg.File.expect)
		.then((f) => f.text)
		.then((t) => t.trim());
	tg.assert(output.includes("Hello, tangram!"));

	return true;
};
