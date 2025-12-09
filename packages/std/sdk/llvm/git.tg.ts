import * as std from "../../tangram.ts";
import zlib from "../dependencies/zlib.tg.ts";

const metadata = {
	name: "git",
	version: "2.47.1",
};

export const source = async () => {
	const { name, version } = metadata;
	const extension = ".tar.xz";
	const base = `https://mirrors.edge.kernel.org/pub/software/scm/git`;
	const checksum =
		"sha256:f3d8f9bb23ae392374e91cd9d395970dabc5b9c5ee72f39884613cd84a6ed310";
	return await std.download
		.extractArchive({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const git = async (arg?: Arg) => {
	const {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};
	const host = host_ ?? std.triple.host();
	const build = build_ ?? host;

	const sourceDir = source_ ?? source();

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

	const env = std.env.arg(env_, zlib({ build, host }));

	const result = std.autotools.build({
		...(await std.triple.rotate({ build, host })),
		buildInTree: true,
		env,
		phases,
		sdk,
		source: sourceDir,
	});
	return result;
};

export default git;

export const test = async () => {
	// FIXME
	// await std.assert.pkg({ buildFn: git, binaries: ["git"], metadata });
	return true;
};
