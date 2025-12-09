import * as std from "std" with { local: "./std" };

export const metadata = {
	homepage: "https://www.bytereef.org/mpdecimal/index.html",
	license: "Simplified BSD",
	name: "mpdecimal",
	version: "4.0.1",
	tag: "mpdecimal/4.0.1",
	provides: {
		headers: ["mpdecimal.h"],
		libraries: ["mpdec"],
	},
};

export const source = async (): Promise<tg.Directory> => {
	const { name, version } = metadata;
	const checksum =
		"sha256:96d33abb4bb0070c7be0fed4246cd38416188325f820468214471938545b1ac8";
	const base = `https://www.bytereef.org/software/mpdecimal/releases`;
	const extension = ".tar.gz";
	return std.download
		.extractArchive({
			checksum,
			base,
			name,
			version,
			extension,
		})
		.then(tg.Directory.expect)
		.then(std.directory.unwrap);
};

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = async (...args: std.Args<Arg>) => {
	const {
		autotools = {},
		build,
		env,
		host,
		sdk,
		source: source_,
	} = await std.packages.applyArgs<Arg>(...args);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
