import * as gettext from "tg:gettext" with { path: "../gettext" };
import * as openssl from "tg:openssl" with { path: "../openssl" };
import * as std from "tg:std" with { path: "../std" };
import * as zlib from "tg:zlib" with { path: "../zlib" };

export let metadata = {
	homepage: "https://git-scm.com/",
	license: "GPL-2.0-only",
	name: "git",
	repository: "https://github.com/git/git",
	version: "2.45.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let extension = ".tar.xz";
	let base = `https://mirrors.edge.kernel.org/pub/software/scm/${name}`;
	let checksum =
		"sha256:51bfe87eb1c02fed1484051875365eeab229831d30d0cec5d89a14f9e40e9adb";
	return await std
		.download({ base, checksum, name, version, extension })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		gettext?: gettext.Arg;
		openssl?: openssl.Arg;
		zlib?: zlib.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		dependencies: {
			gettext: gettextArg = {},
			openssl: opensslArg = {},
			zlib: zlibArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let sourceDir = source_ ?? source();

	let prepare = tg`cp -R ${sourceDir}/* . && chmod -R u+w .`;

	let configure = {
		args: ["--without-tcltk"],
		command: `./configure`,
	};

	let phases = {
		prepare,
		configure,
	};

	let env = std.env.arg(
		gettext.build({ build, env: env_, host, sdk }, gettextArg),
		openssl.build({ build, env: env_, host, sdk }, opensslArg),
		zlib.build({ build, env: env_, host, sdk }, zlibArg),
		env_,
	);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases,
			sdk,
			source: sourceDir,
		},
		autotools,
	);
});

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["git"],
		metadata,
	});
	return true;
});
