import * as acl from "acl" with { local: "../acl" };
import * as attr from "attr" with { local: "../attr" };
import * as libcap from "libcap" with { local: "../libcap" };
import * as libiconv from "libiconv" with { local: "../libiconv" };
import * as std from "std" with { local: "../std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/coreutils/",
	license: "GPL-3.0-or-later",
	name: "coreutils",
	repository: "http://git.savannah.gnu.org/gitweb/?p=coreutils.git",
	version: "9.8",
	tag: "coreutils/9.8",
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

export const source = async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:e6d4fd2d852c9141a1c2a18a13d146a0cd7e45195f72293a4e4c044ec6ccca15";
	const source = await std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});

	return source;
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		acl?: std.args.OptionalDependencyArg<acl.Arg>;
		attr?: std.args.OptionalDependencyArg<attr.Arg>;
		libcap?: std.args.OptionalDependencyArg<libcap.Arg>;
		libiconv?: std.args.DependencyArg<libiconv.Arg>;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: dependencyArgs = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	let dependencies = [];

	if (std.triple.os(host) === "linux") {
		dependencies.push(
			std.env.runtimeDependency(acl.build, dependencyArgs.acl),
			std.env.runtimeDependency(attr.build, dependencyArgs.attr),
			std.env.runtimeDependency(libcap.build, dependencyArgs.libcap),
		);
	}

	if (std.triple.os(host) === "darwin") {
		dependencies.push(
			std.env.runtimeDependency(libiconv.build, dependencyArgs.libiconv),
		);
	}

	const envs: tg.Unresolved<Array<std.env.Arg>> = [
		...dependencies.map((dep) =>
			std.env.envArgFromDependency(build, env_, host, sdk, dep),
		),
		{ FORCE_UNSAFE_CONFIGURE: true },
		env_,
	];

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(...envs),
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
