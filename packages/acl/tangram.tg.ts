import attr from "tg:attr" with { path: "../attr" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "acl",
	version: "2.3.2",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:5f2bdbad629707aa7d85c623f994aa8a1d2dec55a73de5205bac0bf6058a2f7c";
	let unpackFormat = ".tar.gz" as const;
	let packageName = std.download.packageArchive({
		name,
		version,
		unpackFormat,
	});
	let url = `http://download.savannah.gnu.org/releases/${name}/${packageName}`;
	let outer = tg.Directory.expect(
		await std.download({ checksum, unpackFormat, url }),
	);
	return std.directory.unwrap(outer);
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: tg.Triple.Arg;
	env?: std.env.Arg;
	host?: tg.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let acl = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let configure = {
		args: ["--disable-dependency-tracking"],
	};
	let phases = { configure };

	let env = [attr(arg), env_];

	let output = await std.autotools.build(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
			env,
			phases,
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

export default acl;

export let test = tg.target(async () => {
	let directory = acl();
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
		directory,
		libs: ["acl"],
		metadata,
	});
	return directory;
});
