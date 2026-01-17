import * as std from "../../tangram.ts";
import zlib from "../dependencies/zlib.tg.ts";

const metadata = {
	name: "git",
	version: "2.52.0",
};

export const source = async () => {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const base = `https://mirrors.edge.kernel.org/pub/software/scm/git`;
	const checksum =
		"sha256:3cd8fee86f69a949cb610fee8cd9264e6873d07fa58411f6060b3d62729ed7c5";
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = std.autotools.Arg;

export const build = async (...args: std.Args<Arg>) => {
	const buildPhase = `make NO_GETTEXT=1 -j "$(nproc)"`;

	const configure = {
		args: ["--with-openssl=NO", "--without-tcltk"],
	};

	const install = `make NO_GETTEXT=1 install`;

	const phases = {
		build: buildPhase,
		configure,
		install,
	};

	const result = std.autotools.build(
		{
			buildInTree: true,
			env: zlib(),
			phases,
			source: source(),
		},
		...args,
	);
	return result;
};

export default build;
