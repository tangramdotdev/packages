import * as std from "std" with { source: "./std" };
import * as ncurses from "ncurses" with { source: "./ncurses.tg.ts" };
import * as python from "python" with { source: "./python" };
import * as readline from "readline" with { source: "./readline.tg.ts" };
import * as xz from "xz" with { source: "./xz.tg.ts" };
import * as zlib from "zlib-ng" with { source: "./zlib-ng.tg.ts" };

export const metadata = {
	homepage: "https://gitlab.gnome.org/GNOME/libxml2/-/wikis/home",
	license: "https://gitlab.gnome.org/GNOME/libxml2/-/blob/master/Copyright",
	name: "libxml2",
	repository: "https://gitlab.gnome.org/GNOME/libxml2/-/tree/master",
	version: "2.15.3",
	tag: "libxml2/2.15.3",
	provides: {
		binaries: ["xml2-config", "xmlcatalog", "xmllint"],
		libraries: ["xml2"],
	},
};

export async function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:78262a6e7ac170d6528ebfe2efccdf220191a5af6a6cd61ea4a9a9a5042c7a07";
	const extension = ".tar.xz";
	const majorMinor = version.split(".").slice(0, 2).join(".");
	const base = `https://download.gnome.org/sources/${name}/${majorMinor}`;
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
}

export function deps() {
	return std.deps({
		ncurses: ncurses.build,
		python: { build: python.self, kind: "buildtime" },
		readline: readline.build,
		xz: xz.build,
		zlib: zlib.build,
	});
}

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export async function build(...args: std.Args<Arg>) {
	const arg = await std.autotools.arg(
		{
			source: source(),
			deps,
			setRuntimeLibraryPath: true,
			phases: {
				configure: {
					args: [
						"--disable-dependency-tracking",
						"--enable-static",
						"--enable-shared",
						"--with-history",
					],
				},
			},
		},
		...args,
	);

	// Get the python artifact for CPATH setup.
	const { python: pythonArtifact } = await std.deps.artifacts(deps, {
		build: arg.build,
		host: arg.host,
		...(arg.dependencies !== undefined && arg.dependencies !== null
			? { dependencies: arg.dependencies }
			: {}),
		subtreeEnv: arg.subtreeEnv ?? null,
		...(arg.subtreeSdk !== undefined && arg.subtreeSdk !== null
			? { subtreeSdk: arg.subtreeSdk }
			: {}),
	});
	tg.assert(pythonArtifact !== undefined);
	const env = std.env.arg(arg.env ?? null, {
		CPATH: tg.Mutation.suffix(
			tg`${pythonArtifact}/include/python${python.versionString()}`,
			":",
		),
	});

	return std.autotools.build({ ...arg, env });
}

export default build;

export async function test() {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.binaries(metadata.provides.binaries, {
			xmlcatalog: { testArgs: ["--verbose"], snapshot: "Catalogs cleanup" },
			xmllint: { snapshot: "using libxml version 21503" },
		}),
	};
	return await std.assert.pkg(build, spec);
}
