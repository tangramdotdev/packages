import * as attr from "tg:attr" with { path: "../attr" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "acl",
	version: "2.3.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:5f2bdbad629707aa7d85c623f994aa8a1d2dec55a73de5205bac0bf6058a2f7c";
	let extension = ".tar.gz" as const;
	let packageName = std.download.packageArchive({
		extension,
		name,
		version,
	});
	let url = `http://download.savannah.gnu.org/releases/${name}/${packageName}`;
	let outer = tg.Directory.expect(await std.download({ checksum, url }));
	return std.directory.unwrap(outer);
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

	let configure = {
		args: ["--disable-dependency-tracking", "--disable-rpath"],
	};
	let phases = { configure };

	let env = [attr.build(attrArg), env_];

	let output = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env: std.env.arg(env),
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
