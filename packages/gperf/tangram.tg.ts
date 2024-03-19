import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://www.gnu.org/software/gperf/",
	license: "GPL-3.0-or-later",
	name: "gperf",
	repository: "https://git.savannah.gnu.org/git/gperf.git",
	version: "3.1",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:588546b945bba4b70b6a3a616e80b4ab466e3f33024a352fc2198112cdbb3ae2";
	return std.download.fromGnu({ name, version, checksum });
});

type Arg = {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	build?: tg.Triple.Arg;
	env?: std.env.Arg;
	host?: tg.Triple.Arg;
	sdk?: tg.MaybeNestedArray<std.sdk.Arg>;
	source?: tg.Directory;
};

export let gperf = tg.target(async (arg?: Arg) => {
	let { autotools = [], build, host, source: source_, ...rest } = arg ?? {};

	let configure = {
		args: ["--disable-dependency-tracking"],
	};
	let phases = { configure };

	return std.autotools.build(
		{
			...rest,
			...tg.Triple.rotate({ build, host }),
			phases,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default gperf;

export let test = tg.target(async () => {
	let directory = gperf();
	await std.assert.pkg({
		directory,
		binaries: ["gperf"],
		metadata,
	});
	return directory;
});
