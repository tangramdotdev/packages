import * as std from "std" with { source: "./std" };

export const metadata = {
	homepage: "http://pkgconf.org",
	license: "https://github.com/pkgconf/pkgconf?tab=License-1-ov-file#readme",
	name: "pkgconf",
	repository: "https://github.com/pkgconf/pkgconf",
	version: "3.0.8",
	tag: "pkgconf/3.0.8",
	provides: {
		binaries: ["pkgconf"],
	},
};

export async function source() {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const base = `https://distfiles.ariadne.space/pkgconf`;
	const checksum =
		"sha256:943f0bc88bcaeceb630b00262e2a8ad5ea4fac3fba72a4267d8b9ec6b35d1194";
	return std.download
		.extractArchive({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export type Arg = std.autotools.Arg & {
	proxy?: boolean;
};

export async function build(...args: tg.Args<Arg>) {
	const arg = await std.autotools.arg(
		{
			source: source(),
			phases: {
				configure: {
					args: ["--disable-dependency-tracking"],
				},
			},
		},
		...args,
	);

	// Extract proxy option (not part of autotools args).
	const proxy =
		(
			await tg.Args.apply<Arg, tg.ValueOrMaybeMutationMap<Arg>, Arg>({
				args: args as tg.Args<Arg>,
				map: async (a) => a,
				reduce: {},
			})
		).proxy ?? true;

	const output = await std.autotools.build(arg);

	let pkgconf: tg.File | tg.Template = tg.File.expect(
		await output.get("bin/pkgconf"),
	);
	if (proxy) {
		pkgconf = await tg`#!/usr/bin/env sh
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
			exec ${pkgconf} "$@"
		`;
	}

	const wrappedBin = std.wrap(pkgconf, { args: ["--define-prefix"] });

	return tg.directory(output, {
		["bin/pkgconf"]: wrappedBin,
		["bin/pkg-config"]: tg.symlink("pkgconf"),
	});
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
