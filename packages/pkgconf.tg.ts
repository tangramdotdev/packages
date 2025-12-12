import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "http://pkgconf.org",
	license: "https://github.com/pkgconf/pkgconf?tab=License-1-ov-file#readme",
	name: "pkgconf",
	repository: "https://github.com/pkgconf/pkgconf",
	version: "2.5.1",
	tag: "pkgconf/2.5.1",
	provides: {
		binaries: ["pkgconf"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const base = `https://distfiles.ariadne.space/pkgconf`;
	const checksum =
		"sha256:cd05c9589b9f86ecf044c10a2269822bc9eb001eced2582cfffd658b0a50c243";
	return std.download
		.extractArchive({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = std.autotools.Arg & {
	proxy?: boolean;
};

export const build = async (...args: std.Args<Arg>) => {
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
			await std.args.apply<Arg, Arg>({
				args: args as std.Args<Arg>,
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
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
