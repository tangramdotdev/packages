import * as bash from "tg:bash" with { path: "../bash" };
import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://sourceware.org/bzip2/",
	license:
		"https://sourceware.org/git/?p=bzip2.git;a=blob;f=LICENSE;hb=6a8690fc8d26c815e798c588f796eabe9d684cf0",
	name: "bzip2",
	repository: "https://sourceware.org/git/bzip2.git",
	version: "1.0.8",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:ab5a03176ee106d3f0fa90e381da478ddae405918153cca248e682cd0c4a2269";
	let extension = ".tar.gz" as const;
	let packageArchive = std.download.packageArchive({
		name,
		version,
		extension,
	});
	let url = `https://sourceware.org/pub/${name}/${packageArchive}`;
	let artifact = tg.Directory.expect(await std.download({ checksum, url }));
	return std.directory.unwrap(artifact);
});

export type Arg = {
	autotools?: std.autotools.Arg;
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
		env,
		host: host_,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);
	let host = host_ ?? (await std.triple.host());

	let os = std.triple.os(std.triple.archAndOs(host));

	let sourceDir = source_ ?? source();

	// Only build the shared library on Linux.
	let buildCommand =
		os === "linux"
			? `make CC="$CC" SHELL="$SHELL" -f Makefile-libbz2_so && make clean && make CC="$CC" SHELL="$SHELL"`
			: `make CC="cc $CFLAGS" SHELL="$SHELL"`;

	let install =
		os === "darwin"
			? {
					command: `make install PREFIX="$OUTPUT" SHELL="$SHELL"`,
					args: tg.Mutation.unset(),
			  }
			: {
					command: `make install PREFIX="$OUTPUT" SHELL="$SHELL" && cp libbz2.so.* $OUTPUT/lib`,
					args: tg.Mutation.unset(),
			  };

	let fixup =
		os === "linux"
			? `
				chmod -R u+w $OUTPUT
				cd $OUTPUT/lib
				ln -sv libbz2.so.${metadata.version} libbz2.so
				cd $OUTPUT/bin
				rm bzcmp
				ln -s bzdiff bzcmp
				rm bzegrep bzfgrep
				ln -s bzgrep bzegrep
				ln -s bzgrep bzfgrep
				rm bzless
				ln -s bzmore bzless
			`
			: "";

	let phases = {
		build: buildCommand,
		configure: tg.Mutation.unset(),
		install,
		fixup,
	};

	let output = await std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
			buildInTree: true,
			env,
			sdk,
			source: sourceDir,
			phases,
		},
		autotools,
	);

	// Wrap installed scripts.
	let bashScripts = ["bzdiff", "bzgrep", "bzmore"];

	for (let script of bashScripts) {
		let file = tg.File.expect(await output.get(`bin/${script}`));
		output = await tg.directory(output, {
			[`bin/${script}`]: bash.wrapScript(file),
		});
	}

	return output;
});

export default build;

export let test = tg.target(async () => {
	let host = await std.triple.host();
	let os = std.triple.os(host);
	await std.assert.pkg({
		buildFunction: build,
		binaries: [{ name: "bzip2", testArgs: ["--help"] }],
		libraries:
			os === "darwin"
				? [{ name: "bz2", dylib: false, staticlib: true }]
				: ["bz2"],
		metadata,
	});
	return true;
});
