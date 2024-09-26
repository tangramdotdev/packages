import * as bison from "bison" with { path: "../bison" };
import * as m4 from "m4" with { path: "../m4" };
import * as perl from "perl" with { path: "../perl" };
import * as std from "std" with { path: "../std" };
import { $ } from "std" with { path: "../std" };
import * as zlib from "zlib" with { path: "../zlib" };

export const metadata = {
	homepage: "https://www.gnu.org/software/autoconf/",
	license: "GPL-3.0-or-later",
	name: "autoconf",
	repository: "https://git.savannah.gnu.org/git/autoconf.git",
	version: "2.72",
};

export const source = tg.target(() => {
	const { name, version } = metadata;
	const checksum =
		"sha256:ba885c1319578d6c94d46e9b0dceb4014caafe2490e437a0dbca3f270a223f5a";
	return std.download.fromGnu({
		name,
		version,
		checksum,
		compressionFormat: "xz",
	});
});

export type Arg = {
	autotools?: std.autotools.Arg;
	build?: string;
	dependencies?: {
		bison?: bison.Arg;
		m4?: m4.Arg;
		perl?: perl.Arg;
		zlib?: zlib.Arg;
	};
	env?: std.env.Arg;
	host?: string;
	sdk?: std.sdk.Arg;
	source?: tg.Directory;
};

export const build = tg.target(async (...args: std.Args<Arg>) => {
	const arg = await std.args.apply<Arg>(...args);
	const {
		autotools = {},
		build,
		dependencies: {
			bison: bisonArg = {},
			m4: m4Arg = {},
			perl: perlArg = {},
			zlib: zlibArg = {},
		} = {},
		env: env_,
		host,
		sdk,
		source: source_,
	} = arg;

	const perlArtifact = await perl.build(
		{ build, env: env_, host, sdk },
		perlArg,
	);
	const dependencies = [
		perlArtifact,
		bison.build({ build, host: build }, bisonArg),
		m4.build({ build, host: build }, m4Arg),
		zlib.build({ build, env: env_, host, sdk }, zlibArg),
	];
	const env = std.env.arg(...dependencies, env_);

	let autoconf = await std.autotools.build(
		{
			...(await std.triple.rotate({ build, host })),
			env,
			sdk,
			source: source_ ?? source(),
		},
		autotools,
	);

	// Patch the autom4te.cfg file.
	autoconf = await patchAutom4teCfg(autoconf, arg);

	const shellSripts = ["autoconf"];

	const perlScripts = [
		"autoheader",
		"autoreconf",
		"autoscan",
		"autoupdate",
		"ifnames",
	];

	// Bundle the perl scripts.

	const interpreter = await tg.symlink({
		artifact: perlArtifact,
		path: "bin/perl",
	});

	let binDirectory = tg.directory();

	const autom4te = await std.wrap(
		tg.symlink({
			artifact: autoconf,
			path: "bin/autom4te",
		}),
		{
			interpreter,
			args: ["-B", await tg`${autoconf}/share/autoconf`],
			env: {
				autom4te_perllibdir: tg`${autoconf}/share/autoconf`,
				AC_MACRODIR: tg.Mutation.suffix(tg`${autoconf}/share/autoconf`, ":"),
				M4PATH: tg.Mutation.suffix(tg`${autoconf}/share/autoconf`, ":"),
				PERL5LIB: tg.Mutation.suffix(tg`${autoconf}/share/autoconf`, ":"),
				AUTOM4TE_CFG: tg`${autoconf}/share/autoconf/autom4te.cfg`,
			},
		},
	);

	binDirectory = tg.directory(binDirectory, { ["autom4te"]: autom4te });
	for (const script of perlScripts) {
		const wrappedScript = await std.wrap(
			tg.File.expect(await autoconf.get(`bin/${script}`)),
			{
				interpreter,
				env: {
					AUTOM4TE: autom4te,
					M4PATH: tg.Mutation.suffix(tg`${autoconf}/share/autoconf`, ":"),
					AUTOM4TE_CFG: tg`${autoconf}/share/autoconf/autom4te.cfg`,
					PERL5LIB: tg.Mutation.suffix(tg`${autoconf}/share/autoconf`, ":"),
				},
			},
		);

		binDirectory = tg.directory(binDirectory, {
			[script]: wrappedScript,
		});
	}

	// Bundle the shell scripts.
	for (const script of shellSripts) {
		const wrappedScript = await std.wrap(
			tg.File.expect(await autoconf.get(`bin/${script}`)),
			{
				env: {
					trailer_m4: tg.Mutation.setIfUnset(
						tg`${autoconf}/share/autoconf/autoconf/trailer.m4`,
					),
					AUTOM4TE: tg`${autoconf}/bin/autom4te`,
					M4PATH: tg.Mutation.suffix(tg`${autoconf}/share/autoconf`, ":"),
					PERL5LIB: tg.Mutation.suffix(tg`${autoconf}/share/autoconf`, ":"),
					AUTOM4TE_CFG: tg`${autoconf}/share/autoconf/autom4te.cfg`,
				},
			},
		);

		binDirectory = tg.directory(binDirectory, {
			[script]: wrappedScript,
		});
	}

	const output = tg.directory(autoconf, {
		["bin"]: binDirectory,
	});
	return output;
});

export const patchAutom4teCfg = tg.target(
	async (autoconf: tg.Directory, arg?: Arg): Promise<tg.Directory> => {
		const autom4teCfg = await autoconf.get("share/autoconf/autom4te.cfg");
		tg.assert(autom4teCfg instanceof tg.File);

		const lines = (await autom4teCfg.text()).split("\n");

		let contents = tg``;
		for (const line of lines) {
			let newLine: Promise<tg.Template> | string = line;
			if (line.includes("args: --prepend-include")) {
				newLine = tg`args: -B '${autoconf}/share/autoconf'`;
			}
			contents = tg`${contents}${newLine}\n`;
		}

		const patchedAutom4teCfg = await $`
			cat <<'EOF' | tee $OUTPUT
			${contents}
		`
			.env(arg?.env, std.sdk(arg?.sdk))
			.then(tg.File.expect);

		return tg.directory(autoconf, {
			["share/autoconf/autom4te.cfg"]: patchedAutom4teCfg,
		});
	},
);

export default build;

export const test = tg.target(async () => {
	await std.assert.pkg({
		buildFunction: build,
		binaries: ["autoconf"],
		metadata,
	});
	return true;
});
