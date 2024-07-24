import * as bison from "tg:bison" with { path: "../bison" };
import * as m4 from "tg:m4" with { path: "../m4" };
import * as std from "tg:std" with { path: "../std" };
import * as zlib from "tg:zlib" with { path: "../zlib" };

export let metadata = {
	homepage: "https://www.freedesktop.org/wiki/Software/pkg-config/",
	license: "GPL-2.0-or-later",
	name: "pkg-config",
	repository: "https://gitlab.freedesktop.org/pkg-config/pkg-config",
	version: "0.29.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let extension = ".tar.gz";
	let base = `https://pkgconfig.freedesktop.org/releases`;
	let checksum =
		"sha256:6fc69c01688c9458a57eb9a1664c9aba372ccda420a02bf4429fe610e7e7d591";
	return std
		.download({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		zlib?: zlib.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
	proxy?: boolean;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		dependencies: { zlib: zlibArg = {} } = {},
		env: env_,
		host,
		proxy = true,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	// Set up default build dependencies.
	let buildDependencies = [];
	let m4ForBuild = m4.build({ build, host: build }).then((d) => {
		return { M4: std.directory.keepSubdirectories(d, "bin") };
	});
	buildDependencies.push(m4ForBuild);
	let bisonForBuild = bison.build({ build, host: build }).then((d) => {
		return { BISON: std.directory.keepSubdirectories(d, "bin") };
	});
	buildDependencies.push(bisonForBuild);

	// Set up host dependencies.
	let zlibForHost = await zlib
		.build({ build, host, sdk }, zlibArg)
		.then((d) => std.directory.keepSubdirectories(d, "include", "lib"));

	// Resolve env.
	let env = await std.env.arg(
		...buildDependencies,
		zlibForHost,
		{
			CFLAGS: tg.Mutation.prefix("-Wno-int-conversion", " "),
		},
		env_,
	);

	// Add final build dependencies to environment.
	let resolvedBuildDependencies = [];
	let finalM4 = await std.env.getArtifactByKey({ env, key: "M4" });
	resolvedBuildDependencies.push(finalM4);
	let finalBison = await std.env.getArtifactByKey({ env, key: "BISON" });
	resolvedBuildDependencies.push(finalBison);
	env = await std.env.arg(env, ...resolvedBuildDependencies);

	// Set up phases.
	let configure = {
		args: [
			"--with-internal-glib",
			"--disable-dependency-tracking",
			"--enable-define-prefix",
		],
	};

	let phases = { configure };

	let pkgConfigBuild = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

	// Bundle the resulting binary with the `--define-prefix` flag.
	let pkgConfig: tg.File | tg.Template = tg.File.expect(
		await pkgConfigBuild.get("bin/pkg-config"),
	);
	if (proxy) {
		pkgConfig = await tg`#!/usr/bin/env sh
			set -eu

			PKG_CONFIG_PATH=""

			for dir in $(echo $LIBRARY_PATH | tr ":" "\n"); do
				if [ -d "$dir/pkgconfig" ]; then
					PKG_CONFIG_PATH="$PKG_CONFIG_PATH:$dir/pkgconfig"
				fi

				if echo "$dir" | grep -q '/lib$'; then
						adjacent_share="\${dir%/lib}/share/pkgconfig"
						if [ -d "$adjacent_share" ]; then
								PKG_CONFIG_PATH="$PKG_CONFIG_PATH:$adjacent_share"
						fi
				fi
			done

			PKG_CONFIG_PATH=$(echo "$PKG_CONFIG_PATH" | sed 's/^://')

			export PKG_CONFIG_PATH
			exec ${pkgConfig} "$@"
		`;
	}

	let wrappedBin = std.wrap(pkgConfig);

	return tg.directory(pkgConfigBuild, {
		["bin/pkg-config"]: wrappedBin,
	});
});

export default build;

export let path = tg.target(
	async (
		dependencies: Array<tg.Artifact>,
	): Promise<tg.Template | undefined> => {
		let standardPaths = [
			"",
			"/lib",
			"/share",
			"/lib/pkgconfig",
			"/share/pkgconfig",
		];

		let allPaths: Array<tg.Template> = [];
		for (let dependency of dependencies) {
			for (let path of standardPaths) {
				allPaths.push(await tg`${dependency}${path}`);
			}
		}

		return tg.Template.join(":", ...allPaths);
	},
);

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["pkg-config"],
		metadata,
	});
	return build();
});
