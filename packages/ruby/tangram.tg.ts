import * as std from "tg:std" with { path: "../std" };

import libffi from "tg:libffi" with { path: "../libffi" };
import libyaml from "tg:libyaml" with { path: "../libyaml" };
import ncurses from "tg:ncurses" with { path: "../ncurses" };
import openssl from "tg:openssl" with { path: "../openssl" };
import readline from "tg:readline" with { path: "../readline" };
import zlib from "tg:zlib" with { path: "../zlib" };

import * as bootstrap from "./bootstrap.tg.ts";

export let metadata = {
	homepage: "https://www.ruby-lang.org/",
	name: "ruby",
	license: "BSD-2-Clause",
	repository: "https://git.ruby-lang.org/ruby.git",
	version: "3.3.0",
};

export let source = tg.target(async () => {
	let { version } = metadata;
	let checksum =
		"sha256:96518814d9832bece92a85415a819d4893b307db5921ae1f0f751a9a89a56b7d";
	let extension = ".tar.gz";
	let majorMinor = version.split(".").slice(0, 2).join(".");
	let url = `https://cache.ruby-lang.org/pub/ruby/${majorMinor}/ruby-${version}${extension}`;
	let outer = tg.Directory.expect(await std.download({ url, checksum }));
	return std.directory.unwrap(outer);
});

type Arg = {
	env: std.env.Arg;
	phases: tg.MaybeNestedArray<std.phases.Arg>;
	source?: tg.Directory;
	build?: string;
	host?: string;
};

export let ruby = async (...args: tg.Args<Arg>) => {
	type Apply = {
		envs: std.env.Arg;
		phases: tg.MaybeNestedArray<std.phases.Arg>;
		source: tg.Directory;
		build: string;
		host: string;
	};
	let {
		envs,
		phases: phases_,
		source: source_,
		build: build_,
		host: host_,
	} = await tg.Args.apply<Arg, Apply>(args, async (arg) => {
		if (arg === undefined) {
			return {};
		} else {
			let object: tg.MutationMap<Apply> = {};
			if (arg.env !== undefined) {
				object.envs = await tg.Mutation.arrayAppend<std.env.Arg>(arg.env);
			}
			if (arg.phases !== undefined) {
				object.phases = tg.Mutation.is(arg.phases)
					? arg.phases
					: await tg.Mutation.arrayAppend<std.phases.Arg>(arg.phases);
			}
			if (arg.source !== undefined) {
				object.source = arg.source;
			}
			if (arg.build !== undefined) {
				object.build = arg.build;
			}
			if (arg.host !== undefined) {
				object.host = arg.host;
			}
			return object;
		}
	});

	// Get the source code.
	let sourceDir = source_ ?? (await source());

	// We need to skip the makefile step that attempts to update any .gem files in the bundle and replace them with the .gems we download ourself.
	sourceDir = await std.patch(
		sourceDir,
		tg.File.expect(await tg.include("./0001-skip-update-gems.patch")),
	);

	// The ruby build will attempt to download and install several .gem files. Explicitly forbid this.
	source_ = await tg.directory(sourceDir, {
		gems: bundledGems(),
		"gems/bundled_gems": "",
	});

	// Generate the host and target.
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let env_ = [
		libffi({ host }),
		libyaml({ host }),
		ncurses({ host }),
		openssl({ host }),
		readline({ host }),
		zlib({ host }),
		bootstrap.ruby(host),
		envs,
	];

	// Build ruby.
	let ruby = await std.autotools.build({
		source: source_,
		// Ruby requires an existing Ruby to build, so we pull in an older version.
		env: env_,
		phases: {
			configure: {
				// Disable documentation.
				args: ["--disable-install-doc"],
			},
			//install: tg.Mutation.set("find ./bin -empty -delete && make install"),
		},
		...std.triple.rotate({ build, host }),
	});

	// Create the RUBYLIB environment variable.
	let { arch: hostArch, os: hostOs } = std.triple.components(host);
	let version = metadata.version;
	let libs = [
		tg`${ruby}/lib/ruby/site_ruby/${version}`,
		tg`${ruby}/lib/ruby/site_ruby/${version}/${hostArch}-${hostOs}`,
		tg`${ruby}/lib/ruby/site_ruby`,
		tg`${ruby}/lib/ruby/vendor_ruby/${version}`,
		tg`${ruby}/lib/ruby/vendor_ruby/${version}/${hostArch}-${hostOs}`,
		tg`${ruby}/lib/ruby/vendor_ruby`,
		tg`${ruby}/lib/ruby/${version}`,
		tg`${ruby}/lib/ruby/${version}/${hostArch}-${hostOs}`,
	];
	let rubylib = tg.Template.join(":", ...(await Promise.all(libs)));

	// Create the GEM_PATH, GEM_HOME environment variable.
	let gems = [tg`${ruby}/lib/ruby/gems/${version}`];
	let gemPath = tg.Template.join(":", ...(await Promise.all(gems)));

	// Create the env used for wrapping ruby bins.
	let env = std.env({
		RUBYLIB: rubylib,
		GEM_PATH: gemPath,
		GEM_HOME: gemPath,
	});

	// Wrap Ruby itself.
	let rubyBin = std.wrap({
		executable: tg.symlink(tg`${ruby}/bin/ruby`),
		env,
	});

	// Wrap the other binaries provided by ruby.
	let binNames = [
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
	for (let name of binNames) {
		bin = tg.directory(bin, {
			[name]: std.wrap({
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

export type DownloadGemArg = {
	/** The name of the gem. */
	name: string;

	/** The version of the gem. */
	version: string;

	/** The checksum of the .gem file itself. */
	checksum: tg.Checksum;
};

/** Download and extract a .gem file from rubygems.org. */
export let downloadGem = (arg: DownloadGemArg) => {
	let gemFile = std.download({
		url: `https://rubygems.org/downloads/${arg.name}-${arg.version}.gem`,
		checksum: arg.checksum,
	});

	return tg.directory({
		[`${arg.name}-${arg.version}.gem`]: gemFile,
	});
};

/** These are the gems required by the ruby build itself and installed by default. */
let bundledGems = (): Promise<tg.Directory> => {
	let args = [
		{
			name: "minitest",
			version: "5.16.3",
			checksum:
				"sha256:60f81ad96ca5518e1457bd29eb826db60f86fbbdf8c05eac63b4824ef1f52614",
		},
		{
			name: "power_assert",
			version: "2.0.3",
			checksum:
				"sha256:cd5e13c267370427c9804ce6a57925d6030613e341cb48e02eec1f3c772d4cf8",
		},
		{
			name: "rake",
			version: "13.0.6",
			checksum:
				"sha256:5ce4bf5037b4196c24ac62834d8db1ce175470391026bd9e557d669beeb19097",
		},
		{
			name: "test-unit",
			version: "3.5.7",
			checksum:
				"sha256:0e162a55d8be7032068758c6dfe548b8b40b19ace3f79b369767d28a62bbb0e5",
		},
		{
			name: "rexml",
			version: "3.2.5",
			checksum:
				"sha256:a33c3bf95fda7983ec7f05054f3a985af41dbc25a0339843bd2479e93cabb123",
		},
		{
			name: "rss",
			version: "0.2.9",
			checksum:
				"sha256:a045876bea9b35456241d4d57b9340d9e3a042264d6b4aea9d93983c0fe83fac",
		},
		{
			name: "net-ftp",
			version: "0.2.0",
			checksum:
				"sha256:c9ddc46d8ddce05b4f19c4598ae272dcee1530c6418e830408bd08515e4f1e2f",
		},
		{
			name: "net-imap",
			version: "0.3.4",
			checksum:
				"sha256:a82a59e2a429433dc54cae5a8b2979ffe49da8c66085740811bfa337dc3729b5",
		},
		{
			name: "net-pop",
			version: "0.1.2",
			checksum:
				"sha256:848b4e982013c15b2f0382792268763b748cce91c9e91e36b0f27ed26420dff3",
		},
		{
			name: "net-smtp",
			version: "0.3.3",
			checksum:
				"sha256:3d51dcaa981b74aff2d89cbe89de4503bc2d682365ea5176366e950a0d68d5b0",
		},
		{
			name: "matrix",
			version: "0.4.2",
			checksum:
				"sha256:71083ccbd67a14a43bfa78d3e4dc0f4b503b9cc18e5b4b1d686dc0f9ef7c4cc0",
		},
		{
			name: "prime",
			version: "0.1.2",
			checksum:
				"sha256:d4e956cadfaf04de036dc7dc74f95bf6a285a62cc509b28b7a66b245d19fe3a4",
		},
	];

	return tg.directory(...args.map(downloadGem));
};

export default ruby;

export let test = tg.target(() => {
	return std.build(
		tg`
			echo "Checking that we can run Ruby and Rubygems."
			ruby -e 'puts "Hello, tangram!"'
			gem --version
		`,
		{ env: ruby() },
	);
});
