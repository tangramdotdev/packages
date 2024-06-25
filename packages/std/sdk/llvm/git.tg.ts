import * as std from "../../tangram.tg.ts";
import zlib from "../dependencies/zlib.tg.ts";

let metadata = {
	name: "git",
	version: "2.45.0",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let extension = ".tar.xz";
	let packageArchive = std.download.packageArchive({
		extension,
		name,
		version,
	});
	let url = `https://mirrors.edge.kernel.org/pub/software/scm/git/${packageArchive}`;
	let checksum =
		"sha256:0aac200bd06476e7df1ff026eb123c6827bc10fe69d2823b4bf2ebebe5953429";
	let outer = tg.Directory.expect(await std.download({ url, checksum }));
	return await std.directory.unwrap(outer);
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

	let env = std.env.arg(
		env_,
		std.utils.env({ build, env: env_, host, sdk }),
		zlib({ build, env: env_, host, sdk }),
	);

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
