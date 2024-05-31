import * as std from "tg:std" with { path: "../std" };

export let metadata = {
	homepage: "https://jqlang.github.io/jq/",
	name: "jq",
	license: "https://github.com/jqlang/jq?tab=License-1-ov-file#readme",
	repository: "https://github.com/jqlang/jq",
	version: "1.7",
};

export let source = tg.target(async () => {
	let { name, version } = metadata;
	let checksum =
		"sha256:402a0d6975d946e6f4e484d1a84320414a0ff8eb6cf49d2c11d144d4d344db62";
	let extension = ".tar.gz";
	let packageArchive = std.download.packageArchive({
		name,
		version,
		extension,
	});
	let url = `https://github.com/stedolan/${name}/releases/download/${name}-${version}/${packageArchive}`;
	return await std
		.download({ checksum, url })
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let jq = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = [],
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	let configure = {
		args: ["--without-oniguruma", "--disable-maintainer-mode"],
	};
	let phases = { configure };

	return std.autotools.build(
		{
			...std.triple.rotate({ build, host }),
			env,
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export let test = tg.target(async () => {
	return std.build(tg`
		echo "Checking that we can run jq." | tee $OUTPUT
		${jq()}/bin/jq --version | tee -a $OUTPUT
	`);
});

export default jq;
