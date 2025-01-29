import * as std from "../../tangram.ts";

export const metadata = {
	name: "bison",
	version: "3.8.2",
	provides: {
		binaries: ["bison"],
	},
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:9bba0214ccf7f1079c5d59210045227bcf619519840ebfa80cd3849cff5a5bf2";
	return std.download.fromGnu({
		name,
		version,
		compressionFormat: "xz",
		checksum,
	});
});

export type Arg = {
	build?: string;
	env?: std.env.Arg;
	host?: string;
	source?: tg.Directory;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const {
		build,
		env,
		host,
		source: source_,
	} = await std.args.apply<Arg>(...args);
	console.log("env", env);
	throw new Error("halt");

	const configure = {
		args: [
			"--disable-dependency-tracking",
			"--disable-nls",
			"--disable-rpath",
			"--enable-relocatable",
		],
	};

	let output = await std.utils.buildUtil({
		...(await std.triple.rotate({ build, host })),
		env,
		phases: { configure },
		sdk: false,
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
});

export default build;
import * as bootstrap from "../../bootstrap.tg.ts";
export const test = tg.target(async () => {
	const host = await bootstrap.toolchainTriple(await std.triple.host());
	const env = await bootstrap.sdk(host);
	const spec = {
		...std.assert.defaultSpec(metadata),
		bootstrapMode: true,
		env,
	};
	return await std.assert.pkg(build, spec);
});
