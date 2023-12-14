import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://www.gnu.org/software/bison/",
	license: "GPLv3",
	name: "bison",
	repository: "https://savannah.gnu.org/projects/bison/",
	version: "3.8.2",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:9bba0214ccf7f1079c5d59210045227bcf619519840ebfa80cd3849cff5a5bf2";
	let compressionFormat = ".xz" as const;
	return std.download.fromGnu({ compressionFormat, name, version, checksum });
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: std.Triple.Arg;
	env?: std.env.Arg;
	host?: std.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let bison = tg.target((arg?: Arg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	let configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-nls",
			"--disable-rpath",
			"--enable-relocatable",
		],
	};
	let phases = { configure };

	return std.autotools.build(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			phases,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default bison;

export let test = tg.target(() => {
	return std.build(
		`
		echo "Checking that we can run bison." | tee $OUTPUT
		bison --version | tee -a $OUTPUT
	`,
		{ env: bison() },
	);
});
