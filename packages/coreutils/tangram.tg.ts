import * as acl from "tg:acl" with { path: "../acl" };
import * as attr from "tg:attr" with { path: "../attr" };
import * as libcap from "tg:libcap" with { path: "../libcap" };
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
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		acl?: acl.Arg;
		attr?: attr.Arg;
		libcap?: libcap.Arg;
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
			acl: aclArg = {},
			attr: attrArg = {},
			libcap: libcapArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let dependencies = [
		acl.build(aclArg),
		attr.build(attrArg),
		libcap.build(libcapArg),
	];
	let env = [...dependencies, env_];

	return std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
			env: std.env.arg(env),
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
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
	return true;
});
