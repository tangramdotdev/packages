import acl from "tg:acl" with { path: "../acl" };
import attr from "tg:attr" with { path: "../attr" };
import libcap from "tg:libcap" with { path: "../libcap" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://www.gnu.org/software/coreutils/",
	license: "GPL-3.0-or-later",
	name: "coreutils",
	repository: "http://git.savannah.gnu.org/gitweb/?p=coreutils.git",
	version: "9.4",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let compressionFormat = ".xz" as const;
	let checksum =
		"sha256:ea613a4cf44612326e917201bbbcdfbd301de21ffc3b59b6e5c07e040b275e52";
	let source = await std.download.fromGnu({
		name,
		version,
		compressionFormat,
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
