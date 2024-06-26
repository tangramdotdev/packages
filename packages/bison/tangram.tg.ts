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
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		m4?: m4.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let resolved = await std.args.apply<Arg>(...args);
	console.log("resolved", resolved);
	let {
		autotools = {},
		build,
		dependencies: { m4: m4Arg = {} } = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = resolved;
	console.log("m4Arg", m4Arg);

	let configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-nls",
			"--disable-rpath",
			"--enable-relocatable",
		],
	};
	if (build !== host) {
		configure.args.push(`--build=${build}`);
		configure.args.push(`--host=${host}`);
	}
	let phases = { configure };

	let env = std.env.arg(m4.build(m4Arg), env_);

	return std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);
});

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["bison"],
		metadata,
	});
	return true;
});
