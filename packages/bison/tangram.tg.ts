import * as m4 from "tg:m4" with { path: "../m4" };
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
	return std.download.fromGnu({
		compressionFormat: "xz",
		name,
		version,
		checksum,
	});
});

export type Arg = {
	build?: string;
	dependencies: {
		m4?: m4.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
	autotools?: std.autotools.Arg;
};

export let bison = tg.target(async (...args: std.Args<Arg>) => {
	let {
		autotools = [],
		build,
		dependencies,
		env: env_,
		host,
		source: source_,
		...rest
	} = await arg(...(args ?? []));

	let configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-nls",
			"--disable-rpath",
			"--enable-relocatable",
		],
	};
	let phases = { configure };

	let env = [m4.m4(dependencies?.m4 ?? {}), env_];

	return std.autotools.build(
		{
			...rest,
			...std.triple.rotate({ build, host }),
			env,
			phases,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default bison;

export let arg = tg.target(async (...args: std.Args<Arg>) => {
	return await std.args.apply<Arg>(args);
});

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: bison,
		binaries: ["bison"],
		metadata,
	});
	return true;
});
