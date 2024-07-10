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
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export let build = tg.target(async (...args: std.Args<Arg>) => {
	let resolved = await std.args.apply<Arg>(...args);
	let {
		autotools = {},
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = resolved;

	// Set up default build dependencies.
	let buildDependencies = [];
	let m4ForBuild = m4.build({ build, host: build }).then((d) => {
		return { M4: std.directory.keepSubdirectories(d, "bin") };
	});
	buildDependencies.push(m4ForBuild);

	// Resolve environment.
	let env = await std.env.arg(...buildDependencies, env_);

	// Add final build dependencies to environment.
	let finalM4 = await std.env.getArtifactByKey({ env, key: "M4" });
	env = await std.env.arg(env, finalM4);

	// Set up phases.
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
