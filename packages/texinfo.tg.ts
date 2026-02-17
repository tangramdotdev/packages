import * as bash from "bash" with { local: "./bash.tg.ts" };
import * as gawk from "gawk" with { local: "./gawk.tg.ts" };
import * as gnused from "gnused" with { local: "./gnused.tg.ts" };
import * as ncurses from "ncurses" with { local: "./ncurses.tg.ts" };
import * as perl from "perl" with { local: "./perl" };
import * as std from "std" with { local: "./std" };
import * as zlib from "zlib-ng" with { local: "./zlib-ng.tg.ts" };

export const deps = () =>
	std.deps({
		ncurses: ncurses.build,
		perl: { build: perl.build, kind: "full" },
		zlib: zlib.build,
	});

export const metadata = {
	homepage: "https://www.gnu.org/software/texinfo/",
	license: "GPL-3.0-or-later",
	name: "texinfo",
	repository: "https://git.savannah.gnu.org/git/texinfo.git",
	version: "7.2",
	tag: "texinfo/7.2",
	provides: {
		binaries: [
			"install-info",
			"makeinfo",
			"pdftexi2dvi",
			"pod2texi",
			"texi2any",
			"texi2dvi",
			"texi2pdf",
			"texindex",
		],
	},
};

export const source = () => {
	const { name, version } = metadata;
	const checksum =
		"sha256:0329d7788fbef113fa82cb80889ca197a344ce0df7646fe000974c5d714363a6";
	return std.download.fromGnu({
		name,
		version,
		compression: "xz",
		checksum,
	});
};

export type Arg = std.autotools.Arg & std.deps.Arg<typeof deps>;

export const build = async (...args: std.Args<Arg>) => {
	const arg = await std.autotools.arg(
		{
			source: source(),
			deps,
			env: { CFLAGS: tg.Mutation.suffix("-std=gnu17", " ") },
		},
		...args,
	);

	const output = await std.autotools.build(arg);
	const host = arg.host;

	const { perl: perlArtifact } = await std.deps.artifacts(deps, {
		build: arg.build,
		host,
	});
	tg.assert(perlArtifact !== undefined);

	const interpreter = tg.File.expect(await perlArtifact.get("bin/perl"));

	const perlLibPaths = [
		tg`${output}/share/texi2any/lib/Text-Unidecode/lib`,
		tg`${output}/share/texi2any/lib/Unicode-EastAsianWidth/lib`,
		tg`${output}/share/texi2any/lib/libintl-perl/lib`,
		tg`${output}/share/texi2any/Pod-Simple-Texinfo`,
		tg`${output}/share/texi2any`,
	];

	const perlEnv: tg.Unresolved<std.env.Arg> = {
		PERL5LIB: tg.Mutation.suffix(tg.Template.join(":", ...perlLibPaths), ":"),
	};

	let binDir = tg.directory({
		["bin/install-info"]: output.get("bin/install-info"),
		["bin/pod2texi"]: std.wrap({
			executable: tg.File.expect(await output.get("bin/pod2texi")),
			interpreter,
			env: perlEnv,
		}),
		["bin/texi2any"]: std.wrap({
			executable: tg.File.expect(await output.get("bin/texi2any")),
			interpreter,
			env: perlEnv,
		}),
		["bin/makeinfo"]: tg.symlink("texi2any"),
	});

	// The shell scripts need sed in PATH.
	const sedArtifact = await gnused.build({ host });
	const sedEnv = await std.env.arg(sedArtifact);

	// Wrap texi2dvi first, as pdftexi2dvi and texi2pdf depend on it.
	const texi2dviFile = tg.File.expect(await output.get("bin/texi2dvi"));
	const texi2dviWrapped = await bash.wrapScript(texi2dviFile, host, sedEnv);
	binDir = tg.directory(binDir, {
		["bin/texi2dvi"]: texi2dviWrapped,
	});

	// pdftexi2dvi and texi2pdf exec texi2dvi internally, so they need it and sed in PATH.
	const texi2dviDir = tg.directory({ ["bin/texi2dvi"]: texi2dviWrapped });
	const pdfScriptEnv = await std.env.arg(sedArtifact, texi2dviDir);
	for (const script of ["pdftexi2dvi", "texi2pdf"]) {
		const scriptFile = tg.File.expect(await output.get(`bin/${script}`));
		binDir = tg.directory(binDir, {
			[`bin/${script}`]: bash.wrapScript(scriptFile, host, pdfScriptEnv),
		});
	}

	// texindex execs gawk with the texindex.awk script.
	const gawkArtifact = await gawk.build({ host });
	const texindexEnv = await std.env.arg(gawkArtifact, {
		TEXINDEX_AWK: tg.Mutation.setIfUnset(tg`${gawkArtifact}/bin/gawk`),
		TEXINDEX_SCRIPT: tg.Mutation.setIfUnset(
			tg`${output}/share/texinfo/texindex.awk`,
		),
	});
	const texindexFile = tg.File.expect(await output.get("bin/texindex"));
	binDir = tg.directory(binDir, {
		["bin/texindex"]: bash.wrapScript(texindexFile, host, texindexEnv),
	});

	return binDir;
};

export default build;

export const test = async () => {
	const spec = {
		...std.assert.defaultSpec(metadata),
		binaries: std.assert.binaries(metadata.provides.binaries, {
			pod2texi: { testArgs: ["--version"], snapshot: "0.01" },
		}),
	};
	return await std.assert.pkg(build, spec);
};
