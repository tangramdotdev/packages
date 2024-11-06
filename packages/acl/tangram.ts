import * as attr from "attr" with { path: "../attr" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://savannah.nongnu.org/projects/acl",
	hosts: ["aarch64-linux", "x86_64-linux"],
	license: "GPL-2.0-or-later",
	name: "acl",
	repository: "https://git.savannah.nongnu.org/cgit/acl.git",
	version: "2.3.2",
};

export const source = tg.target(async () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:97203a72cae99ab89a067fe2210c1cbf052bc492b479eca7d226d9830883b0bd";
	const base = `https://download.savannah.gnu.org/releases/${name}`;
	const extension = ".tar.xz";
	return std
		.download({ base, checksum, extension, name, version })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	autotools?: std.autotools.Arg;
	dependencies?: {
		attr?: attr.Arg;
	};
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		dependencies: { attr: attrArg = {} } = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	std.assert.supportedHost(host, metadata);

	// Set up host dependencies.
	const attrForHost = await attr
		.default_({ build, host, sdk }, attrArg)
		.then((d) => std.directory.keepSubdirectories(d, "include", "lib"));

	const env = await std.env.arg(attrForHost, env_);

	const configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-rpath",
			"--disable-silent-rules",
		],
	};
	const phases = { configure };

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default default_;

export const test = tg.target(async () => {
	const binTest = (name: string) => {
		return {
			name,
			testArgs: [],
			testPredicate: (stdout: string) => stdout.includes("Usage:"),
		};
	};
	const binaries = ["chacl", "getfacl", "setfacl"].map(binTest);

	await std.assert.pkg({
		binaries,
		buildFn: default_,
		libraries: ["acl"],
		metadata,
	});
	return true;
});
