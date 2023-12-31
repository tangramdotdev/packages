import * as std from "../tangram.tg.ts";

let metadata = {
	name: "git",
	version: "2.41.0",
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
		"sha256:e748bafd424cfe80b212cbc6f1bbccc3a47d4862fb1eb7988877750478568040";
	let outer = tg.Directory.expect(
		await std.download({ url, checksum, unpackFormat }),
	);
	return await std.directory.unwrap(outer);
});

export let git = async (arg?: std.sdk.BuildEnvArg) => {
	let source_ = source();

	let prepare = tg`cp -R ${source_}/* .`;

	let build = `make NO_GETTEXT=1 -j "$(nproc)"`;

	let configure = {
		args: ["--without-iconv", "--with-openssl=NO", "--without-tcltk"],
		command: `./configure`,
	};

	let install = `make NO_GETTEXT=1 install`;

	let phases = {
		prepare,
		build,
		configure,
		install,
	};

	let result = std.autotools.build({
		...arg,
		phases,
		source: source_,
	});
	return result;
};

export default git;
