import * as std from "../../tangram.ts";

export const metadata = {
	homepage: "https://gitlab.gnome.org/GNOME/libxml2/-/wikis/home",
	license: "https://gitlab.gnome.org/GNOME/libxml2/-/blob/master/Copyright",
	name: "libxml2",
	repository: "https://gitlab.gnome.org/GNOME/libxml2/-/tree/master",
	version: "2.9.14", // NOTE - this library is here in std to support the precompiled clang toolchain, which expects this older version.
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

export type Arg = {
	bootstrap?: boolean;
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		bootstrap: bootstrap_ = false,
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	const configure = {
		args: [
			"--disable-dependency-tracking",
			"--enable-static",
			"--enable-shared",
		],
	};

	const phases = { configure };

	const env = [env_];

	return std.autotools.build({
		...(await std.triple.rotate({ build, host })),
		bootstrap: bootstrap_,
		env: std.env.arg(...env),
		phases,
		sdk,
		setRuntimeLibraryPath: true,
		source: source_ ?? source(),
	});
};

export default build;
