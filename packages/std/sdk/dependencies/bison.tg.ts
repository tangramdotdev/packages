import * as std from "../../tangram.ts";

export const metadata = {
	name: "bison",
	version: "3.8.2",
	tag: "bison/3.8.2",
	provides: {
		binaries: ["bison"],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:9bba0214ccf7f1079c5d59210045227bcf619519840ebfa80cd3849cff5a5bf2";
	return std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});
};

export type Arg = std.autotools.Arg;

export const build = async (...args: std.Args<Arg>) => {
	let output = await std.autotools.build(
		{
			source: source(),
			phases: {
				configure: {
					args: [
						"--disable-dependency-tracking",
						"--disable-nls",
						"--disable-rpath",
						"--enable-relocatable",
					],
				},
			},
		},
		...args,
	);

	// Wrap with BISON_PKGDATADIR to locate m4 support files.
	const datadir = await output.get("share/bison").then(tg.Directory.expect);

	// Wrap bison binary.
	const bisonBin = await output.get("bin/bison").then(tg.File.expect);
	output = await tg.directory(output, {
		["bin/bison"]: std.wrap(bisonBin, {
			env: { BISON_PKGDATADIR: datadir },
		}),
	});

	// Wrap yacc shell script with proper shebang and BISON_PKGDATADIR.
	let yaccScript = await output.get("bin/yacc").then(tg.File.expect);
	yaccScript = await std.utils.changeShebang(yaccScript);
	output = await tg.directory(output, {
		["bin/yacc"]: std.wrap(yaccScript, {
			env: { BISON_PKGDATADIR: datadir },
		}),
	});

	return output;
};

export default build;

export const test = async () => {
	return await build();
};
