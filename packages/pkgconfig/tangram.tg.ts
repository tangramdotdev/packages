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
	let unpackFormat = ".tar.gz" as const;
	let packageArchive = std.download.packageArchive({
		name,
		version,
		unpackFormat,
	});
	let url = `https://pkgconfig.freedesktop.org/releases/${packageArchive}`;
	let checksum =
		"sha256:6fc69c01688c9458a57eb9a1664c9aba372ccda420a02bf4429fe610e7e7d591";
	let outer = tg.Directory.expect(
		await std.download({ url, checksum, unpackFormat }),
	);
	return await std.directory.unwrap(outer);
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let pkgconfig = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let configure = {
		args: ["--with-internal-glib", "--disable-dependency-tracking"],
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
	let wrappedBin = std.wrap(
		tg.symlink({
			artifact: pkgConfigBuild,
			path: "bin/pkg-config",
		}),
		{
			args: ["--define-prefix"],
			libraryPaths: additionalLibDirs,
		},
	);

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
	let directory = pkgconfig();
	await std.assert.pkg({
		directory,
		binaries: ["pkg-config"],
		metadata,
	});
	return directory;
});
