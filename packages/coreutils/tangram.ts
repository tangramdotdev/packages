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
	version: "9.5",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:cd328edeac92f6a665de9f323c93b712af1858bc2e0d88f3f7100469470a1b8a";
	const source = await std.download.fromGnu({
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
		libiconv?: libiconv.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
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
			acl.default_({ build, env: env_, host, sdk }, aclArg),
			attr.default_({ build, env: env_, host, sdk }, attrArg),
			libcap.default_({ build, env: env_, host, sdk }, libcapArg),
		]);
	}

	if (std.triple.os(host) === "darwin") {
		dependencies.push(
			libiconv.default_({ build, env: env_, host, sdk }, libiconvArg),
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

export default default_;

export const test = tg.target(async () => {
	await std.assert.pkg({
		packageDir: default_(),
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
