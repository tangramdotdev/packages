import * as attr from "tg:attr" with { path: "../attr" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://savannah.nongnu.org/projects/acl",
	license: "GPL-2.0-or-later",
	name: "acl",
	repository: "https://git.savannah.nongnu.org/cgit/acl.git",
	version: "2.3.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:97203a72cae99ab89a067fe2210c1cbf052bc492b479eca7d226d9830883b0bd";
	let base = `https://download.savannah.gnu.org/releases/${name}`;
	let extension = ".tar.xz";
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

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = {},
		build,
		dependencies: { attr: attrArg = {} } = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	// Set up host dependencies.
	let attrForHost = await attr
		.build({ build, host, sdk }, attrArg)
		.then((d) => std.directory.keepSubdirectories(d, "include", "lib"));

	let env = await std.env.arg(attrForHost, env_);

	let configure = {
		args: ["--disable-dependency-tracking", "--disable-rpath"],
	};
	let phases = { configure };

	let output = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

	let libDir = tg.Directory.expect(await output.get("lib"));
	let bins = await Promise.all(
		["chacl", "getfacl", "setfacl"].map(async (bin) => {
			return [
				bin,
				std.wrap(tg.File.expect(await output.get(`bin/${bin}`)), {
					libraryPaths: [libDir],
				}),
			];
		}),
	);
	for (let [binName, binFile] of bins) {
		output = await tg.directory(output, { [`bin/${binName}`]: binFile });
	}
	return output;
});

export default build;

export let test = tg.target(async () => {
	let binTest = (name: string) => {
		return {
			name,
			testArgs: [],
			testPredicate: (stdout: string) => stdout.includes("Usage:"),
		};
	};
	let binaries = ["chacl", "getfacl", "setfacl"].map(binTest);

	await std.assert.pkg({
		binaries,
		buildFunction: build,
		libraries: ["acl"],
		metadata,
	});
	return true;
});
