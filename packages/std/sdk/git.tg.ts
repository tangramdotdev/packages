import * as std from "../tangram.tg.ts";
import zlib from "./dependencies/zlib.tg.ts";

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

export type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
};

export let git = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
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

	let env = [
		env_,
		std.utils.env({ ...rest, build, env: env_, host }),
		zlib({ ...rest, build, env: env_, host }),
	];

	let result = std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			buildInTree: true,
			env,
			phases,
			source: sourceDir,
		},
		autotools,
	);
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
