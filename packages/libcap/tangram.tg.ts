import attr from "tg:attr" with { path: "../attr" };
import perl from "tg:perl" with { path: "../perl" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	name: "libcap",
	version: "2.24",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let unpackFormat = ".tar.xz" as const;
	let packageName = std.download.packageArchive({
		name,
		version,
		unpackFormat,
	});
	let checksum =
		"sha256:cee4568f78dc851d726fc93f25f4ed91cc223b1fe8259daa4a77158d174e6c65";
	let url = `https://www.kernel.org/pub/linux/libs/security/linux-privs/libcap2/${packageName}`;
	let outer = tg.Directory.expect(
		await std.download({ checksum, unpackFormat, url }),
	);
	return std.directory.unwrap(outer);
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let libcap = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let install = tg.Mutation.set(`
		mkdir -p $OUTPUT/bin $OUTPUT/lib/pkgconfig
		bins="capsh getcap setcap getpcaps"
		for bin in $bins; do
			cp "progs/$bin" "$OUTPUT/bin"
		done
		cp -R libcap/include "$OUTPUT"
		cp libcap/libcap.pc "$OUTPUT/lib/pkgconfig"
		cp libcap/libcap.a "$OUTPUT/lib"
		cp libcap/libcap.so.${metadata.version} "$OUTPUT/lib"
		cd $OUTPUT/lib
		ln -s libcap.so.${metadata.version} libcap.so.2
		ln -s libcap.so.2 libcap.so
	`);
	let phases = { configure: tg.Mutation.unset(), install };

	let attrArtifact = await attr(arg);
	let dependencies = [attrArtifact, perl(arg)];
	let env = [
		...dependencies,
		{
			LDFLAGS: tg.Mutation.templatePrepend(`-L${attrArtifact}/lib`, " "),
		},
		env_,
	];

	let output = await std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			buildInTree: true,
			env,
			phases,
			source: source_ ?? source(),
		},
		autotools,
	);

	let bins = ["capsh", "getcap", "setcap", "getpcaps"];
	let libDir = tg.Directory.expect(await output.get("lib"));
	let attrLibDir = tg.Directory.expect(await attrArtifact.get("lib"));
	for (let bin of bins) {
		let unwrappedBin = tg.File.expect(await output.get(`bin/${bin}`));
		let wrappedBin = std.wrap(unwrappedBin, {
			libraryPaths: [libDir, attrLibDir],
		});
		output = await tg.directory(output, { [`bin/${bin}`]: wrappedBin });
	}
	return output;
});

export default libcap;

export let test = tg.target(async () => {
	let directory = libcap();
	let binTest = (name: string) => {
		return {
			name,
			testArgs: [],
			testPredicate: (stdout: string) => stdout.includes("usage:"),
		};
	};
	let binaries = ["capsh", "getcap", "setcap", "getpcaps"].map(binTest);
	await std.assert.pkg({
		directory,
		binaries,
		libs: ["cap"],
		metadata,
	});
	return directory;
});
