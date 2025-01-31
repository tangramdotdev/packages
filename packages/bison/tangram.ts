import * as m4 from "m4" with { path: "../m4" };
import * as std from "std" with { path: "../std" };

export const metadata = {
	homepage: "https://www.gnu.org/software/bison/",
	license: "GPLv3",
	name: "bison",
	repository: "https://savannah.gnu.org/projects/bison/",
	version: "3.8.2",
	provides: {
		// FIXME - yacc requires sed
		binaries: ["bison"],
		libraries: [{ name: "y", dylib: false, staticlib: true }],
	},
};

export const source = tg.command(() => {
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

export const build = tg.command(async (...args: std.Args<Arg>) => {
	const resolved = await std.args.apply<Arg>(...args);
	const {
		autotools = {},
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = resolved;

	const dependencies = [std.env.buildDependency(m4.build)].map((dep) =>
		std.env.envArgFromDependency(build, env_, host, sdk, dep),
	);

	// Resolve environment.
	const env = await std.env.arg(...dependencies, env_);

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

export default build;
export const test = tg.command(async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
});
