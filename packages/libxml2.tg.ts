import * as std from "std" with { local: "./std" };
import * as ncurses from "ncurses" with { local: "./ncurses.tg.ts" };
import * as python from "python" with { local: "./python" };
import * as readline from "readline" with { local: "./readline.tg.ts" };
import * as xz from "xz" with { local: "./xz.tg.ts" };
import * as zlib from "zlib-ng" with { local: "./zlib-ng.tg.ts" };

export const metadata = {
	homepage: "https://gitlab.gnome.org/GNOME/libxml2/-/wikis/home",
	license: "https://gitlab.gnome.org/GNOME/libxml2/-/blob/master/Copyright",
	name: "libxml2",
	repository: "https://gitlab.gnome.org/GNOME/libxml2/-/tree/master",
	version: "2.15.1",
	tag: "libxml2/2.15.1",
	provides: {
		binaries: ["xml2-config", "xmlcatalog", "xmllint"],
		libraries: ["xml2"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:c008bac08fd5c7b4a87f7b8a71f283fa581d80d80ff8d2efd3b26224c39bc54c";
	const extension = ".tar.xz";
	const majorMinor = version.split(".").slice(0, 2).join(".");
	const base = `https://download.gnome.org/sources/${name}/${majorMinor}`;
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export const deps = () =>
	std.deps({
		ncurses: ncurses.build,
		python: { build: python.self, kind: "buildtime" },
		readline: readline.build,
		xz: xz.build,
		zlib: zlib.build,
	});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = async (...args: std.Args<Arg>) => {
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
	const { python: pythonArtifact } = await std.deps.artifacts(deps, arg);
	const env = std.env.arg(arg.env, {
		CPATH: tg.Mutation.suffix(
			tg`${pythonArtifact}/include/python${python.versionString()}`,
			":",
		),
	});

	return std.autotools.build({ ...arg, env });
};

export default build;

export const test = async () => {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.binaries(metadata.provides.binaries, {
			xmlcatalog: { testArgs: ["--verbose"], snapshot: "Catalogs cleanup" },
			xmllint: { snapshot: "using libxml version 21501" },
		}),
	};
	return await std.assert.pkg(build, spec);
};
