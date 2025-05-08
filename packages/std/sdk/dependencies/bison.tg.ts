import * as std from "../../tangram.ts";

export const metadata = {
	name: "bison",
	version: "3.8.2",
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

export type Arg = {
	build?: string | undefined;
	env?: std.env.Arg;
	host?: string | undefined;
	sdk?: std.sdk.Arg | boolean;
	source?: tg.Directory;
};

export const build = async (arg?: tg.Unresolved<Arg>) => {
	const {
		build,
		env,
		host,
		sdk,
		source: source_,
	} = arg ? await tg.resolve(arg) : {};

	const configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-nls",
			"--disable-rpath",
			"--enable-relocatable",
		],
	};

	let output = await std.utils.autotoolsInternal({
		...(await std.triple.rotate({ build, host })),
		env,
		phases: { configure },
		sdk,
		source: source_ ?? source(),
		wrapBashScriptPaths: ["bin/yacc"],
	});

	// Wrap with BISON_PKGDATADIR to locate m4 support files.
	const bins = ["bison", "yacc"];
	const datadir = await output.get("share/bison").then(tg.Directory.expect);
	for (const bin of bins) {
		const unwrappedBin = await output.get(`bin/${bin}`).then(tg.File.expect);
		output = await tg.directory(output, {
			[`bin/${bin}`]: std.wrap(unwrappedBin, {
				buildToolchain: env,
				env: { BISON_PKGDATADIR: datadir },
			}),
		});
	}

	return output;
};

export default build;
import * as bootstrap from "../../bootstrap.tg.ts";

export const test = async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const sdkArg = await bootstrap.sdk.arg(host);
	// FIXME
	// await std.assert.pkg({ buildFn: build, binaries: ["bison"], metadata });
	return true;
};
