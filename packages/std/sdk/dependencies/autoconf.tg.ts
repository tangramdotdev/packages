import * as std from "../../tangram.tg.ts";
import bison from "./bison.tg.ts";
import m4 from "./m4.tg.ts";
import make from "./make.tg.ts";
import perl from "./perl.tg.ts";
import zlib from "./zlib.tg.ts";

export let metadata = {
	name: "autoconf",
	version: "2.72",
};

export let source = tg.target(() => {
	let { name, version } = metadata;
	let checksum =
		"sha256:ba885c1319578d6c94d46e9b0dceb4014caafe2490e437a0dbca3f270a223f5a";
	let compressionFormat = ".xz" as const;
	return std.download.fromGnu({ name, version, checksum, compressionFormat });
});

type Arg = std.sdk.BuildEnvArg & {
	autotools?: tg.MaybeNestedArray<std.autotools.Arg>;
	source?: tg.Directory;
};

export let build = tg.target(async (arg?: Arg) => {
	let {
		autotools = [],
		build,
		env: env_,
		host,
		source: source_,
		...rest
	} = arg ?? {};

	let perlArtifact = await perl(arg);
	let dependencies = [make(arg), perlArtifact, bison(arg), m4(arg), zlib(arg)];
	let env = [std.utils.env(arg), ...dependencies, env_];

	let autoconf = await std.utils.buildUtil(
		{
			...rest,
			...std.Triple.rotate({ build, host }),
			env,
			source: source_ ?? source(),
		},
		autotools,
	);

	// Patch the autom4te.cfg file.
	autoconf = await patchAutom4teCfg(autoconf, arg);

	let shellSripts = ["autoconf"];

	let perlScripts = [
		"autoheader",
		"autoreconf",
		"autoscan",
		"autoupdate",
		"ifnames",
	];

	// Bundle the perl scripts.

	let interpreter = await tg.symlink({
		artifact: perlArtifact,
		path: "bin/perl",
	});

	let binDirectory = tg.directory();

	let autom4te = await std.wrap(
		tg.symlink({
			artifact: autoconf,
			path: "bin/autom4te",
		}),
		{
			interpreter,
			args: ["-B", await tg`${autoconf}/share/autoconf`],
			env: {
				autom4te_perllibdir: tg`${autoconf}/share/autoconf`,
				AC_MACRODIR: tg.Mutation.templateAppend(
					tg`${autoconf}/share/autoconf`,
					":",
				),
				M4PATH: tg.Mutation.templateAppend(tg`${autoconf}/share/autoconf`, ":"),
				PERL5LIB: tg.Mutation.templateAppend(
					tg`${autoconf}/share/autoconf`,
					":",
				),
				AUTOM4TE_CFG: tg`${autoconf}/share/autoconf/autom4te.cfg`,
			},
			sdk: arg?.sdk,
		},
	);

	binDirectory = tg.directory(binDirectory, { ["autom4te"]: autom4te });
	for (let script of perlScripts) {
		let wrappedScript = await std.wrap(
			tg.File.expect(await autoconf.get(`bin/${script}`)),
			{
				interpreter,
				env: {
					AUTOM4TE: autom4te,
					M4PATH: tg.Mutation.templateAppend(
						tg`${autoconf}/share/autoconf`,
						":",
					),
					AUTOM4TE_CFG: tg`${autoconf}/share/autoconf/autom4te.cfg`,
					PERL5LIB: tg.Mutation.templateAppend(
						tg`${autoconf}/share/autoconf`,
						":",
					),
				},
				sdk: arg?.sdk,
			},
		);

		binDirectory = tg.directory(binDirectory, {
			[script]: wrappedScript,
		});
	}

	// Bundle the shell scripts.
	for (let script of shellSripts) {
		let wrappedScript = await std.wrap(
			tg.File.expect(await autoconf.get(`bin/${script}`)),
			{
				env: {
					trailer_m4: tg.Mutation.setIfUnset(
						tg`${autoconf}/share/autoconf/autoconf/trailer.m4`,
					),
					AUTOM4TE: tg`${autoconf}/bin/autom4te`,
					M4PATH: tg.Mutation.templateAppend(
						tg`${autoconf}/share/autoconf`,
						":",
					),
					PERL5LIB: tg.Mutation.templateAppend(
						tg`${autoconf}/share/autoconf`,
						":",
					),
					AUTOM4TE_CFG: tg`${autoconf}/share/autoconf/autom4te.cfg`,
				},
				sdk: arg?.sdk,
			},
		);

		binDirectory = tg.directory(binDirectory, {
			[script]: wrappedScript,
		});
	}

	let output = tg.directory(autoconf, {
		["bin"]: binDirectory,
	});
	return output;
});

export let patchAutom4teCfg = tg.target(
	async (autoconf: tg.Directory, arg?: Arg): Promise<tg.Directory> => {
		let autom4teCfg = await autoconf.get("share/autoconf/autom4te.cfg");
		tg.assert(tg.File.is(autom4teCfg));

		let lines = (await autom4teCfg.text()).split("\n");

		let contents = tg``;
		for (let line of lines) {
			let newLine: Promise<tg.Template> | string = line;
			if (line.includes("args: --prepend-include")) {
				newLine = tg`args: -B '${autoconf}/share/autoconf'`;
			}
			contents = tg`${contents}${newLine}\n`;
		}

		let env = [arg?.env, std.sdk(arg?.sdk)];

		let dir = tg.Directory.expect(
			await tg.build(
				tg`
			mkdir -p $OUTPUT
			cat <<'EOF' | tee $OUTPUT/autom4te.cfg
			${contents}
		`,
				{ env: await std.env.object(env) },
			),
		);

		return tg.directory(autoconf, {
			["share/autoconf/autom4te.cfg"]: dir.get("autom4te.cfg"),
		});
	},
);

export default build;

export let test = tg.target(async () => {
	await std.assert.pkg({
		directory: build({ sdk: { bootstrapMode: true } }),
		binaries: ["autoconf"],
		metadata,
	});
	return true;
});
