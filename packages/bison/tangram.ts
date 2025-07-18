import * as std from "std" with { local: "../std" };

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

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:9bba0214ccf7f1079c5d59210045227bcf619519840ebfa80cd3849cff5a5bf2";
	return std.download.fromGnu({
		compression: "xz",
		name,
		version,
		checksum,
	});
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
	const resolved = await std.packages.applyArgs<Arg>(...args);
	const {
		autotools = {},
		build,
		env: env_,
		host,
		sdk,
		source: source_,
	} = resolved;

	const env = std.env.arg(env_);

	// Set up phases.
	const configure = {
		args: [
			"--disable-dependency-tracking",
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
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
