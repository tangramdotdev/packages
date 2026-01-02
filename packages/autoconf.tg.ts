import grep from "gnugrep" with { local: "./gnugrep.tg.ts" };
import * as m4 from "m4" with { local: "./m4.tg.ts" };
import * as perl from "perl" with { local: "./perl" };
import * as std from "std" with { local: "./std" };
import { $ } from "std" with { local: "./std" };
import * as zlib from "zlib" with { local: "./zlib.tg.ts" };

export const metadata = {
	homepage: "https://www.gnu.org/software/autoconf/",
	license: "GPL-3.0-or-later",
	name: "autoconf",
	repository: "https://git.savannah.gnu.org/git/autoconf.git",
	version: "2.72",
	tag: "autoconf/2.72",
	provides: {
		binaries: [
			"autoconf",
			"autoheader",
			"autom4te",
			"autoreconf",
			"autoscan",
			"autoupdate",
			"ifnames",
		],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:ba885c1319578d6c94d46e9b0dceb4014caafe2490e437a0dbca3f270a223f5a";
	return std.download.fromGnu({
		name,
		version,
		checksum,
		compression: "xz",
	});
};

const deps = std.deps({
	perl: { build: perl.build, kind: "buildtime" },
	zlib: zlib.build,
});

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg(
		{
			source: source(),
			deps,
		},
		...args,
	);

	const ctx = { build: arg.build, host: arg.host, sdk: arg.sdk };

	// Get the perl artifact for wrapping scripts later.
	const { perl: perlArtifact } = await std.deps.artifacts(deps, ctx);
	tg.assert(perlArtifact !== undefined);

	let autoconf = await std.autotools.build(arg);

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

	const shareDirectory = await autoconf.get("share").then(tg.Directory.expect);

	const interpreter = await tg.symlink({
		artifact: perlArtifact,
		path: "bin/perl",
	});

	let binDirectory = tg.directory();

	// Wrap autom4te
	const autom4te = await std.wrap(
		tg.symlink({
			artifact: autoconf,
			path: "bin/autom4te",
		}),
		{
			interpreter,
			args: ["-B", await tg`${shareDirectory}/autoconf`],
			env: std.env.arg(
				grep({ build: ctx.build, host: ctx.host }),
				m4.build({ build: ctx.build, host: ctx.host }),
				{
					autom4te_perllibdir: tg`${shareDirectory}/autoconf`,
					AC_MACRODIR: tg.Mutation.suffix(tg`${shareDirectory}/autoconf`, ":"),
					M4PATH: tg.Mutation.suffix(tg`${shareDirectory}/autoconf`, ":"),
					PERL5LIB: tg.Mutation.suffix(tg`${shareDirectory}/autoconf`, ":"),
					AUTOM4TE_CFG: tg`${shareDirectory}/autoconf/autom4te.cfg`,
				},
			),
		},
	);

	binDirectory = tg.directory(binDirectory, { ["autom4te"]: autom4te });

	// Wrap the shell scripts.
	for (const script of shellSripts) {
		const wrappedScript = await std.wrap(
			tg.File.expect(await autoconf.get(`bin/${script}`)),
			{
				env: {
					trailer_m4: tg.Mutation.setIfUnset(
						tg`${shareDirectory}/autoconf/autoconf/trailer.m4`,
					),
					AUTOCONF: tg`${binDirectory}/autoconf`,
					AUTOHEADER: tg`${binDirectory}/autoheader`,
					AUTOM4TE: autom4te,
					M4PATH: tg.Mutation.suffix(tg`${shareDirectory}/autoconf`, ":"),
					PERL5LIB: tg.Mutation.suffix(tg`${shareDirectory}/autoconf`, ":"),
					AUTOM4TE_CFG: tg`${shareDirectory}/autoconf/autom4te.cfg`,
				},
			},
		);

		binDirectory = tg.directory(binDirectory, {
			[script]: wrappedScript,
		});
	}

	// Wrap the perl scripts.
	for (const script of perlScripts) {
		const wrappedScript = await std.wrap(
			tg.File.expect(await autoconf.get(`bin/${script}`)),
			{
				interpreter,
				env: {
					AUTOCONF: tg`${binDirectory}/autoconf`,
					AUTOHEADER: tg`${binDirectory}/autoheader`,
					AUTOM4TE: autom4te,
					M4PATH: tg.Mutation.suffix(tg`${shareDirectory}/autoconf`, ":"),
					AUTOM4TE_CFG: tg`${shareDirectory}/autoconf/autom4te.cfg`,
					PERL5LIB: tg.Mutation.suffix(tg`${shareDirectory}/autoconf`, ":"),
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
};

export const patchAutom4teCfg = async (
	autoconf: tg.Directory,
	arg?: { env?: tg.Unresolved<std.env.Arg>; sdk?: std.sdk.Arg },
): Promise<tg.Directory> => {
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
			cat <<'EOF' | tee ${tg.output}
			${contents}
		`
		.env(arg?.env)
		.env(std.sdk(arg?.sdk))
		.then(tg.File.expect);

	return tg.directory(autoconf, {
		["share/autoconf/autom4te.cfg"]: patchedAutom4teCfg,
	});
};

export default build;

export const test = async () => {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
};
