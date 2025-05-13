import * as std from "../tangram.ts";
import { sdk as bootstrapSdk } from "../bootstrap.tg.ts";

export const metadata = {
	homepage: "http://pkgconf.org",
	license: "https://github.com/pkgconf/pkgconf?tab=License-1-ov-file#readme",
	name: "pkgconf",
	repository: "https://github.com/pkgconf/pkgconf",
	version: "2.4.3",
	provides: {
		binaries: ["pkgconf"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const base = `https://distfiles.ariadne.space/pkgconf`;
	const checksum =
		"sha256:51203d99ed573fa7344bf07ca626f10c7cc094e0846ac4aa0023bd0c83c25a41";
	return std.download
		.extractArchive({ checksum, base, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = {
	bootstrap?: boolean;
	bashExe: tg.File;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (arg: tg.Unresolved<Arg>) => {
	const {
		bootstrap: bootstrap_ = false,
		bashExe,
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = await tg.resolve(arg);
	const env = std.env.arg(env_);

	const configure = {
		args: ["--disable-dependency-tracking"],
	};
	const phases = { configure };

	const output = await std.utils.autotoolsInternal({
		...(await std.triple.rotate({ build, host })),
		bootstrap: bootstrap_,
		env,
		phases,
		sdk,
		source: source_ ?? source(),
	});

	const pkgconfFile = await output.get("bin/pkgconf").then(tg.File.expect);
	const pkgconf = await tg`#!/usr/bin/env sh
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
			exec ${pkgconfFile} "$@"
		`;

	const wrappedBin = std.wrap({
		args: ["--define-prefix"],
		executable: pkgconf,
		interpreter: bashExe,
		buildToolchain: bootstrapSdk(),
	});

	return tg.directory(output, {
		["bin/pkgconf"]: wrappedBin,
		["bin/pkg-config"]: tg.symlink("pkgconf"),
	});
};

export default build;
