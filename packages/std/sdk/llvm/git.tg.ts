import * as std from "../../tangram.ts";
import zlib from "../dependencies/zlib.tg.ts";

const metadata = {
	name: "git",
	version: "2.53.0",
};

export const source = async () => {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const base = `https://mirrors.edge.kernel.org/pub/software/scm/git`;
	const checksum =
		"sha256:5818bd7d80b061bbbdfec8a433d609dc8818a05991f731ffc4a561e2ca18c653";
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
