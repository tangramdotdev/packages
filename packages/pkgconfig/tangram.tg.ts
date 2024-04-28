import bison from "tg:bison" with { path: "../bison" };
import libiconv from "tg:libiconv" with { path: "../libiconv" };
import m4 from "tg:m4" with { path: "../m4" };
import * as std from "tg:std" with { path: "../std" };
import zlib from "tg:zlib" with { path: "../zlib" };

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
	let packageArchive = std.download.packageArchive({
		extension,
		name,
		version,
	});
	let url = `https://pkgconfig.freedesktop.org/releases/${packageArchive}`;
	let checksum =
		"sha256:6fc69c01688c9458a57eb9a1664c9aba372ccda420a02bf4429fe610e7e7d591";
	let outer = tg.Directory.expect(await std.download({ url, checksum }));
	return await std.directory.unwrap(outer);
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	proxy?: boolean;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let pkgconfig = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		proxy = true,
		source: source_,
		...rest
	} = arg ?? {};
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let configure = {
		args: [
			"--with-internal-glib",
			"--disable-dependency-tracking",
			"--enable-define-prefix",
		],
	};

	let phases = { configure };
	let dependencies: tg.Unresolved<Array<std.env.Arg>> = [
		bison(arg),
		m4(arg),
		zlib(arg),
	];
	let additionalLibDirs = [];
	if (std.triple.os(build) === "darwin") {
		let libiconvArtifact = await libiconv(arg);
		dependencies.push(libiconvArtifact);
		additionalLibDirs.push(
			tg.Directory.expect(await libiconvArtifact.get("lib")),
		);
		dependencies.push({
			LDFLAGS: await tg.Mutation.templatePrepend(
				tg`-L${libiconvArtifact}/lib`,
				" ",
			),
		});
	}
	let env = [...dependencies, env_];

	if (
		std.triple.os(build) === "darwin" ||
		(await std.env.tryWhich({ env: env_, name: "clang" })) ||
		std.flatten(rest.sdk ?? []).some((sdk) => sdk?.toolchain === "llvm")
	) {
		env.push({
			CC: "clang -Wno-int-conversion",
		});
	}

	let pkgConfigBuild = await std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases,
			source: source_ ?? source(),
		},
		autotools,
	);

	// Bundle the resulting binary with the `--define-prefix` flag.
	let pkgConfig: tg.File | tg.Template = tg.File.expect(
		await pkgConfigBuild.get("bin/pkg-config"),
	);
	if (proxy) {
		pkgConfig = await tg`
			#!/usr/bin/env sh
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

			# Remove leading colon if it exists
			PKG_CONFIG_PATH=$(echo "$PKG_CONFIG_PATH" | sed 's/^://')

			export PKG_CONFIG_PATH
			${pkgConfig} "$@"
		`;
	}

	let wrappedBin = std.wrap(pkgConfig, {
		libraryPaths: additionalLibDirs,
	});

	return tg.directory(pkgConfigBuild, {
		["bin/pkg-config"]: wrappedBin,
	});
});

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

export default pkgconfig;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: pkgconfig,
		binaries: ["pkg-config"],
		metadata,
	});
	return pkgconfig();
});
