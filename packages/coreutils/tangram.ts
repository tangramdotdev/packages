import * as acl from "acl" with { path: "../acl" };
import * as attr from "attr" with { path: "../attr" };
import * as libcap from "libcap" with { path: "../libcap" };
import * as libiconv from "libiconv" with { path: "../libiconv" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/coreutils/",
	license: "GPL-3.0-or-later",
	name: "coreutils",
	repository: "http://git.savannah.gnu.org/gitweb/?p=coreutils.git",
	version: "9.6",
	provides: {
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
	},
};

export const source = tg.command(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:7a0124327b398fd9eb1a6abde583389821422c744ffa10734b24f557610d3283";
	const source = await std.download.fromGnu({
		name,
		version,
		compression: "xz",
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
		libiconv?: libiconv.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.command(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: {
			acl: aclArg = {},
			attr: attrArg = {},
			libcap: libcapArg = {},
			libiconv: libiconvArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let dependencies: Array<tg.Unresolved<std.env.Arg>> = [];

	if (std.triple.os(host) === "linux") {
		dependencies = dependencies.concat([
			acl.build({ build, env: env_, host, sdk }, aclArg),
			attr.build({ build, env: env_, host, sdk }, attrArg),
			libcap.build({ build, env: env_, host, sdk }, libcapArg),
		]);
	}

	if (std.triple.os(host) === "darwin") {
		dependencies.push(
			libiconv.build({ build, env: env_, host, sdk }, libiconvArg),
		);
	}

	const env = [...dependencies, env_];

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(env),
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default build;

export const test = tg.command(async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
});
