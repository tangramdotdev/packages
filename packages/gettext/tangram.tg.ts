import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://www.gnu.org/software/gettext",
	license: "GPL-3.0-or-later",
	name: "gettext",
	repository: "https://git.savannah.gnu.org/git/gettext.git",
	version: "0.22.4",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:29217f1816ee2e777fa9a01f9956a14139c0c23cc1b20368f06b2888e8a34116";
	let compressionFormat = ".xz" as const;
	return std.download.fromGnu({ name, version, checksum, compressionFormat });
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: tg.Triple.Arg;
	env?: std.env.Arg;
	host?: tg.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let gettext = tg.target(async (arg?: Arg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	let output = await std.autotools.build(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
			source: source_ ?? source(),
		},
		autotools,
	);

	// Wrap output binaries.
	let libDir = tg.Directory.expect(await output.get("lib"));
	let binDir = tg.Directory.expect(await output.get("bin"));
	for await (let [name, artifact] of binDir) {
		let file = tg.File.expect(artifact);
		let wrappedBin = await std.wrap(file, { libraryPaths: [libDir] });
		output = await tg.directory(output, { [`bin/${name}`]: wrappedBin });
	}

	return output;
});

export default gettext;

export let test = tg.target(async () => {
	await std.assert.pkg({
		directory: await gettext(),
		binaries: ["msgfmt", "msgmerge", "xgettext"],
		metadata,
	});
	return true;
});
