import acl from "tg:acl" with { path: "../acl" };
import attr from "tg:attr" with { path: "../attr" };
import libcap from "tg:libcap" with { path: "../libcap" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://www.gnu.org/software/coreutils/",
	license: "GPL-3.0-or-later",
	name: "coreutils",
	repository: "http://git.savannah.gnu.org/gitweb/?p=coreutils.git",
	version: "9.5",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:cd328edeac92f6a665de9f323c93b712af1858bc2e0d88f3f7100469470a1b8a";
	let source = await std.download.fromGnu({
		name,
		version,
		compressionFormat: "xz",
		checksum,
	});

	return source;
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let coreutils = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let dependencies = [acl(arg), attr(arg), libcap(arg)];
	let env = [...dependencies, env_];

	return std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default coreutils;

export let test = tg.target(async () => {
	let directory = coreutils();
	await std.assert.pkg({
		directory,
		binaries: [
			"cp",
			"ls",
			"mv",
			"rm",
			"shuf",
			"sort",
			"tail",
			"tee",
			"touch",
			"true",
			"uname",
			"uniq",
			"wc",
			"whoami",
			"yes",
		],
		metadata,
	});
	return directory;
});
