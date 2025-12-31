import * as std from "std" with { local: "./std" };
import * as zlib from "zlib" with { local: "./zlib.tg.ts" };

export const metadata = {
	homepage: "https://www.freedesktop.org/wiki/Software/pkg-config/",
	license: "GPL-2.0-or-later",
	name: "pkg-config",
	repository: "https://gitlab.freedesktop.org/pkg-config/pkg-config",
	version: "0.29.2",
	tag: "pkg-config/0.29.2",
	provides: {
		binaries: ["pkg-config"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const extension = ".tar.gz";
	const base = `https://pkgconfig.freedesktop.org/releases`;
	const checksum =
		"sha256:6fc69c01688c9458a57eb9a1664c9aba372ccda420a02bf4429fe610e7e7d591";
	return std.download
		.extractArchive({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

const deps = std.deps({
	zlib: zlib.build,
});

export type Arg = std.autotools.Arg &
	std.deps.Arg<typeof deps> & {
		proxy?: boolean;
	};

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg(
		{
			deps,
			source: source(),
			env: {
				CFLAGS: tg.Mutation.prefix("-Wno-int-conversion -std=gnu17", " "),
			},
			phases: {
				configure: {
					args: [
						"--with-internal-glib",
						"--disable-dependency-tracking",
						"--enable-define-prefix",
					],
				},
			},
		},
		...args,
	);

	// Extract proxy option (not part of autotools args).
	const proxy =
		(
			await std.args.apply<Arg, Arg>({
				args: args as std.Args<Arg>,
				map: async (arg) => arg,
				reduce: {},
			})
		).proxy ?? true;

	const pkgConfigBuild = await std.autotools.build(arg);

	let pkgConfig: tg.File | tg.Template = tg.File.expect(
		await pkgConfigBuild.get("bin/pkg-config"),
	);
	if (proxy) {
		pkgConfig = await tg`#!/usr/bin/env sh
			set -eu

			PKG_CONFIG_PATH="\${PKG_CONFIG_PATH:-}"

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

	const wrappedBin = std.wrap(pkgConfig);

	return tg.directory(pkgConfigBuild, {
		["bin/pkg-config"]: wrappedBin,
	});
};

export default build;

export const path = async (
	dependencies: Array<tg.Artifact>,
): Promise<tg.Template | undefined> => {
	const standardPaths = [
		"",
		"/lib",
		"/share",
		"/lib/pkgconfig",
		"/share/pkgconfig",
	];

	const allPaths: Array<tg.Template> = [];
	for (const dependency of dependencies) {
		for (const path of standardPaths) {
			allPaths.push(await tg`${dependency}${path}`);
		}
	}

	return tg.Template.join(":", ...allPaths);
};

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
