import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "http://pkgconf.org",
	license: "https://github.com/pkgconf/pkgconf?tab=License-1-ov-file#readme",
	name: "pkgconf",
	repository: "https://github.com/pkgconf/pkgconf",
	version: "2.3.0",
	provides: {
		binaries: ["pkgconf"],
	},
};

export const source = tg.command(async () => {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const base = `https://distfiles.ariadne.space/pkgconf`;
	const checksum =
		"sha256:3a9080ac51d03615e7c1910a0a2a8df08424892b5f13b0628a204d3fcce0ea8b";
	return std
		.download({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
	proxy?: boolean;
};

export const build = tg.command(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env,
		host,
		proxy = true,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	// Set up phases.
	const configure = {
		args: ["--disable-dependency-tracking"],
	};

	const phases = { configure };

	const output = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

	let pkgconf: tg.File | tg.Template = tg.File.expect(
		await output.get("bin/pkgconf"),
	);
	if (proxy) {
		pkgconf = await tg`#!/usr/bin/env sh
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
			exec ${pkgconf} "$@"
		`;
	}

	const wrappedBin = std.wrap(pkgconf);

	return tg.directory(output, {
		["bin/pkgconf"]: wrappedBin,
		["bin/pkg-config"]: tg.symlink("pkgconf"),
	});
});

export default build;
export const test = tg.command(async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
});
