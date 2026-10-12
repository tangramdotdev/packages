import * as std from "../tangram.ts";
import { sdk as bootstrapSdk } from "../bootstrap.tg.ts";

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

export type Arg = {
	bashExe: tg.File;
	build?: string | null;
	env?: std.env.Arg | null;
	host?: string | null;
	sdk?: std.sdk.Arg | null;
	source?: tg.Directory | null;
};

export async function build(arg: tg.Unresolved<Arg>) {
	const {
		bashExe,
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = await tg.resolve(arg);
	const env = std.env.compose(env_ ?? null);

	const configure = {
		args: ["--disable-dependency-tracking"],
	};
	const phases = { configure };

	const output = await std.utils.autotoolsInternal({
		build: build ?? null,
		host: host ?? null,
		env,
		phases,
		processName: metadata.name,
		...std.args.optional("sdk", sdk),
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
}

export default build;
