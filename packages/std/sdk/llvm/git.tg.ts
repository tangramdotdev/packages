import * as std from "../../tangram.tg.ts";
import zlib from "../dependencies/zlib.tg.ts";

let metadata = {
	name: "git",
	version: "2.45.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let extension = ".tar.xz";
	let base = `https://mirrors.edge.kernel.org/pub/software/scm/git`;
	let checksum =
		"sha256:51bfe87eb1c02fed1484051875365eeab229831d30d0cec5d89a14f9e40e9adb";
	return await std
		.download({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let git = tg.target(async (arg?: Arg) => {
	let {
		build: build_,
		env: env_,
		host: host_,
		sdk,
		source: source_,
	} = arg ?? {};
	let host = host_ ?? (await std.triple.host());
	let build = build_ ?? host;

	let sourceDir = source_ ?? source();

	let buildPhase = `make NO_GETTEXT=1 -j "$(nproc)"`;

	let configure = {
		args: ["--with-openssl=NO", "--without-tcltk"],
	};

	let install = `make NO_GETTEXT=1 install`;

	let phases = {
		build: buildPhase,
		configure,
		install,
	};

	let env = std.env.arg(env_, zlib({ build, host }));

	let result = std.autotools.build({
		...(await std.triple.rotate({ build, host })),
		buildInTree: true,
		env,
		phases,
		sdk,
		source: sourceDir,
	});
	return result;
});

export default git;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: git,
		binaries: ["git"],
		metadata,
	});
	return true;
});
