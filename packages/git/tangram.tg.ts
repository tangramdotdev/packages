import * as gettext from "tg:gettext" with { path: "../gettext" };
import * as openssl from "tg:openssl" with { path: "../openssl" };
import * as std from "tg:std" with { path: "../std" };
import * as zlib from "tg:zlib" with { path: "../zlib" };

export let metadata = {
	homepage: "https://git-scm.com/",
	license: "GPL-2.0-only",
	name: "git",
	repository: "https://github.com/git/git",
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
	return std.directory.unwrap(outer);
});

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		gettext: gettext.Arg;
		openssl: openssl.Arg;
		zlib: zlib.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let git = tg.target(async (...args: std.Args<Arg>) => {
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
		gettext.gettext(gettextArg),
		openssl.openssl(opensslArg),
		zlib.zlib(zlibArg),
		env_,
	);

	return std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
			env,
			phases,
			sdk,
			source: sourceDir,
		},
		autotools,
	);
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
