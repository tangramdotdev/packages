import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };

import * as libffi from "libffi" with { path: "../libffi" };
import * as gmp from "gmp" with { path: "../gmp" };
import * as libyaml from "libyaml" with { path: "../libyaml" };
import * as ncurses from "ncurses" with { path: "../ncurses" };
import * as openssl from "openssl" with { path: "../openssl" };
import * as readline from "readline" with { path: "../readline" };
import * as rust from "rust" with { path: "../rust" };
import * as zlib from "zlib" with { path: "../zlib" };

import * as bootstrap from "./bootstrap.tg.ts";

import skipUpdateGems from "./0001-skip-update-gems.patch" with {
	type: "file",
};

export const metadata = {
	homepage: "https://www.ruby-lang.org/",
	name: "ruby",
	license: "BSD-2-Clause",
	repository: "https://git.ruby-lang.org/ruby.git",
	version: "3.4.1",
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
		"sha256:3d385e5d22d368b064c817a13ed8e3cc3f71a7705d7ed1bae78013c33aa7c87f";
	const extension = ".tar.gz";
	const majorMinor = version.split(".").slice(0, 2).join(".");
	const url = `https://cache.ruby-lang.org/pub/ruby/${majorMinor}/ruby-${version}${extension}`;
	return std.download
		.extractArchive({ url, checksum })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = {
	autotools?: std.autotools.Arg;
	dependencies?: {
		gmp?: gmp.Arg;
		libffi?: libffi.Arg;
		libyaml?: libyaml.Arg;
		ncurses?: ncurses.Arg;
		openssl?: openssl.Arg;
		readline?: readline.Arg;
		zlib?: zlib.Arg;
	};
	env?: std.env.Arg;
	source?: tg.Directory;
	build?: string;
	host?: string;
};

export const self = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		dependencies: {
			gmp: gmpArg = {},
			libffi: libffiArg = {},
			libyaml: libyamlArg = {},
			ncurses: ncursesArg = {},
			openssl: opensslArg = {},
			readline: readlineArg = {},
			zlib: zlibArg = {},
		} = {},
		env: env_,
		source: source_,
		build,
		host,
	} = await std.packages.applyArgs<Arg>(...args);

	// Get the source code.
	let sourceDir = source_ ?? (await source());

	// We need to skip the makefile step that attempts to update any .gem files in the bundle and replace them with the .gems we download ourself.
	sourceDir = await std.patch(sourceDir, skipUpdateGems);

	const gmpArtifact = gmp.build({ build, host }, gmpArg);
	const libYamlArtifact = libyaml.build({ build, host }, libyamlArg);
	const deps = [
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
	const ruby = await std.autotools.build(
		{
			source: sourceDir,
			env: std.env.arg(...deps, env_),
			phases: {
				configure: {
					args: [
						// Skip documentation.
						"--disable-install-doc",
						// Enable optimized bignum.
						tg`--with-gmp-dir=${gmpArtifact}`,
						// Required for `psych` to work with rdoc.
						tg`--with-opt-dir=${libYamlArtifact}`,
					],
				},
			},
			...(await std.triple.rotate({ build, host })),
		},
		autotools,
	);

	// Create the RUBYLIB environment variable.
	let { arch: hostArch, os: hostOs } = std.triple.components(host);
	const os = std.triple.os(host);
	if (os === "darwin") {
		if (hostArch === "aarch64") {
			hostArch = "arm64";
		}
		hostOs = "darwin24.2.0";
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
	const rubyBin = std.wrap({
		executable: tg.symlink(tg`${ruby}/bin/ruby`),
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
				version: "5.25.4",
				checksum:
					"sha256:9cf2cae25ac4dfc90c988ebc3b917f53c054978b673273da1bd20bcb0778f947",
			},
			{
				name: "power_assert",
				version: "2.0.5",
				checksum:
					"sha256:63b511b85bb8ea57336d25156864498644f5bbf028699ceda27949e0125bc323",
			},
			{
				name: "rake",
				version: "13.2.1",
				checksum:
					"sha256:46cb38dae65d7d74b6020a4ac9d48afed8eb8149c040eccf0523bec91907059d",
			},
			{
				name: "test-unit",
				version: "3.6.7",
				checksum:
					"sha256:c342bb9f7334ea84a361b43c20b063f405c0bf3c7dbe3ff38f61a91661d29221",
			},
			{
				name: "rexml",
				version: "3.4.0",
				checksum:
					"sha256:efbea1efba7fa151158e0ee1e643525834da2d8eb4cf744aa68f6480bc9804b2",
			},
			{
				name: "rss",
				version: "0.3.1",
				checksum:
					"sha256:b46234c04551b925180f8bedfc6f6045bf2d9998417feda72f300e7980226737",
			},
			{
				name: "net-ftp",
				version: "0.3.8",
				checksum:
					"sha256:28d63e407a7edb9739c320a4faaec515e43e963815248d06418aba322478874f",
			},
			{
				name: "net-imap",
				version: "0.5.4",
				checksum:
					"sha256:b665d23a4eeea6af725a9bda0e3dbb65f06b7907e7a3986c1bbcc5d09444599d",
			},
			{
				name: "net-pop",
				version: "0.1.2",
				checksum:
					"sha256:848b4e982013c15b2f0382792268763b748cce91c9e91e36b0f27ed26420dff3",
			},
			{
				name: "net-smtp",
				version: "0.5.0",
				checksum:
					"sha256:5fc0415e6ea1cc0b3dfea7270438ec22b278ca8d524986a3ae4e5ae8d087b42a",
			},
			{
				name: "matrix",
				version: "0.4.2",
				checksum:
					"sha256:71083ccbd67a14a43bfa78d3e4dc0f4b503b9cc18e5b4b1d686dc0f9ef7c4cc0",
			},
			{
				name: "prime",
				version: "0.1.3",
				checksum:
					"sha256:baf031c50d6ce923594913befc8ac86a3251bffb9d6a5e8b03687962054e53e3",
			},
		];

	return tg.directory(...args.map(downloadGem));
};

export const test = async () => {
	const hasVersion = (name: string, version: string) => {
		return {
			name,
			testPredicate: (stdout: string) => stdout.toLowerCase().includes(version),
		};
	};

	const binaries = [
		hasVersion("bundle", "2.6.2"),
		hasVersion("bundler", "2.6.2"),
		hasVersion("erb", "4.0.4"),
		hasVersion("gem", "3.6.2"),
		hasVersion("irb", "1.14.3"),
		hasVersion("racc", "1.8.1"),
		hasVersion("rdoc", "6.10.0"),
		hasVersion("ruby", metadata.version),
		hasVersion("ri", "6.10.0"),
	];
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries,
	};
	await std.assert.pkg(self, spec);

	const output = await $`ruby -e 'puts "Hello, tangram!"' > $OUTPUT`
		.env(self())
		.then(tg.File.expect)
		.then((f) => f.text())
		.then((t) => t.trim());
	tg.assert(output.includes("Hello, tangram!"));

	return true;
};
