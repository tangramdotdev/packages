import * as std from "../../tangram.tg.ts";
import bison from "./bison.tg.ts";
import m4 from "./m4.tg.ts";
import zlib from "./zlib.tg.ts";

export let metadata = {
	name: "pkg-config",
	version: "0.29.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let unpackFormat = ".tar.gz" as const;
	// let url = `https://pkgconfig.freedesktop.org/releases/${packageArchive}`;
	// let url = `http://fresh-center.net/linux/misc/pkg-config-0.29.2.tar.gz`;
	let url =
		"https://github.com/tangramdotdev/bootstrap/releases/download/v2023.12.14/pkg-config-0.29.2.tar.gz";
	let checksum =
		"sha256:6fc69c01688c9458a57eb9a1664c9aba372ccda420a02bf4429fe610e7e7d591";
	let outer = tg.Directory.expect(
		await std.download({ url, checksum, unpackFormat }),
	);
	return await std.directory.unwrap(outer);
});

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};
	let host = host_ ?? await std.triple.host();
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
		let libiconv = await std.utils.libiconv.build(arg);
		dependencies.push(libiconv);
		additionalLibDirs.push(tg.Directory.expect(await libiconv.get("lib")));
		dependencies.push({
			LDFLAGS: await tg.Mutation.templatePrepend(tg`-L${libiconv}/lib`, " "),
		});
	}
	let env = [env_, std.utils.env(arg), ...dependencies];
	let pkgConfigBuild = await std.utils.buildUtil(
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
	let wrappedBin = std.wrap({
		args: ["--define-prefix"],
		executable: tg.symlink({
			artifact: pkgConfigBuild,
			path: "bin/pkg-config",
		}),
		buildToolchain: env_,
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

export default build;

import * as bootstrap from "../../bootstrap.tg.ts";
export let test = tg.target(async () => {
	let host = bootstrap.toolchainTriple(await std.triple.host());
	let bootstrapMode = true;
	let sdk = std.sdk({ host, bootstrapMode });
	let directory = build({ host, bootstrapMode, env: sdk });
	await std.assert.pkg({
		bootstrapMode,
		directory,
		binaries: ["pkg-config"],
		metadata,
	});
	return directory;
});
