import * as std from "../../tangram.ts";

export const metadata = {
	homepage: "https://gitlab.gnome.org/GNOME/libxml2/-/wikis/home",
	license: "https://gitlab.gnome.org/GNOME/libxml2/-/blob/master/Copyright",
	name: "libxml2",
	repository: "https://gitlab.gnome.org/GNOME/libxml2/-/tree/master",
	version: "2.9.14",
	tag: "libxml2/2.9.14", // NOTE - this library is here in std to support the precompiled clang toolchain, which expects this older version.
	provides: {
		binaries: ["xml2-config", "xmlcatalog", "xmllint"],
		libraries: ["xml2"],
	},
};

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:60d74a257d1ccec0475e749cba2f21559e48139efba6ff28224357c7c798dfee";
	const extension = ".tar.xz";
	const majorMinor = version.split(".").slice(0, 2).join(".");
	const base = `https://download.gnome.org/sources/${name}/${majorMinor}`;
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = std.autotools.Arg;

export const build = async (...args: std.Args<Arg>) => {
	return std.autotools.build(
		{
			source: source(),
			phases: {
				configure: {
					args: [
						"--disable-dependency-tracking",
						"--enable-static",
						"--enable-shared",
					],
				},
			},
			setRuntimeLibraryPath: true,
		},
		...args,
	);
};

export default build;
