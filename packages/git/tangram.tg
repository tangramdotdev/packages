import gettext from "tg:gettext" with { path: "../gettext" };
import openssl from "tg:openssl" with { path: "../openssl" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://git-scm.com/",
	license: "GPL-2.0-only",
	name: "git",
	repository: "https://github.com/git/git",
	version: "2.43.0",
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
		"sha256:5446603e73d911781d259e565750dcd277a42836c8e392cac91cf137aa9b76ec";
	let outer = tg.Directory.expect(
		await std.download({ url, checksum, unpackFormat }),
	);
	return std.directory.unwrap(outer);
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: std.Triple.Arg;
	env?: std.env.Arg;
	host?: std.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let git = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

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

	let env = [gettext(arg), openssl(arg), env_];

	return std.autotools.build(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			env,
			phases,
			source: sourceDir,
		},
		autotools,
	);
});

export default git;

export let test = tg.target(async () => {
	await std.assert.pkg({
		directory: await git(),
		binaries: ["git"],
		metadata,
	});
	return true;
});
