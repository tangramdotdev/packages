import * as m4 from "m4" with { path: "../m4" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/bison/",
	license: "GPLv3",
	name: "bison",
	repository: "https://savannah.gnu.org/projects/bison/",
	version: "3.8.2",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
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

export const default_ = tg.target(async (...args: std.Args<Arg>) => {
	const resolved = await std.args.apply<Arg>(...args);
	const {
		autotools = {},
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = resolved;

	// Set up default build dependencies.
	const buildDependencies = [];
	const m4ForBuild = m4.default_({ build, host: build }).then((d) => {
		return { M4: std.directory.keepSubdirectories(d, "bin") };
	});
	buildDependencies.push(m4ForBuild);

	// Resolve environment.
	let env = await std.env.arg(...buildDependencies, env_);

	// Add final build dependencies to environment.
	const finalM4 = await std.env.getArtifactByKey({ env, key: "M4" });
	env = await std.env.arg(env, finalM4);

	// Set up phases.
	const configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-nls",
			"--disable-rpath",
			"--enable-relocatable",
		],
	};
	const phases = { configure };

	let output = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			phases,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

	// Wrap with BISON_PKGDATADIR to locate m4 support files.
	const bins = ["bison", "yacc"];
	const datadir = await output.get("share/bison").then(tg.Directory.expect);
	for (const bin of bins) {
		const unwrappedBin = await output.get(`bin/${bin}`).then(tg.File.expect);
		output = await tg.directory(output, {
			[`bin/${bin}`]: std.wrap(unwrappedBin, {
				env: { BISON_PKGDATADIR: datadir },
			}),
		});
	}

	return output;
});

export default default_;

export const test = tg.target(async () => {
	await std.assert.pkg({ buildFn: default_, binaries: ["bison"], metadata });
	return true;
});
