import * as std from "../tangram.tg.ts";

let metadata = {
	name: "git",
	version: "2.44.0",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let unpackFormat = ".tar.xz" as const;
	let packageArchive = std.download.packageArchive({
		name,
		version,
		unpackFormat,
	});
	let url = `https://mirrors.edge.kernel.org/pub/software/scm/git/${packageArchive}`;
	let checksum =
		"sha256:e358738dcb5b5ea340ce900a0015c03ae86e804e7ff64e47aa4631ddee681de3";
	let outer = tg.Directory.expect(
		await std.download({ url, checksum, unpackFormat }),
	);
	return await std.directory.unwrap(outer);
});

export type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
};

export let git = async (arg?: Arg) => {
	let {
		autotools = [],
		build: build_,
		env: env_,
		host: host_,
		source: source_,
		...rest
	} = arg ?? {};
	let host = host_ ? tg.triple(host_) : await tg.Triple.host();
	let build = build_ ? tg.triple(build_) : host;

	let sourceDir = source_ ?? source();

	let prepare = tg`cp -RT ${sourceDir} . && chmod -R u+w .`;

	let buildPhase = `make NO_GETTEXT=1 -j "$(nproc)"`;

	let configure = {
		args: ["--with-openssl=NO", "--without-tcltk"],
		command: `./configure`,
	};

	let install = `make NO_GETTEXT=1 install`;

	let phases = {
		prepare,
		build: buildPhase,
		configure,
		install,
	};

	let result = std.autotools.build(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
			phases,
			source: sourceDir,
		},
		autotools,
	);
	return result;
};

export default git;

export let test = tg.target(async () => {
	let directory = git();
	await std.assert.pkg({
		directory,
		binaries: ["git"],
		metadata,
	});
	return directory;
});
