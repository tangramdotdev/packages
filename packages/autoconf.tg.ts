import grep from "gnugrep" with { source: "./gnugrep.tg.ts" };
import * as m4 from "m4" with { source: "./m4.tg.ts" };
import * as perl from "perl" with { source: "./perl" };
import * as std from "std" with { source: "./std" };
import { $ } from "std" with { source: "./std" };
import * as zlib from "zlib-ng" with { source: "./zlib-ng.tg.ts" };

export const metadata = {
	homepage: "https://www.gnu.org/software/autoconf/",
	license: "GPL-3.0-or-later",
	name: "autoconf",
	repository: "https://git.savannah.gnu.org/git/autoconf.git",
	version: "2.73",
	tag: "autoconf/2.73",
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

export function source() {
	const { name, version } = metadata;
	const checksum =
		"sha256:9fd672b1c8425fac2fa67fa0477b990987268b90ff36d5f016dae57be0d6b52e";
	return std.download.fromGnu({
		name,
		version,
		checksum,
		compression: "xz",
	});
}

export function deps() {
	return std.deps({
		perl: { build: perl.build, kind: "buildtime" },
		zlib: zlib.build,
	});
}

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export async function build(...args: tg.Args<Arg>) {
	const arg = await std.autotools.arg(
		{
			source: source(),
			deps,
		},
		...args,
	);

	// Get the perl artifact for wrapping scripts later.
	const { perl: perlArtifact } = await std.deps.artifacts(deps, arg);
	tg.assert(perlArtifact !== undefined);

	let autoconf = await std.autotools.build(arg);

	// Patch the autom4te.cfg file.
	autoconf = await patchAutom4teCfg(autoconf, {
		...std.args.optional("env", arg.env),
		...std.args.optional("sdk", arg.sdk),
	});

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
				grep({ build: arg.build, host: arg.host }),
				m4.build({ build: arg.build, host: arg.host }),
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
}

export async function patchAutom4teCfg(
	autoconf: tg.Directory,
	arg?: { env?: tg.Unresolved<std.env.Arg>; sdk?: std.sdk.Arg },
): Promise<tg.Directory> {
	const autom4teCfg = await autoconf.get("share/autoconf/autom4te.cfg");
	tg.assert(autom4teCfg instanceof tg.File);

	const lines = (await autom4teCfg.text).split("\n");

	// This patch step needs a real compiler, so an `sdk: "none"` argument contributes nothing here.
	const sdkArg = std.sdk.argObject(arg?.sdk);

	let contents = tg``;
	for (const line of lines) {
		let newLine: PromiseLike<tg.Template> | string = line;
		if (line.includes("args: --prepend-include")) {
			newLine = tg`args: -B '${autoconf}/share/autoconf'`;
		}
		contents = tg`${contents}${newLine}\n`;
	}

	const patchedAutom4teCfg = await $`
			cat <<'EOF' | tee ${tg.output}
			${contents}
		`
		.env(arg?.env ?? {})
		.env(std.sdk(...(sdkArg !== undefined ? [sdkArg] : [])))
		.then(tg.File.expect);

	return tg.directory(autoconf, {
		["share/autoconf/autom4te.cfg"]: patchedAutom4teCfg,
	});
}

export default build;

export async function test() {
	const spec = std.assert.defaultSpec(metadata);
	return await std.assert.pkg(build, spec);
}
