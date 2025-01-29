import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://www.bytereef.org/mpdecimal/index.html",
	license: "Simplified BSD",
	name: "mpdecimal",
	version: "4.0.0",
};

export const source = tg.target(async (): Promise<tg.Directory> => {
	const { name, version } = metadata;
	const checksum =
		"sha256:942445c3245b22730fd41a67a7c5c231d11cb1b9936b9c0f76334fb7d0b4468c";
	const base = `https://www.bytereef.org/software/mpdecimal/releases`;
	const extension = ".tar.gz";
	return std
		.download({
			checksum,
			base,
			name,
			version,
			extension,
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.args.apply<Arg>(...args);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default build;

export const provides = {
	headers: ["mpdecimal.h"],
	libraries: ["mpdec"],
};

export const test = tg.target(async () => {
	const spec = std.assert.defaultSpec(provides, metadata);
	return await std.assert.pkg(build, spec);
});
